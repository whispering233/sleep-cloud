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

## 卡 1：天气开关 + 雨天雨声（端到端）

### 目标

齿轮浮层里多一颗天气胶囊（文案 = 当前天气），点它切换「雨天 / 无雨」；雨天出声（8 s 早播循环先起，主循环就绪后 1 s 交叉淡化），无雨静音；偏好落盘、重载保持；缺键时按本地日历日序号奇偶初始化。

### 依据

`40-client-storage.md` §3（键与日期默认）、`config.md` §4（音频与电平规格）、`00-master-design.md` §5.4（天气是个人偏好）、`../ui/DESIGN.md` 的 `hud-menu`、`architecture.md` §3（音频不走 Phaser）。

### 资产（已加工好，直接拷入）

`C:\download\游戏素材\sleep-cloud-audio\rain-loop.v1.wav` 与 `rain-loop-intro.v1.wav` → `public/audio/`；另建 `public/audio/LICENSE-rain-and-thunders.txt`（作者 `kindland`、源页 `https://opengameart.org/content/rain-and-thunders`、CC0 1.0、加工链与命令）与 `public/_headers`（`/audio/*` → `public, max-age=31536000, immutable`）。

### 改动

| 文件 | 要点 |
| :--- | :--- |
| `src/client/prefs.ts` | `PREFS.weatherRain = 'sc.weather.rain'`；`readWeatherRain()`（缺键 → 日期默认）、`writeWeatherRain()`（单写入路径，`false` 也照写） |
| `src/client/weather.ts` 🆕 | 纯函数 `defaultRainAt(date)`（`Math.floor(Date.UTC(y,m,d)/86_400_000) % 2 === 1`）、`weatherLabel(rain)`（`雨天` / `无雨`） |
| `src/client/store.ts` | `rain` 初值 = 读偏好；`setRain()`（同值不写、写 store + 偏好） |
| `src/client/audio.ts` 🆕 | `setRain(on)` / `unlock()`：懒建 `AudioContext`；先取小文件、解码即循环；再顺序取大文件、解码后 1 s 交叉淡入并停掉小 source；关 = 停源 + `suspend` + `AbortController` 取消在途请求；`visibilitychange` 可见时若需要的 `resume()` |
| `src/client/App.tsx` | 进厅手势里调 `unlock()`；订阅 `rain` 驱动 `setRain()`（不进逐帧路径） |
| `src/client/components/ActionRow.tsx` | 浮层第二项：胶囊、文案 = 当前天气、`aria-pressed`、**点它不关浮层**、`pointerdown` 里 `preventDefault()`、独立 `key` |
| `src/client/hud-view.ts` | `rain` 进 `HudView` 与 `sameHudView`（否则位置节拍会白重渲染） |
| `src/client/styles/app.css` | 浮层里两颗胶囊的间距（组内间距） |
| `CHANGELOG.md` | `## [Unreleased]` → `### Added` 两条（天气开关与偏好、雨天雨声） |

### 验收

- `npm run typecheck` + `npm test` 全绿；新增用例：日期奇偶（相邻日相反、跨月、`Date.UTC` 不受时区影响）、缺键走日期默认、坏值与版本不符会被删、`hudViewOf` 带上 `rain`、两个 WAV 的格式与时长（单声道 / 32000 / 16-bit / 30.000 s 与 8.000 s）、**键集合镜像**（`40-client-storage.md` §3 登记表 === `PREFS` 注册表）
- `npm run e2e`：点胶囊 → `aria-pressed` 翻转 + `localStorage['sc.weather.rain']` 写入 → 重载后保持；点浮层**不产生 `walk`**
- 人耳（主会话或用户）：晴 → 雨**先出小循环**、随后切到主循环；雨 → 晴立刻静音；重载后状态保持
- 模拟器（`ui-verifier`）：切后台再回来仍出声；切到无雨时 `AudioContext` 为 `suspended`
- `curl -I` 看 `/audio/*` 的 `cache-control`（本地 `npm run dev` 即可初步看，线上再确认一次）

### 不做

音量 / 静音、雷声与其它天气、IndexedDB / Cache Storage、任何服务端改动（协议、schema、快照零改动）。

---

## 卡 2：雨层画面（屏幕空间并行 Scene）

### 目标

天气 = 雨天时画布上出现细雨；无雨时 400 ms 内消失干净；雨不受世界缩放、可用视口、面板换位影响。

### 依据

`../ui/DESIGN.md` 的 `rain-layer`、`config.md` §4（粒子参数）、`00-master-design.md` §7。

### 改动

| 文件 | 要点 |
| :--- | :--- |
| `src/client/world/weather.ts` 🆕 | `WeatherScene`（`active: true`）：相机 `zoom = DPR`、运行时 `generateTexture` 生成 2×14 纹理、粒子发射器、按屏幕高算 `lifespan`、`rain` 变化时 400 ms 线性淡入淡出（走 `update`，不挂 tween / 定时器） |
| `src/client/world/world.ts` | `scene: [scene, new WeatherScene()]`——天气 Scene 在**后**（渲染在世界之上） |
| `CHANGELOG.md` | `### Added`：雨天画面 |

### 验收

- 先验第一条（不成立就停）：并行 Scene 在 `Scale.NONE` + 手动 `scale.resize` 下相机视口是否跟随画布——不跟随就会只铺左上角
- `npm run typecheck` + `npm test` 全绿（本卡预计不新增单测：Scene 里没有可独立成纯函数的东西）
- 模拟器（`ui-verifier`）：① 雨可见但不刺眼 ② 切无雨 400 ms 内无残留粒子 ③ `全厅` 与 `1×` 两档雨密度相同 ④ 打字态面板换位期间雨不动 ⑤ 同屏 60 fps
- 真机（降级可接受）：低亮度下能看出在下雨，但不至于把地板压暗

### 不做

地面涟漪 / 水花、`prefers-reduced-motion` 特化、雨随缩放变化、雨进 DOM。

---

**当前没有进行中的卡片。**
