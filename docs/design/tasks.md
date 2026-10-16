# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> **剩下两张卡都改 `src/hall/hall.ts` → 必须串行派工。**

- [ ] 卡 6：回我的床（`goHome` 瞬移 + HUD 那条做两件事 + 客户端大跳变落位）
  - **目标**：跨厅不再靠走。规则见 `10-hall-runtime.md` §5.1 新增段、`api/20-api-ws.md` §3 的 `goHome` 行与 §4.7 的跳变落位段、`ui/DESIGN.md` 相机表「瞬移落位」行与 HUD 行。
  - **改（协议）**：`src/shared/protocol.ts` 加 `goHome: Record<string, never>`，`UPSTREAM_TYPES` 插在 `walk` 之后 → `['hello','walk','goHome','lie','rise','sleep','chat','whisper','emote']`（**顺序必须与文档表一致**）；`src/shared/tests/protocol.test.ts` 的字面列表与测试名「（8 种）」→「（9 种）」同步。
  - **改（服务端）**：`hall.ts` 的 `handleIntent` 加 `case 'goHome'`：无归属 → **静默 return**（不回错误码）；在床上 → 复用 `standUp`（保留归属）；新位置 = `frontPointOf(ownedBedNo)`（`undefined` 则静默 return）；清路径与到达后动作 + `stopWalking(userId)`（不进移动者集合、不起节拍循环）；写连接；**广播一条位置**（用现成的位置广播工具）。
  - **改（客户端）**：`src/client/ws.ts` 加 `sendGoHome()`；`src/client/components/Hud.tsx` 那条点击改为 `sendGoHome()` **加上** `focusMyBed()`（两件事一起做）；`src/client/motion.ts` 的 `nextMotion`：与上一窗口终点的位移 **> `TELEPORT_SNAP_PX`** 时返回**塌缩窗口**（`from = to = 新点`、`fromTs = toTs = ts` → `span = 0` → `positionAt` 直接返回终点，天然「落位、不拉丝」）；新常量 `TELEPORT_SNAP_PX = 400` 放 `src/shared/constants.ts`（注释说明：只写给客户端，服务端不知道）。
  - **不做**：不改 `focusMyBed` 的相机逻辑；不新增错误码；不加二次确认；不动 `INTERPOLATION_DELAY_MS` / `MAX_INTERPOLATION_DELAY_MS`。
  - **测试**：`motion.test.ts` 加两条——大跳变（> 400px）塌缩窗口且 `positionAt` 立刻等于新点；常规位移（如一格 173px 的 22px/拍）仍返回插值窗口。`protocol.test.ts` 见上。
  - **独立验收（ui-verifier，≤6 条，手机视口）**：① 在离床远的地方点 HUD 那条 → 小人一步到自己床边（给前后两张截图，落点在自己床脚前走道）；② **只产生 1 条 `pos`**（hook WebSocket 验，且无「拉丝」中间帧）；③ 相机跟着到位；④ 躺在床上点它 → 仍是躺着（无动作）；⑤ 无床时那条不显示；⑥ 点地面走动的常规平滑性不变（位置按节拍连续推进，不是瞬移）。
  - **CHANGELOG**：`### Added` 补一条。

- [ ] 卡 7：提前扩容（已用率 75% 扩 / 外圈空且已用 < 50% 缩）
  - **目标**：像 `ArrayList` 一样提前长，不等到一张空床都没有；两个阈值成对防自激。判据见 `10-hall-runtime.md` §8（含滞回推导）。
  - **改**：`src/shared/constants.ts` 加 `GROW_USED_RATIO = 0.75`、`SHRINK_USED_RATIO = 0.5`（注释指向 `10-hall-runtime.md` §8）；`src/hall/level-rules.ts`：`nextLevelCapacity` / `previousLevelCapacity` 改吃**已用床数**（或已用率），口径 = **≥ 0.75 升、< 0.5 才降（且外圈仍须全空）**；`src/hall/hall.ts`：把 `hasClaimableBed` 换成**已用床数计数**（复用 `bedBusy` 遍历，仍是同一次全表读，成本与今天相同）、`growIfNeeded` 与 `shrinkIfOuterRingEmpty` 接新判据；`isHallFull` 保持「末档 + 无空闲」不变。
  - **不做**：不把「过期」规则抄进 SQL（继续用 `bedBusy`，别制造第三处副本）；不改触发点（升级仍在入场前，不做「认领后也检查」）；不动 `resize` 的消息形态与 `recoverPosition` 的降级流程。
  - **测试**（`src/hall/tests/level-rules.test.ts` 为主）：① 已用 74% 不升、75% 升；② 外圈空但已用 51% **不**降、已用 49% 降；③ 外圈不空时任何比率都不降；④ 滞回自洽：用级表步长断言括号式「扩完的已用率 < 升阈值」与「缩完的已用率 < 升阈值」（防自激，就是 §8 那段推导）；⑤ 末档 + 无空闲仍 `2002`；⑥ 一条 Hall 级用例（照 `broadcast.test.ts` 模式）：`meta.bed_count = 117` + 塞 88 张有主床 → `growIfNeeded()` 触发一次 `resize` 到 150 且只发一条。
  - **独立验收（≤5 条）**：①–⑥ 的单测全绿 + `typecheck`；② 反例回归：把已用床数压回 74% 后不再触发第二次 `resize`（同一档不连跳）；③ `CHANGELOG.md` 的 `### Changed` 补一条。