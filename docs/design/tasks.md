# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
> 设计前置已随文档提交（`DESIGN.md`：变体表回退到 5 张母图 → 8 张贴图、新增「气泡不走素材」的理由段、`chat-bubble` 行改成程序化绘制 + 名字单独一行）。

- [ ] 卡 14：气泡改程序化绘制（圆角矩形 + 三角尾巴）+ 名字移到气泡上方单独一行 + 删两帧素材
  - **为什么**（实测）：上游气泡素材 36×30，竖直描边只有 1–2px 且带抗锯齿；为了跟文字宽度对齐而**横向拉伸**（实测 ×5.25）会把竖直描边拉成 5–10px 的半透明带 → 左右两边发虚（上下边只做纵向缩放，所以正常）。改成程序化绘制后任何尺寸都清晰，且与「几何程序化生成」这条主线一致。
  - **改（`src/client/world/views.ts`）**：
    1. 删两个 Image 视图（`chat_bubble` / `chat_bubble_tail`）与常量 `CHAT_BUBBLE_SCALE`；
    2. 气泡底 = `scene.add.rectangle(0, 0, w, h, COLORS.bubbleFill).setRounded(4).setStrokeStyle(1, COLORS.bubbleLine)`（圆角 4px、1px 描边）；`COLORS` 里加 `bubbleFill: color('secondary')`、`bubbleLine: color('neutral-muted')`；
    3. 尾巴 = 一个小三角（朝下，宽约 9、高约 6，填充同底、1px 描边同色；用 `add.triangle` 或 `Graphics` 一次画完都行），水平居中、上沿贴气泡下沿；
    4. **位置与尺寸取整**（`Math.round`），并给气泡对象 `setRoundPixels(true)`——否则半像素仍会糊；
    5. 名字行：新增一个 Text（`neutral-muted`、`LABEL_PX`、`setWordWrapWidth(NAME_MAX_PX = 96, true)`），位置在**气泡上方 2px**，内容用现成的 `truncateToLines(name, 1, linesOf)` 截断加 `…`；
    6. 唯一入口签名扩展成 `setPersonChat(view, input: { text: string; kind: 'chat' | 'whisper'; name?: string } | undefined)`；
    7. **不变**：`CHAT_BUBBLE_MAX_PX = 200`、两行上限与截断、私聊「悄悄话 · 」前缀、槽位规则（聊天 > 表情 > 选中名字）、`chatBaseY` 的两套底线。
  - **改（`src/client/world/world.ts`）**：别人的消息改为传 `name`（**去掉原来的「名字：」前缀拼接**——名字已经单独成行）；自己的消息不传 `name`。
  - **改（管线与素材，做减法）**：`tools/art/build-sprites.mjs` 删掉 `chat_bubble` / `chat_bubble_tail` 两条 `VARIANTS`、母图说明与 required 校验回退到 **5 张**、注释里的数字回 `5 张母图 → 8 张贴图`；删 `tools/art/masters/ChatBackground.png` 与 `ChatBackgroundTail.png`；重跑 `npm run art`（图集回 **8 帧**、`frames.css` 回 **8 条**、`LICENSE-wheatcloudsleep.txt` 回到 5 个母图名）。`frames.css` 仍要产出（入场层形象预览用它）。
  - **改（文档数字回退）**：`AGENTS.md`、`README.md`、`docs/design/build.md`、`docs/design/00-master-design.md` 里卡 10 刚改成「7 张母图 / 10 张贴图」的地方回退成 **5 / 8**。
  - **改（测试）**：`src/client/world/tests/atlas.test.ts`：锚点断言回到两档（床 = 左上角、小人 = 底边中心）、帧数与 `frames.css` 规则数跟着改；`rules` 的截断测试不动。
  - **不做**：**不统一**名字气泡 / 表情气泡的画法（那是另一件事，等有人抱怨不一致再说）；不改气泡的寿命 / 覆盖 / 槽位 / 前缀规则；不改协议与服务端；**不改 `docs/ui/DESIGN.md`**（设计前置已改完，本卡只让代码与它一致）。
  - **验收（≤6 条）**：① `npm test` + `npm run typecheck` + `npm run lint:design` 全绿；② `npm run art` 幂等（连跑两次产物逐字节相同），图集 **8 帧**、`frames.css` **8 条规则**、LICENSE 里 **5** 个母图名；③ `grep -rn "chat_bubble\|CHAT_BUBBLE_SCALE" src/ tools/ docs/` **零命中**（`dist/` 与旧产物除外）；④ 单测：名字行「放得下就原样、放不下就截断加 `…`」两条（可在 `rules.test.ts` 复用现有 `truncateToLines` 用例的写法）；⑤ **浏览器复验交主会话**（见下）；⑥ `CHANGELOG.md` 的 `### Changed` 一条（不写任务卡语义）。
  - **主会话浏览器复验（我会做）**：气泡左右边缘不虚化（放大截图 + 像素扫边，与本次的 `debug-1792178246800` 对比）；名字单独一行且在气泡上方；私聊「悄悄话 · 」前缀仍在；8 秒消失；两行截断与 200px 上限不变。