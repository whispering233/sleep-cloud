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

### 卡 2c：领先量封顶 + 严格陈旧判据 + 把三条不可证伪的测试换掉

- **背景**（复审 F1/F2/F3/F4/F5）：
  - `serverNow − old.ts == 2000` 这一边界被当作新鲜 → 带进 2000ms（440px）幻影；
  - 领先量无上限，静默 1818~2000ms 后改目标 → 下一条 `pos` 超出 `TELEPORT_SNAP_PX` → 外推作废、画面成段后跳；
  - 「床上 78px 不被算成领先量」这条测试不可证伪（躺下时 `prediction` 恒为 `undefined`，把弧长换成直线距离仍然全绿）；
  - 「中途改目标」的测试里新旧折线**共享首段** → `hypot` 与弧长同值，同样不可证伪；断言用 `<10px` 而非 `≤1px`；
  - `ts === pos.ts` 是复述实现的断言，无外部行为约束。
- **规格**：`docs/design/30-movement-sync.md` §3.3（封顶 + 弧长理由改成「垂直改目标」）与 §3.7（严格陈旧判据 + 封顶）。
- **改动范围**：`src/client/store.ts`、`src/client/tests/prediction.test.ts`。不改 `prediction.ts` / `hall.ts` / `docs/`。
- **要做**：
  1. 陈旧闸门改**严格**：`serverNow − old.ts < PREDICTION_STALE_MS` 才算新鲜。
  2. 携带的 `leadMs` 封顶 `PREDICTION_STALE_MS / 2`。
  3. 测试换成可证伪的：
     - **垂直改目标**：旧画面点在新路径的侧方（`hypot > 弧长`），断言切换前后画面点各差 ≤1px（弧长版）；把掐头换成 `hypot` 后必红。
     - 「躺下时没有外推 → 改目标 lead = 0」只保留一条轻量断言，并去掉「78px」这条不可达的论证式断言。
     - 陈旧闸门边界：`serverNow − old.ts` = 1999 / 2000 / 2001 三个点，分别断言带/不带 lead；带的时候 `lead ≤ 1000ms`。
     - 删掉 `ts === pos.ts` 这种镜像断言，改成正向断言：真值时刻前移后，冻结点跟着前移（用画面距离断言）。
- **CHANGELOG**：并入卡 2 已有条目（不单开）。

### 卡 3b：补齐另两条起步路径的测试 + 去掉精确浮点相等

- **背景**（卡 3 复审 P2）：`movement.test.ts` 只用 `walk`（→`startWalking`）验了「中途起步不补走一拍」；**走躺**（`approachBed`）与**驱逐重建**（`ensureMovers`）这两条起步路径无断言。另有三处 `toBe(START.x + 22)` 断言一个经比例算出的坐标，几何常量一改会因非行为原因变红。
- **改动范围**：`src/hall/tests/movement.test.ts`（重建场景若已有固定写法则可在 `src/hall/tests/resume.test.ts` 内补）。不改生产代码、不改 `docs/`。
- **验收**：
  - 一拍已过 80ms 时新增一个**走躺**意图（`lie` 到远处床）→ 第一拍只推进 20ms（≈4.4px）。
  - 驱逐重建后的移动者，第一拍推进量 = `TICK_MS`（不补走被驱逐那段）。
  - 现有 12 条全绿；坐标断言改 `toBeCloseTo(..., 9)`。
- **CHANGELOG**：无。

### 卡 2d：去掉领先量封顶，闸门收到半个保鲜期

- **背景**（卡 2c 复审 F1/F2）：封顶是两个错：① 它会在 RTT 大时咬掉**合法**领先量（RTT 2s 时 `lead ≈ 1s` 是正常的），被咬的那一下正是用户点击的时刻 → 画面后退（卡 2c 的边界测试自己就构造出 219.8px 后退）；② 它并不能保证「后续重锚不被传送门槛作废」（文档原句是错的）。正确做法：**不封顶**，把闸门收到保鲜期的一半。
- **规格**：`docs/design/30-movement-sync.md` §3.1 / §3.3 / §3.7。
- **改动范围**：`src/client/store.ts`、`src/client/tests/prediction.test.ts`。不改 `prediction.ts` / `hall.ts` / `docs/`。
- **要做**：删掉 `Math.min(carriedMs, PREDICTION_STALE_MS / 2)`；闸门改 `serverNow - old.ts < PREDICTION_STALE_MS / 2`。
- **验收（把卡 2c 的三点边界测试改成四点）**：
  - 陈旧度 250ms（正常改目标）→ 携带，切换那一刻 0px；
  - 陈旧度 999ms（同向）→ 携带，切换那一刻 0px（证明没有封顶）；
  - 陈旧度 1000ms / 2000ms → 不携带，画面 = 真值点（有界重同步）；
  - **RTT 2s 的合法领先量不被咬**：旧画面领先 1000ms 且陈旧度 100ms → 新 `anchorTs = serverNow − 1000`（容差 1ms），切换那一刻 0px。
- **CHANGELOG**：并入 `### Fixed` 那条（不单开）。

### 卡 5：探针修正（p95 + 倒退只在同一条折线内算）

- **背景**（卡 4 复审）：
  - `§6.2` 与 `backlog` 的判据都点名 **p95**（`tickSpan` p95 > 150ms / `posAge` p50 > 200ms），落地版只给了 p50 与 max；
  - `regressPx` 按「逆着上一帧方向」算，**用户合法掉头**（改目标）时下一帧位移就是逆着的 → 误报 `!!`；`hop` / 传送回落也会误报；
  - `ProbeFrame.point` 的注释说「不在走动时没有画面点」，实际站定时用 `me.x/y` 照样采样。
- **改动范围**：`src/client/move-probe.ts`、`src/client/tests/move-probe.test.ts`。不改 store / 世界层 / 服务端 / `docs/`。
- **要做**：
  1. 输出加 **p95**（四字段：`p50/p95/max`）。
  2. `regressPx` 改成**只在同一条折线内**算：记住上一采样的 `prediction.path` 引用 + 当时的弧长；只有 path 引用未变才比较弧长、倒退 = `max(0, 上次弧长 − 本次弧长)`；path 换了（= 新意图或剪枝后换了数组）就当新轨迹、不比较。这样合法掉头不误报，真正的重锚倒退仍能抓到。
  3. 把 `ProbeFrame.point` 的注释改成与代码一致（站定时用 `me.x/y`，仍采样、值恒 0）。
- **验收**：
  - 新增测试：合法掉头（换 path）→ `regressPx = 0`；同一条 path 上倒退 30px → `regressPx = 30`；拐角不误报（弧长单调）。
  - `summarizeWindow` 输出含 p95；样本 ≥ 20 时 p95 与手算一致。
  - 现有 16 条全绿。
- **CHANGELOG**：并入已有的 `### Added` 那条（不单开）。

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
- **改动范围**：新增 `src/client/move-probe.ts` + `src/client/tests/move-probe.test.ts`；`src/client/store.ts` 只加一个只读字段；`src/client/main.tsx` 或 `App.tsx` 里一行开关。不改世界层渲染、不改协议、不改 `docs/`。
- **口径**（`docs/design/30-movement-sync.md` §6.2）：
  - `leadMs = prediction.ts − prediction.anchorTs`（没有外推时不计）；
  - `regressPx` = 两帧之间画面点**逆着上一个运动方向**的位移累加（拐弯处点积≈ 0，不误报）；
  - `posAge = (Date.now() + clockOffsetMs) − state.lastPosTs`（该字段由 `applyPos` 写入，新快照后重置）；
  - `tickSpan` = 相邻两条 `pos.ts` 之差。
- **验收**：
  - `?debug=1` 时每 10s 一行：`leadMs` / `regressPx` / `posAge` / `tickSpan` 的 p50 与 max；
  - 无参数时**不订阅、不建定时器、零开销**；
  - `regressPx > 0` 的行用 `!!` 前缀（控制台一眼看到）；
  - 聚合逻辑是纯函数，单测覆盖（p50/max、倒退累加、拐弯不误报、无样本不出行）。
- **不做**：不加协议字段、不加 HUD 文案、不写文件。
- **CHANGELOG**：`### Added` 一条——`?debug=1` 的位置同步观测。

---

**真机项**（不占卡片，验收时按清单跑）：走到床边再躺下的站立等待（`30-movement-sync.md` §3.9）、`build.md` §7 的既有三项（#25 / #26 / #27）。

