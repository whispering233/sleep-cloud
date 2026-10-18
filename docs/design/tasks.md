# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是本次三张卡的规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

## 卡片 C：清理键盘相机旧逻辑（**去掉**）

键盘现在只负责「把输入行抬到键盘上沿」，相机与画布归插槽面板的冻结管。文档已改好（`DESIGN.md`「软键盘」、`build.md` §7 的 19/21/25 三条），本卡只删代码。

#### 删这些（`src/client/world/world.ts`）

- `syncKeyboard()` 以及它在 `update` 里的调用。
- `beginKeyboard()` / `endKeyboard()` / `keyboardCamera()` / `rebaseKeyboard()`，以及 `baseline` / `keyboardMoved` 两个字段与它们在各处的分支（`resizeToHost`、`applyCameraBounds`、`follow`、拖拽 / 捏合两条入口）。
- `resizeToHost` 里键盘那一段（`const keyboard = keyboardNow().open` 到最后那两行 `if (keyboard) … else …`）→ 只留「尺寸重算 + `applyZoom()`」。
- **已成死分支、一并删**：`onPointerDown` 里的 `if (!keyboardNow().open) blurFocusedEditable()` 与轻点里那个「键盘弹着时吞掉这一下」的分支（焦点在输入行时画布被插槽面板盖住，指针事件根本到不了画布）。`blurFocusedEditable` 本身留在 `src/client/focus.ts`（`ChatPanel` 还在用），但 `world.ts` 可能因此不再需要 import 它——按实情处理。
- `keyboardNow()` 的 import 如果没人用了就删。

#### 删这些（`src/client/world/rules.ts` + 单测）

- `anchorScroll()`、`revealShift()`，以及 `src/client/world/tests/rules.test.ts` 里对应的用例。
- **保留** `keyboardOf()` / `KEYBOARD_OPEN_PX` / `KeyboardState`（`src/client/keyboard.ts` 还在用它们算「抬多高」）。

#### 不许动

- `src/client/keyboard.ts`（`trackKeyboard` / `keyboardNow` 仍要写 `.app-shell` 的 `inset-block-end`）。
- `slotOpen` 那一套冻结（四、五处早退）。
- `docs/`（只允许补 `CHANGELOG.md` 的 `## [Unreleased]`）。

#### 验证

`npm test`、`npm run typecheck` 两条全绿；`npm run build` 通过。另外确认删完后 `world.ts` 不再 import 已删的东西（`typecheck` 会抦）。

> 回滚：本卡是一次纯删除，`git revert` 即可单独回滚，与前面的卡无耦合。

---

**当前进行中：无。** 真机验收清单在 `build.md` §7，两项待验：**走到床边 → 躺下的站立等待 ≈ RTT**（`30-movement-sync.md` §3.9）、**`?debug=1` 下走一趟 `regressPx max` 必须为 0**（§6.2）。
