# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 本批主题：**断连自愈（卡 1–3）+ 自身外推（卡 4）+ 链路量测（卡 5）**。设计依据已写进 `../api/20-api-ws.md` §5.1 / §6、`config.md` §2、`../ui/DESIGN.md`（`conn-banner`）。

**派活硬约束（每张卡都适用）**：一条命令一步、不要管道 / 重定向 / `&&` / 多行内联脚本；工具自己会截断输出，不要用 `tail` / `grep` 过滤。工具不可用就如实写「未能验证」并退出，不要为了凑结论硬撑。

**顺序**：卡 2 → 卡 3（依赖 2）→ 卡 4（独立，可并行）→ 卡 5（独立，量完即删）。每张卡完成后 `git commit` 一次。

**已完成**：卡 1（探活协议 `ping` / `pong`）已落地并独立验证通过。

---

## 卡 2 · 连接管理：三态 + 按需探活 + 退避重连（无 UI）

依赖卡 1（要 `ping` / `pong`）。

- [ ] `src/shared/constants.ts`：加 `PROBE_TIMEOUT_MS = 2000`、`INTENT_ECHO_TIMEOUT_MS = 1500`、`RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]`（与 `config.md` §2 一致）。
- [ ] `src/client/conn-state.ts`（新，**纯函数**）：退避取值、探测状态机、`'connecting' | 'online' | 'offline'` 迁移。**不许 import WebSocket / DOM / React**，否则测不了。
- [ ] `src/client/ws.ts`（重写为连接管理器）：
  - `probe()`：socket 不是 `OPEN` → 立即重连；是 `OPEN` → 发 `ping`，`PROBE_TIMEOUT_MS` 内无 `pong` → `close()` + 重连。
  - 三条触发点：`visibilitychange`（可见时探活；**hidden 时停掉退避等待**）、`online` 事件、发上行后 `INTENT_ECHO_TIMEOUT_MS` 内没收到任何「关于自己的下行」。
  - 退避 `RECONNECT_BACKOFF_MS` 封顶 15s，成功后归零；**永不放弃**。
  - 两个导出给 UI 用：`retryNow()`（打断等待、立即试一次，不改退避序列）、连接态写进 store。
  - 发送出口一律返回布尔：`offline` 时**丢弃不排队**（理由见 `../api/20-api-ws.md` §5.1），失败即 `ensureConnected()`。
- [ ] `src/client/store.ts`：`connected: boolean` → `connection: 'connecting' | 'online' | 'offline'`（`applySnapshot` 置 `online`）；`applyPos` **补写 `me.x/y`**（卡 4 的回退锚点，现在只写 `people`）。
- [ ] `src/client/world/world.ts`：`update` 里 `state.connected` 改判 `connection === 'online'`；重连对准 **`selfPoint`**（首次进厅仍走 `focusPoint` = 我的床）。
- [ ] `src/client/tests/conn-state.test.ts`（新）+ `src/client/tests/store.test.ts`（`connected` 断言跟着改）：退避序列、探针超时→重连、hidden 暂停、三态迁移、`applyPos` 写 `me.x/y`。

**验收**：`npm test`、`npm run typecheck`；本地 `npm run dev` 后拔网 30s 再恢复，控制台应看到退避重连并最终恢复（服务端恢复后位置按 `snapshot` 落位）。**不要**在卡 2 里做任何 DOM。**回滚**：删 `conn-state.ts` 并还原 `ws.ts` 一处文件即可。

---

## 卡 3 · 断连提示条（端到端可验收）

依赖卡 2。

- [ ] `src/client/components/ConnectionBanner.tsx`（新）：`connecting` 且超过 3s / `offline` 时显示；两态文案「正在连接…」/「连接已断开，正在重连…」；右侧 44×44「尝试连接」按钮 → `retryNow()`；`role="status"`；**不自动消失**、无入场动画、不抢焦点。
- [ ] `src/client/components/ChatPanel.tsx`：作为 `.chat-panel` 的**第一个子元素**挂载（**占位，不是浮层**）。理由：世界层的可用视口只扣 `.chat-panel` 与 `.hud` 的实占高度，**占位就不需要改世界层**（硬纪律 22）。
- [ ] `src/client/styles/app.css`：新 class，**复用 `toast-recoverable` 的令牌组合**（`secondary` 底 + `alert` 文 + `label` 档 + `rounded.md`），**不新增 token**（`npm run lint:design` 基线不动）。
- [ ] `src/client/tests/` 里补一条：文案由连接态决定的纯函数（两态 + 3s 阈值）。

**验收**（交 `subAgent` 验证，条目 ≤8、机位 393×852 手机视口）：断网后 2s 内出现 / 条在聊天面板之上、不遮床号 / 按钮可点且重连成功后条消失 / 输入框与表情行没被顶出视口 / 最底一行床位数没被盖住。**回滚**：删组件与 `ChatPanel` 一行挂载。

---

## 卡 4 · 自身外推（外推自己，别人不动）

与卡 1–3 无交集，可并行。

- [ ] 挪文件：`src/hall/pathfinding.ts` → `src/shared/pathfinding.ts`、`src/hall/movement.ts` → `src/shared/movement.ts`，改 3 处 import（`hall.ts`、`hall/tests/*`、`docs/design/architecture.md` §3 已写好新描述）。两个文件都只依赖 `../shared/layout` 与 `../shared/constants`，挪过去即零改逻辑。
- [ ] `src/client/prediction.ts`（新，**纯函数**）：`walk` 时用共享 `findPath` + `WALK_SPEED_PX_PER_S` 按时间外推；收到关于自己的 `pos` 就**重锚**（权威点 + 服务端时刻，沿同一路径继续）；`2s` 无自己的 `pos` → **冻结在最后一个外推点（不回退）**；上床 / 离开 / 重连 → 清掉。
- [ ] `src/client/store.ts`：意图发出时登记外推；`applyState` / `applyLeave` / `applySnapshot` 清掉。
- [ ] `src/client/world/world.ts`：`selfPoint` 优先取外推点，否则回落到插值；推进在 `update` 里做（**不进 React 循环**）。
- [ ] `src/client/tests/prediction.test.ts`（新）：外推推进、重锚、2s 冻结、清预测、与服务端路径一致（同一 `findPath` 输入 → 同一折线）。

**验收**：单测 + 真机（点地面后小人立刻起步、贴边与拐角不抖、躺下/`hop` 后不残留外推、别人移动手感不变）。**回滚**：删 `prediction.ts` 与 `world.ts` 那一段，其他不动。

---

## 卡 5 · `?debug=1` 量测探针（临时，量完删）

独立。

- [ ] `src/client/net-metrics.ts`（新）：只在 URL 含 `debug=1` 时挂载；每 10s 打一行汇总 `{posAge p50/p95, tickSpan p50/p95, 超 150ms 次数, probeRtt p50, 样本数}`，并挂 `window.__sc`。
- [ ] 三个量都**不需要改协议**：`posAge = (Date.now() + clockOffsetMs) − pos.ts`；`tickSpan` = 相邻两批 `pos` 的 `ts` 差；`probeRtt` 来自 `pong.ts`。
- [ ] 量完：把结论写进 `backlog.md` 的「节拍实际抖动」「渲染时钟平滑」两行（有数字就改写该行），**删掉探针文件**（不留临时面板、不留历史实现记录）。

**验收**：本地各跑 60s 有一次走动与一次静置，控制台有汇总行；真机同一 URL 上报一次真实数字。**回滚**：删文件即可。
