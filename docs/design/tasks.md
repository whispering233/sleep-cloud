# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`70-reserve-decor.md`（本轮总规格）、`20-layout.md` §2.1、`../ui/DESIGN.md`（素材变体 / 暖色纪律 / 拉远退役）、`../../AGENTS.md`（硬纪律 4 / 17 / 24）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。**只 `git add` 本卡涉及的文件，不要 `git add -A`**（工作区里有未跟踪的素材母图，属于卡 2）。
- **worker 不改 `docs/`**：设计已先落文档。卡里标注「要补 CHANGELOG」时，只补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`，它们不入库）。
- 验收：`npm run typecheck` + `npm test` 必须全绿；卡 3–5 另按 `test.md` §2 在宿主 Android 模拟器上验证（先建 `.dev.vars`，否则 `/api/me` 报 9001）。

---

## 卡 2：素材管线（猫 20 帧 + 篝火 7 帧 + 许可，画面无变化）

**依据**：`../ui/DESIGN.md`「构建期要产出的变体」与「两支映射」、`build.md` §素材管线。

先确认母图已在位（**这些文件不归本卡生成，只归本卡提交**）：

```text
tools/art/masters/cat-sheet.png              1160×1072，透明（无纸底 / 无注记 / 无虚线格框）
tools/art/masters/cat-fire-out.png           128×128（同一张图里火苗/火星/辉光已屏掉）
tools/art/masters/cat-all-sprites-atlas.json 上游帧坐标（唯一来源）
```

1. `tools/art/build-sprites.mjs`：
   - 新增一个「多色素材」分支：读 `cat-all-sprites-atlas.json`，白名单只取 `idle` / `walk` / `run` / `sleep` / `fire` 五组（**`pat` / `nuzzle` 不打进图集**，留 `backlog.md`），逐帧按 JSON 的 `x/y/w/h` 从 `cat-sheet.png` 裁；`fire-out` 单独从 `cat-fire-out.png` 整格裁。
   - 帧名：`cat-idle-1…8`、`cat-walk-1…4`、`cat-run-1…4`、`cat-sleep-1…4`、`fire-1…6`、`fire-out`。锚点一律 `{ x: 0.5, y: 1 }`（墨迹底边中心）。
   - **映射规则（两支，不是两色渐变）**：逐像素算 `sat = (max−min)/max`、`lum = 0.299r+0.587g+0.114b`（0~1）。
     `sat < 0.12 且 lum > 0.90` → 颜色换成 `paper`；`sat < 0.30 且 lum < 0.20` → 颜色换成 `neutral`；**其余原样保留**（橙火、光晕、腮粉、木、灰、以及它们的抗锯齿过渡）。alpha 一律照抄母图。
   - `inkBox` 的「非全透明」判据沿用（母图已去纸底与格框），不要为此改阈值。
   - 打包：`ATLAS_WIDTH` 保持 256；帧数变多后高度自然翻到下一个 2 的幂，不要为此另开第二张图集。
   - 文件头注释补一段：猫/篝火母图是**一次性离线栅格化**的产物（SVG → 去纸底 / 去注记 / 去格框 → `sharp` density 72），`npm run art` 只读 PNG，**不引入 SVG 依赖**。
2. 新增 `public/sprites/LICENSE-cat-fire.txt`：猫与篝火为项目自绘，MIT，附生成方式一句话。
3. `src/client/world/tests/atlas.test.ts` 补断言：上面 28 个帧都在、`spriteSourceSize` / `sourceSize` 与帧一致、锚点是 `{0.5, 1}`、`frame.w * ART_SCALE` 落在预期区间（猫 38~54、篝火 46~50），且图集里**没有** `pat` / `nuzzle` 的帧。
4. 要补 CHANGELOG 的 `### Added` 条目（一句：猫与篝火的贴图帧进入图集 + 自绘许可）。
5. 验收：`npm run art` 跑**两次**，第二次产物与第一次逐字节一致（幂等）；`npm run typecheck`、`npm test`。**画面不得有任何变化**（本卡不动客户端逻辑）。

## 卡 3：床头篝火（第一处可见变化）

**依据**：`70-reserve-decor.md` §2。

1. `src/client/world/rules.ts` 加纯函数 `campfireLit(me)`（`me` 就是 `SelfPerson | undefined`）：`state === 'lying' || state === 'asleep'` 为真；`roaming` / `trace` / 无 `me` 为假。单测覆盖这 5 种输入。
2. `src/client/world/views.ts` 加篝火视图：`Sprite`（**动画要 `Sprite`，不是 `Image`**）+ 定位
   - 位置 = `reserveBlockOf(bedNo, 'head')` 的**底边中心**；容器坐标就用世界坐标（与床位同一个坐标空间）。
   - 燃烧：`anims.create({ key: 'fire-burning', frames: generateFrameNames(SPRITES_KEY, { prefix: 'fire-', start: 1, end: 6 }), frameRate: 8, repeat: -1 })`；
     熄灭：`anims.stop()` + `setTexture(SPRITES_KEY, 'fire-out')`。**熄灭不隐藏**。
3. `src/client/world/world.ts`：在 `update` 里（`syncBeds` 之后）取「我躺的那张床」= `me.state` 非 `roaming` 时用 `me.bedNo`，否则用 `me.ownedBedNo`；没有床 / 那张床不在 `viewRect` 内 → 不画；否则按 `campfireLit(me)` 切两种状态。只有一张篝火，**不需要对象池**；深度与小人同一条规则（`DEPTH.person + y`）。
4. 要补 CHANGELOG 的 `### Added` 条目。
5. 验收：`npm run typecheck`、`npm test`；模拟器（393×852）**一项**：躺下 → 火在床头烧起来；起身 → 火熄成柴堆（**不是消失**）。截图 2 张即可，不要更多。

## 卡 4：床尾猫（核心：动画 + 窝 + 跟随 + 无窝起跑）

**依据**：`70-reserve-decor.md` §3.1–3.3 / §3.5 / §4。

1. 新增 `src/client/world/pet.ts`（**纯函数，无 Phaser**）：
   - `PET_*` 常量：速度系数 `1.2`、下限 `260`、上限 `1320`、跑动阈值 `300`、跟随偏移 `16`、重算阈值 `24`、无窝起跑距离 `120`。
   - `petTargetFor(me, bedCount)` → `{ kind: 'home' | 'user' | 'spawn', point }`：`lying`/`asleep` → 窝（`reserveBlockOf(ownedBedNo,'foot')` 的底边中心）；否则有窝 → 我脚前 16px（不可走时退回我的点）；无窝 → `nearestStreetPoint(我 + (0,120))`。
   - `petPathFor(from, target, bedCount)`：从当前位置到目标的折线。家 / 窝那一段走「预留位底边中心 ⇄ `nearestStreetPoint(中心)`（门口）」的短直线，中间一律 `findPath`；`findPath` 返回 `null` 时退回直线（猫是本地装饰，不能因此消失）。
   - `petSpeedFor(distance)` = `clamp(1.2 × distance, 260, 1320)`；`petAnimFor(speed)` = `>300` → `'cat-run'`，`>0` → `'cat-walk'`，否则 `'cat-idle'`。
2. `src/client/world/tests/pet.test.ts`：至少 8 条——躺下 → 窝；漫游且有窝 → 我脚前；无窝 → 起跑点（且与我的距离 ≈120 或最近街网）；速度单调 + 上下限；`petAnimFor` 三档；`petPathFor` 从窝出发时**先经过门口**（第一段终点在街上）；`findPath` 失败时仍给出非空折线。
3. `src/client/world/views.ts` 加猫视图：`Sprite` + 四组动画（`cat-idle` 8f/8fps、`cat-walk` 4f/6fps、`cat-run` 4f/6fps、`cat-sleep` 4f/6fps，全部 `repeat: -1`）；深度同小人（`DEPTH.person + y`）。
4. `src/client/world/world.ts`：每帧推进（`advanceMover`，速度取 `petSpeedFor`；**按经过时间算，不按拍数**）：
   - 目标每帧取（纯函数），**目标点移动 > 24px 或床位数变了才重算折线**；
   - 状态切换：`lying`/`asleep` 到家 → `cat-sleep`；漫游到位 → `cat-idle`；其余按速度切 `walk`/`run`；
   - 没有 `me` 或 `me.state === 'trace'` → 不画；不在视野内 → 不画（对象留在场景里，不做池）；
   - **逐帧状态只放场景字段**：不得写 store、不得触发 React 重渲染（硬纪律 17）。
5. 要补 CHANGELOG 的 `### Added` 条目。
6. 验收：`npm run typecheck`、`npm test`；模拟器**三项**：① 漫游时猫跟在脚前、不穿床；② 躺下 → 猫回床尾块睡（播 `sleep`）；③ 首次进厅还没有床时，猫从旁边跑过来（此时**不要**验问候，那是卡 5）。

## 卡 5：进厅问候（抽气泡复用件 + 4 秒、仅首次进厅）

**依据**：`70-reserve-decor.md` §3.4；`../ui/DESIGN.md`「气泡不走素材」。

1. `src/client/world/views.ts`：把 `PersonView` 里的气泡三件（底 / 尾巴 / 文字）与量文字的两支二分抽成可复用件（如 `createBubbleView` / `setBubble`），`PersonView` 改用它、**行为与外观不变**（小人气泡是回归面）。
2. 猫问候：
   - 触发：首次进厅（沿用 `WorldScene` 里已有的 `everOnline`，`false` 那一次）且猫**第一次**跑到我旁边；
   - 文案「欢迎进来」，4 秒，到点在渲染时比较时间戳（**不挂定时器**）；
   - `Z < ZOOM_TEXT_MIN` 时不画（猫本体照画）；
   - **不写 `state.bubbles`**（它不是聊天）。
3. 视觉：气泡挂在猫头顶（锚在猫的脚点上方，高度按猫的贴图高 ≈54.5 世界像素），不与我的小人气泡抢同一槽位。
4. 要补 CHANGELOG 的 `### Added` 条目。
5. 验收：`npm run typecheck`、`npm test`；模拟器**两项**：① 首次进厅 → 猫跑过来，头顶出现「欢迎进来」，4 秒后消失；② 刷新重连（同一会话的宽限恢复）→ **不再**问候；另加**一项回归**：随便发一条聊天 → 小人头顶气泡照旧 8 秒消失、最长两行。

---

**当前进行中的卡片**：卡 2（素材管线）
