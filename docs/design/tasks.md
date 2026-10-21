# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1 — 日志单一出口 + 关掉 invocation log

**目标**：建立唯一的日志出口，并让它的第一批调用点（Worker 层的 `err`）端到端可见。

**改动范围**
- 新增 `src/shared/log.ts`：按 `100-log.md` §4 实现字段白名单（`ev` + 每个事件的字段表）、永不抛、闸门（30 条/分钟，超出累加，每 5 分钟最多一条 `suppressed`）、静默点带 `n` 的聚合出口。
- `wrangler.jsonc`：`observability` 改成 `{ "enabled": true, "logs": { "invocation_logs": false } }`。**不要动** `logs.persist` / `logs.enabled`。
- `src/worker/app.ts` 的 `onError`：改写为 `log.err({ where: 'http', code: '9001' })` + 保留原 `console.error`（本地 `wrangler tail` 仍要能看见堆栈）。
- 新增 `src/shared/tests/log.test.ts`。

**不做**：埋点事件（卡 3/4）、`Hall` 内任何改动、`head_sampling_rate` 调优。

**验证**
- 单测：未知 `ev` 被丢弃；字段表外的键被丢弃；出口自身在 `console.log` 抛异常时不向上抛；闸门在 31 条后只剩 `suppressed`；`n` 聚合在阈值与 5 分钟边界各触发一次。
- `npm test` / `npm run typecheck` 零失败。
- 由 reviewer 独立核对：`100-log.md` §3/§4 的每个字段与阈值在实现里逐条存在。

**回滚**：单条 `revert`（新模块无调用方依赖，`wrangler.jsonc` 一行可单独改回）。

## 卡 2 — 入口异常与静默降级

**目标**：让今天被吞掉的错误变成 `err`，让高频降级变成带 `n` 的 `drop`。

**改动范围（`src/hall/`）**
- 无保护的入口各包一层 `try/catch` → `log.err({ where, code })`，**catch 之后行为不变**（原来吞的继续吞、原来断的继续断）：`hall.ts` 的 `webSocketMessage`、`webSocketClose`、alarm 周期执行那一处（`armAlarm` 的 catch 已在，补 `err`）。
- `hall.ts` 的 `send`（`readyState` 非 OPEN 直接返回的那条路径）与 `broadcast`/`broadcastExcept` 的跳过路径 → `log.drop({ kind: 'send' | 'skip', n })`。
- `guardIncoming` 返回 `ignore` 的解析失败路径 → `log.drop({ kind: 'parse', n })`；上行限流丢弃 → `log.drop({ kind: 'limit', n })`。
- 意图被拒的 `reject()` → `log.reject({ code, intent })`（逐条，受卡 1 的闸门）。
- `admin.ts:189`、`admin.ts:270` 的 `console.error` 保留，另补 `log.err`。

**不做**：不改任何协议语义、不改 `reject` 的错误码、不动 `send` 的返回值。

**验证**
- 单测：`send` 到已关闭连接后累计到阈值产出一条 `drop{n}`；`reject` 超过闸门后不再逐条。
- 手工：断开一个连接（关标签页）→ 日志里能看到 `drop{kind:'send'|'skip'}` 的 `n` 累加，而不是刷屏。
- 基线三条零失败。

**回滚**：`Hall` 内的调用点全部是新增行，按文件 `revert` 即回到「静默」。

## 卡 3 — 生命周期事件（enter / lie / sleep / wake / settle / snapshot）

**目标**：把「厅里发生了什么」变成可聚合的数值事件，其中 `wake` 的 `dwellMs` 是 backlog 里「一起睡了多久」的数据来源。

**改动范围（`src/hall/`）**
- `enter`（握手 `hello` 成功，带 `fresh` / `online`）、`lie`（带 `bed` / `from`）、`sleep`（带 `bed` / `auto`）、`wake`（带 `bed` / `dwellMs`）、`settle`（`runDailyWake` 收尾，带 `wakes` / `traces` / `from` / `to` / `ms`）、`snapshot`（`snapshotFor` 产出后，带 `bytes` / `people` / `beds`）。
- `dwellMs` 必须来自 `sleep_started_at`，且**不增加行读取**：优先让清空那一步带 `RETURNING`（`clearBed` 改成返回 `sleep_started_at`），拿不到时才退回一次单独读，并在代码里用 `shortcut:` 注明多了一次行读。
- 字段名与取值必须与 `100-log.md` §3 逐字一致。

**不做**：`tick`（卡 4）、任何 UI、任何新的下行消息。

**验证**
- 单测：`lie` → `wake` 一次，断言 `dwellMs` 等于两次时间戳之差；`clearBed` 的改动不改变原来「清空 `sleep_started_at`」的结果（可用既有 bed-store 测试覆盖）。
- 基线三条零失败。
- reviewer 核对：`used` / `beds` / `level` 的来源在卡 4 里是同一套读法（不要两份实现）。

**回滚**：按模块 `revert`；`clearBed` 的 `RETURNING` 若影响既有单测就整体回滚本卡。

## 卡 4 — 社交与风控事件 + tick

**目标**：补齐剩余事件，并给厅的整体状态留下一条时间序列（在线 / 已用床位 / 级）。

**改动范围（`src/hall/`）**
- `chat`（带 `len` / `dm`，**不写文本**）、`censor`（带 `kind` / `n`）、`report`（带 `target` / `dup`）、`block`（带 `until` / `by`）。
- `tick`（带 `online` / `used` / `beds` / `level`）：**只在这个厅有连接时**、每 5 分钟一条。复用已有的内存循环，不新增长驻 `setInterval`；没有人时那套循环本来就该被清除（`AGENTS.md` 硬纪律 6）。
- 落库口径：`used` 用已有的 `usedBedCount`，`beds` 用 `bedCount()`，`level` 用已读的 `meta.bed_count`——**不为日志新增一次全表读**。

**不做**：`db` 事件（平台面板已有）、聊天文本、任何 `uid` 以外的身份字段。

**验证**
- 单测：`censor` / `chat` / `report` / `block` 的字段与 `100-log.md` §3 表一致；`tick` 在无连接时不产出。
- reviewer 核对额度预算表（`100-log.md` §5）的量级估算与实际写入频率一致（尤其 `tick` 不能超过 288/天）。
- 基线三条零失败。

**回滚**：按调用点 `revert`；`tick` 若与内存循环耦合过深，可先只保留其余事件。