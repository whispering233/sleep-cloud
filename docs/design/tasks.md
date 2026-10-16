# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> 设计前置已随本批文档提交（`master` §4/§5.2、`error-code` §1–§4、`20-api-ws` §3/§4.5、`config` §2、`schema`、`DESIGN` 「谁能躺」、`10-hall-runtime` 复合意图表、`backlog`）。**镜像测试现在预期会红**（错误码表与枚举双向等行数），由本卡收口。

- [ ] 卡 8：换床（点任意空床即搬）+ 10 秒冷却
  - **目标**：一人一床的语义从「不能换」改成「**可以搬，但不要连着搬**」。规则见 `master` §4 与 §5.2、`api/20-api-ws.md` §3 的 `lie` 行与 §4.5、`error-code.md` 的 `3008`、`config.md` §2 的 `BED_SWITCH_COOLDOWN_MS`。
  - **改（错误码，镜像逐字）**：
    - `src/shared/error-code.ts`：**删** `'3007'`，**加** `'3008': 'bed switch cooling down'`（文档表里 3007 整行已删、3008 已加 → 枚举与文档必须**行数相同**）。
    - `src/client/error-text.ts`：**删** `'3007'`，**加** `'3008': '刚换过床，稍等一下'`（必须与 `error-code.md` §2 的「用户可见文案方向」列**逐字一致**）。
    - `src/client/tests/error-text.test.ts`：`toHaveLength(25)` **不变**（−1 +1）；注释里拿 `3007` 举的例子改成 `3008`。
  - **改（常量）**：`src/shared/constants.ts` 加 `BED_SWITCH_COOLDOWN_MS = 10_000`；`src/shared/tests/constants.test.ts` 的时间常量断言补一条。
  - **改（判据，纯函数）**：`src/hall/bed-rules.ts`：
    - `checkLie` 入参 `ownedBedNo?: number` → **`owned?: { bedNo: number; claimedAt: number | null }`**，新增 `now: number`；
    - **删** `3007` 那一行；**加**冷却判据，且**只在 `claimable === true` 且 `owned !== undefined`** 时判：`owned.claimedAt !== null && now - owned.claimedAt < BED_SWITCH_COOLDOWN_MS` → `3008`（`claimedAt === null` 视为无冷却，不能用旧数据卡住人）；
    - `LieVerdict` 的 ok 分支加 `releasingBedNo?: number`（= 旧床号，供广播用）；优先级顺序保持：床号 → 已在床上 → 占用 → 别人的床 → **冷却** → 认领。
  - **改（存储）**：`src/hall/bed-store.ts` 的 `findOwnedBed` 改成返回 **`{ bedNo, claimedAt } | undefined`**（同一次单行读，多取 `claimed_at` 一列），并更新全部调用点（`hall.ts` 的 resumeSession 步 0、goHome、两处 `lieVerdictFor`、快照的 `myOwnedBedNo`）；`bed-store.ts:303` 那句提到 3007 的注释同步。
  - **改（广播）**：`hall.ts` 的 `lieDown`：**先**广播旧床释放（`{ t:'bed', bedNo: verdict.releasingBedNo, owned:false }`）、**再**广播新床认领（`owned:true`）、最后 `broadcastState`。两处 `lieVerdictFor` 调用点补齐 `owned` / `now`。
  - **不做**：不做「解绑床」意图（进 `backlog.md`）；不动 `putInBed` 的清行逻辑（它本来就能搬）；不改唯一索引；不动 `spawnPoint` / `resumeSession` 的出生点规则；不加冷却的 UI 提示以外的任何界面（HUD 不加倒计时）。
  - **测试**：
    - `src/hall/tests/bed-rules.test.ts`：把现有 4 条 `3007` 用例改成——① 已有床 + 目标另一张无主床 + 距认领 >10s → `{ ok:true, claiming:true, releasingBedNo:旧床 }`；② 距认领 <10s → `3008`（用 9_999 / 10_001 卡边界）；③ `claimedAt === null` → 允许；④ 躺回自己那张 → `{ ok:true, claiming:false }` 且**无** `releasingBedNo`；⑤ 优先级：`3002` / `3003` 仍先于 `3008`。
    - Hall 级（照 `broadcast.test.ts` 的 `newHall(sockets)` + FakeSocket）：换床一次 → 库里旧床 `owner_user_id` 被清、新床有主；**收到的消息顺序 = `bed(旧,false)` → `bed(新,true)` → `state`**。
  - **独立验收（≤5 条）**：① `npm test` + `npm run typecheck` + `npm run lint:design` 全绿；② 边界用例（9_999 拒 / 10_001 允 / `claimedAt=null` 允）有断言；③ 广播顺序有断言（旧床释放在新床认领之前）；④ 文档零残留：`grep -rn "3007" src/ docs/` 只剩 `error-code.md` §1/§4 的历史说明；⑤ `CHANGELOG.md` 的 `### Changed` 补一条（不写任务卡语义）。