# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

- [ ] 卡 8：广播不看 `readyState` → 一个死连接打断整次广播
  - **症状（已实测）**：`broadcast` / `broadcastExcept` 只看连接附加数据里的 `ready`，不查 `ws.readyState`。关掉一个标签页后，另一个标签页的小人不再走动（`Can't call WebSocket send() after close()` 抛出、广播中断），重载才恢复。
  - **改**：`src/hall/hall.ts` 的发送点集中成一个守卫（`readyState === OPEN` 才发，或 `try/catch` 吞掉发送失败），**不改变广播语义**；若同一处还漏了别的发送点，一并收口。
  - **测试**：写一条能证明「一个会抛 / 已关闭的 socket 不影响其它连接收到消息」的单测（现有 hall 测试的假 socket 夹具改造一下即可）。
  - **验收**：`npm test` + `npm run typecheck`；`backlog.md` 里那条删掉（已落地）。
