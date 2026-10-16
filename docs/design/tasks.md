# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> **本批剩下的两张卡都落在 `src/client/world/views.ts` → 必须串行派工，不要并行。** 设计前置已随 `11e82a9` 提交（文档领先于代码是预期状态）。

- [ ] 卡 2：房间地面与预留位（两层固定色贴片）
  - **目标**：每间房的地（`roomOf`）与留给装饰物的预留位（`reserveOf`）画出来，让「一格一间」读得出来、新人也看得出哪块是空地。色阶与「只有走道地板跟困倦度缓动」的规则已写进 `../ui/DESIGN.md`（`11e82a9`）。
  - **改**：① `src/client/world/views.ts` —— `COLORS` 加 `room: color('room')` / `rug: color('rug')`；`BedView` 的容器里加两个矩形绘制对象（作为**最前面的子对象**，压在床贴图之下）；`placeBed` 里按 `roomOf(bedNo)` / `reserveOf(bedNo)` **现算**位置与错位（**不要自己算坐标**：偶行房起点 = 床左上角，奇行 = 床左上角 − `RESERVE_W`）；`releaseBed` 一并隐藏。② 图层：走道地板仍是现有的 `floorGfx`（唯一跟困倦度缓动的那一层）；房间与预留位是**固定色**，不参与 `ambience`。
  - **不做**：不动 `TileSprite` 地板、不动 `wallRegionOf` / `scrollRegionOf`、不加新素材、不改 `layout.ts` 的几何（`roomOf` / `reserveOf` 早已存在）。
  - **独立验收（≤7 条，必须用手机视口 393×852）**：① 同屏每张床所属的「间」与走道可辨，且相邻行错位与床一致；② 预留位与房间地面也分得开（走道 / 房间 / 预留位三层可辨）；③ 困倦度变化时**只有走道地板**变暗，另两层颜色不变（两张截图对比）；④ 床、床号、我的床标记、小人都压在贴片之上，无遮挡错位；⑤ 像素采样：两层颜色 = tokens 值（`--color-room: #182137` / `--color-rug: #212c44`）；⑥ 同屏对象数增加约 2×10，帧率不劣于本地基线（记录数字，不比绝对值）；⑦ 升级/降级后贴片随床一起出现/消失，老床位不动。
  - **已知边界**：本地低亮度可辨性无法验收（与 backlog 里「空芯可辨性」同类），若本轮无真机，只在验收记录里写明「待真机」。
  - **验证前置（实测教训）**：本地库有遗留归属时会挡住「出生点 = 内部 0 号床」这类用例 → 先按 `build.md` §2「干净库」那一行清掉 `.wrangler/state/v3/do/`。
  - **CHANGELOG**：`### Added` 补一条。

- [ ] 卡 3：走速 220 px/s + 走路摆动 4.5 Hz
  - **目标**：一屏之内走起来不拖沓。数值与两条硬约束已写进 `config.md` §3（`11e82a9`）。
  - **改**：① `src/shared/constants.ts` `WALK_SPEED_PX_PER_S: 130 → 220`；② `src/shared/tests/constants.test.ts` 的字面断言同步（§3 是字面断言，不是读文档）；③ `src/client/world/views.ts` `WALK_SWAY_HZ: 3 → 4.5`（幅度仍 3%）。
  - **不做**：不动 `advanceMover` 的算法（推进量仍按**实际经过时间**算）、不动 `TICK_MS`、不动 `MAX_INTERPOLATION_DELAY_MS`、不动相机跟随上限 `CAMERA_FOLLOW_PX_PER_S = 500`。
  - **独立验收（≤6 条，手机视口 + 桌面各一次）**：① `npm test` 全绿（常量与文档一致）；② 走一格（173px）实测 0.79s ±15%、一屏（393px）≈1.8s；③ 按 `../ui/DESIGN.md` 的「不跳」口径分开量：小人**世界坐标**单帧位移 <10px（60fps 预期 3.7px）、相机**滚动量** ≤ 500×dt；④ 稳态跟随不回跳（沿用既有验收法：连续走动时相机步进 = 小人步进）；⑤ 摆动幅度仍约 3%、频率 4.5Hz，肉眼看无明显「滑行」；⑥ 与睡着的人/静止的人无关（只影响移动者）。
  - **CHANGELOG**：`### Changed` 补一条。