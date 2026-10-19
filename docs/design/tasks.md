# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

---

**当前没有进行中的卡片。** 插槽面板（`50-slot-panel.md`）与本地存储（`40-client-storage.md`）都已落地并独立验证，位置同步全部落地。下一批候选见 `backlog.md`（广播折线替代采样、`lead` 前向收敛）。

哪类验收该在哪个环境做见 `test.md`。当前只差真机（真手指、低端机帧率、低亮度观感）与真机弱网（位置同步的「画面一帧也不往回跳」）两类结论。

---

## 插槽面板搬到聊天面板下沿（聚焦时整组贴顶）

**规格**：`50-slot-panel.md` §2、§3、§5（已改好）；`DESIGN.md` 的 `slot-panel` 行与「软键盘」节（已改好）。

**动机**：界面不再需要读键盘高度——那一量在部分内核里测不出来，而画布闪烁就是它在逐帧驱动画布重建。

**已定的四个决策**（不要再改）：

| # | 决定 |
| :--- | :--- |
| 1 | 焦点态下屏幕底部**什么都不留**（不占位、不留底线），世界铺到屏底 |
| 2 | 快捷用语改**两列网格**（单列 8 条要 432px，两列只要 224px） |
| 3 | **不引动画库**，用 CSS `transform` / `opacity` + `transitionend` |
| 4 | 相机可用视口的 `bottom` **不算面板**（面板贴顶时按空闲态同一大小占位，只是位置从屏底移到面板下沿） |

### 卡 1：键盘层只留 pan（纯函数 + 单测）— **已完成**

`keyboardOf` 去掉 `shrink`、只返回 `pan`；`trackKeyboard` 只写 `transform`；`rules.test.ts` 相应重写。

### 卡 2：世界层去掉冻结（先做，否则中间态是坏的）

**为什么要先做**：冻结是为「面板贴底、跟着键盘逐帧抬」设计的。面板一旦改到顶部，键盘不再驱动画布高度，冻结就成了纯负担——而且如果先改布局再删冻结，中间态会出现「面板已经挪走，但相机仍按旧位置冻结」这一坏状态。

- `world.ts`：删 `setSlotOpen` 方法、`slotOpen` 字段、以及 `resizeToHost` / `follow` / 夹取里三处 `if (this.slotOpen) return`。
- `world-handle.ts`：删 `setSlotOpen` 导出。
- `App.tsx`：删那一段 `setSlotOpen(slotActive())` + `subscribeSlot` 的 effect（以及 `world-handle` 的 import）。
- `slot.ts` 顶部注释里「`App` 转发给世界层的冻结」那句一并改掉。
- 顺手加一条早退：`resizeToHost` 里尺寸与 dpr 都没变就直接 return（旋屏之外的重复触发不该重建绘制缓冲）。
- 验收：`npm test` / `npm run typecheck` 绿；手机视口下打字前后画面不闪。

### 卡 3：聊天面板两种悬挂态 + 插槽面板改挂下沿（必须同一张卡）

**为什么必须合并**：只把 `.chat-panel` 挪到顶部、而 `.slot-panel` 仍挂在它**上沿**，插槽面板会跑到屏幕最上面盖住 HUD。两者是一对，分开提交没有可验证的中间态。

- `.chat-panel`：默认贴底；`data-docked="top"` 时贴 HUD 下方。位置切换用 `transform` 过渡（只动 transform，不触发布局）。
- `.slot-panel`：`inset-block-end: 100%` → `inset-block-start: 100%`（改挂下沿）。
- **边框接缝**：谁在上面谁拥有上圆角；下面那块上沿不画边、只画下沿。两块都同时画完整 1px 描边会在交界处留两道线与两个圆角凹口，视觉上割裂。
- 开关从 `hidden` 改 `inert` + `opacity` / `transform` 过渡，`transitionend` 收尾（**不许定时器**，同 `Toast`）。
- `slotHeightOf` 换语义：从「聊天面板上沿 → HUD 下沿」改成「聊天面板下沿 → 可用视口下沿」。注意 `@media` 两档（640 / 1024）的 `.chat-panel` 也要跟着改。
- `SlotPanel.tsx` 里三个 `ResizeObserver` 的观察对象与算式跟着改。
- 验收：手机视口下点输入行 → 整组贴顶、面板在聊天面板下面；点空白 → 退回底部；全程 `canvas.width/height` 不因键盘变；交界处只有一条线、无圆角凹口。

### 卡 4：快捷用语两列网格

- `.quick-phrases` 改 `display: grid; grid-template-columns: 1fr 1fr`（单列 8 条要 432px，两列只要 224px）。
- 验收：393 宽下 8 条全可见、不需滚动；每条 44px；最长的「有人吗？有人吗？」不溢出。

### 卡 5：收口文档与变更记录

- `CHANGELOG.md` 的 `## [Unreleased]` 写行为变化（用户可见语义，不写卡号）。
- `test.md` 里那段「实测基线」提到「键盘收起时画布连重建 2 次」——改造后不再成立，更新掉。
- 核一遍 `interactive-widget` / 键盘高度 / 「冻结」相关描述已无残留。
