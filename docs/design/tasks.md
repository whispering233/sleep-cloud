# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> 依赖：**10 → 11 → 12**，且 **10 → 13**。四张卡都改客户端/管线文件 → 一律串行派工。
> 设计前置已随本批文档提交（`DESIGN.md` 的气泡素材/变体表/槽位/面板瘦身/形象选择/断表修复、`master` §4·§6·§7、`api/20-api-ws` §4·§5、`config` §2·§3、`schema`、`backlog`）。

- [ ] 卡 13：入场层选形象
  - **目标**：入场层多一个二选一（`boy` / `girl`），没选的人行为不变（按 `user_id` 派生）。
  - **改**：① `src/worker/session.ts`：`Session` 加 `appearance?: Appearance`（解析/序列化与 nickname 同形）；② `src/worker/app.ts`：新增 `POST /api/appearance`（校验取值在 `APPEARANCES` 内，非法 → `1004` 风格的可见错误？用现有码：非法值走 `4001`/新码 → **取最小方案：非法值直接忽略并回原会话**）、`/api/ws` 升级时把形象放进身份 header；③ `src/shared/http-api.ts`：`SessionView` 加 `appearance`；④ `src/hall/hall.ts` 的 `fetch`：读该 header，**缺失/非法时回落到 `appearanceFor(userId)`**；⑤ `src/client/api.ts` 加 `setAppearance`；⑥ `src/client/components/EntryOverlay.tsx`：加两个可点选项（用图集 `boy_stand` / `girl_stand` 预览，坐标走 `public/sprites/frames.css`——**卡 10 的产物**），选中态可见；⑦ 样式引用 tokens，不写内联/单行 className 堆叠。
  - **不做**：不做厅内改形象（与改名一致：只在入场层）；不改 `appearanceFor` 的哈希（它是回落，不是默认值来源）；不动协议（`appearance` 已在下行）。
  - **验收（≤5 条）**：① 单测：session 解析/写入、hall 对 header 缺失/非法的回落、`SessionView` 形状；② `ui-verifier`：入场层能选（手机视口）、选中后进厅、**另一个会话看到的是所选形象**；③ 不选（或没有该字段的老 cookie）→ 行为与今天一致；④ 非法值（手改请求）→ 不炸、回落到哈希；⑤ `npm test` + `typecheck` + `lint:design` 全绿。
  - **CHANGELOG**：`### Added` 一条。