# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `config.md` 与 `../ui/DESIGN.md`：卡片里出现的参数名、数值、闸门都必须与它们逐字一致，不一致就改代码不改文档。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

---

## 卡 2 · 世界层只声明「我要哪几组」（客户端侧）

**依赖**：卡 1。

**改哪里**
1. `src/client/world/views.ts`
   - 声明一个本地的动画元数据类型（`{ group, frames, frameRate, loop, out? }`），从 `../assets/sprites/atlas.json` 读 `animations`；
   - 一个 `registerAnim(scene, group, animKey)`：按组标识取帧列表 / 帧率 / `loop`（`repeat = loop ? -1 : 0`）注册，**全局只注册一次**的守卫保留；
   - 摸猫六组：`['cat-idle','cat-walk','cat-run','cat-sleep','cat-pat','cat-nuzzle']`，动画 key 就等于组标识（`PetAnim` 一行不改，`pet.ts` 不动）；
   - 床头装饰：删掉 `HEAD_DECOR_SKINS` 里的一切数字 / 前缀 / 熄灭帧名，只留「偏好 id → 组标识」的映射（`fire` → `fire`、`pumpkin` → `cat-pumpkin`）；动画 key 改成 `decor-fire` / `decor-pumpkin`（`views.ts` 内部使用）；熄灭帧名从产物的 `out` 取；
   - `createHeadDecorView` 的初始贴图同样从产物的 `out` 取。
2. `src/client/world/tests/atlas.test.ts`
   - 顶部类型声明补 `animations`；
   - 删掉 `numberedFrames` / `CAT_FRAMES` / `FIRE_FRAMES` / `PUMPKIN_FRAMES` 三张手抄表，一律从 `atlas.animations` 派生；
   - 新增断言：**产物 `animations` 与源 `tools/art/masters/cat-all-sprites-atlas.json` 逐组等价**（组标识集合、帧名数组含顺序、`frameRate` ↔ `fps`、`loop`、`out`）；
   - 新增断言：每个 `animations[].frames` 里的帧名都在 `atlas.frames` 里；
   - **保留**「站立 5 组同框」「熄灭帧与燃烧 / 点亮帧同框」两条既有断言（改用派生出来的名字）。

**验收**：`npm test`、`npm run typecheck` 全绿；`npm run art` 之后 `git status` 干净（本卡不改素材）。手工验收不入本卡。

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
