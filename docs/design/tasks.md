# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

---

## 卡 1 · 探针升级：可测的倒退 + 帧级采样

**范围**：`src/client/move-probe.ts`、`src/client/world/world.ts`（`update()` 末尾一处只读调用）。**不动** `prediction.ts` / `motion.ts` / 协议 / 渲染。

**做**：
1. `regressPx` 换判据：保存上一帧的画面世界坐标，本帧把「上一帧点」与「本帧点」**都投影到当前折线**取弧长差；负值累加为 `regressPx`，变号（单次 > 0.5px）计数为 `reversals`。折线换掉的那一帧若上一帧点被夹在折线起点 → 记 `pathSwap` 并跳过。投影抽成纯函数。
2. 每帧采 `frameDelta`（`performance.now()` 差）、`selfStepPx`、`camStepPx`、`isMovingFlips`。
3. 输出仍 10s 一行，字段名与 `30-movement-sync.md` §6.2 逐字一致。

**验收**：
- `npm test` 绿：新增单测证明「同一折线上把点往回喂能测出倒退」（步长为负）、原地不动为 0、换折线那帧被跳过。
- `npm run typecheck` 绿；不带 `?debug=1` 时探针仍不被 import（`src/client/main.tsx:22` 现状），别顺手改成静态 import。

## 卡 2 · `setPersonName` 签名守卫

**范围**：`src/client/world/views.ts` 的 `setPersonName`，写法对齐同文件 `placeBed` 与 `setBubble`。

**做**：把 `setColor` / `setBackgroundColor` / `setPadding` / `setVisible` 的入参收成一个签名字符串，与上一帧相同就整体跳过。今天它们**每人每帧无条件**执行三条 `TextStyle` setter，而三者都走 `updateText()`（整段 canvas 重画 + 纹理重传）。

**验收**：`npm run typecheck` 绿；代码审阅对照 `placeBed` 写法一致。帧时改善由卡 5 量，**不作为本卡通过条件**。

## 卡 3 · 帧时直通（`fps: { smoothStep: false }`）

**范围**：`src/client/world/world.ts` 的 `new Phaser.Game({...})` 加 `fps: { smoothStep: false }`。文档已在 `60-interaction-shell.md` §5.2 写定（理由与代价），本卡只改代码。

**验收**：`npm run typecheck` 绿；模拟器上「游戏页 → 返回」后猫立刻按原速走（不需要 2~4 秒恢复），录屏前后各 ≤15s 对比。

## 卡 4 · 500ms 压力基线的账目

**范围**：只动文档（已落笔，本卡只做核对与补齐）：`test.md` §2、`30-movement-sync.md` §1.3 / §3.9 / §6.2。

**验收**：`npm run lint:design` 0 error；文档之间没有互相矛盾的数字（§1.3 表仍是 RTT 500 名义基线，压力基线单向 500 有指路）；§6.2 的五个判据阈值与本次讨论一致（0.5px / 25ms / 5% / 2 次）。

## 卡 5 · 模拟器实测与定性（不改代码）

**前置**：建 `.dev.vars` 与 `.android-env`（都不入库）；`npm run build`。

**样本上限**（超了没结论就写「未能验证」）：`?debug=1` 下 **3 趟**跳厅走动（每趟 ≤30s）、**2 段** `screenrecord`（各 ≤30s）、**1 次**游戏页进出。

**做**：
1. 按 `test.md` §2 起模拟器、注入单向 500ms、用 HUD「延迟」确认 ≈1000ms（先验 WS 帧是否跟着变）。
2. 每趟走动录下 `?debug=1` 的那一行，按 `30-movement-sync.md` §6.2 的五条判据判红/绿。
3. **先做 `WALK_SWAY = 0` 的对照**：临时把 `src/client/world/views.ts:88` 置 0、走一趟、录一段，**立刻还原**，看「抽搐」是否消失（4.5Hz ±3% 缩放摆动）。收尾 `git status` 必须干净。
4. 游戏页进出：录屏判猫的速度是否仍被压慢。

**产出**：一张表 —— 每个现象（行进中抽搐 / 到达后快速抖动 / 游戏页返回卡顿）→ 命中哪条判据 → 归到哪一组（位置倒退 / 帧时 / 相机 / 摆动闸门 / 视觉摆动）。**只报不修**。

---

## 暂不做

- **游戏代码搬 `public/`**：游戏 chunk 已在 `/assets/` 下、缓存策略相同；途中的另一个动机（加游戏不用碰 TS）已由「文件夹即注册」解决。今天没有需求方。
- `/audio/*`、`/fun/*` 搬进构建：两者已 immutable，搬过去缓存收益为零，只换来「删掉人工 `vN` 纪律」——理由与触发条件见 `backlog.md`。
