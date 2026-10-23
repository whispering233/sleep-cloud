# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

---

## 卡 2 · `setPersonName` 签名守卫

**范围**：`src/client/world/views.ts` 的 `setPersonName`，写法对齐同文件 `placeBed` 与 `setBubble`。

**做**：把 `setColor` / `setBackgroundColor` / `setPadding` / `setVisible` 的入参收成一个签名字符串，与上一帧相同就整体跳过。今天它们**每人每帧无条件**执行三条 `TextStyle` setter，而三者都走 `updateText()`（整段 canvas 重画 + 纹理重传）。

**验收**：`npm run typecheck` 绿；代码审阅对照 `placeBed` 写法一致。帧时改善由卡 5 量，**不作为本卡通过条件**。

## 卡 3 · 帧时直通（`fps: { smoothStep: false }`）

**范围**：`src/client/world/world.ts` 的 `new Phaser.Game({...})` 加 `fps: { smoothStep: false }`。文档已在 `60-interaction-shell.md` §5.2 写定（理由与代价），本卡只改代码。

**验收**：`npm run typecheck` 绿；模拟器上「游戏页 → 返回」后猫立刻按原速走（不需要 2~4 秒恢复），录屏前后各 ≤15s 对比。

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
