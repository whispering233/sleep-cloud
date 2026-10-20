# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

## 卡 7：举报按被举报人折叠

接口见 `docs/api/30-api-admin.md` §5.7。

### 产物

1. `src/hall/report.ts`：`listReportTargets(sql, limit)` —— `GROUP BY target_user_id`，取 `SUM(count)` / `COUNT(*)` / `MAX(last_at)`，事由用相关子查询取**最近那一行**的 `reason`；排序 `count DESC, last_at DESC`。
2. `src/hall/admin.ts`：`reportTargetsPage(url, ctx)` 回 `{ items }`（无 `next`），每项 `{ target: { userId, nickname }, count, reporters, lastAt, reason }`，昵称走既有 `partyOf`；路由 `resource === 'reports' && second === 'targets'`，**不要**改坏 `resource === 'reports' && second === undefined` 那条。
3. `src/worker/admin.ts`：转发 `admin.get('/reports/targets', forward)`。
4. `public/admin.html`：举报区块上方加一张「按被举报人」表（列：被举报人 / 次数 / 举报人数 / 最近一次 / 最近事由），被举报人格仍是 `<details>`、复用既有台账详情加载函数；后接原明细表（标题区分「明细」）。
5. 单测 `src/hall/tests/admin-api.test.ts`：两人各被不同人数举报 → 合计次数与 `reporters` 对得上、排序按合计倒序、昵称 `null`、`reason` 取最近那一行。

### 验收

- 后台能一眼看出「谁被最多人举报」，点进去仍是台账详情（封禁只在台账那一处）。
- `npm test` / `npm run typecheck` 绿。

### 不做

按时间窗过滤、导出、举报状态流转、在聚合行上直接封禁。

**当前没有进行中的卡片。**
