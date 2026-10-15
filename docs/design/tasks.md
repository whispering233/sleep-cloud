# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
>
> **卡 0（文档先行）已完成**：上面这些文档已按新设计改写完毕（单厅 / 无缩放 / 床位自动伸缩 / 取消昼夜 / Phaser 4 / 睡痕 TTL）。
> **已知预期**：文档已先行，代码未跟上，`npm test` 现有 7 条镜像测试会红（`error-code`、`protocol`、`schema`、`error-text`、`hall-registry` 各文件比对文档）。它们随卡 1~4 各自收口，**不要在卡 1 里顺手修**。

> **卡 1 的验收结果（已复验）**：世界层替换成立（Phaser 真正在跑、命中与 DPR 换算正确、无缩放三条路径都成立）；两条阻断已在「卡 1 修轮」修掉：① 认领非自己的空床会撞「一人一床」唯一索引（旧服务端就有的 bug）→ 新增错误码 `3007` + 客户端可见提示；② 走动每格一次单帧瞬移（服务端只在格号变化时发 `pos`，间隔 200~300ms，而客户端按固定 100ms 滞后插值）→ 滞后改成按最近两批的实际间隔自适应。

---

## [ ] 卡 3：厅服务切布局 + 床位模型

**目标**：房间服务改用布局函数，床位改为「惰性行 + 级表伸缩」，并把睡痕/归属的过期改成读取时推导。

**改动范围**

- **`pos` 广播改成每拍都发**（不再只在格号变化时发），坐标改**世界像素**；客户端的插值滞后去掉「固定 100ms」的隐含假设（`motion.ts` 的自适应滞后在窄间隔下自然退化成稳定的 ~100ms）
- `src/hall/`：`scene.ts` 删除（可行走性来自 `layout.ts`）；`bed-store.ts` 改惰性行（**只有有主或有占用才有一行**）+ `meta` 表（`bed_count` / `owned_count`）+ 删 `owner_tz`；`schema.ts` 删「预建 256 行」的补种 SQL；`bed-rules.ts` 的 `capacity` → `bedCount`，判据加「过期睡痕视为无占用、过期归属视为无主」；`pathfinding.ts` 改为**街网寻路**（目标点不在街网上 → `3006`，不吸附）
- `src/hall/hall.ts`：出生点（编号最小的无主空床前方走道）、升级（入场前判定 `owned_count >= bed_count` 且未触顶 → 写 `meta` + 广播 `resize`）、降级（每日唤醒评估：最外圈全无主无占用）、每日唤醒只做「归属释放 + 缩级评估」（**删掉睡痕清理任务与厅时区换算**）
- `src/worker/`：删 `/api/halls` 与 `/api/hall`（单厅）；会话删 `hallId` / `timezone`；`/api/me` 加布局版本
- `src/shared/`：`protocol.ts` 的 `capacity → bedCount`、`ownedBeds` 改**位图**编码、加 `resize` 消息与 `traceUntil` 字段、删 `Facing`；`hall-registry.ts` 收敛为单厅常量；`http-api.ts` 删厅列表与 `HallsView`；`constants.ts` 按 `config.md` §3/§4/§5 更新（`TRACE_TTL_MS`、`DAILY_WAKE_UTC_HOUR`、`WALK_SPEED_PX_PER_S`、几何常量、`POOL_SIZE`；删 `SLEEP_TRACE_CLEAR_HOUR`、`SCENE_BED_COUNT`）
- **`bedNoAt` / `isWalkable` 的每个调用点都要显式传 `bedCount`**：不传 = 按最高档判定（fail-open，墙会静默消失），只给校验用
- **删除旧场景数据**：`public/scenes/*.json`、`src/shared/scene.ts`、`src/hall/scene.ts`、`src/client/world/scene-index.ts` 及其测试（两端已切到 `layout.ts`；卡 2 只新增了 `layout.ts`，没删任何东西），同时把客户端世界层的格/像素换算改成直接吃 `layout.ts`

**验收**

- 单测：惰性行（新厅 0 行）、`meta` 计数与重算、升级/降级判据（含「外圈有人 → 不降级」）、过期睡痕可认领、过期归属可认领、位图编解码、街网寻路（含 `3006`）
- 镜像测试收口：`error-code.test.ts`（删 `1006`、`2003` 改文案、`2002` 改语义）、`protocol.test.ts`（`resize` + 删 `Facing`）、`schema.test.ts`、`hall-registry.test.ts`、`error-text.test.ts`
- 手工 ws 冒烟：入场 → 看到 114 张无主空床 → 躺下 → 造满 → 升级 → `resize`

**依赖**：卡 2

---

## [ ] 卡 4：美术管线 + 贴真图

**目标**：5 张母图 → 8 张贴图（`DESIGN.md`「构建期要产出的变体」），世界层换掉占位图形。

**改动范围**

- 新增构建期脚本（Node）：两色**渐变映射**（黑线 → 墨色三档，白填充 → `paper` 或**透明**）、裁到墨迹 bbox（床 122×201、男 66×113、女 97×113）、生成图集 + 锚点元数据
- `public/sprites/`：产物入库；附 `LICENSE-wheatcloudsleep.txt`（MIT, © 2022 WheatBox）
- 世界层：床（空芯/有主/有人/睡痕）、小人（站/走）、**睁眼躺姿叠点**、床号文字、我的床标记
- `AGENTS.md` 的常用命令里补上脚本命令

**验收**

- 脚本产物自检（尺寸、锚点、许可文件存在）
- `ui-verifier`：iPhone 16 视口目视——床/小人是真素材、空芯与有主可辨、睡痕更暗、床号可读、无锯齿

**依赖**：卡 1（世界层）、卡 2（几何，用于锚点）

---

## [ ] 卡 5：HUD 精简 + 入场层删大区

**目标**：用户侧只剩「床号 + 在线人数」；入场只剩「昵称 + 18 岁自述」。

**改动范围**：`src/client/components/{Hud,EntryOverlay}.tsx`、`src/client/hud-view.ts`（删昼夜与厅名）、`src/client/world/rules.ts`（删 `isDaytime`）、`docs` 与 `CHANGELOG` 相应条目

**验收**：`ui-verifier` 手机视口（入场只剩两项、HUD 只有床号与在线、无昼夜文案）；`npm test` 全绿

**依赖**：卡 3（协议字段）

---

## [ ] 卡 6：明暗氛围（困倦度 → 地板底色）

**目标**：`困倦度 = (睡着 + 睡痕) / (在线 + 睡痕)` 驱动地板底色在 `primary` ⇄ `primary-dim` 之间缓动（约 1.5 秒），只在数值签名变化时重算，空厅兜底最亮档。

**改动范围**：世界层（地板对象 1 个）+ `src/client/store.ts`（困倦度派生，别在 100ms 位置节拍里重算）

**验收**：`ui-verifier` 手机视口——多人睡着时地板变暗、有人醒来时变亮、**床与小人的颜色不变**、无「切换感」

**依赖**：卡 4

---

## [ ] 卡 7：收尾

**目标**：把设计变更落实到 `CHANGELOG.md`（按卡补条目，不写任务卡语义）、复核 `README` / `docs` 与代码一致、确认无 PixiJS 残留、把实测项结论回填 `backlog.md`。

**验收**：`npm run build`、`npm test`、`npm run typecheck`、`npm run lint:design` 全绿；全仓 `grep -r pixi` 无命中（除 `CHANGELOG` 历史条目）

**依赖**：卡 1~6
