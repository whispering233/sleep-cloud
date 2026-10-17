# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

当前没有进行中的卡片。下一批候选与已知待办都在 `backlog.md`；真机验收清单在 `build.md` §7（含本地怎么跑真 DPR 3）。

**派活硬约束（每张卡都适用）**：一条命令一步、不要管道 / 重定向 / `&&` / 多行内联脚本；工具自己会截断输出，不要用 `tail` / `grep` 过滤。工具不可用就如实写「未能验证」并退出，不要为了凑结论硬撑。
