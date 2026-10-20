# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

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
