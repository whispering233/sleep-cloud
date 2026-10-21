# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1 · 游戏页壳（入口 / 出口 / 列表 / 宿主）

设计：`110-games-page.md` §1、§2、§3、§4。

| 文件 | 改什么 |
| :--- | :--- |
| `src/client/games/types.ts`（新） | `GameModule` / `GameCtx` / `GameEntry`，字段与 §4 逐字一致 |
| `src/client/games/host.ts`（新） | 按 `base` 建舞台（`scale = min(cw/bw, ch/bh)`、居中、`overflow: hidden`）；同一时刻只挂一个；换条目先 `dispose` 再 `mount` |
| `src/client/games/registry.ts`（新） | `GAMES: GameEntry[]`，**本卡为空数组**（条目在卡 3 落） |
| `src/client/store.ts` | `gamesOpen: boolean` + `openGames()` / `closeGames()` |
| `src/client/components/GamesOverlay.tsx`（新） | 复用 `.entry-overlay` / `.entry-card` / `.entry-title`；左上「离开」胶囊 + `Esc` 同一出口；列表 = 标题 + 一句说明 + 由 `base` 推导的「横屏更好」小标 |
| `src/client/components/ActionRow.tsx` | `game` 那一条从 `PLACEHOLDER_ENTRIES` 移出，点击 `openGames()` |
| `src/client/App.tsx` | 挂在 `ChatPanel` 之后、`AboutOverlay` 之前 |
| `src/client/styles/app.css` | `games-page` / `games-list` 两条注释节，只用既有 token，不写内联样式 |

**验收**：点「游戏」→ 整屏页出现；「离开」与 `Esc` 都能回大厅且**不产生任何上行**（`?debug=1` 看上行日志）；空注册表时列表是一行「还在做」；条目高 ≥ 44px；`composer !== 'idle'` 时游戏图标不可达（右端被「收起」占位）；三条基线全绿。

## 卡 2 · 让位：世界暂停 + 大厅音频挂起

设计：`110-games-page.md` §5。

| 文件 | 改什么 |
| :--- | :--- |
| `src/client/world/world.ts` | `WorldHandle` 加 `pause()` / `resume()` = `game.loop.sleep()` / `game.loop.wake(true)` |
| `src/client/world-handle.ts` | 转发这两个方法（照现有转发的写法） |
| `src/client/audio.ts` | `suspendHall()` / `resumeHall()`：没有 context 就什么都不做；不建 context、不改偏好 |
| `src/client/components/GamesOverlay.tsx` | 开 → `pause()` + `suspendHall()`；关 → `resume()` + `resumeHall()`；`5002` / `blocked` / `replaced` 到达时**强制关闭** |

**验收**：打开页面期间世界不再推进（位置与状态一个字节都不变）；关闭后小人还在原处、无跳帧（`wake(true)` 不吃巨大 `delta`）；雨声在页面期间停、退出恢复；封禁 / 被顶替时页面自动关闭（手工模拟：把 `blocked` 分支打一条假 close 走一遍）。

## 卡 3 · 第一个游戏：Skyline

设计：`110-games-page.md` §4（契约）。样板风：窗 + 随机亮灭的窗灯，canvas2d，30~40 行。

| 文件 | 改什么 |
| :--- | :--- |
| `src/client/games/skyline.ts`（新） | 默认导出 `GameModule`；`base` 推荐 `1:1` 或 `3:4`；`canvas.width = base.w * ctx.dpr`；窗灯按固定节奏随机亮 / 灭；`dispose` 里 `cancelAnimationFrame` |
| `src/client/games/registry.ts` | 加一条 `{ id: 'skyline', title, blurb, base, load: () => import('./skyline') }` |

**约束**：不 import 任何大厅模块（store / ws / world / audio / prefs）；不发上行；不读本地存储；不使用 Chromium 114+ API；不抄参考 demo 的代码（许可未标）。

**验收**：点条目后网络面板出现 `skyline` 的独立 chunk，首屏不载它；连续进出 10 次后 `rAF` 只有一个循环（`?debug=1` 或计数）；舞台按 `base` 比例居中、超出裁掉不撑破布局；`npm run build` 产物能被 `chrome100` 解析。

## 卡 4 · `act` 协议与服务端

设计：`110-games-page.md` §6、`../api/20-api-ws.md` §3 / §3.1 / §4.4。

| 文件 | 改什么 |
| :--- | :--- |
| `src/shared/protocol.ts` | `UpstreamPayloads.act = { act: 'hall' \| 'game' }`；`UPSTREAM_TYPES` 加 `'act'`；`Person.act?: 'game'` |
| `src/hall/connection.ts` | 附加数据 `act?: 'game'`；`personFromConnection` 在返回值里带上 |
| `src/hall/hall.ts` | `act` 分派：只接受 `'hall' \| 'game'`，`'hall'` 删字段；写附件后广播一条 `{ t: 'state', ...personFromConnection(conn), online }`（含本人） |
| `src/hall/snapshot.ts` | 不需改代码（`selfPerson` 与 `people` 都走 `personFromConnection`）——加一条单测证明 `act` 跟着下发 |

**约束**：`act` 不进任何业务判定（不影响归属、占用、睡眠、限流之外的状态）；不新增表、不新增下行消息类型。

**验收**：`npm test` 里新增的单测证明「`act: 'game'` → 快照与 `state` 报文都带 `act`」「`act: 'hall'` → 字段消失」「非法值被忽略且不断线」；三条基线全绿。

## 卡 5 · `act` 客户端：上行 + 头顶后缀

设计：`110-games-page.md` §6。

| 文件 | 改什么 |
| :--- | :--- |
| `src/client/act-text.ts`（新） | `actTextOf(act)` → `'游戏中'`（照 `error-text.ts` 的写法） |
| `src/client/ws.ts` | 上行 `act` 的发送函数；`hello` 之后若 `gamesOpen` 为真补发一次 |
| `src/client/components/GamesOverlay.tsx` | 开 / 关各发一次 `act`（`game` / `hall`） |
| `src/client/world/world.ts` + `views.ts` | 名字行拼 `名字 \| 游戏中`；**后缀优先保留、名字先截断**；只在名字行加，气泡名字行不加 |
| `src/client/store.ts` | `applyJoin` / `applyState` / `applySnapshot` 把 `act` 放进人（`act` 缺省 = 无后缀） |

**验收**：两个标签页（两个身份）互相能看见「名字 | 游戏中」；退出游戏页后后缀消失；`Z < ZOOM_TEXT_MIN`（`全厅` 档）下无文字；聊天气泡上的名字行不带后缀；断线重连后后缀仍在（靠 `hello` 后补发）；关掉页面立刻消失。
