# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

## 卡 4：举报的服务端闭环（表 + 发言缓冲 + 上行 + 回执 + 清理）

设计口径以文档为准，不要自行改：`docs/db/schema.md` §4.4、`docs/api/20-api-ws.md` §4.9、`docs/api/error-code.md` 的 `5003`、`docs/design/10-hall-runtime.md` §10.1、`docs/design/config.md` §3 的四个 `REPORT_*` 常量。

### 产物

1. `src/shared/constants.ts`：`REPORT_REASON_MAX_LEN = 200`、`REPORT_EVIDENCE_MAX = 10`、`REPORT_DEDUP_MS = 24h`、`REPORT_TTL_MS = 90d`。
2. `src/shared/protocol.ts`：`UPSTREAM_TYPES` 加 `'report'`，并给它一个带类型的上行结构 `{ t: 'report', toId: string, reason: string }`。
3. `src/hall/schema.ts`：`REPORT_TABLE_SQL`（列与索引照 `docs/db/schema.md` §4.4）+ `REPORT_INDEX_SQL`；`initializeStorage()` 里建表（新表用 `CREATE TABLE IF NOT EXISTS` 就够，**不需要** `ALTER`）。
4. 新模块 `src/hall/report.ts`：
   - `recordReport(sql, input, now)`：先按 `(reporter_user_id, target_user_id)` + `last_at > now - REPORT_DEDUP_MS` 找一行；命中 → `UPDATE report SET count = count + 1, last_at = ? WHERE id = ?`（**不刷新事由与证据**）；未命中 → `INSERT`。返回 `'merged' | 'created'`。
   - `listReports(sql, { limit, before })`：`id DESC` 分页（自增主键游标）。
   - `purgeExpiredReports(sql, now)`：`DELETE FROM report WHERE last_at < ?`。
5. `src/hall/hall.ts`：
   - 实例上一个 `Map<string, { text: string; at: number }[]>` 当**发言缓冲**（每 userId 最多 `REPORT_EVIDENCE_MAX` 条，先进先出）。`chat` 与 `whisper` 成功发出后写入**打码后的那份文本**；**不许**写进 `ConnectionState` 附加数据（附件要跨休眠存活，放它上面等于持久化聊天内容）。
   - 上游 `case 'report'`：`toId` 必须是非空字符串且不等于自己（否则 `4003` 静默）；`reason` trim 后为空 → `4003`，超过 `REPORT_REASON_MAX_LEN` → `4001`；然后取**目标**的缓冲当证据，落库，回 `{ t: 'error', code: '5003' }`。去重命中（`merged`）也回 `5003`。限流沿用既有 5 条/秒窗口（超额静默，不额外发码）。
   - 每日唤醒：`purgeExpiredReports` + 清空发言缓冲（`clear()`），两条都别新开定时器。
6. 单测 `src/hall/tests/report.test.ts`（复用 `freshSql()` 夹具）：首次落库、24 小时内重复只加计数且不换事由/证据、超过 24 小时另起一行、证据是目标的最近 10 条且**不含举报人自己的话**、`purgeExpiredReports` 只删过期行、`listReports` 分页。

### 验收

- `report` 上行端到端：`hello` 之后发 `report` → 收到 `5003`，库里一行，`evidence` 与目标最近的发言逐字一致。
- 空事由 / 超长 / 举报自己都不落库：前两者分别回 `4003` / `4001`，后者 `4003`。
- 24 小时内两次举报同一人：库里仍一行、`count = 2`。
- 每日唤醒跑一次后，`last_at` 超 90 天的行消失。
- `npm test` / `npm run typecheck` 绿；词表/内容过滤相关既有测试不得改动。

### 不做

客户端界面、后台页面、全量聊天日志、按举报自动封禁。

## 卡 5：客户端举报交互（点小人 → 举报 → 事由 → 回执）

设计要求见 `docs/design/60-interaction-shell.md` §2（`composer` 三个值）、`docs/design/50-slot-panel.md` §4。

### 产物

1. `src/client/composer.ts`：`ComposerState` 加 `'report'`；事件加 `{ kind: 'report' }`（`idle` / `typing` → `report`）；**`focus-in` 在 `report` 下返回 `report`（不降级）**，其余仍 `→ 'typing'`。
2. `src/client/focus.ts`：可编辑控件的判定选择器改为 `.chat-panel, .slot-panel`（事由框在插槽面板里，是兄弟节点；只匹配前者会让聚焦当场触发对账退场）。
3. `src/client/styles/app.css`：4 处 `[data-composer='typing']` 与 1 处 `:not([data-composer='typing'])` 改成 `[data-composer]:not([data-composer='idle'])`；`data-composer` 属性值仍写**明文状态**（e2e 断言它）。
4. `src/client/components/ChatPanel.tsx`：私聊行三栏（名字 `flex-[3]`、竖线、举报按钮 `flex-[1]`、`×` 最右）——**保留「私聊 小明」文字**，举报按钮自带「举报」文案；点它 = 进 `report` 态并聚焦事由框。`children` 二选一：`report` → 举报表单，否则快捷用语。
5. 新组件 `src/client/components/ReportForm.tsx`：独立 `<form>`（**不能嵌进聊天那个 `<form>`**，否则事由里按 Enter 会提交聊天）；多行 `textarea`（placeholder「举报事由」，`maxLength = REPORT_REASON_MAX_LEN`，**Enter 换行不提交**）+「确认举报」按钮（trim 后为空时禁用）；内容顶对齐、不底锚（键盘弹起会盖住底部按钮）。
6. store 与发送：`sendReport(toId, reason)`；记住 `pendingReportTo`；收到 `5003` → 把它加进本地的「已举报」集合（按钮置灰成「已举报」，本次会话内有效）、`exitComposer()`、`chat-hint` 那行写「已收到你的反馈」（常驻到下一次操作，**不挂定时器**）。

### 验收

- 单测（`src/client/tests/` 现有 composer 测试）：`idle`→`report`、`report` 下 `focus-in` 仍是 `report`、`report` 下 `exit` / `offline` / `lost-focus` 都回 `idle`。
- `e2e/shell.spec.ts` 的 `expectComposer` 扩成允许 `'report'`；新增一条：选中某人 → 点举报 → `data-composer="report"` 且事由框可输入 → 点「收起」回 `idle`。
- `npm test` / `npm run typecheck` / `npm run e2e` 绿。

### 不做

举报的历史列表、撤回举报、举报后自动拉黑。

## 卡 6：后台举报列表

接口见 `docs/api/30-api-admin.md` §5.6。

### 产物

1. `src/hall/admin.ts`：`GET /api/admin/reports?limit&before`，返回 `{ items, next }`；每项按 §5.6 的字段组装（`reporter` / `target` 的昵称用 `findIdentity` 现补，可能为 `null`）。
2. `public/admin.html`：第四个区块「举报」——表格列：时间（`lastAt`）/ 次数 / 举报人（昵称 + userId）/ 被举报人（昵称 + userId，**可点，点了展开该身份的台账详情**）/ 事由 / 证据（每条一行，`<details>` 折叠也行）；分页与台账一致。
3. 单测 `src/hall/tests/admin-api.test.ts`：列表字段齐、昵称为空时是 `null`、`evidence` 数组透传、游标翻页不重复。

### 验收

- 后台能看清「谁举报了谁、说了什么、当时他说了什么」，并从举报行一键跳到该身份的详情（封禁仍只在那一处）。
- `npm test` / `npm run typecheck` 绿。

### 不做

在举报区直接封禁、批量处理、举报状态（已读/已处理）流转。
