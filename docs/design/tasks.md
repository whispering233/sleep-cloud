# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`60-interaction-shell.md`（本轮的总规格）、`50-slot-panel.md`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律 32–35）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- **worker 不改 `docs/`**：设计已先落文档。卡里标注「要补 CHANGELOG」时，只补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。
- 验收：`npm run typecheck` + `npm test` 必须全绿；改到壳层的卡另跑 `npm run e2e`（卡 6 之后）。

---

**当前没有进行中的卡片。**

打字态状态机、网格两态、退场时序、画布冻结与 L2 契约 spec 全部落地。

哪类验收该在哪个环境做见 `test.md`。当前只差 L3 / L4：真 IME 下 `visualViewport` 三量的关系、键盘动画观感、`scale.resize` 次数（模拟器），以及真手指手感、低端机帧率、特定内核（夸克 / Via）。
