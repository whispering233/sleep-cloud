# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

文档已经先改完（`10-hall-runtime.md`、`00-master-design.md`、`config.md`、`architecture.md`、`db/schema.md`、`api/20-api-ws.md`、`api/api-public.md`、`70-privacy-risk.md`、`backlog.md`、`README.md`）。**代码未跟上时单测会红，这是预期顺序**，由下面两张卡收口。

## 卡 2 · 断线重连以床位行为唯一权威

**为什么**：现在重连只认 `trace` 行，60 秒内回来就恢复不出来（用户实测：<60 秒重连后点自己的床得到 `3002` 「这张床有人了」）。内存宽限记录救不了这件事——对象空闲约 10 秒就休眠，被驱逐时连 `close` 事件都不给。

**改哪些**

- `src/hall/hall.ts`：删内存宽限记录全部 7 处——`private readonly grace` 字段、`takeGrace()`、`resumeSession` 里的 `graced` 分支、`webSocketClose` 里的 `grace.set`、`expireGrace` 尾部的清理循环、`GraceSession` import、`grace.ts` 的 import。**保留** `due` 里的 `grace` 事件与 `hello` 里的 `due.remove('grace', …)`。
- `src/hall/hall.ts` `resumeSession`：判据改成**床位行**——
  1. `findOccupiedBedByOwner(sql, userId, now)`（新增：`owner_user_id = ? AND state IN ('lying','asleep','trace')`，走 `bed_owner_user_id` 索引）命中且 `state IN ('lying','asleep')` → 原状态恢复（`state` 照搬，位置 = `frontPointOf(bedNo)`），**不广播**（别人看到的画面本来就没变）。
  2. 命中且 `state = 'trace'` → `restoreBedOccupancy`（清洗为 `state = 'asleep'`，见 `docs/db/schema.md` §6）→ 原位恢复 + `broadcastState`（别人那边是暗的，必须推一条「我醒了」）。
  3. 没命中 → 保留现有的「有归属就站床脚 / 否则出生点」两条。
- `src/hall/bed-store.ts`：`restoreBedOccupancy` 的 `state` 从硬写 `'lying'` 改为写 `'asleep'`（函数注释同步改：睡痕恢复 = 睡着的还原，归属与 `sleep_started_at` 不动）。
- `src/hall/grace.ts`：删 `GraceSession`；文件头注释改成「宽限只有一根时间轴：床位行的 `last_seen_at` + 有没有活连接」；顺手把注释里错的「硬纪律第 9 条」改成第 10 条。
- 测试：`src/hall/tests/` 下涉及 `takeGrace` / 恢复路径的用例改成走床位行；补两条断言——① `lying` / `asleep` 行在宽限内重连后状态**原样**（`asleep` 不许退成 `lying`）② `trace` 行重连后是 `asleep` 且发了一次 `state` 广播。

**验收**

1. `npm test` 与 `npm run typecheck` 全绿。
2. `grep -rn "takeGrace\|GraceSession\|grace.set" src/` 无结果。
3. 端到端手工路径（本地 `npm run dev`）：躺下 → 点「睡了」→ 关页面 → **10 秒内**重进 → 仍在床上且是**睡着**（出现「起身」而不是「睡了」）；再走一次**关页面后等 70 秒**重进 → 同样仍在床上睡着，且别人那条连接收到一次 `state`。
