# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`60-interaction-shell.md`（本轮的总规格）、`50-slot-panel.md`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律 32–35）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- **worker 不改 `docs/`**：设计已先落文档。卡里标注「要补 CHANGELOG」时，只补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。
- 验收：`npm run typecheck` + `npm test` 必须全绿；改到界面壳层的卡另跑 `npm run e2e`（见 `test.md` §1 的 L2）。

---

**当前进行中的卡片。**

### 卡 1 — 无 Popover 的降级路径（Chromium 100 能进厅）

**依据**：`architecture.md` §1「浏览器兼容基线」、`60-interaction-shell.md` §4 末条。

**范围**：新增 `src/client/popover.ts`；改 `src/client/components/ToneLayer.tsx`、`src/client/components/ActionRow.tsx`；只在降级确实需要时动 `src/client/styles/app.css`。

**做什么**

- `HAS_POPOVER = 'showPopover' in HTMLElement.prototype`（全仓能力判断只此一处）。
- `ToneLayer`：无 Popover 时不写 `popover` 属性、不调 `showPopover`、不装 `toggle` 重排监听；有 Popover 时行为一行不变。
- 齿轮菜单：无 Popover 时 `menuOpen` state 开关；`pointerdown`（捕获）点外关闭；`Esc` 关闭；开时聚焦菜单首项、关时焦点回齿轮；`aria-expanded` 手写；菜单项点击用 `setMenuOpen(false)`。
- 有 Popover 的路径（顶层渲染、light-dismiss、`popovertarget`）一行行为不变。

**验收**

- `npm run typecheck`、`npm test`、`npm run e2e` 全绿（e2e 需先 `npm run dev` 并读 `.wrangler/dev-port`）。
- 删掉 `showPopover` 后进厅不白屏（卡 2 的 e2e 固化）。

**不做**：不改 SlotPanel 的 `allow-discrete`；不给 Tailwind 的 `@property` / `color-mix` 兜底。

---

### 卡 2 — 兼容基线防回归（构建目标 + e2e 降级用例）

**依据**：`architecture.md` §1、`test.md` §1 的「降级路径的回归」。

**范围**：`vite.config.ts`、`e2e/shell.spec.ts`。

**做什么**

- `build.target: 'chrome100'`，把兼容基线钉进构建。
- e2e 新增一条：`addInitScript` 删 `HTMLElement.prototype.showPopover/hidePopover/togglePopover` → 进厅成功、`pageerror` 为空、`.tone-layer` 覆盖视口、齿轮开 → `Esc` 关 → 再开 → 「更换床位」可用。

**验收**

- `npm run typecheck`、`npm test` 全绿；`npm run e2e` 全绿（新用例在默认环境也必须绿）。

**不做**：不替换 / 新增测试框架。
