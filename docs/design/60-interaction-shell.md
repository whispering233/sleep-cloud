# 交互外壳（interaction shell）

**一句话**：界面只有**一份布局**、**一个输入会话状态**、**一条退场路径**。键盘不是变量——它只是「输入会话」在某个内核上的副作用，界面永远不读它有多高。

这个文件回答四个问题：谁拥有哪个量（§1）、输入会话怎么开始与结束（§2）、两态布局长什么样（§3）、DOM 与画布的时序边界在哪（§4、§5）。**插槽面板的内容契约仍在 `50-slot-panel.md`**，它的几何与开关由本文接管。

## 1. 所有权表

每个量只能有一个主人。表里没有的量，不允许存在。

| 量 | 唯一来源 | 谁读 | 禁止 |
| :--- | :--- | :--- | :--- |
| **画布像素尺寸** | 「非编辑会话时」的宿主尺寸 × DPR | `scale.resize` | 编辑会话期间任何 resize（§5） |
| **画布显示位置** | `visualViewport.offsetTop` | `.app-shell` 的 `translateY` | 改尺寸、改 inset |
| **面板停靠 / 插槽显隐** | `composer` 状态（store） | `data-docked` / `data-open` | DOM 的 `blur` 事件、`:focus-within`、键盘高度 |
| **可用视口（相机）** | HUD 与面板的**布局**实占（`layoutTopOf` + `offsetHeight`） | 取景、夹取、死区 | `getBoundingClientRect`（会跟着 transform 跑） |
| **世界缩放** | `zoomMode` | `camera.zoom` | 键盘、面板 |

**键盘高度不存在。** 不是「不重要」，是**这个量不许被推导出来**：`innerHeight − visualViewport.height`、`documentElement.clientHeight − visualViewport.height` 一类的差值一律禁止。理由见 `50-slot-panel.md` §2：部分内核既不缩布局视口也不缩视觉视口（或一起缩导致差值归零）。

## 2. 输入会话状态机（composer）

```text
idle ──focusin(可编辑控件)──▶ typing
typing ──发送 / 收起键 / 断线 / 焦点对账失败──▶ idle
```

- **状态住 store**（`composer: 'idle' | 'typing'`）。DOM 焦点只是它的**入口之一**，不是它的定义——这是全篇最要紧的一句：焦点是会被卸载、会被抢走、会被系统手势吞掉的东西，把它当状态本体就必然出现「回不到大厅」。
- **入口统一**：shell 级 `focusin`，目标匹配 `input, textarea, [contenteditable]` → `enterComposer()`。今天有两个源：聊天输入、`GO` 的床号输入（**任何将来会拉起键盘的控件都自动进同一个状态**，不需要逐个登记）。
- **出口唯一**：`exitComposer()`。它必须满足三条：
  1. **幂等**（重复调用无副作用）；
  2. **不看 `activeElement` 是谁**（当前实现正是因为它只看输入框，才在输入框被卸载后彻底失效）；
  3. 自己显式 `blur` 焦点控件，再通知订阅者。
- **焦点对账**：shell 级 `focusout` → **下一帧**（rAF）检查活跃元素是否仍落在 `.chat-panel` 的可编辑控件内；不在就 `exitComposer()`。这一条覆盖两类真实故障：
  - 控件被卸载而**不发 `blur`**（表情行原地替换输入行就是这一种）；
  - 别的控件抢走焦点（`GO`、将来任何弹层）。
- **typing 态必须有常驻可见出口**：动作行右端的齿轮临时换成 **44px「收起」胶囊**，点它 = `exitComposer()`。**不能**把「点面板空白」当唯一出口——隐性出口在出错时等于没有出口。
- **断线**（连接态转 `offline`）也走 `exitComposer()`：那一刻没有可发的东西，界面必须先把世界还给人。

**纯逻辑**：`composerReducer(state, event)` 与 `canExit(state)` 是 DOM-free 纯函数，单测穷举事件序列（见 §7 的 L1）。

## 3. 布局：Grid 两态，零测量

```text
空闲（idle）                    打字（typing）
┌──────────────┐              ┌──────────────┐
│    HUD       │              │    HUD       │
├──────────────┤              ├──────────────┤
│              │              │  聊天面板     │
│    世界      │              ├──────────────┤
│              │              │  插槽面板     │  ← 铺满到屏底
├──────────────┤              │  （快捷用语） │
│  聊天面板     │              │              │
└──────────────┘              └──────────────┘
```

- `.app-shell` 是 `display: grid`，两种态**只换 `grid-template-rows`**：`auto 1fr auto`（空闲）/ `auto auto 1fr`（打字）。
- 面板与插槽面板**都在流里**。因此**删除**：`--dock-y` 位移、`translateY`、`slotHeightOf()`、量面板高的两个 `ResizeObserver`、`data-docked` 的 transform 分支。加一行控件不再需要任何重算。
- **两态瞬切，不做滑动动画。** 弱机更稳，也没有「动画中途的可点区域」这个问题（§4）。
- **插槽面板铺满到屏底**（`1fr`）：打字时看不见世界——已确认接受（`50-slot-panel.md` §9），换来的是「面板盖住世界」这条语义在打字期间始终成立。
- 世界层仍然绝对定位铺满、在网格之下。相机 insets 照旧读**布局值**（`layoutTopOf` = `offsetTop` 累加 + `offsetHeight`）：布局值不吃 `transform`，过渡进行中量到的是终点。
- 宽档（≥640）的居中 / 最大宽度由网格承担（`justify-self` + `max-width`），不再用 `inset` 微调位置。

## 4. DOM 时序：可点性必须与视觉同源

- **退场用 `visibility` 离散过渡**：`opacity` 与 `visibility` 挂同一条 transition，`transition-behavior: allow-discrete` 让 `visibility: hidden` 在动画末帧才生效。**不再用 `pointer-events` 立刻断开**——那会让面板在还看得见的 160ms 里把点击漏给画布（实测：`opacity: 1` 而 `pointer-events: none`，`elementFromPoint` 返回 `<canvas>`）。
- 判据：退场动画的**每一帧**，面板覆盖区域内任意一点 `document.elementFromPoint` 都不得返回 `<canvas>`。
- **世界层 tap 不变式**：`pointer.downElement !== game.canvas` 一律不派发。Phaser 4 只在 `downElement === canvas` 时才发 `POINTER_DOWN`（否则只发 `POINTER_DOWN_OUTSIDE`），这条是把那个判定抄成自己的兜底，将来任何 DOM 叠层都自动安全。
- **齿轮浮层用 `popover`**：顶层渲染、light-dismiss、焦点管理全部由平台给，删掉手写的 `aria-expanded` + 点外关闭。

## 5. 画布：编辑会话期间冻结像素尺寸

- `.app-shell` 是 `position: fixed; inset: 0`，靠**布局视口**定位。iOS 聚焦时浏览器会平移视觉视口（`visualViewport.offsetTop > 0`），shell 用 `transform: translateY(offsetTop)` 把自己拉回屏幕——**只动 transform，不改尺寸**。
- **冻结门**（纯函数 `shouldResize(prev, next, typing)`）：`typing && 宽度不变 && 高度变小` → **跳过** `scale.resize`。这正是键盘的指纹：键盘只会让高度变小，宽度不动。
  - 宽度变化、DPR 变化、旋屏 → **立即重算**（不受冻结影响）。
  - 退出 typing 后**重算一次**；尺寸真的变了就发生一次重排（可见跳变一次，接受）。
- 冻结期间若内核缩了布局视口，画布底部会有一截空白——被键盘盖住，看不见。这比「逐帧重建绘制缓冲 → 黑闪」便宜得多。
- **不声明 `interactive-widget`**（iOS 到 27.2 仍不支持，见 §8），**不读键盘高度**（§1）。

## 6. 不变式（每条都必须可测）

| # | 不变式 |
| :--- | :--- |
| I1 | `composer` 只能由 store 改；界面不得从 DOM 事件推导停靠态 |
| I2 | 从 `typing` 出发，**任何**事件序列都必须在有限步内可达 `idle`（`canExit`） |
| I3 | `exitComposer()` 幂等，且不依赖 `document.activeElement` 的具体类型 |
| I4 | `typing` 态屏幕内始终存在一个可见的 44px 出口控件 |
| I5 | 任何可编辑控件获得焦点 → `composer === 'typing'`（无例外，含 `GO` 床号） |
| I6 | `typing` 期间画布像素尺寸不变（`canvas.width/height` 与 `scale.resize` 调用次数都不变） |
| I7 | 面板退场动画的每一帧，面板区域内 `elementFromPoint` 都不是 canvas |
| I8 | 世界层只接受 `downElement === canvas` 的 tap |
| I9 | 相机取景只吃布局值（`layoutTopOf`），不吃 `getBoundingClientRect` |
| I10 | 全仓不出现键盘高度推导（`innerHeight`/`visualViewport.height`/`clientHeight` 的差值） |

## 7. 测试分层

| 层 | 环境 | 内容 |
| :--- | :--- | :--- |
| **L1** | vitest（`npm test`） | `composerReducer` / `canExit` 事件序列穷举；`shouldResize`、`slotHeightOf` 之类布局算术 |
| **L2** | Playwright（`npm run e2e`，手机视口，**不需要 IME**） | I4 / I6 / I7 / I8 的 DOM 契约；每个状态的出口可达 |
| **L3** | 宿主 Android 模拟器（配方见 `test.md` §2） | 真 IME 下三个量的关系、`scale.resize` 次数、`screenrecord` 逐帧看闪烁 |
| **L4** | 真机 | 手感、特定内核（夸克 / Via）、低亮度观感 |

L2 **不进 CI**：它要 `.dev.vars`、要起 wrangler、要真浏览器；塞进 Actions 只是放大不确定性。写进 `test.md` 的「合并前必跑」清单。

## 8. 拒绝的方案与理由

| 方案 | 为什么不 |
| :--- | :--- |
| 读键盘高度抬 composer（`keyboard-inset` / `use-dynamic-viewport` / `viewport-lock` / `react-bottom-fixed` / `react-ios-keyboard-viewport`） | 全部依赖 `visualViewport` 差值或 `navigator.virtualKeyboard`；部分内核测不出（§1）。引包等于把已删掉的病根请回来 |
| `interactive-widget=resizes-content` | iOS Safari 到 27.2 仍不支持（caniuse；w3c/editing #549）。用了就把「iOS 一条路 / Android 另一条路」写死 |
| VirtualKeyboard API（`overlaysContent` + `env(keyboard-inset-height)`） | MDN 标 Limited availability、非 Baseline。**记进 `backlog.md`**：将来 Safari 落地后它能一举简化 |
| 固定内部分辨率 + CSS 缩放（`Scale.FIT` 那一派） | 会让「1 世界像素 = 1 CSS 像素」失效，相机与触摸换算全要重算 |
| View Transitions 做两态动画 | 整页快照，画布页首帧代价高；它解决「好看」，不解决「一致」 |
| `input: { windowEvents: false }` | 不必要：Phaser 已经用 `downElement` 拦住了非画布起手的事件（§4） |
| 把输入框关进 iframe（PlayCanvas 圈的通行解法） | 唯一「结构性」根治键盘缩布局视口的办法，但 composer 整块要搬进 iframe（令牌、字体、安全区、焦点、a11y 全重来）。**留作第 3 层兜底**：L3 实测若仍有内核黑闪再上 |

## 9. 已知代价

- **两态瞬切，没有滑动动画。**
- **打字时齿轮不可达**：typing 态右端被「收起」占位，换床 / 看版本要先收起（打字时开设置本来也无意义）。
- **冻结期间画布底部可能留白**（被键盘盖住，看不见）。
- **退出 typing 时可能重排一次**（内核真的缩过布局视口时）。
- **打字时看不见世界**（插槽铺满的既有代价）。

## 10. 验收判据

### 本地可验（L1 + L2）

| # | 判据 |
| :--- | :--- |
| 1 | `npm test` 里 `composerReducer` 序列穷举全绿：含「表情行替换输入行」「`GO` 夺焦」「断线」「发送」四条路径，每条都能回到 `idle` |
| 2 | 手机视口下依次点：输入框 → 😀 → 面板空白 → 收起胶囊，四步都能把面板送回底部、画布可点 |
| 3 | `typing` 全程 `canvas.width` / `canvas.height` 不变，且 `MutationObserver` 没看到画布尺寸属性变化 |
| 4 | 面板退场动画期间（`data-open` 已撤、`opacity > 0`）`elementFromPoint` 在面板区域内不返回 canvas |
| 5 | 在 `typing` 态用 CDP/Playwright 派发一次画布起手的 tap → 有 `walk`；从面板起手的 tap → 没有 `walk` |
| 6 | `GO` 床号输入聚焦后 `data-docked` 同样成立（同一个状态机） |

### 只能在真机 / 模拟器得结论

真 IME 下的键盘动画观感、iOS 视觉视口 pan、低端机帧率、特定内核（夸克 / Via）。
