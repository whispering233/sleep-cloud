# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

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