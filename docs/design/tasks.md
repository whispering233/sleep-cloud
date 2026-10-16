# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

- [ ] 卡 7：提前扩容（已用率 75% 扩 / 外圈空且已用 < 50% 缩）
  - **目标**：像 `ArrayList` 一样提前长，不等到一张空床都没有；两个阈值成对防自激。判据见 `10-hall-runtime.md` §8（含滞回推导）。
  - **改**：`src/shared/constants.ts` 加 `GROW_USED_RATIO = 0.75`、`SHRINK_USED_RATIO = 0.5`（注释指向 `10-hall-runtime.md` §8）；`src/hall/level-rules.ts`：`nextLevelCapacity` / `previousLevelCapacity` 改吃**已用床数**（或已用率），口径 = **≥ 0.75 升、< 0.5 才降（且外圈仍须全空）**；`src/hall/hall.ts`：把 `hasClaimableBed` 换成**已用床数计数**（复用 `bedBusy` 遍历，仍是同一次全表读，成本与今天相同）、`growIfNeeded` 与 `shrinkIfOuterRingEmpty` 接新判据；`isHallFull` 保持「末档 + 无空闲」不变。
  - **顺手一处**：`constants.ts` 里 `POOL_SIZE` 的注释还写着「可见范围约 5 床 × 3.5 行（≈ 18 床）」，与 `config.md` §3 现在写的「约一屏 10 床 + 邻接缓冲」不一致 —— 只改注释，**不改值**。
  - **不做**：不把「过期」规则抄进 SQL（继续用 `bedBusy`，别制造第三处副本）；不改触发点（升级仍在入场前，不做「认领后也检查」）；不动 `resize` 的消息形态与 `recoverPosition` 的降级流程。
  - **测试**（`src/hall/tests/level-rules.test.ts` 为主）：① 已用 74% 不升、75% 升；② 外圈空但已用 51% **不**降、已用 49% 降；③ 外圈不空时任何比率都不降；④ 滞回自洽：用级表步长断言括号式「扩完的已用率 < 升阈值」与「缩完的已用率 < 升阈值」（防自激，就是 §8 那段推导）；⑤ 末档 + 无空闲仍 `2002`；⑥ 一条 Hall 级用例（照 `broadcast.test.ts` 模式）：`meta.bed_count = 117` + 塞 88 张有主床 → `growIfNeeded()` 触发一次 `resize` 到 150 且只发一条。
  - **独立验收（≤5 条）**：①–⑥ 的单测全绿 + `typecheck`；② 反例回归：把已用床数压回 74% 后不再触发第二次 `resize`（同一档不连跳）；③ `CHANGELOG.md` 的 `### Changed` 补一条。