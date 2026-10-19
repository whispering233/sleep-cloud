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

## 卡 6：L2 契约 spec

**做**
1. devDep 加 `@playwright/test`；`package.json` 加 `"e2e": "playwright test"`；`playwright.config.ts`（`webServer` 指 `http://localhost:8787`，不自动起服务；`use.viewport = { width: 393, height: 852 }`，`deviceScaleFactor: 3`，`hasTouch: true`）。
2. `e2e/shell.spec.ts` 四条：
   - 每状态出口可达：`idle` → 聚焦输入 → `typing` → 点「收起」→ `idle`；再 `typing` → 点面板空白 → `idle`；再 `typing` → 点 😀（输入框被卸载）→ 点「收起」→ `idle`
   - 退场期间命中：`data-open` 撤下、`opacity > 0` 时，面板区域任一点 `elementFromPoint` 不是 canvas
   - 画布尺寸：整个 `typing` 往返期间 `canvas.width/height` 不变（`MutationObserver` 计数 = 0）
   - tap 门：从面板起手的 touch 不发 `walk`，从画布起手的发（用 `WebSocket.prototype.send` 打点，别改生产代码）
3. `docs/` 不改（`test.md` 已经写好）；只在 `CHANGELOG.md` 的 `## [Unreleased]` 补一条。

**验收**：`npm run e2e` 四条全绿（先 `npm run dev`）；`npm run typecheck` 干净。

---

## 收口卡：清空本文件

全部卡落地 + 独立验证通过后：本文件回到「当前没有进行中的卡片」，`CHANGELOG.md` 补齐条目，`git log` 每条提交独立可回滚。
