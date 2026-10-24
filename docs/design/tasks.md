# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `config.md` 与 `../ui/DESIGN.md`：卡片里出现的参数名、数值、闸门都必须与它们逐字一致，不一致就改代码不改文档。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

---

## 卡 3 · `frames.css` 只产入场层预览的两帧

**依赖**：无（与 1/2 独立）。

**改哪里**
1. `tools/art/build-sprites.mjs`：`frames.css` 只给 `boy_stand` / `girl_stand` 两条规则（注释改成「只产入场层预览用到的帧」）。
2. `src/client/world/tests/atlas.test.ts`：那条「每帧一条规则 + 坐标同源」的断言改成「**恰好**这两条、名字就是这两个、坐标与图集一致」。

**验收**：`npm run art` 后 `frames.css` 只剩 2 条规则，`atlas.png` / `atlas.json` 不变；`npm test` 绿；入场层两个形象预览仍出图（`EntryOverlay.tsx` 的 `sprite-${PREVIEW_FRAME[value]}`）。

---

## 暂不做

- **游戏代码搬 `public/`**：游戏 chunk 已在 `/assets/` 下、缓存策略相同；途中的另一个动机（加游戏不用碰 TS）已由「文件夹即注册」解决。今天没有需求方。
- `/audio/*` 搬进构建：已 immutable，搬过去缓存收益为零，只换来「删掉人工 `vN` 纪律」——理由与触发条件见 `backlog.md`。
