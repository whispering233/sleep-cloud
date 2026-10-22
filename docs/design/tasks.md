# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

**本批的统一目标**：**一行的主语是「一个人」时，昵称与 `userId` 印在一起**，并且能点开只读抽屉。理由见 `120-admin-console.md` §2.1 末段。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

---

## K2 台账点「身份」开抽屉

**契约**：`120-admin-console.md` §2.1 与 §9 判据 5。

- 只改 `public/admin.js`：`identityRow` 的第一格改成 `.link` 按钮（文案就是 `userId`），点击调 `openIdentity(item.userId, item.userId)`。
- **不加列、不加表头**：台账仍是 8 列。
- **不做**：不给整行加点击；不动抽屉内容。

**验收**（全部通过才算完成）

1. `node --check public/admin.js` 通过。
2. 手工（或 `ui-verifier`）：点身份 → 抽屉出现该 `userId` 的详情；`Esc` / 遮罩 / 「关闭」都能退出；抽屉里没有封禁按钮。

---

## K3 反馈列表「提交者」

**契约**：`../api/30-api-admin.md` §5.9（服务端已返回 `userId`）、`130-feedback.md` §7。

- `public/admin.html` 反馈表头「昵称」→「提交者」。
- `public/admin.js` `feedbackRow` 第 2 格改成 `partyLink({ userId: item.userId, nickname: item.nickname })`（与举报页同一条 `partyText` 规则：昵称 `null` 时只显示 `userId`）；顺手改掉函数上方那句「不显示 `userId`」的注释。
- **不做**：不加列、不改分页、不改正文渲染（保留 `pre-wrap`）。

**验收**（全部通过才算完成）

1. `node --check public/admin.js` 通过。
2. 手工（或 `ui-verifier`）：昵称在 → `昵称 · userId`；昵称被清空 → 只有 `userId`；两者都能点开抽屉。

---

（本批只剩 K2 / K3 两张静态页卡片。）
