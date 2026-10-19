# 测试环境与测试流程

**本文只回答一件事：某一类测试该在哪个环境里做。** 不维护测试条目清单——条目跟着需求走，需求一变就全废，维护它没有收益。判据写在对应模块的设计文档里（每份设计文档自己带「怎么算做对了」），用例从那里现取。

## 1. 环境一览

| 环境 | 是什么 | 什么时候用它 |
| :--- | :--- | :--- |
| **单测** | `npm test`（vitest）：纯函数、布局、寻路、位置同步的假时间轴、协议镜像 | **任何纯逻辑**。能写成纯函数就必须在这里验，不要留到别处 |
| **类型检查** | `npm run typecheck`（三份 tsconfig） | 改协议 / 样式令牌 / 前端代码后。干净克隆先跑一次 `npm run tokens` |
| **桌面浏览器** | 本机 Chromium（Playwright / BetterWright） | 逻辑与流程：进厅、走动、躺下、聊天、断线重连、命中判定。**桌面视口只用于「不是响应式」的那类结论** |
| **桌面浏览器 + 手机视口** | 同上，但视口按手机设（393×852 类） | 布局与响应式的**第一道**筛子：会不会溢出、会不会换行、触摸目标够不够。**它仿真不了软键盘**（见 §3） |
| **宿主 Windows 上的 Android 模拟器** | 真 Android + 真 Chrome + 真 Gboard，`-gpu host` | **一切与软键盘、IME、真触摸语义、帧率有关的结论**。配方见 §2 |
| **真机** | 实机 iOS Safari / Android Chrome | 真手指、低端机帧率、真机低亮度观感、iOS 与 Android 的平台差异、你要验的那个具体内核（夸克 / Via） |
| **生产** | 部署后的站点 + 平台用量面板 | 额度、并发上限、真实网络下的节拍与位置年龄。**与额度相关的结论只看平台用量面板，不接受推算** |

**基线设备**：iPhone 16 竖屏（393×852 / DPR 3 / 真手指触摸）。窄档阈值 640，其它窄屏手机走同一套分支。

## 2. 宿主 Windows 上的 Android 模拟器

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

## 3. 环境能做到什么、做不到什么

| 结论类型 | 桌面视口 | 模拟器（宿主） | 真机 |
| :--- | :--- | :--- | :--- |
| 纯逻辑 / 协议 / 布局计算 | 单测即可 | — | — |
| DOM 布局、响应式、触摸目标尺寸 | 可以 | 可以 | 可以（唯一权威） |
| **软键盘**：`innerHeight` / `visualViewport.height` / `document.documentElement.clientHeight` 三者的真实关系 | **不能**（无 IME） | **可以** | 可以 |
| **画布重建次数与面板撤除的先后顺序** | 可以（信号是页内的，与 IME 无关） | 可以 | 可以 |
| 真手指触摸手感、捏合跟手 | 不能 | 不能（`adb shell input tap` 是合成事件） | 可以 |
| 低端机帧率 | 不能 | 不能（宿主是独显） | 可以 |
| 低亮度观感（对比度、三档幅度） | 不能 | 不能 | 可以 |
| **特定内核**（夸克 / Via 等自研内核） | 不能 | 不能（模拟器里只有真 Chrome，除非侧载 APK） | 可以 |

**一句话**：模拟器是「真 Chrome + 真 IME + 真触摸语义」的替代品，**不是**「真手指 + 低端机 + 你要验的那个内核」的替代品。

## 4. 流程

1. **纯逻辑先有单测**。没有单测的行为改动，先问「这段能不能变成纯函数」。
2. **UI 类改动**：桌面手机视口先过一遍（布局不一定对，但错得离谱能立刻看出来）→ 涉及键盘 / 触摸语义的进模拟器 → 只有真机能得结论的留到真机。
3. **UI 验证交 subAgent**，不要让大量截图占主会话上下文。派活时必须给**验证条目的数量上限**（实测不加限制会超时）；并明确允许它「工具不可用就如实写『未能验证』」，**不要为了凑结论硬撑**。
4. **响应式与触摸类验收必须用手机视口**，不得只用桌面浏览器。
5. **额度类结论只看平台用量面板**与实测数据。

## 5. 派 subAgent 的硬约束

实测 `ui-verifier` 与 `worker` 都栽在同一处：**shell 引号与重定向**。派活时写清：

- **一条命令一步**，不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- **工具不可用就如实写「未能验证」并退出**，不要硬撑。
- **给出现条目数量上限**（例如「不超过 8 条」）。
