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

## 卡 1：点插槽面板空白不再让小人走开

**依据**：`50-slot-panel.md` §1、§4、§5；`60-interaction-shell.md` §3、§4、§6（I7）、§10-4；`CHANGELOG.md` 的 `## [Unreleased]`

**现状**：空白处 `pointerdown` 就退场 ⇒ 两态布局瞬切，手指底下当场变 canvas ⇒ 浏览器抬手后补发的 `mousedown` / `mouseup` 命中 canvas，被当成一次从画布起手的 tap ⇒ 发一条 `walk`（实测 10 次漏 7 次）。

### 改动（只这三处）

1. `src/client/components/SlotPanel.tsx`
   - 空白处判定不变：`event.target === event.currentTarget`。
   - `onPointerDown`：只 `event.preventDefault()`（保住焦点 + 让浏览器不再派发兼容鼠标事件），**不**调 `onBlankPointerDown()`。
   - 新增 `onClick`：同一判定成立时调 `onBlankPointerDown()`。
   - 顶注释按新口径重写：不再写「`inert` 保证还吃点击」；写清「按下不退场、抬手 `click` 才退场」与理由（一次点按手势期间不许换手）。
2. `e2e/shell.spec.ts`
   - **删掉**「退场动画期间，面板区域不会把点击漏给画布」这个测试（它逐帧读面板的**实时** rect；面板一跳到底行，采样点就落进聊天面板，永远返回 DIV = 假通过）。
   - **新增**「点插槽面板空白不产生 `walk`」：进厅 → 聚焦输入框进 typing → 在 `.slot-panel` 上取一个空白点（`elementFromPoint(x, y) === 面板`）→ 在 `document` 冒泡阶段监听 `pointerdown` 记录 `defaultPrevented` → touchscreen tap → 断言：① 记录的 `defaultPrevented` 为 `true`；② `walk` 帧数为 0；③ 回到 `idle`。然后循环 8 次（每次重新进 typing），全程 0 次 `walk`。
   - 现有「只有从画布起手的 tap 才产生 walk」保持不动。
3. `CHANGELOG.md`：`## [Unreleased]` 的 `### Fixed` 条目已经写好了（本轮文档改动里），**worker 只需校对**：如果实现与本条目不符（例如直到底层行为不一样），把差异报告出来，**不要自己改条目**。

**不做**：退场动画（已进 `backlog.md`）、`inert` 的去留（保留）、其它 DOM 点按（`GO` / 缩放档位 / 收起 / 😀 / 快捷用语已实测 0/5 不漏）、`world.ts` 的兜底（不变）。

### 验收

- `npm run typecheck` 全绿；`npm test` 全绿。
- `npm run e2e`：先 `npm run dev` 起站点；宿主机没有 Playwright 浏览器时用 `PLAYWRIGHT_CHROMIUM_PATH` 指向已有的 Chromium（本机实测可用 `/home/whispering2333/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`）。不通过就不算完成。
- **辅助自查**（不改仓库）：用 Playwright 手机视口 + `hasTouch` 在空白处连点 10 次，确认 `walk` 帧为 0、每次都回到 `idle`；改前应能看到 7/10 漏。

**证据（交回时必须带）**：两个命令的原始结论（哪几条通过）+ 新测试的运行输出。
