# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
>
> 依赖：**10 → 11 → 12**，且 **10 → 13**。四张卡都改客户端/管线文件 → 一律串行派工。
> 设计前置已随本批文档提交（`DESIGN.md` 的气泡素材/变体表/槽位/面板瘦身/形象选择/断表修复、`master` §4·§6·§7、`api/20-api-ws` §4·§5、`config` §2·§3、`schema`、`backlog`）。

- [ ] 卡 11：聊天气泡（世界内）
  - **目标**：聊天与私聊在世界里以气泡出现（8 秒、覆盖、宽度上限、私聊前缀），**不再有本地消息流**。规则见 `DESIGN.md` 的 `chat-bubble` 行与槽位说明。
  - **改**：① `src/shared/constants.ts` 加 `CHAT_BUBBLE_MS = 8_000`（`constants.test.ts` 加断言）；② `src/client/store.ts`：`messages` / `ChatLine` 形态改成 `bubbles: Map<发送者id, { text, kind: 'chat' | 'whisper', expiresAt }>`，`applyChat` / `applyWhisper` 写入并**覆盖同人前一条**、重置 `expiresAt`；`applySnapshot` / `applyLeave` 清掉（人走气泡走）；③ `src/client/world/views.ts`：加气泡视图（`chat_bubble` + `chat_bubble_tail` 两个 Image **同原点**、一个 Text），画法照上游：**底图按文字宽度横向拉伸、尾巴固定尺寸**；宽度上限 `CHAT_BUBBLE_MAX_PX = 200`（客户端常量，放 `views.ts` 与其它气泡常量同处）、最多两行、超出加 `…`；**槽位唯一**：聊天 > 表情 > 名字；④ `src/client/world/world.ts`：每帧把未过期气泡挂到对应人身上（`expiresAt` vs 现在，**不挂定时器**）。
  - **不做**：不改协议（`chat` / `whisper` 下行字段一个都不动）、不改服务端、不加气泡进场/退场动画、不做用户的距离过滤（仍全厅可听，只是**只在视野内画**）。
  - **测试**：`src/client/tests/store.test.ts` 的 chat/whisper 用例改成气泡语义——覆盖同人前一条、`expiresAt` 重置、人离开清掉、自己发的不带名字前缀（`own` 仍在）。
  - **独立验收（ui-verifier，≤6 条，手机视口）**：① 发一条全局消息 → 自己头上出现气泡，8 秒后消失；② 连发两条 → **只有一条**气泡且是后一条；③ 长消息（接近 200 字）→ 气泡宽度不超过约 200px、两行封顶、截断带 `…`；④ 私聊 → 双方头上出现且带「悄悄话」前缀，第三方（另一个会话）看不到；⑤ 同一个人同时有表情与消息 → 只显示聊天（槽位规则）；⑥ 对方离开大厅 → 气泡立即消失。
  - **CHANGELOG**：`### Added` 一条。

- [ ] 卡 12：删底部聊天记录（面板只剩控件行）
  - **目标**：面板不再有消息列表；聊天只在世界里。面板 = 私聊目标行 + 表情行 + 床上动作行 + 输入行。
  - **改**：① `src/client/components/ChatPanel.tsx`：删 `<ol class="chat-log">`、`view.messages`、滚动到底的 effect、`lineClass`；② `src/client/store.ts`：删 `messages` 字段与残留（`ChatLine` 若已随卡 11 改成 bubbles 就只删引用）；③ `src/shared/constants.ts` 删 `CHAT_LOG_MAX`（`constants.test.ts` 同步）；④ `src/client/styles/app.css`：删 `.chat-log` / `.chat-message-own` / `.chat-message-other` 等**已无人使用**的样式（别动其它）；⑤ `DESIGN.md` 已在设计前置改完，本卡不改文档。
  - **不做**：不改输入行与表情行的布局、不改错误提示层、不引入新组件。
  - **独立验收（≤5 条）**：① 页面 DOM 里没有消息列表节点；② 面板总高比改动前**变小**，最底一行床仍能走到、点得到、床号可见（**可用视口变化后的相机复验**，手机视口 393×852）；③ 输入行/表情行/私聊目标行/床上动作行都仍工作；④ `npm test` + `typecheck` + `lint:design` 全绿；⑤ `grep -rn "CHAT_LOG_MAX\|chat-log\|ChatLine" src/` 只剩零命中或注释。
  - **CHANGELOG**：`### Changed` 一条。

- [ ] 卡 13：入场层选形象
  - **目标**：入场层多一个二选一（`boy` / `girl`），没选的人行为不变（按 `user_id` 派生）。
  - **改**：① `src/worker/session.ts`：`Session` 加 `appearance?: Appearance`（解析/序列化与 nickname 同形）；② `src/worker/app.ts`：新增 `POST /api/appearance`（校验取值在 `APPEARANCES` 内，非法 → `1004` 风格的可见错误？用现有码：非法值走 `4001`/新码 → **取最小方案：非法值直接忽略并回原会话**）、`/api/ws` 升级时把形象放进身份 header；③ `src/shared/http-api.ts`：`SessionView` 加 `appearance`；④ `src/hall/hall.ts` 的 `fetch`：读该 header，**缺失/非法时回落到 `appearanceFor(userId)`**；⑤ `src/client/api.ts` 加 `setAppearance`；⑥ `src/client/components/EntryOverlay.tsx`：加两个可点选项（用图集 `boy_stand` / `girl_stand` 预览，坐标走 `public/sprites/frames.css`——**卡 10 的产物**），选中态可见；⑦ 样式引用 tokens，不写内联/单行 className 堆叠。
  - **不做**：不做厅内改形象（与改名一致：只在入场层）；不改 `appearanceFor` 的哈希（它是回落，不是默认值来源）；不动协议（`appearance` 已在下行）。
  - **验收（≤5 条）**：① 单测：session 解析/写入、hall 对 header 缺失/非法的回落、`SessionView` 形状；② `ui-verifier`：入场层能选（手机视口）、选中后进厅、**另一个会话看到的是所选形象**；③ 不选（或没有该字段的老 cookie）→ 行为与今天一致；④ 非法值（手改请求）→ 不炸、回落到哈希；⑤ `npm test` + `typecheck` + `lint:design` 全绿。
  - **CHANGELOG**：`### Added` 一条。