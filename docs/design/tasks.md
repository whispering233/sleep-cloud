# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

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
