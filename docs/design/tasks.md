# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1：南瓜灯进素材管线（独立母图 + 亮灭两组）

规格：`docs/design/80-reserve-decor.md` §2.4、`docs/ui/DESIGN.md`「构建期要产出的变体」。

- **亮组母图** `tools/art/masters/cat-pumpkin.png`：从 `<素材目录>/cat-all-sprites-sheet.svg` 取南瓜那一行（组 `pumpkin`，6 格 ×128×128，`x = 112 + i*128`、`y = 1048`）→ 去掉纸底 / 虚线格框 / 左侧标签 → 裁成 `768×128` 透明底
- **灭帧母图** `tools/art/masters/cat-pumpkin-out.png`：按 `cat-fire-out.png` 的先例另出 `128×128`（南瓜身与卷蒂保留；三角眼 / 嘴变成暗的挖洞；光晕与地面光池去掉）
- **组登记** `tools/art/masters/cat-all-sprites-atlas.json`：加 `pumpkin` 组（`"sheet": "cat-pumpkin"`，帧 `x = i*128, y = 0, w = h = 128`，`fps: 10`、`loop: true`）
- **管线** `tools/art/build-sprites.mjs`：`cellsOf` 读组里的 `sheet`（缺省 `cat-sheet`）；`decorGroups` 加「南瓜亮组 + 灭帧」一组（**同组共框**）；许可正文加一句南瓜灯
- **白名单** `src/client/world/tests/atlas.test.ts`：加 `cat-pumpkin-1…6` 与 `cat-pumpkin-out`
- **产物**：`npm run art` 重新生成的 `atlas.png` / `atlas.json` / `frames.css` / `public/sprites/LICENSE-cat-fire.txt`

**验收**：`npm run art` 打印出 7 条南瓜帧且无报错；`npm test` 绿；逐格目视 6 帧无格框 / 标签残留；`git status` 里 `tools/art/masters/cat-sheet.png` **不在修改列表**。

## 卡 2：床头块新增「南瓜灯」候选

规格：`docs/design/80-reserve-decor.md` §2.4 / §4。

- `src/client/decor.ts`：`DECOR_BLOCKS.head = ['fire', 'pumpkin']`；`DECOR_LABELS` 加「南瓜灯」。**默认值不动**（仍是篝火），存储与界面按表遍历所以零改动
- `src/client/world/rules.ts`：`fireLit` → `decorLit`（同一判据现在有两个消费者），引用与单测同步
- `src/client/world/views.ts`：南瓜灯视图（亮组 6 帧 10fps 循环 / 灭帧；墨迹底边中心锚点）
- `src/client/world/world.ts`：`decor.head === 'pumpkin'` 才画；亮灭吃 `decorLit`；不可点；按可视窗口裁剪（与篝火同构）
- 单测：`src/client/tests/decor.test.ts`（候选表 / 文案按表自动覆盖）、`src/client/world/tests/rules.test.ts`（判据对两个候选同真）

**验收**：`npm run typecheck` + `npm test` 绿；浮层「装饰 → 床头」多一行「南瓜灯」（高度 332 → 384）；躺下亮、起身灭、火不出现；别人看不见。
