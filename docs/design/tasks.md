# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
> 设计前置已随文档提交（`ui/DESIGN.md` 的 Typography 与 `chat-bubble` 行写明「世界里的文字只有两档：气泡/名字 = `label` 13px、床号 = `caption` 12px」，并顺手修掉同一段里 `CHAT_BUBBLE_MAX_PX` 写成 150 的自相矛盾；`config.md` 的 `CHAT_MAX_LEN` 行改成「纯中文约 28 字」）。**代码未跟上期间 `npm test` 不会红**（现有测试镜像的是代码而不是文档字号），由本卡收口。

- [ ] 卡 19：气泡文字 12px → 13px（`caption` 档 → `label` 档，对齐文档）
  - **为什么**：`docs/ui/DESIGN.md` 一直写「气泡文字 = `label` 档」（Typography 与 `chat-bubble` 两处），代码却是 `LABEL_PX = 12`（`caption` 档，与床号同档）。消息只在世界里出现、气泡是产品**唯一的内容通道**，应回到 `label`（13px）；**床号继续 `caption`（12px）**——两档刻意分开。卡 17/18 治的是「糊」，本卡治「小」。
  - **改**：
    1. `src/client/bubble-fit.ts`：`LABEL_PX = 12` → `13`；注释改成「气泡用的字号 = `label` 档（世界像素 = CSS 像素，见 `docs/ui/DESIGN.md` Typography）」。**三档字宽必须按 13px 重新实测**（本机 Chromium，字体栈与 `theme.fontFamily.body[0]` 一致：`13px ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif`，用 `ctx.measureText`）：**中文/全角 `13.00`、拉丁 `7.69`（量 `x`）、空格与 `·` `4.13`**（**主会话已实测**，直接用这三个数；**不许按 12px 旧值乘 13/12 推算**——旧注释写的拉丁 `7.35` 在本机复现不出来，同一环境量 `x`@12px 是 `7.10`）。注释里补一行 `shortcut:`：ASCII 里 `@`/`W`/`m`/`%` 实测最宽 `13.00`（与中文同宽），按 `x` 估对它们偏乐观；真机反馈「提示说放得下、实际被截断」时，就把拉丁档换成 ASCII 实测最宽值（或直接并进中文档）。
    2. `src/client/world/views.ts`：床号（`createBedView` 里的 `number`）改用**新增的本地常量** `const BED_NUMBER_PX = 12;`（注释：床号是 `caption` 档，刻意比名字与气泡小一档）；`bubbleText` / `emote`（吃 `BUBBLE_STYLE`）、`bubbleName`、`name` 继续吃 `LABEL_PX`（现在 = 13）。`resolution`、字号以外的几何一律不动。
    3. `src/client/tests/bubble-fit.test.ts`：`CJK_PER_LINE = BUBBLE_TEXT_PX / 12` → **`Math.floor(BUBBLE_TEXT_PX / 13)`（= 14）**（`192/13` 不是整数，直接用除法会被 `String.repeat` **静默取整**）；「末尾约 8 字」按新容量重算：40 个中文 → 两行 28 → **末尾约 12 字**。
    4. `CHANGELOG.md` 的 `[Unreleased]` 加 `### Changed`：气泡文字 12px → 13px（`caption` → `label` 档，对齐 `docs/ui/DESIGN.md`），床号仍 12px；气泡两行容量从约 32 字降到约 28 字（输入框提示的字数随之变）。
  - **不做**：不改气泡宽度上限（200）/圆角/描边/尾巴/槽位优先级；不改表情与名字的显示条件；不改 `CHAT_MAX_LEN`；不改 DOM 面板的字号；不改估算法则本身（表外字符仍按最宽档）。
  - **测试**：`bubble-fit.test.ts` 的容量与提示字数按新档位更新（这是本卡唯一可单测的部分）；`npm test` + `npm run typecheck` 全绿。
  - **验收（≤5 条）**：① `npm test` + `npm run typecheck` 全绿；② 真 DPR 3 会话（`BETTERWRIGHT_CHROMIUM_ARGS="--force-device-scale-factor=3 --window-size=500,939" betterwright run --session … --no-ad-block`；**别调 `setViewportSize`**，它会把 dpr 打回 1）发一条中文聊天：气泡文字比改前大一档、仍最多两行、气泡底刚好包住文字、仍居中在头顶；③ 同屏床号看起来**没变**（仍 12px）；④ 输入框敲 40 个中文 → 提示是「末尾约 12 字会变成 …」；⑤ 控制台无报错、无失败资源。
