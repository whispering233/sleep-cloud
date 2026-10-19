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

### 卡 1：键盘层只留 pan（纯函数 + 单测）

- `rules.ts` 的 `keyboardOf` 去掉 `shrink`，只返回 `pan`；`KeyboardState` 同步。
- `rules.test.ts` 重写「软键盘」那组断言（删 `shrink` 用例，保留并补 `pan` 用例，含负值归零）。
- `keyboard.ts` 删 `shell.style.insetBlockEnd` 那一行，只留 `transform`。
- 验收：`npm test` 绿；`npm run typecheck` 绿。

### 卡 2：聊天面板两种悬挂态（CSS + 组件的 `data-docked`）

- `.chat-panel` 从 `inset-block-end: 0` 改成可用 `block-start` 控制；加 `data-docked="top"` 态。
- 位置切换有 `transform` 过渡（只动 transform）。
- 两块面板的边框接缝：上圆角归上块、下圆角归下块，交界处不重复画线。
- 验收：手机视口下目视两种态，交界处只有一条线、无圆角凹口；键盘开合时画布不重建。

### 卡 3：插槽面板改挂下沿 + 几何重算 + `inert` 过渡

- `.slot-panel`：`inset-block-end: 100%` → `inset-block-start: 100%`。
- `slotHeightOf` 换成「聊天面板下沿 → 可用视口下沿」。
- 开关从 `hidden` 改 `inert` + `opacity` / `transform` 过渡，`transitionend` 收尾（**不许定时器**）。
- 验收：点输入行 → 整组贴顶、面板在下面；点空白 → 退回底部；全程 `canvas.width/height` 不因键盘变。

### 卡 4：删掉世界层的冻结机制

- `world.ts`：`setSlotOpen`、`slotOpen` 字段、`resizeToHost` 里的早退、`follow` / 夹取里的早退全部删除。
- `world-handle.ts` 的 `setSlotOpen` 与 `App.tsx` 里的订阅一并删除。
- `SlotPanel` 不再需要通知世界层。
- 验收：`npm test` / `typecheck` 绿；手机视口下打字前后世界不可见地闪、相机不跳。

### 卡 5：快捷用语两列网格

- `.quick-phrases` 改 `display: grid; grid-template-columns: 1fr 1fr`。
- 验收：393 宽下 8 条全可见不需滚动、每条 44px、最长的「有人吗？有人吗？」不溢出。

### 卡 6：收口文档与变更记录

- `CHANGELOG.md` 的 `## [Unreleased]` 写行为变化（用户可见的语义，不写卡号）。
- 核 `interactive-widget` / 键盘高度相关描述已无残留。
