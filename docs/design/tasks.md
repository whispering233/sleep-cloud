# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。**只 `git add` 本卡涉及的文件，不要 `git add -A`**。
- **worker 不改 `docs/`**：设计已先落文档。卡里标注「要补 CHANGELOG」时，只补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`，它们不入库）。
- 验收：`npm run typecheck` + `npm test` 必须全绿；涉及界面 / 触摸 / 软键盘的卡另按 `test.md` §2 在宿主 Android 模拟器上验证（先建 `.dev.vars`，否则 `/api/me` 报 9001）。
- **不要新增接口、不要新开 RPC 方法**：封禁判定只有 `entryStatus(来源)` 一处实现，`/api/me` 与 `hello` 共用。

---

**当前没有进行中的卡片。**
