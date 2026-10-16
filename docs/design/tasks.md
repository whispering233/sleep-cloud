# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> 设计前置已随本批文档提交（`master` §5.2 躺下行、`10-hall-runtime` §5.1 复合意图表与三点说明、`20-api-ws` §3 的 `lie` 行、`error-code` 的 3004 说明、`DESIGN`「谁能躺」）。

- [ ] 卡 9：在床上点别的空床 = 自动起身 + 走过去 + 躺下（换床一次点击完成）
  - **症状（已实测复现）**：躺在床上点另一张无主空床 → 服务端回 `3004`（静默），画面**毫无变化**；换床实际上要两次操作（先起身、再点新床）。与「在床上点地面 = 自动起身 + 走过去」的既有原则不一致。
  - **改（判据）**：`src/hall/bed-rules.ts`：`checkLie` 入参加 `currentBedNo?: number`，`3004` 的判据从「在床上」**收窄成「在床上且 `currentBedNo === bedNo`」**。**必须仍排在 `3002` 之前**（否则点自己躺着的那张会得到「床被占」这种绕的话）。
  - **改（服务端）**：`hall.ts` 的 `case 'lie'`：判定通过后，若 `fresh.state !== 'roaming'` → `const standing = this.standUp(ws, fresh)`，再 `this.approachBed(ws, standing, bedNo)`（照 `case 'walk'` 的复合写法）。**判定不通过时绝不站起来**（不为了一个会失败的动作产生副作用）。`lieDown` 的到达后复检也把 `currentBedNo` 传进去（`connection.state !== 'roaming' ? connection.bedNo : undefined`）。
  - **不做**：不改 `rise` 的语义、不动 `3005`、不给「点自己躺着的那张」加任何提示（保持静默）、不改换床与冷却的任何规则。
  - **测试**：`src/hall/tests/bed-rules.test.ts` 加 5 类——① 在床上 + 目标是另一张无主床 → `{ ok:true, claiming:true }`（**不是** 3004）；② 在床上 + 目标是**自己正躺着的那张** → `3004`；③ 在床上 + 目标是别人的床 → `3003`（而不是 3004）；④ 在床上 + 目标是占用中的床 → `3002`；⑤ 在床上 + 目标是另一张无主床但冷却中 → `3008`。Hall 级（照 `bed-switch.test.ts` 的 FakeSocket 形状）：在床上发一条 `lie` → 收到的第一条消息是 `state(roaming)`（起身），随后是位置/走到新床的消息。
  - **独立验收（≤4 条）**：① `npm test` + `npm run typecheck` 全绿；② 单测覆盖上面 5 类（逐条有断言）；③ Hall 级断言「先 `state(roaming)`，且**失败时一条都不发**」（失败用例：目标是别人的床 → 只收到 `error 3003`，**没有** `state`）；④ `CHANGELOG.md` 的 `### Changed` 补一条（不写任务卡语义）。