# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

- [ ] 卡 7：把「床位区 / 地板区 / 取景范围」三个范围分开，相机可滚到墙外一圈
  - **症状**：手机上推到边缘只能看见一条贴在屏幕最外圈的细线 —— 相机被夹在「厅含墙的外沿」，**墙外永远进不了画面**，于是「墙」读不成实体边界。
  - **改**（文档已先改好，见 `config.md` §2/§4/§7 与 `ui/DESIGN.md`）：① `constants.ts` 加 `OUTSIDE_MARGIN = AISLE`（56）；② `layout.ts` 加 `scrollRegionOf(index)` = 地板区（`wallRegionOf`）+ 墙带 + 墙外一圈；③ `world.ts` 的 `applyCameraBounds()` 改用 `scrollRegionOf(...)`，删掉卡 4 里那段手写的 `WALL_WIDTH` 外扩。**可走范围不变**（仍是 `wallRegionOf` 内缩 `WALL_BODY`），墙外那圈不铺地板、不可走。
  - **测试**：`src/shared/tests/layout.test.ts` 覆盖 `scrollRegionOf`（= 地板区每边各外扩 `WALL_BODY`… 注意：是 `WALL_WIDTH + OUTSIDE_MARGIN`，请按 §7 的措辞写清楚）与不变量「可走范围 = 地板区」；`npm test` + `npm run typecheck`。
  - **UI 验收**：`ui-verifier` 手机 393×852 —— 推到四个极值各截图，证明「**墙外的底（`secondary`）+ 3px 墙带 + 地板**」三样同时可见，且小人仍走不进墙外。

- [ ] 卡 8：广播不看 `readyState` → 一个死连接打断整次广播
  - **症状（已实测）**：`broadcast` / `broadcastExcept` 只看连接附加数据里的 `ready`，不查 `ws.readyState`。关掉一个标签页后，另一个标签页的小人不再走动（`Can't call WebSocket send() after close()` 抛出、广播中断），重载才恢复。
  - **改**：`src/hall/hall.ts` 的发送点集中成一个守卫（`readyState === OPEN` 才发，或 `try/catch` 吞掉发送失败），**不改变广播语义**；若同一处还漏了别的发送点，一并收口。
  - **测试**：写一条能证明「一个会抛 / 已关闭的 socket 不影响其它连接收到消息」的单测（现有 hall 测试的假 socket 夹具改造一下即可）。
  - **验收**：`npm test` + `npm run typecheck`；`backlog.md` 里那条删掉（已落地）。
