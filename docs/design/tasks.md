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

## 卡 2：面板 / 出口 / `GO` 接入状态机，退役 `slot.ts`

**目标**：一切停靠与显隐只看 store 里的 `composer`；退场只有一个出口；打字态常驻「收起」胶囊。

**做**
1. `store.ts`：`ClientState` 加 `composer: ComposerState`；`emptyState()` 给 `'idle'`；导出 `setComposer(event)`（内部走 `composerReducer`，**同值不通知**）；导出 `exitComposer()`（幂等：置 `idle` + `blurFocusedEditable()`）。
2. `focus.ts`：
   - `isEditable(el)` 判定 `input` / `textarea` / `[contenteditable]`；**进入条件还要 `el.closest('.chat-panel')` 命中**（入场层的昵称输入框不在面板里，绝不能把打字态带进厅）
   - `trackComposerFocus(shell)`：shell 级 `focusin`（`isEditable(event.target)` → `setComposer({ kind: 'focus-in' })`）+ `focusout` → **下一帧**检查 `document.activeElement` 是否仍落在 `.chat-panel` 内的可编辑控件 → 不在则 `setComposer({ kind: 'lost-focus' })`。返回解绑函数
   - `blurFocusedEditable()` 保留（`exitComposer` 用它）
3. `App.tsx`：`trackComposerFocus` 与已有的 `trackKeyboard` 一起装/卸。
4. `ChatPanel.tsx`：`data-docked` 与 `SlotPanel` 的打开都读 `state.composer === 'typing'`；**删掉** `onFocus` / `onBlur` 里的 `setSlotSource`、`docked` 局部 state、`subscribeSlot`。
5. `ActionRow.tsx`：`typing` 态右端把齿轮换成 44px「收起」胶囊（`aria-label="收起输入"`，外观沿用 `.hud-action`），`onClick` = `exitComposer()`。空闲态照旧显示齿轮。
6. `slot.ts`：**删除**（源集合、`subscribeSlot`、`slotActive`、`slotHeightOf` 全走人）；`SlotPanel.tsx` 的 `active` 改为 prop（由 `ChatPanel` 传 `composer === 'typing'`），`onBlankPointerDown` = `exitComposer()`。
7. 断线：订阅 store，**记住上一次的连接态**，只在转入 `offline` 的那一次调 `setComposer({ kind: 'offline' })`（位置节拍每秒十次，不要每次都过一遍 reducer；也不许新挂定时器）。
8. `src/client/tests/slot.test.ts` 删掉 `slotHeightOf` 的用例（纯函数随实现一起退役）。

**验收**
- 手机视口手点：输入框 → 😀（输入框被替换）→ 面板空白 → 「收起」胶囊，四步之后 `data-docked` 都为 `undefined`、`document.activeElement` 不是可编辑控件
- 输入框 → 😀 之后（旧 bug：卡死在顶部）能靠「收起」胶囊退出
- `GO` 床号输入聚焦时 `data-docked === 'top'`
- `npm run typecheck` + `npm test` 全绿

---

## 卡 3：布局改 Grid 两态，删掉所有量高

**目标**：面板与插槽进流；删 `--dock-y`、`translateY`、量高的 `ResizeObserver`。

**做**
1. `app.css`：`.app-shell` 改 `display: grid; grid-template-rows: auto 1fr auto`；`[data-docked='top']` 时 `grid-template-rows: auto auto 1fr`（选择器挂 `.app-shell` 上，用 `:has()` 或由 `ChatPanel` 给 shell 加 `data-composer`，选后者：不依赖 `:has()`）。
2. `.world-layer` 改 `grid-area: 1 / 1 / -1 / -1`（铺满所有行、在网格之下），`.hud-stack` 第 1 行，`.chat-panel` 第 3 行（打字态第 2 行），`.slot-panel` 打字态第 3 行、`min-height: 0`（要能内部滚动）。
3. **删**：`.chat-panel` 的 `--dock-y` 与 `transform`、`SlotPanel` 的 `height` inline 计算与两个 `ResizeObserver`、`ChatPanel` 的 `dockShift`。
4. 边框接缝按现状保留（谁在上面谁有上圆角）。
5. 宽档（≥640）的居中/最大宽度改用 `justify-self` + `margin-inline: auto`，不再靠 `inset` 微调。

**验收**
- 两态切换后 HUD / 面板 / 插槽边界与改前一致（手机视口截图对比，允许 ±0px）
- `npm run typecheck` 干净；grep 不到 `--dock-y`、`slotHeightOf`
- 相机取景不受影响（面板可见时最底一行仍能滚到面板之上）

---

## 卡 4：指针与退场时序（可点性跟视觉同源）+ 齿轮浮层改 `popover`

**做**
1. `.slot-panel`：退场改 `opacity` + `visibility` 同一条 transition（`transition-behavior: allow-discrete`），**删掉** `pointer-events` 抢跑；`inert` 保留。
2. `world.ts`：`dispatchTap` 先判 `pointer.downElement === this.game.canvas`，不是就 return（`this.game` 从 `scene.sys.game` 拿，别新存一份）。
3. `ActionRow.tsx`：齿轮浮层改 `popover`（`popovertarget` / `popover="auto"`），删手写遮罩与点外关闭状态；`tone-layer` 仍在顶层之上（`popover` 走 top layer，需要给 `.tone-layer` 相应处理：确认减光是否仍盖得住，盖不住就在 `popover` 上加 `z-index` 并说明）。

**验收**
- Playwright/手检：点面板空白退场后，**同一帧**在面板原区域 `document.elementFromPoint` 不返回 `<canvas>`
- 从面板上起手的一次点击不发 `walk`；从画布起手的照旧发
- `npm run typecheck` + `npm test` 全绿

---

## 卡 5：画布在编辑会话期间冻结像素尺寸

**做**
1. `world/rules.ts`：新纯函数 `shouldResize(prev, next, typing)`：`typing && next.width === prev.width && next.height < prev.height` → `false`；其余（宽变、高变、DPR 变、旋屏）→ `true`。
2. `world.ts`：`resizeToHost` 里算完 `pxW/pxH/dpr` 后走 `shouldResize`；被挡掉时**记录待办**（存 `pendingSize`），在 `composer` 回 `idle` 时（`update` 里比一次）重算一次。
3. 单测：`world/tests/rules.test.ts` 补 `shouldResize` 的 6 条（键盘指纹 / 宽度变 / 旋屏 / DPR 变 / 空闲态放大 / 空闲态缩小）。

**验收**
- 手机视口：聚焦输入框前后 `canvas.width/height` 不变（`MutationObserver` 观察 canvas 的 `width`/`height` 属性，零变化）
- 退出打字态后仍能正常跟随窗口尺寸（手动改视口宽 → 画布跟着变）
- `npm test` 全绿

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
