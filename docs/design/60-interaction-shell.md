# 交互外壳（interaction shell）

**一句话**：界面只有**一份布局**、**一个输入会话状态**、**一条退场路径**。键盘不是变量——它只是「输入会话」在某个内核上的副作用，界面永远不读它有多高。

这个文件回答四个问题：谁拥有哪个量（§1）、输入会话怎么开始与结束（§2）、两态布局长什么样（§3）、DOM 与画布的时序边界在哪（§4、§5）。**插槽面板的内容契约仍在 `50-slot-panel.md`**，它的几何与开关由本文接管。

## 1. 所有权表

每个量只能有一个主人。表里没有的量，不允许存在。

| 量 | 唯一来源 | 谁读 | 禁止 |
| :--- | :--- | :--- | :--- |
| **画布像素尺寸** | 「非编辑会话时」的宿主尺寸 × DPR（键盘引起的收缩永不跟进） | `scale.resize` | 编辑会话期间任何 resize（§5） |
| **画布显示位置** | `visualViewport.offsetTop` | `.app-shell` 的 `translateY` | 改尺寸、改 inset |
| **面板停靠 / 插槽显隐** | `composer` 状态（store） | `.app-shell` 的 `data-composer`、面板的 `data-open` | DOM 的 `blur` 事件、`:focus-within`、键盘高度 |
| **可用视口（相机）** | HUD 与面板的**布局**实占（`layoutTopOf` + `offsetHeight`）；底部占位 = **面板自身高度** | 取景、夹取、死区 | `getBoundingClientRect`（会跟着 transform 跑）；「屏底 − 面板顶边」（打字态会把整屏算成界面） |
| **世界缩放** | `zoomMode` | `camera.zoom` | 键盘、面板 |
| **游戏页是否打开** | `gamesOpen`（store） | `GamesOverlay` 的挂载、`suspendHall()` / `resumeHall()`；世界按全局的 `coversWorld` 走**共用的** `setWorldSuspended`，不另记一份暂停态 | 由 DOM 焦点或 `history` 推导（见 `140-games-page.md` §2） |
| **世界要不要出帧** | `coversWorld(整屏页快照)` 一处（`src/client/covered.ts`，纯函数） | `setWorldSuspended` | 按页面名另写一份枚举；用 `game.pause()` 代替 `loop.sleep()`（§5.2） |

**游戏页是唯一一个「盖住整屏、却不是输入会话」的层**：它只可能在 `composer === 'idle'` 时被打开（打开它的那颗胶囊就在被「收起」替换掉的那一组里），所以不参与 §2 的状态机，也没有第二条退场路径。

**键盘高度不存在。** 不是「不重要」，是**这个量不许被推导出来**：`innerHeight − visualViewport.height`、`documentElement.clientHeight − visualViewport.height` 一类的差值一律禁止。理由见 `50-slot-panel.md` §2：部分内核既不缩布局视口也不缩视觉视口（或一起缩导致差值归零）。

## 2. 输入会话状态机（composer）

```text
idle ──focusin(可编辑控件)──▶ typing
idle ──点「举报」（已选中某人）──▶ report
idle ──点礼物托盘里的「随机阅读」──▶ reading（不拉键盘，所以不靠 focusin）
idle ──点齿轮「反馈与建议」──▶ feedback（拉键盘，焦点进事由框）
report ──focusin──▶ report（不降级：事由框换焦点不该把它换成快捷用语）
feedback ──focusin──▶ feedback（不降级：同 report，否则会卸载表单、丢掉已写的字）
reading ──focusin──▶ typing（点了输入框就该能打字，文本让位）
report ──5003 回执 / 收起键 / 点面板空白 / 取消选中──▶ idle
feedback ──5004 回执 / 收起键 / 点面板空白──▶ idle
reading ──收起键 / 点面板空白──▶ idle
typing / report / reading / feedback ──断线 / 焦点对账失败──▶ idle
```

- **状态住 store**（`composer: 'idle' | 'typing' | 'report' | 'reading' | 'feedback'`）。DOM 焦点只是它的**入口之一**，不是它的定义——这是全篇最要紧的一句：焦点是会被卸载、会被抢走、会被系统手势吞掉的东西，把它当状态本体就必然出现「回不到大厅」。
- **入口统一**：shell 级 `focusin`，目标匹配 `input, textarea, [contenteditable]` **且落在 `.chat-panel` 或 `.slot-panel` 内** → `enterComposer()`。今天有四个源：聊天输入、`GO` 的床号输入、举报事由、反馈事由（后两者都在**插槽面板**里，是 `.chat-panel` 的兄弟节点——只匹配前者会把「聚焦事由框」判成面板外，下一帧对账直接退场）。**任何将来会拉起键盘的控件都自动进同一个状态**，不需要逐个登记。限定在面板内是必须的：入场层也有输入框（昵称），进厅时绝不能带着一个「打字态」进来。`report` / `feedback` 已在时，**`focusin` 不降级**：`ComposerEvent` 没有携带焦点目标，分不清「事由框复焦」与「点聊天输入框」，而降级会当场卸载表单、丢掉已写的事由。**`reading` 是唯一的非焦点入口**：那颗在**礼物托盘里**（`gift-tray`，不是动作行上的一颗）的阅读胶囊不拉键盘，状态由点击自己写进去（理由见 `50-slot-panel.md` §附）；从 `reading` 出发的 `focusin` 降成 `typing`（点了输入框就是要打字）。
- **出口唯一**：`exitComposer()`。它必须满足三条：
  1. **幂等**（重复调用无副作用）；
  2. **不看 `activeElement` 是谁**（当前实现正是因为它只看输入框，才在输入框被卸载后彻底失效）；
  3. 自己显式 `blur` 焦点控件，再通知订阅者。
- **焦点对账**：shell 级 `focusout` → **下一帧**（rAF）检查活跃元素是否仍落在 `.chat-panel` 或 `.slot-panel` 的可编辑控件内；不在就 `exitComposer()`。这一条覆盖两类真实故障：
  - 控件被卸载而**不发 `blur`**（表情行原地替换输入行就是这一种）；
  - 别的控件抢走焦点（`GO`、将来任何弹层）。
  - **`reading` 是唯一例外**：它里面**没有任何可编辑控件**（见 `50-slot-panel.md` §附），这条对账没有可对的东西，收到 `lost-focus` 保持原态。不豁免就会出现「面板只活 1 帧」：从礼物托盘进 `reading`，`hidePopover()` 先把焦点还给礼物那颗，而它随右端整组被换成「收起」而卸载 → `focusout` → 对账把它当成退场。
- **`composer !== 'idle'` 必须有常驻可见出口**：空闲态动作行**右端那一组两颗（礼物 / 齿轮）整体换成一颗 44px「收起」胶囊**，点它 = `exitComposer()`（typing 与 report 都一样）；左端（床号 / `GO`）不受影响。所以打字态里礼物与齿轮**一起不可达**，开着的托盘也跟着关。**不能**把「点面板空白」当唯一出口——隐性出口在出错时等于没有出口。
  两处实现细节是实测踩出来的：① 胶囊在 `pointerdown` 里 `preventDefault()`（否则它一聚焦就触发对账、面板当场换位）；② 胶囊与它替换掉的右端那一组**必须带各自的 `key`**（React 会原地复用同一颗 `<button>`，而点击的「激活行为」（`popovertarget` 开浮层）在事件处理器之后才跑，于是按「收起」会顺手弹出设置浮层）。
- **断线**（连接态转 `offline`）也走 `exitComposer()`：那一刻没有可发的东西，界面必须先把世界还给人。

**纯逻辑**：`composerReducer(state, event)` 是 DOM-free 纯函数（`composer.ts` 里**只有**它，唯一的写入路径在 store 的 `setComposer`，唯一的出口 `exitComposer()` 在 `focus.ts`——它要顺手收焦点，而 store 不该碰 DOM），单测穷举事件序列（见 §7 的 L1）。

## 3. 布局：Grid 两态，零测量

```text
空闲（idle）                    打字（typing）
┌──────────────┐              ┌──────────────┐
│    HUD       │              │    HUD       │
├──────────────┤              ├──────────────┤
│              │              │  聊天面板     │
│    世界      │              ├──────────────┤
│              │              │  插槽面板     │  ← 铺满到屏底
├──────────────┤              │ （快捷用语 /  │
│  聊天面板     │              │   类型文本）   │
└──────────────┘              └──────────────┘
```

- `.app-shell` 是 `display: grid`，两种态**只换 `grid-template-rows`**：`auto 1fr auto`（空闲）/ `auto auto 1fr`（打字）。
- 面板与插槽面板**都在流里**：位置只由网格行决定，不靠位移、不量身、没有任何逐帧布局。加一行控件不需要重算任何东西。
- **两态瞬切，不做滑动动画。** 弱机更稳，也没有「动画中途的可点区域」这个问题（§4）。插槽面板也一样：退场不是淡出（§4 末条有实测数字）。
- **插槽面板铺满到屏底**（`1fr`）：打字时看不见世界——已确认接受（`50-slot-panel.md` §9），换来的是「面板盖住世界」这条语义在打字期间始终成立。
- 世界层仍然绝对定位铺满、在网格之下。相机 insets 照旧读**布局值**（`layoutTopOf` = `offsetTop` 累加 + `offsetHeight`）：布局值不吃 `transform`。
- **底部占位用「面板自身高度」，不是「屏底 − 面板顶边」**：网格后打字态面板在屏幕上方，后者会把整块屏幕算成界面（取景变成整屏居中，而且退出打字没人重算）。两态下「面板高度」是同一个数（窄屏面板在空闲态本来就贴屏底），所以取景在两态之间不跳。
- 宽档（≥640）的居中 / 最大宽度由网格承担（`justify-self` + `max-width`），不再用 `inset` 微调位置。

## 4. DOM 时序：可点性必须与视觉同源

- **可点性跟视觉走，但依据是「盒子在不在」**：关闭态由 `visibility: hidden`（挂同一条 `allow-discrete` 过渡）负责——不可命中、不可 Tab、不在读屏树里。**不用 `pointer-events`**（关得早：面板还看得见的 160ms 里点击就漏给画布，实测 `opacity: 1` 而 `elementFromPoint` 返回 `<canvas>`）；**也不要指望 `inert`**——它会让命中跳过整棵子树（同样实测返回 `<canvas>`），它只保证「不可 Tab / 不被读屏读到」。 **打开方向不能延迟 `visibility`**：表单 `autoFocus` 落在 `visibility: hidden` 的起始帧会被吞，随后 `focusout` 对账把面板判回 idle——所以 `visibility` 只在关闭方向参与过渡，`[data-open]` 上立即生效。
- **一次点按手势期间，不许把被点的盒子拿掉。** 触摸抬手的兼容鼠标事件（`mousedown` / `mouseup` / `click`）是**按抬手那一刻**重新做命中的：盒子若在 `pointerdown` 里就消失（布局切换 / 元素卸载），补发的 `mousedown` 就落到 `<canvas>` 上——而它确实是从画布起手的事件，`pointer.downElement !== canvas` 那道兜底拦不住，一次误点就往服务端发一条 `walk`（实测：点插槽面板空白，10 次漏 7 次；鼠标不补发这些事件，所以桌面看不出来）。两种合规做法，二选一：
  1. 把手势期间的布局变化推到 `click`（点空白退场就是这么做的）；
  2. 在 `pointerdown` 里 `preventDefault()`（浏览器据此不再派发兼容鼠标事件；顺带保住焦点）。
- **世界层 tap 不变式**：`pointer.downElement !== game.canvas` 一律不派发。Phaser 4 只在 `downElement === canvas` 时才发 `POINTER_DOWN`（否则只发 `POINTER_DOWN_OUTSIDE`）。注意**它挡不住合成鼠标事件**（那种事件的目标本来就是 canvas），所以上面第二条约的是 DOM 侧的手势纪律，二者互补。
- **退场不淡出。** 撤下 `data-open` 的那一帧盒子就换成 idle 那一行、内容同时卸掉，160ms 的 `opacity` 只作用在一块与聊天面板重合的空盒子上（实测数字见 `50-slot-panel.md` §5）。所以**别按「淡出期间还看得见 ⇒ 还挡得住」来做设计**，也别拿这条写测试（这正是旧 I7 测不到东西的原因）。
- **有 Popover 时齿轮浮层用 `popover`**：顶层渲染、light-dismiss、焦点管理全部由平台给，不再手写 `aria-expanded` + 点外关闭。**但不要把布局规则写在 `[popover]` 元素本身上**：作者样式压过 UA 的 `[popover]:not(:popover-open) { display: none }`，给浮层根写 `display`（`grid` / `flex`）会让关着的浮层照旧可见——布局规则挂到一个内部容器上（礼物托盘就这样：`.hud-menu-action` 的横排与间距挂在里面的 `.hud-menu-group`）。
- **没有 Popover API 时退回自己管开关**（Chromium <114，如夸克 / UC 内核 = Chromium 100，见 `architecture.md` §1 的兼容基线）：`ToneLayer` 不写 `popover` 属性、不调 `showPopover`、不装 `toggle` 重排监听——它本来就是 `position: fixed; inset: 0` 且是 `.app-shell` 的最后一个子节点，按 DOM 顺序照样压在面板与浮层之上；齿轮菜单与礼物托盘退回同一个 `openMenu: 'none' | 'gift' | 'gear'` + `pointerdown` 点外关闭 + `Esc` 关闭 + 关时焦点回触发源，`aria-expanded` 手写（联合类型顺带保证两个浮层不会同时开）。两条路径只由 `src/client/popover.ts` 的 `HAS_POPOVER` 分叉，组件里不各写一份能力判断。降级菜单的 light-dismiss 与原生不逐字等价（焦点返回、点击穿透细节），靠手工在开发者工具里删掉三个 popover 方法后过一遍（见 `test.md` §1「降级路径的回归」）。

## 5. 画布：尺寸与渲染的生命周期

### 5.1 编辑会话期间冻结像素尺寸

- `.app-shell` 是 `position: fixed; inset: 0`，靠**布局视口**定位。iOS 聚焦时浏览器会平移视觉视口（`visualViewport.offsetTop > 0`），shell 用 `transform: translateY(offsetTop)` 把自己拉回屏幕——**只动 transform，不改尺寸**。
- **冻结门**（纯函数 `shouldResize(prev, next, typing)`）：`typing && 宽度不变 && 高度变小` → **跳过** `scale.resize`。这正是键盘的指纹：键盘只会让高度变小，宽度不动。
  - 宽度变化、DPR 变化、旋屏 → **立即重算**（不受冻结影响）。
  - **退出 typing 后不补算。** 退场与键盘收起不同步：退场那一帧量到的宿主还在收起中途，照它重算就是「先缩、再涨回」——**两次重建绘制缓冲 = 两帧黑闪**（模拟器实测：退场时量到 748、真值 772，录屏在画布区域抓到 2 帧全黑）。画布留在进打字态前的尺寸，宿主回到原值后 `ResizeObserver` 自己会来，尺寸相同就早退（不重建）。
- 冻结期间画布比宿主高（内核缩了布局视口）：多出来那条被 `.app-shell` 裁掉，而它正好在键盘或面板底下，看不见。这比「重建绘制缓冲 → 黑闪」便宜得多。
- **不声明 `interactive-widget`**（iOS 到 27.2 仍不支持，见 §8），**不读键盘高度**（§1）。

### 5.2 整屏页期间世界停渲染

- **规则：画面里看不见厅，就不许出帧。** 判据是**可见性**，不是页面身份——「哪几页要停」的答案收在一个纯函数里：`coversWorld(快照)`（`src/client/covered.ts`）。今天盖满整屏的四页**全都复用 `.entry-overlay`**（入场层 / 说明面板 / 游戏页 / 求签页；该类是 `position: absolute; inset: 0` + `background-color: var(--color-outside)`，**完全不透明满屏**，世界在底下连一个像素都看不见），所以任一页开着 → `coversWorld === true` → `setWorldSuspended(true)` → 世界层**整帧停**：`game.loop.sleep()`（Phaser 语义：`raf.stop()`，连渲染一起停）。`game.pause()` / `scene.pause()` 不行：只停 update，画布照旧每帧重绘（§8）。
- **不许按页面名枚举。** 这句规则以前写成「入场层、说明面板、游戏页」的枚举，于是求签页落地时不在名单里，2.7 Mpx 画布在整页底下照旧满帧跑——同一处缺陷的第二次现形（第一次是说明面板，见下一条），**症状都是「关页慢」，很容易被误判成卸载慢**。所以判据只在 `coversWorld` 一处，且由两条单测钉住：真值表（`coversWorld 逐字段穷举`）+ 清单对账（扫 `src/client/components/*.tsx` 里用 `entry-overlay` 的组件，与字面清单**集合相等**——多加一页就红，`src/client/tests/covered.test.ts`）。哪天把这四页抽成共用的整屏页壳组件，对账那条改成扫那个组件。
- **`hasSession` 也算进公式**：`/api/me` 没回来时四页都还没画（都等 `session`），只看 `!entered` 就会停在一块什么都没盖的屏上。
- **为什么停**：整屏页盖住的是 **2.7 Mpx** 画布（393 CSS px × DPR 3 = 1179×2316）。谁也看不见它，它却照旧吃满合成与 WebGL 的那一份预算。宿主 Android 模拟器（SwiftShader，≈23fps）实测：说明页开着时整条帧管线堵到**一次 tap 排队 31 → 270 ms、rAF 停顿 1.8 ~ 3.7 s**；真机 Via 上的形态正是这个——**「点知道了没反应、1-2 秒后大厅直接出现」，卡的不是关闭动作（面板出 DOM 只要 2 ~ 12 ms），是关闭之前那段时间管线已经堵住**。
- **恢复必须重锚**：`loop.wake()` 只重启 rAF，**不清 `lastTime`**；`step()` 里 `delta = time - lastTime` 于是会算出「暂停了多久」那么大的一个 delta，`advanceMover` 与相机跟随都会一次跳一屏。顺序恒为 `resetDelta()` → `wake()`（`resetDelta()` 把 `time` / `lastTime` 一起打回 `performance.now()`，首帧 delta ≈ 0）。位置本身不需要补偿：服务端时间戳与外推都是 `f(t)`，醒来那一帧自然就是「当下」。
- **幂等**：世界层自留一个 `suspended` 布尔，只有状态真翻转才 sleep / wake（`wake()` 在 `running` 时虽会早退，但 `resetDelta()` 会打乱 FPS 统计）。
- **首次创建时 loop 还没跑起来**：`new Phaser.Game()` 之后要先等 `TextureManager` 把三张 base64 贴图 `onload` 完才 `loop.start()`，而世界 chunk 是动态 import 的——注册那一刻 `running === false`，直接 `sleep()` 就是空操作。所以停不下时挂一次 `poststep`、在首帧尾巴上再睡（醒来前又盖上的情况由 `suspended` 兜住）；`!started` 时**不 wake**：那时 `wake()` 会在 `callback` 设上之前就重启 rAF。
- **界面层不关心世界层起没起来**：世界层是懒加载块（入场层不该等它下载完），App 的 effect 可能比它先跑。所以 `src/client/world-handle.ts` **模块级记住最后一次请求**，`setWorldHandle()` 注册时把当前值套上去。
- **覆盖期间没有别的东西要看**：停的是整个世界（含雨层 Scene）；DOM 界面照旧，它本来就不吃 Phaser 的帧。

## 6. 不变式（每条都必须可测）

| # | 不变式 |
| :--- | :--- |
| I1 | `composer` 只能由 store 改；界面不得从 DOM 事件推导停靠态 |
| I2 | 从 `typing` / `report` / `feedback` 出发，**任一**退出类事件（`exit` / `lost-focus` / `offline`）都直接到 `idle`；从 `reading` 出发，`exit` / `offline` 到 `idle`、`lost-focus` **保持 `reading`**（里面没有可编辑控件）——穷举长度 ≤ 4 的序列证明没有卡住的路 |
| I3 | `exitComposer()` 幂等，且不依赖 `document.activeElement` 的具体类型 |
| I4 | `composer !== 'idle'` 时屏幕内始终存在一个可见的 44px 出口控件 |
| I5 | 任何可编辑控件获得焦点 → `composer` 为 `typing` 或 `report`（无例外，含 `GO` 床号与举报事由）；**`report` 不会被焦点事件降级成 `typing`** |
| I6 | `typing` 期间与退场当帧画布像素尺寸都不变（`canvas.width/height` 与 `scale.resize` 调用次数都不变） |
| I7 | 点插槽面板空白**不产生 `walk`**：空白处的 `pointerdown` 被取消（`defaultPrevented`），且整次手势期间手指底下的盒子不换手 |
| I8 | 世界层只接受 `downElement === canvas` 的 tap |
| I9 | 相机取景只吃布局值（`layoutTopOf`），不吃 `getBoundingClientRect` |
| I10 | 全仓不出现键盘高度推导（`innerHeight`/`visualViewport.height`/`clientHeight` 的差值） |
| I11 | 无 Popover API（Chromium 100）时进厅不崩，齿轮菜单靠手写开关走完开 / `Esc` 关 / 换床；能力判断只在 `src/client/popover.ts`（手工删三个 popover 方法复验） |
| I12 | 整屏页期间不产生帧（`game.loop.running === false`）；恢复首帧 delta 不超过一帧目标，且画面直接是「当下」。视口尺寸变化引起的绘制缓冲重建不算（那也不画新帧） |
| I13 | `coversWorld` 的真值表穷举全绿，且**每个用 `.entry-overlay` 的组件都在它的判据里**（两份单测：`tests/covered.test.ts`）；新增整屏页而不同步 `coversWorld` 时测试必红 |

## 7. 测试分层

| 层 | 环境 | 内容 |
| :--- | :--- | :--- |
| **L1** | vitest（`npm test`） | `composerReducer` 的事件序列穷举；`shouldResize`、`keyboardOf`、`usableView` 之类布局算术 |
| **L2** | 桌面浏览器（手机视口，手工过一遍） | 每个状态的出口可达、画布尺寸不变、`walk` 的来源、Popover 降级（开发者工具里删三个方法后仍能用） |
| **L3** | 宿主 Android 模拟器（配方见 `test.md` §2） | 真 IME 下三个量的关系、`scale.resize` 次数、`screenrecord` 逐帧看闪烁 |
| **L4** | 真机 | 手感、特定内核（夸克 / Via）、低亮度观感 |

## 8. 拒绝的方案与理由

| 方案 | 为什么不 |
| :--- | :--- |
| 读键盘高度抬 composer（`keyboard-inset` / `use-dynamic-viewport` / `viewport-lock` / `react-bottom-fixed` / `react-ios-keyboard-viewport`） | 全部依赖 `visualViewport` 差值或 `navigator.virtualKeyboard`；部分内核测不出（§1）。引包等于把已删掉的病根请回来 |
| `interactive-widget=resizes-content` | iOS Safari 到 27.2 仍不支持（caniuse；w3c/editing #549）。用了就把「iOS 一条路 / Android 另一条路」写死 |
| VirtualKeyboard API（`overlaysContent` + `env(keyboard-inset-height)`） | MDN 标 Limited availability、非 Baseline。**记进 `backlog.md`**：将来 Safari 落地后它能一举简化 |
| 固定内部分辨率 + CSS 缩放（`Scale.FIT` 那一派） | 会让「1 世界像素 = 1 CSS 像素」失效，相机与触摸换算全要重算 |
| View Transitions 做两态动画 | 整页快照，画布页首帧代价高；它解决「好看」，不解决「一致」 |
| `input: { windowEvents: false }` | 不必要：Phaser 已经用 `downElement` 拦住了非画布起手的事件（§4）。但它拦不住触摸抬手后补发的合成鼠标事件，那条靠 DOM 侧的手势纪律（§4） |
| `game.pause()` / `scene.pause()` 当暂停用 | 只停 update，画布照旧每帧重绘，覆盖期间的无用功一点没少（`sleep()` 才是连渲染一起停，见 `.agents/skills/scenes`） |
| 靠降 DPR（`MAX_DPR` 3 → 2）摊平成本 | 拿全屏清晰度换一段**谁也看不见的**时间。DPR 1 确实不再复现，但那等于长期降低观感去补覆盖期的问题 |
| 把输入框关进 iframe（PlayCanvas 圈的通行解法） | 唯一「结构性」根治键盘缩布局视口的办法，但 composer 整块要搬进 iframe（令牌、字体、安全区、焦点、a11y 全重来）。**留作第 3 层兜底**：L3 实测若仍有内核黑闪再上 |

## 9. 已知代价

- **两态瞬切，没有滑动动画。**
- **打字态齿轮不可达**：typing 态右端被「收起」占位（连同它左边那四颗），换床 / 缩放 / 看版本要先收起（打字时开设置本来也无意义）。`reading` 态同理（右端也是「收起」）——想看阅读历史以外的事，先收起再开。
- **画布不追键盘那次收缩**：打字期间与退场之后，画布都停在进打字态前的像素尺寸。内核若不恢复布局视口，画布就固定比宿主高那一条（底部被 `.app-shell` 裁掉，不可见）。
- **打字时看不见世界**（插槽铺满的既有代价）。
- **游戏页盖住整屏时也看不见厅里**：聊天气泡、别人的走动全部被遮住；明暗层照旧压住它（三档不为例外）。
- **恢复瞬间画面直接对齐当下**：整屏页期间世界停帧，醒来第一帧按服务端时间戳算当前位置，相当于一次 `hop` 式落位（小人、猫、篝火都直接「跳」到该在的地方），不补播这期间的动作。

## 10. 验收判据

### 本地可验（L1 + 桌面浏览器手工过）

| # | 判据 |
| :--- | :--- |
| 1 | `npm test` 里 `composerReducer` 序列穷举全绿：含「表情行替换输入行」「`GO` 夺焦」「断线」「发送」四条路径，每条都能回到 `idle` |
| 2 | 手机视口下依次点：输入框 → 😀 → 面板空白 → 收起胶囊，四步都能把面板送回底部、画布可点 |
| 3 | `typing` 全程与退场之后 `canvas.width` / `canvas.height` 都不变，且 `MutationObserver` 没看到画布尺寸属性变化；宽度 / DPR 变化则立即重算 |
| 4 | 点插槽面板空白：空白处的 `pointerdown` 被取消（`defaultPrevented === true`），且连点 8 次一次 `walk` 都没有、每次都回到 `idle` |
| 5 | 在 `typing` 态从画布起手 tap → 有 `walk`；从面板起手 tap → 没有 `walk`（开发者工具里点，或看 `?debug=1` 的上行日志） |
| 6 | `GO` 床号输入聚焦后 `data-composer="typing"` 同样成立（同一个状态机） |
| 7 | `npm test` 里 `world-handle` 两条：世界层**晚于**请求才注册时仍拿到暂停态；界面层每次请求都转发（**去重在世界层**，那道守卫要 L3 才验得到） |

### 只能在真机 / 模拟器得结论

真 IME 下的键盘动画观感、iOS 视觉视口 pan、低端机帧率、特定内核（夸克 / Via）。另外几条可量化的：**打字退场时 `canvas.width/height` 全程不变**；**发送后 `screenrecord` 逐帧不得出现整块变黑**（判据：画布区域亮度不低于空闲帧）；**整屏页期间画布不再重绘**（`drawElements` / `drawArrays` 计数 1.2 s 增量为 0；`readPixels` 不可用——Phaser 不开 `preserveDrawingBuffer`）；**覆盖期间不出现 ≥1.8 s 的 rAF 停顿**（基线：SwiftShader 上 6 次复现里 5 次出现）；**关掉整屏页后位置不跳**（`?debug=1` 的 `regressPx` 仍为 0，`posAge` 一帧内回到正常）。
