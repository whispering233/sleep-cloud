# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是本次三张卡的规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

## 卡片 A：插槽面板骨架（焦点触发 + 几何 + 世界冻结）

**规格**：`docs/design/50-slot-panel.md` §1–§4、§6、§7；`docs/ui/DESIGN.md` 的 `slot-panel` 行。

#### 范围（只改这些）

| 文件 | 做什么 |
| :--- | :--- |
| `src/client/slot.ts`（新） | 触发源登记：`setSlotSource(id, on)` / `slotActive()` / `subscribeSlot(fn)`。**没有全局「失焦即退场」**：开关由源自己负责 |
| `src/client/focus.ts`（新） | 把 `world.ts` 里那个 `blurFocusedEditable()` 搬出来（world 与 ChatPanel 共用，不写两份） |
| `src/client/components/SlotPanel.tsx`（新） | 壳：订阅 `slot`、量出高度（`shell − HUD − 聊天面板`，三个盒子各挂 `ResizeObserver`，写 inline px）、`active` 时渲染 children，否则不渲染 |
| `src/client/components/ChatPanel.tsx` | 输入行 `onFocus` / `onBlur` 驱动 `setSlotSource('chat-input', …)`；**发送成功后显式 `blurFocusedEditable()`**；面板空白 `pointerdown` → `blurFocusedEditable()`；把 `SlotPanel` 挂进去（children 暂时留空/占位） |
| `src/client/App.tsx` + `src/client/world-handle.ts` | `world-handle.ts` 加一个转发函数 `setSlotOpen(open)`（与 `focusMyBed` / `setZoomMode` 同一套，只转发不 import 世界层）；App 订阅 `slot` 后调它。世界层还没起来（入场层期间）时什么都不做 |
| `src/client/world/world.ts` | `WorldHandle` 加 `setSlotOpen(open: boolean)`：打开 → `resizeToHost` 早退 + 夹取与 `follow` 不跑；关闭 → **先清标志再立即 `resizeToHost()` 一次**。键盘那套相机逻辑**本轮一行不删** |
| `src/client/styles/app.css` | `.slot-panel`：`position: absolute; inset-inline: 0; inset-block-end: 100%`、`overflow-y: auto` + `overscroll-behavior: contain`、`secondary` 底 + `claimed` 描边（与面板同族），**不写任何固定高** |
| `src/client/world/tests/` 或 `src/client/tests/` | 纯函数部分的单测（若高度计算抽成纯函数就覆盖它） |

#### 红线

1. 面板出现时焦点**必须**仍在输入行（不许 `focus()` 抢）。
2. 打开期间 `canvas.width/height` **一次都不许变**。
3. 关闭时**先解冻 + 重建 → 再淡出**；不许挂内存定时器算动画时长。
4. `z-index` 不得 ≥ 4。
5. 不改 `keyboard.ts`、不删键盘相机逻辑、不改 `docs/`（`CHANGELOG.md` 的 `## [Unreleased]` 除外）。

**本地验收**：`50-slot-panel.md` §10 的 1–7 条（手机视口）。

## 卡片 B：快捷用语（插槽面板的第一个内容）

**规格**：`50-slot-panel.md` §5、§附。

| 文件 | 做什么 |
| :--- | :--- |
| `src/client/quick-phrases.ts`（新） | 8 条静态常量（文案见 §附），带上限常量 `QUICK_PHRASE_MAX = 8` |
| `src/client/components/QuickPhrases.tsx`（新） | 竖排列表、每条 44px、点 = 把文本**填进输入框**（替换草稿）；`pointerdown` 里 `preventDefault()` 保住焦点 |
| `src/client/components/ChatPanel.tsx` | 把 `QuickPhrases` 作为 `SlotPanel` 的 children |
| `src/client/styles/app.css` | `.quick-phrase`：44px 触击、`hud-action` 同族外观（**沿用既有胶囊，不发明第二套**） |

**红线**：点条目**不发消息**、**不 blur**、**不 focus**、面板不退场。
**本地验收**：§10 第 3 条 + 点 8 条各一次，输入框内容逐条对上。

## 卡片 C：清理键盘相机旧逻辑（**仅在卡 A 真机验过后**）

删除 `world.ts` 的 `beginKeyboard` / `endKeyboard` / `keyboardCamera` / `rebaseKeyboard` / `keyboardMoved` / `baseline`，`rules.ts` 的 `anchorScroll` / `revealShift` 与其单测；同步 `DESIGN.md`「软键盘」那四条不变量与 `AGENTS.md` 硬纪律 32 的措辞。**前置条件**：卡 A 在真机上验过（否则没有回滚基线）。

---

**当前进行中：无。** 真机验收清单在 `build.md` §7，两项待验：**走到床边 → 躺下的站立等待 ≈ RTT**（`30-movement-sync.md` §3.9）、**`?debug=1` 下走一趟 `regressPx max` 必须为 0**（§6.2）。
