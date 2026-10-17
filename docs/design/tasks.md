# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 本批主题：**断连自愈（卡 1–3）+ 自身外推（卡 4）+ 链路量测（卡 5）**。设计依据已写进 `../api/20-api-ws.md` §5.1 / §6、`config.md` §2、`../ui/DESIGN.md`（`conn-banner`）。

**派活硬约束（每张卡都适用）**：一条命令一步、不要管道 / 重定向 / `&&` / 多行内联脚本；工具自己会截断输出，不要用 `tail` / `grep` 过滤。工具不可用就如实写「未能验证」并退出，不要为了凑结论硬撑。

**顺序**：卡 4（独立）→ 卡 5（独立，量完即删）。每张卡完成后 `git commit` 一次。

**已完成**：卡 1（探活协议 `ping` / `pong`）、卡 2（连接管理：三态 + 按需探活 + 退避重连）、卡 3（断连提示条）均已落地并独立验证通过（卡 3 可视验收：393×852 手机视口，8 项逐条取证）。

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
