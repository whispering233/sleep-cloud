# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

当前没有进行中的卡片。

已知待办（都不是缺陷，等真实反馈再动）：

- **气泡两行容量 约 32 → 约 28 字**（卡 19 落地后）在真机上的手感：`build.md` §7 A9 顺带看。
- **提示报的「末尾约 N 字」比渲染实际吃掉的字数少 1**（`…` 自己占一格；30 字消息提示「约 2 字」而实际吃掉 3 字）。已在 `src/client/bubble-fit.ts` 的 `bubbleHintOf` 上留 `shortcut:` 注释，真机出现抱怨时加 1 即可。
- **`MAX_DPR = 3` 之后的真机帧率**：`build.md` §7 B5（填充率是上限 2 时的 2.25 倍）。
