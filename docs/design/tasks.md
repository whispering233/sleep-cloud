# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是本次三张卡的规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

## 卡片 C：清理键盘相机旧逻辑（**仅在卡 A 真机验过后**）

删除 `world.ts` 的 `beginKeyboard` / `endKeyboard` / `keyboardCamera` / `rebaseKeyboard` / `keyboardMoved` / `baseline`，`rules.ts` 的 `anchorScroll` / `revealShift` 与其单测；同步 `DESIGN.md`「软键盘」那四条不变量与 `AGENTS.md` 硬纪律 32 的措辞。**前置条件**：卡 A 在真机上验过（否则没有回滚基线）。

---

**当前进行中：无。** 真机验收清单在 `build.md` §7，两项待验：**走到床边 → 躺下的站立等待 ≈ RTT**（`30-movement-sync.md` §3.9）、**`?debug=1` 下走一趟 `regressPx max` 必须为 0**（§6.2）。
