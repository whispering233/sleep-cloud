# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是本次三张卡的规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

---

**当前卡片（卡 2 已实现待复审；待做：卡 2b、卡 3、卡 4。一张一次提交）**：规格来源 `30-movement-sync.md`（§3 重锚与不变量、§5.2 节拍、§6.2 观测）。

---

### 卡 2：意图锚点取真值 + `lead` 计算（store 接线）

- **目的**：让「站定起步 / 走路中途改目标 / 在床上点地面 / 点床走躺」四条意图路径都以**真值点**作锚，并把 `lead` 取成「画面点在**新折线上的投影弧长** / v」（= 卡 1 的 `arcLengthAhead`，**不要用直线距离**：在床上起身时那是横向偏移，会把画面凭空前推）。目标是起步 0 帧且不倒退。
- **改动范围**：`src/client/store.ts`（`beginWalk`）、`src/client/tests/prediction.test.ts`。
- **验收**：
  - 站定 → 点地面：首条关于自己的 `pos` 到达时，画面**不后退**（倒退 0px）。
  - 走路中途改目标：`lead` 保持不变，画面在切换那一刻**连续**（单帧位移 < 10px）。
  - 在床上点地面：锚点为床脚前那一点，首帧即起步。
  - 离线（`connection !== 'online'`）时不登记外推（现状保持）。
- **CHANGELOG**：`### Fixed` 一条——起步与改目标时自己的小人不再往回跳。

### 卡 2b：保鲜期按「最后一条关于自己的 `pos`」算（修卡 2 带入 `lead` 后的误冻结）

- **背景**：卡 2 会在「走路中途改目标」时把 `lead`（≈`oneWay`）带进新外推。而现在的冻结判据是「`now − anchorTs > PREDICTION_STALE_MS`」，把 `anchorTs` 往前挪了 `lead` 就等于**白占保鲜期**：① 旧外推已冻结（`now − anchorTs > 2000`）时再发意图 → 新外推 `elapsed` 一开局就 ≥ 2000 → **当场冻死**；② `lead` 接近 2000ms 时新外推只能走一小段就冻。
- **规格**：`docs/design/30-movement-sync.md` §3.7（三行：保鲜期从真值时刻起算、锚点记真值时刻、冻结后的旧外推不带领先量）。
- **改动范围**：`src/client/prediction.ts`、`src/client/store.ts`、`src/client/tests/prediction.test.ts`。不改 `hall.ts` / `docs/`。
- **要做**：
  1. `Prediction` 增加 `ts`（这条锚点对应的**真值时刻**：`beginPrediction` 传的 `now`；`anchorPrediction` 取 `pos.ts`）。
  2. 冻结判据改为 `elapsed = max(0, min(now, ts + PREDICTION_STALE_MS) − anchorTs)`（推进量仍从 `anchorTs` 算，只是天花板按真值时刻）。
  3. `beginWalk`：旧外推已冻结（`serverNow − old.ts > PREDICTION_STALE_MS`）时 `leadMs = 0`；否则照旧。
- **验收**：
  - 现有 491 条全绿（`lead = 0` 的行为一字不变）。
  - 新增：带 `lead = 250ms` 的外推，从发起到 2000ms 都**正常推进**（不再提前冻结）；2000ms 后冻结且不回退。
  - 新增：旧外推已冻结（`now − old.ts > 2000`）→ 发新意图，`lead = 0`、画面 = 真值、且能正常推进（不得一开局就冻）。
  - 新增：`anchorPrediction` 后 `ts === pos.ts`。
- **CHANGELOG**：并入卡 2 已有条目（不单开）。

### 卡 3：新移动者不「补走一拍」（服务端）

- **目的**：节拍运行中才开始走的人，第一拍不许多推进「上一次拍到现在」的整段时间。
- **改动范围**：`src/hall/hall.ts`（移动者携带创建时刻；推进量 = 现在 − max(上一拍时刻, 创建时刻)）、`src/hall/tests/movement.test.ts`。
- **验收**：
  - 一拍已过 80ms 时新增移动者 → 下一拍只推进 20ms（而不是 100ms），位移 ≤ 4.4px。
  - 既有移动者行为不变（仍按实际经过时间推进）。
  - 对象驱逐后重建（`ensureMovers`）不产生追补位移。
- **CHANGELOG**：`### Fixed` 一条——开始走动时不再向前突跳一小段。

### 卡 4：观测探针（`?debug=1`）

- **目的**：让 §6.1 的硬指标可以**举证**，而不是靠肉眼。
- **改动范围**：客户端世界层（每 10s 打印一行，不进 UI、不进 React 状态）、必要时 `src/client/store.ts` 只读导出。
- **验收**：
  - `?debug=1` 时每 10s 打印 `leadMs` / `regressPx` / `posAge` / `tickSpan` 的 p50 与 max。
  - 无参数时完全不打印、无额外开销路径。
  - `regressPx > 0` 时用显眼前缀（便于在控制台一眼看到）。
- **不做**：不加协议字段、不加 HUD 文案。
- **CHANGELOG**：`### Added` 一条——`?debug=1` 的位置同步观测。

---

**真机项**（不占卡片，验收时按清单跑）：走到床边再躺下的站立等待（`30-movement-sync.md` §3.9）、`build.md` §7 的既有三项（#25 / #26 / #27）。

