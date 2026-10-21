# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1 · 后台壳：侧栏 + hash + 分段 + 空态 + 只读抽屉 + toast

- **范围**：`public/admin.html` 拆出 `public/admin.css` / `public/admin.js`（同目录、无目录、无打包）；侧栏五个视图（`#identities` / `#blocks` / `#audit` / `#reports` / `#feedback`，空 hash → `#identities`，未知 → `#identities`）；视图切换卸载重渲染（旧定时器全清，本卡还没有定时器）；`@media (max-width: 1023px)` 侧栏顶栏化；`thead` sticky；表格空态；身份抽屉（read-only，复用 `loadIdentityDetail`）；写操作统一 toast 显错（替换 `alert`）。接口零改动，登录/封禁/解封/分页行为不变。
- **验收**：`npm run typecheck` 不变红；`node --check public/admin.js`；手工：五个 hash 直达、未知 hash 回落、表格空态只有一行、抽屉能打开且不发写请求、断网时 toast 有文案、1440 与 375 宽都不横向溢出；`ui-verifier` 独立复核（含 1023px 临界与刷新后 hash 保持）。
- **不碰**：任何 `/api/admin/*` 契约、封禁表单、`confirm()`、`_headers`、`app.html`、React 前端、构建配置。
- **产出**：`public/admin.css`、`public/admin.js`、`public/admin.html`、`CHANGELOG.md`（Added）。

## 卡 2 · 统计卡：`GET /api/admin/stats` + 概览

- **范围**：`src/hall/admin.ts` 加只读路由；`src/worker/admin.ts` 加转发；`src/shared/constants.ts` 不加新常量（口径引用 `BED_OWNERSHIP_TTL_MS`）；服务端按 `110-admin-console.md` §2 四条口径各一条 SQL；页面概览按视图挂载/切换重拉（`Promise.all` 三视图并发，`needsStats`），不轮询；四个数字与口径说明；`.metric` 样式。
- **验收**：新增单测覆盖四条口径（无主/过期有主/未过期有主、永久封禁/过期封禁/未封禁、近 24 小时举报计数、`online = live.length`）；`npm test`、`npm run typecheck` 绿；`ui-verifier` 复核统计卡出现于每个视图顶部、数字随封禁/举报变化（造一条测试数据）。
- **不碰**：`/identities` / `/blocks` / `/audit` / `/reports` 契约；票据/缓存/会话；前端客户端。
- **依赖**：卡 1 的壳（概览容器）。

## 卡 3 · 反馈服务端：表 + 协议 + 5004/4004 + 每日上限 + 90 天清理

- **范围**：`src/hall/schema.ts` 建 `feedback` 表与两个索引；`src/shared/protocol.ts` 上行 `feedback {text}` 与类型串；`src/shared/error-code.ts` 加 `5004` / `4004`（并修正 `5003` 旧注释）；`src/shared/constants.ts` 三常量；新建 `src/hall/feedback.ts`（校验顺序空 `4003` → 长 `4001` → 配额 `4004` → `insert` → 回 `5004`；滚动 24 小时 `user_id` 计数，`now` 只取一次）；`src/hall/hall.ts` 分发与 ack（`send(ws, { type: 'error', code: '5004' })`）；每日清理点加 `DELETE FROM feedback WHERE created_at < now - FEEDBACK_TTL_MS`；镜像测试（协议类型清单、错误码清单）与单测（空/超长/配额/过期/边界）。
- **验收**：`npm test`、`npm run typecheck` 绿；`npm run lint:design` 0 error；手工用 `wscat`/现有客户端脚本发 6 条验证 `5004`×5 + `4004`×1，且 5 条/秒限流命中时静默丢弃；清理语句在测试里用注入时钟验证边界（`>= now - 90d` 保留，`<` 删）。
- **不碰**：举报协议与 `report` 表；客户端界面（本卡落地后入口尚未出现，允许暂时「协议可用、界面未接」）；`public/admin.*`。
- **注意**：文档先于代码，本卡销掉镜像测试的红。

## 卡 4 · 反馈客户端：齿轮入口 + 面板 + 回执退场 + 告知

- **范围**：`src/client/composer.ts` 新状态 `feedback`（两条 READ，`focusin` 不许把 `feedback` 降回 `typing`，`focus-in` 不能覆盖它）；`store.ts` 菜单开/关 action；`components/FeedbackForm.tsx`（多行、字数、发送、取消、`autoFocus`、错误用黄色 `.hint`、`pointerdown` preventDefault + 稳定 `key`）；`components/IntroPanel.tsx` 左侧一层镜像；`components/ActionRow.tsx` 齿轮菜单「反馈与建议」；`ChatPanel.tsx` 插槽条件；`ws.ts` 发 `{type:'feedback', text}` 且 `onmessage` 不早返回（否则 5004 到不了电脑）；`error-text.ts` 三条文案；`store.ts` 收 `5004` 时 `exitComposer()` + hint；`public/privacy.html`、`README.md`、`docs/design/50-slot-panel.md` 的「用户可读告知」与实现同批。
- **验收**：单测覆盖 composer 状态机（`focusin` 不降级、失焦退场、`5004` 退场）；`ui-verifier` 在 393×852 真机/模拟器（本仓库无模拟器时用桌面手机视口并在结论注明）走完整链路：齿轮 → 反馈 → 写 5 字 → 发送 → 面板关 → toast「收到了」；超长与空文本按钮禁用；「收起」与 Esc 都能退场；打字态与面板位置符合 `60`。
- **不碰**：举报表单；后台列表（下一卡）；任何服务端字段。
- **依赖**：卡 3 的协议与 ack。

## 卡 5 · 反馈后台列表：`GET /api/admin/feedback` + 只读视图

- **范围**：`src/hall/admin.ts` 加 `GET /feedback`（`limit` 50/最大 100，`before` 游标，`next` 末条 id）；`src/worker/admin.ts` 转发；`public/admin.js` `#feedback` 视图（倒序、`text` 保留换行、昵称走身份 PK、空态、上一页/下一页、不渲染 `userId`）；无写操作、无标记。
- **验收**：单测覆盖分页边界（空表、`limit` 夹取、`next` 为 0 不出现）；`ui-verifier` 复核：用卡 3 的测试数据看到新反馈在首行、长文本折行、翻页、空态、无写按钮。
- **不碰**：反馈提交路径、封禁表单、`/reports` 视图。
- **依赖**：卡 1 的壳、卡 3 的表。
