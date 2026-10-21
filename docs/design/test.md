# 测试环境与测试流程

**本文只回答一件事：某一类测试该在哪个环境里做。** 不维护测试条目清单——条目跟着需求走，需求一变就全废，维护它没有收益。判据写在对应模块的设计文档里（每份设计文档自己带「怎么算做对了」），用例从那里现取。

**优先级**：本项目移动端优先，**凡是能在宿主 Android 模拟器里做的验收，一律先在模拟器里做**（§2 有配方）。桌面浏览器仿真手机视口只是**降级选项**——模拟器起不来时用它看「有没有明显离谱」，并且必须在结论里写明「降级验证、未过模拟器」。原因见 §3：视口能仿真，软键盘、IME、触摸语义、合成器行为都仿真不了，而这些恰好是移动端最容易翻车的地方。

## 1. 环境一览

| 环境 | 是什么 | 什么时候用它 |
| :--- | :--- | :--- |
| **单测（L1）** | `npm test`（vitest）：纯函数、布局、寻路、位置同步的假时间轴、协议镜像、**交互状态机（`composerReducer` 及其序列穷举）/ `shouldResize`** | **任何纯逻辑**。能写成纯函数就必须在这里验，不要留到别处 |
| **契约 spec（L2）** | `npm run e2e`（Playwright；需先起 `npm run dev`，端口自动读 `.wrangler/dev-port`；宿主机没装 Playwright 浏览器时用 `PLAYWRIGHT_CHROMIUM_PATH` 指一个已有 Chromium）：DOM 契约（四个 spec 文件：`e2e/shell.spec.ts` 六条、`e2e/weather.spec.ts` 一条、`e2e/about.spec.ts` 四条、`e2e/type-text.spec.ts` 两条）——每个状态的出口可达、点插槽面板空白不产生 `walk`、`typing` 期间与退场之后画布尺寸不变、只有画布起手的 tap 产 `walk`、无 Popover 时降级路径能进厅并走完齿轮菜单、隐私说明两处入口都指向静态页；天气胶囊翻转 / 落盘 / 重载保持；说明面板首访弹一次 / 勾选着关就不再弹 / 取消勾选仍弹 / 齿轮里能自由开关；类型文本点阅读入口就有正文、抽一条换一条、收起与刷新都保留当前条、全程零上行 | **界面壳层的不变式**（`60-interaction-shell.md` §6）。它不测像素、也不需要 IME，所以桌面就能跑；**不进 CI**，进 §4 的「合并前必跑」 |
| **类型检查** | `npm run typecheck`（三份 tsconfig） | 改协议 / 样式令牌 / 前端代码后。干净克隆先跑一次 `npm run tokens` |
| **桌面浏览器** | 本机 Chromium（Playwright / BetterWright） | 逻辑与流程：进厅、走动、躺下、聊天、断线重连、命中判定。**桌面视口只用于「不是响应式」的那类结论** |
| **桌面浏览器 + 手机视口** | 同上，但视口按手机设（393×852 类） | **降级选项**：模拟器不可用时才用，只能看溢出/换行这类明显错误；**结论必须标注「降级验证」**。它仿真不了软键盘、IME、真触摸语义（见 §3），所以**不得作为响应式/触摸类验收的通过依据** |
| **宿主 Windows 上的 Android 模拟器** | 真 Android + 真 Chrome + 真 Gboard，`-gpu host` | **移动端验收的默认环境**：布局与响应式、触摸语义（合成分发）、软键盘 / IME、画布与面板时序、DOM 与合成器行为。配方见 §2 |
| **真机** | 实机 iOS Safari / Android Chrome | 真手指、低端机帧率、真机低亮度观感、iOS 与 Android 的平台差异、你要验的那个具体内核（夸克 / Via） |
| **生产** | 部署后的站点 + 平台用量面板 | 额度、并发上限、真实网络下的节拍与位置年龄。**与额度相关的结论只看平台用量面板，不接受推算** |
| **音频听感** | 外放 / 耳机，人耳 | 只能人耳判。自动化最多断言「`AudioContext` 在跑、请求确实发生、没有异常」，断言不了好不好听。移动端要同时验 **iOS 静音拨片**：拨到静音后 WebAudio 不出声是平台行为，不是 bug |

**基线设备**：iPhone 16 竖屏（393×852 / DPR 3 / 真手指触摸）。窄档阈值 640，其它窄屏手机走同一套分支。

**降级路径的回归**：Popover API 缺失用 e2e 的 init script 模拟（导航前删 `HTMLElement.prototype.showPopover/hidePopover/togglePopover`），`e2e/shell.spec.ts` 有一条固定用例；真夸克（Chromium 100）只能在真机上复验——模拟器跑不动（arm64-only APK 在 x86_64 镜像上 ANR）。

## 2. 宿主 Windows 上的 Android 模拟器（移动端验收的默认环境）

浏览器的窗口宽高反馈**仿真不了**软键盘：`visualViewport` 收不收、布局视口缩不缩、IME 自己的候选条占多大，都是内核行为。要拿这些数只能起一台真的 Android。

**模拟器跑在宿主 Windows，不跑在 WSL 里。** 判据只有一条：GPU。实测同一台机器、同一个页面：

| 模拟器跑在哪 | 图形后端 | 页内 rAF |
| :--- | :--- | :--- |
| WSL 里 | `swiftshader_indirect`（WSL 只有 `/dev/dxg`，没有 `/dev/dri`，拿不到宿主 GPU 直通） | **24 fps**，qemu 吃满约 620% CPU |
| 宿主 Windows | `-gpu host` → 实测落在宿主独显（`emulator` 日志 `Selecting Vulkan device:`、页内 WebGL 报同一块卡） | **60 fps** |

所以：**帧率 / 掉帧 / 动画流畅度类的验收只能在宿主 Windows 上做**；WSL 里那套只能验逻辑、布局与键盘语义。

**路径不入库。** SDK 的真实路径含宿主 Windows 用户名，写进文档既泄露也没法复用。改由本地文件提供（与 `.dev.vars` 同一套习惯）：

```text
cp .android-env.example .android-env     # 填进宿主 SDK 路径、AVD 名（.android-env 已 gitignore）
. ./.android-env                          # 在要起模拟器的 shell 里 source 一次
```

**顺序**（一条命令一步，不要串管道）：

```text
"$EMULATOR" -list-avds                                    # 挑 AVD，填进 .android-env 的 AVD_NAME
"$EMULATOR" -avd "$AVD_NAME" -gpu host -no-snapshot-load  # 起模拟器（保留宿主 GUI 窗口）
npm run dev                                               # 项目仍跑在 WSL 里（原生盘快）
"$ADB" reverse tcp:<dev 端口> tcp:<dev 端口>               # 让设备里的 localhost 指到 WSL 的 dev server
"$ADB" shell am start -a android.intent.action.VIEW -d 'http://localhost:<dev 端口>/' -n com.android.chrome/com.google.android.apps.chrome.Main
```

**设备侧读数**（CDP，不必装 Playwright：宿主 Node ≥ 22 自带 `WebSocket`）：

```text
"$ADB" forward tcp:9222 localabstract:chrome_devtools_remote
# 然后对 http://127.0.0.1:9222/json/list 里的 webSocketDebuggerUrl 发 Runtime.evaluate
```

`forward` 的端口绑在**宿主 Windows 的 127.0.0.1** 上，WSL 里连不上（`curl 127.0.0.1:9222` refused）。所以驱动脚本跑在 Windows 侧（`/mnt/c/Program Files/nodejs/node.exe <脚本>`，Node ≥ 22 自带 `WebSocket`），或者用 `/mnt/c/Windows/System32/curl.exe` 读 `/json/list`。

**用 `adb shell input tap` 点按钮前先换算坐标**：tap 吃的是**设备像素**，页内 `getBoundingClientRect()` 是**视口 CSS 像素**，中间隔着 Chrome 自己的外壳（地址栏，实测约 100 CSS px）。

```text
deviceY = (cssY + (screen.height - innerHeight)) * devicePixelRatio
deviceX = cssX * devicePixelRatio
```

漏掉外壳那一段的表现是「点某颗按钮却点到了它上方的画布或另一行按钮」——实测曾把「点了『睡了』人却站起来」误判成产品 bug（其实是点到了画布 → 发了 `walk`）。稳妥做法：先用 CDP 读出控件的 rect，再按上式换算。

**AVD 要求**：系统镜像必须带 Play Store（`google_apis_playstore`），否则没有真 Chrome 与真 Gboard。要验软键盘还得确认 AVD 的 `hw.keyboard=no`——有物理键盘时部分输入框不弹软键盘。屏幕参数不必与基线一致（窄档就是窄档），可以用运行时覆盖对齐：

```text
"$ADB" shell wm size 1179x2556      # 想对齐 393 CSS 宽 + DPR 3
"$ADB" shell wm density 480
```

**四个坑，都实测踩过**：

1. **页面不在前台就没有 60fps**。标签被切到后台时 `document.visibilityState === 'hidden'`，rAF 被节流到 30fps（实测 `{fps:28~31, vis:'hidden'}`）。量帧率前先 `Page.bringToFront`，量完顺手读一次 `visibilityState` 确认是 `visible`——**别把后台节流当成性能问题**。
2. **`adb reverse` / `adb forward` 会沉默失效**。模拟器重启或 Chrome 被清数据后，`reverse --list` / `forward --list` 仍显示映射，但页面打不开。重跑一次即恢复；**排查顺序是「先重跑这两条」而不是先怀疑服务端**。
3. **渲染进程会崩溃循环**，表现为整页空白：`logcat` 里是 `chromium: Child process died (type=6)` 反复出现，`Runtime.evaluate` 全部超时、而 `Page.captureScreenshot` 仍能出图。`am force-stop` 与 `pm clear` 都**救不回来**，只能 `"$ADB" emu kill` 重启模拟器。
4. **可视证据要走 `screenrecord`**。`Page.captureScreenshot` 与 `Page.startScreencast` 在合成器层会对同帧去重（实测连拍 10 张 md5 全同、screencast 收到 0 帧），抓不到「面板已撤、画布已清」那一瞬间。改用设备侧录屏再逐帧解：`"$ADB" shell screenrecord --bit-rate 16000000 /sdcard/r.mp4` → `ffmpeg -i r.mp4 -vf fps=60 f%03d.jpg`。

**并行：一个 worktree 一台 AVD。** 同名 AVD 不能并行起第二个实例（`userdata-qemu.img` 被锁），而「借别人的模拟器看」会让本地存储、Chrome 登录态、`adb reverse` 串在一起 —— 那样的结论不算数。自己起一台：把 `~/.android/avd/<旧名字>.avd/config.ini` 复制到新目录（**只复制 config.ini**，几个 GB 的 userdata 由首次启动自己生成），再写一份 `<新名字>.ini`，然后 `-avd <新名字> -port 5556 -no-snapshot-load`。`adb reverse` / `forward` 是**按设备**的，每条命令都带 `-s emulator-<端口>`；CDP 的 forward 端口也各用各的（如 9333），否则两台模拟器的调试口互相顶掉。新 AVD 第一次打开 Chrome 会有首运屏（「Stay signed out」→「No thanks」），点完后才到页面。

**它到底在不在响（音频）**：`"$ADB" -s emulator-5556 shell dumpsys audio`，找 `package:com.android.chrome` 的 `AudioPlaybackConfiguration`：`state:started` + `usage=USAGE_MEDIA` 就证明 WebAudio 真的在播（早播循环与主循环会各出现一条，与 `docs/design/config.md` §4 的双 source 设计对得上）。好不好听仍只能人耳（§3）。

## 3. 环境能做到什么、做不到什么

| 结论类型 | 模拟器（宿主，**默认**） | 桌面视口（降级） | 真机 |
| :--- | :--- | :--- | :--- |
| 纯逻辑 / 协议 / 布局计算 | 单测即可 | — | — |
| DOM 布局、响应式、触摸目标尺寸 | 可以（通过依据） | 粗略（只看明显离谱，不作通过依据） | 可以（唯一权威） |
| **软键盘**：`innerHeight` / `visualViewport.height` / `document.documentElement.clientHeight` 三者的真实关系 | **可以** | **不能**（无 IME） | 可以 |
| **画布重建次数与面板撤除的先后顺序** | 可以 | 可以（信号是页内的，与 IME 无关） | 可以 |
| 真手指触摸手感、捏合跟手 | 不能 | 不能（`adb shell input tap` 是合成事件） | 可以 |
| 低端机帧率 | 不能 | 不能（宿主是独显） | 可以 |
| 低亮度观感（对比度、三档幅度） | 不能 | 不能 | 可以 |
| **特定内核**（夸克 / Via 等自研内核） | 不能 | 不能（模拟器里只有真 Chrome，除非侧载 APK） | 可以 |

**一句话**：模拟器是「真 Chrome + 真 IME + 真触摸语义」的替代品，**不是**「真手指 + 低端机 + 你要验的那个内核」的替代品。所以默认用模拟器，只有上表的「不能」与真机专属项才降级到真机/桌面视口。

## 4. 流程

1. **纯逻辑先有单测**。没有单测的行为改动，先问「这段能不能变成纯函数」。
2. **界面壳层类改动（布局 / 键盘 / 焦点 / 指针）必跑 L2**：先 `npm run dev` 起站点，再跑 `npm run e2e`。它测的是不变式，不是像素——不通过就是设计被破坏，不许「下次再看」。
3. **`npm run dev` 不会重建前端**：它只启 `wrangler dev` 并服务 `dist/`，**没有 build、也没有 watch**。所以「改了源码 → 点开页面看」看到的一定是旧构建——实测就有人拿旧构建下了「改动无效」的结论。**UI 验收前先 `npm run build`**（改完源码再验，或验收中途改了源码都要补一次）。
   **建完之后要对一下有没有生效**：`npm run dev` 基于 `dist/` 建过一次资产清单，重建后它可能仍然下发**旧的 `index.html`**（页面引用的哈希 ≠ `ls dist/assets/index-*.js`）。比对一行 `curl -s http://localhost:<端口>/ | grep -o 'assets/index-[^"]*'` 与 `ls dist/assets/index-*.js`，不一致就重启 dev server。**实测**：两个验证者都撞上过这个（一个拿到旧构建得出「改动无效」，一个在旧构建上截图）。嫌麻烦就用 `npm run dev:web` 直接跑源码（Vite 反代 `/api` 到本 worktree 的后端）。
4. **UI 类改动**：先在宿主 Android 模拟器里验收（布局、响应式、触摸、键盘全在同一个环境里过）→ 只有真机能得结论的（真手指手感、低端机帧率、低亮度观感、自研内核）留到真机。**模拟器不可用时**才降级到桌面手机视口，并在结论里明确写「降级验证、未过模拟器」。
5. **UI 验证交 subAgent**，不要让大量截图占主会话上下文。派活时必须给**验证条目的数量上限**（实测不加限制会超时）；并明确允许它「工具不可用就如实写『未能验证』」，**不要为了凑结论硬撑**。
6. **响应式与触摸类验收默认走宿主模拟器**（手机视口 + 真 Chrome + 真 IME + 合成分发触摸）；桌面浏览器缩窄窗口不算通过。
7. **额度类结论只看平台用量面板**与实测数据。

## 5. 派 subAgent 的硬约束

实测 `ui-verifier` 与 `worker` 都栽在同一处：**shell 引号与重定向**。派活时写清：

- **一条命令一步**，不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- **工具不可用就如实写「未能验证」并退出**，不要硬撑。
- **给出现条目数量上限**（例如「不超过 8 条」）。
- **移动端类验收先启模拟器**（source `.android-env` → 起 AVD → `adb reverse` → Chrome 开页），验证者被授权这一步；只有它自己证明模拟器起不来时才允许降级到桌面手机视口，且必须在报告里写明降级。
