# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> **本批剩下的两张卡都落在 `src/client/world/views.ts` → 必须串行派工，不要并行。** 设计前置已随 `11e82a9` 提交（文档领先于代码是预期状态）。

- [ ] 卡 3：走速 220 px/s + 走路摆动 4.5 Hz
  - **目标**：一屏之内走起来不拖沓。数值与两条硬约束已写进 `config.md` §3（`11e82a9`）。
  - **改**：① `src/shared/constants.ts` `WALK_SPEED_PX_PER_S: 130 → 220`；② `src/shared/tests/constants.test.ts` 的字面断言同步（§3 是字面断言，不是读文档）；③ `src/client/world/views.ts` `WALK_SWAY_HZ: 3 → 4.5`（幅度仍 3%）。
  - **不做**：不动 `advanceMover` 的算法（推进量仍按**实际经过时间**算）、不动 `TICK_MS`、不动 `MAX_INTERPOLATION_DELAY_MS`、不动相机跟随上限 `CAMERA_FOLLOW_PX_PER_S = 500`。
  - **独立验收（≤6 条，手机视口 + 桌面各一次）**：① `npm test` 全绿（常量与文档一致）；② 走一格（173px）实测 0.79s ±15%、一屏（393px）≈1.8s；③ 按 `../ui/DESIGN.md` 的「不跳」口径分开量：小人**世界坐标**单帧位移 <10px（60fps 预期 3.7px）、相机**滚动量** ≤ 500×dt；④ 稳态跟随不回跳（沿用既有验收法：连续走动时相机步进 = 小人步进）；⑤ 摆动幅度仍约 3%、频率 4.5Hz，肉眼看无明显「滑行」；⑥ 与睡着的人/静止的人无关（只影响移动者）。
  - **CHANGELOG**：`### Changed` 补一条。