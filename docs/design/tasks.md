# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
> 设计前置已随文档提交（`DESIGN.md` 的 `chat-panel` 行加「发送前提前说明」、`config.md` 的 `CHAT_MAX_LEN` 行写明「它不是气泡的显示容量」）。

- [ ] 卡 15：输入框实时提示「气泡放不下」+ `maxLength = 200`
  - **目标**：别让用户「发完才发现被截断」。**不硬性限制输入**（气泡容量随中英混排变化，硬限制会变成假象），只在草稿超过气泡两行容量时于输入行上方给一行弱提示；另加 `maxLength = CHAT_MAX_LEN`（200）只为免得到服务端才吃 `4001`。
  - **改（新增 Phaser-free 模块 `src/client/bubble-fit.ts`）**：把 `FONT_FAMILY`（tokens 的 body 字体）与 `LABEL_PX = 12` 从 `views.ts` **搬过来并导出**（`views.ts` 反过来 import——否则界面层为了拿这几个数就得把 Phaser 拖进自己的包）；`BUBBLE_PAD = 4`、`CHAT_BUBBLE_MAX_PX = 200`、`BUBBLE_TEXT_PX = CHAT_BUBBLE_MAX_PX - 2 * BUBBLE_PAD` 同处；`estimateBubbleLines(text)`：按字符宽度累加估算行数，宽度表用**实测值**（本机 Chromium 12px：中文/全角 `12.00`、拉丁 `7.35`、空格与 `·` `3.81`），未知字符按 `12` 保守计；`bubbleHintOf(text): string | undefined`：估算行数 ≤ 2 给 `undefined`，否则给「气泡里显示到这里，末尾约 N 字会变成 …」。
  - **改（`src/client/world/views.ts`）**：删本地那两组常量，改从 `bubble-fit.ts` import；**气泡的截断仍用 Phaser 文字对象的精确测量**（`truncateToLines` + `getWrappedText`）——提示用估算、绘制用实测，代码里写一句注释说明这个分工（提示宁可保守，绘制必须准）。
  - **改（`src/client/components/ChatPanel.tsx`）**：输入行**上方**按 `bubbleHintOf(draft)` 渲染一行提示（`undefined` 就不渲染）；`TextInput` 加 `maxLength={CHAT_MAX_LEN}`。
  - **改（`src/client/styles/app.css`）**：加 `.chat-hint`（`caption` 档 + `neutral-muted`，不抢眼）；**不动**其它行样式。
  - **不做**：不硬性截断输入；不在提示里承诺精确字数（估算会有一字级误差）；不改气泡的绘制规则（宽度上限 / 两行 / 截断 / 槽位 / 前缀一律不动）；不改协议与服务端。
  - **测试（新增 `src/client/tests/bubble-fit.test.ts`，纯函数、node 可跑）**：① 短文本 → `undefined`；② 恰好两行 → `undefined`（不误报）；③ 明显超长中文 → 有提示且「末尾约 N 字」的 N > 0；④ 超长英文（拉丁宽度）也能触发；⑤ 空串 → `undefined`；⑥ `estimateBubbleLines` 的单调性（长文本行数 ≥ 短文本）。
  - **验收（≤4 条）**：① `npm test` + `npm run typecheck` + `npm run lint:design` 全绿；② 上述 6 类单测逐条有断言；③ **浏览器复验交主会话**（见下）；④ `CHANGELOG.md` 的 `### Changed` 一条（不写任务卡语义）。
  - **主会话浏览器复验（我会做）**：手机视口下输入 10 字 → **无**提示；输入 40 字 → 出现提示且文案含「…」与字数；提示出现时仍能正常发送（消息照发、气泡按两行截断）；粘贴 250 字 → 输入被 `maxLength` 截到 200 字（服务端不再回 `4001`）。