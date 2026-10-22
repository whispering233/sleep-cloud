# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。




## 卡 4 · 反馈客户端：齿轮入口 + 面板 + 回执退场 + 告知

- **范围**：`src/client/composer.ts` 新状态 `feedback`（两条 READ，`focusin` 不许把 `feedback` 降回 `typing`，`focus-in` 不能覆盖它）；`store.ts` 菜单开/关 action；`components/FeedbackForm.tsx`（多行、字数、发送、取消、`autoFocus`、错误用黄色 `.hint`、`pointerdown` preventDefault + 稳定 `key`）；`components/IntroPanel.tsx` 左侧一层镜像；`components/ActionRow.tsx` 齿轮菜单「反馈与建议」；`ChatPanel.tsx` 插槽条件；`ws.ts` 发 `{type:'feedback', text}` 且 `onmessage` 不早返回（否则 5004 到不了电脑）；`error-text.ts` 三条文案；`store.ts` 收 `5004` 时 `exitComposer()` + hint；`public/privacy.html`、`README.md`、`docs/design/50-slot-panel.md` 的「用户可读告知」与实现同批。
- **验收**：单测覆盖 composer 状态机（`focusin` 不降级、失焦退场、`5004` 退场）；`ui-verifier` 在 393×852 真机/模拟器（本仓库无模拟器时用桌面手机视口并在结论注明）走完整链路：齿轮 → 反馈 → 写 5 字 → 发送 → 面板关 → toast「收到了」；超长与空文本按钮禁用；「收起」与 Esc 都能退场；打字态与面板位置符合 `60`。
- **不碰**：举报表单；后台列表（下一卡）；任何服务端字段。
- **依赖**：卡 3 的协议与 ack。

## 卡 5 · 反馈后台列表：`GET /api/admin/feedback` + 只读视图

- **范围**：`src/hall/admin.ts` 加 `GET /feedback`（`limit` 50/最大 100，`before` 游标，`next` 末条 id）；`src/worker/admin.ts` 转发；`public/admin.js` `#feedback` 视图（倒序、`text` 保留换行、昵称走身份 PK、空态、上一页/下一页、不渲染 `userId`）；无写操作、无标记。
- **验收**：单测覆盖分页边界（空表、`limit` 夹取、`next` 为 0 不出现）；`ui-verifier` 复核：用卡 3 的测试数据看到新反馈在首行、长文本折行、翻页、空态、无写按钮。
- **不碰**：反馈提交路径、封禁表单、`/reports` 视图。
- **依赖**：卡 1 的壳、卡 3 的表。
