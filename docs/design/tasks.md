# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
> 设计前置已随文档提交（master §6 动作集合与导航、`10-hall-runtime` §5.1、`api/20-api-ws` §3 与 §4.7、`ui/DESIGN` 的 HUD 行、`error-code` 的 3001 行）。

- [ ] 卡 16：一跳（`hop`）——HUD 输入床号，跳到**任意床脚**
  - **为什么**：厅自动扩容之后「从厅一头走到另一头」不可接受（第 1 级厅宽 10.7s、末档 93s）。卡片 6 只解决了「回我自己那张床」，本卡把它泛化成「跳到任意指定床号」，**并为它做入口**。这些都已写进 `10-hall-runtime.md` §5.1 与 `ui/DESIGN.md` 的 HUD 行。
  - **改（协议）**：`src/shared/protocol.ts`：`goHome: Record<string, never>` → **`hop: { bedNo?: number }`**；`UPSTREAM_TYPES` 里 `'goHome'` → `'hop'`（**位置不变**，仍在 `walk` 之后，顺序与文档表一致）；`src/shared/tests/protocol.test.ts` 的字面列表同步。
  - **改（服务端）**：`hall.ts` 的 `case 'goHome'` → `case 'hop'`：
    - `bedNo = message.bedNo === undefined ? 我名下未过期归属的床号 : Number(message.bedNo)`；
    - **越界（非整数 / < 0 / ≥ `bedCount`）→ 静默 return**；`frontPointOf` 给不出几何 → 静默 return；**不带床号而我无归属 → 静默 return**；
    - **带床号时不看归属与占用**（跳到别人床脚站着是合法的）；
    - 其余完全沿用：在床上先 `standUp` → `stopWalking` → `retarget(…, undefined)` → `writeConnection` → **一条** `sendPositions`。
  - **改（客户端）**：
    1. `ws.ts`：`sendGoHome()` → `sendHop(bedNo?: number)`（不带就不带字段）；
    2. `world-handle.ts` + `world.ts`：新增 `focusBed(bedNo)`（对准 `frontPointOf(bedNo)`，走现成的 `centerOnUsable`）；`focusMyBed()` 保留；
    3. `Hud.tsx`：床号那条改为 `sendHop()` + `focusMyBed()`；新增「⇢」按钮 → **HUD 下沿展开一行输入**（`inputMode="numeric"`、`enterKeyHint="go"`、高 44px、字号 ≥16px；回车或确定提交、Esc 或取消收起；提交后收起）；
    4. **新增纯函数** `src/client/bed-jump.ts`：`parseJumpTarget(raw: string, bedCount: number): { bedNo: number } | { error: string }` —— 输入是**显示床号（1 起）**，校验 `1 ≤ n ≤ bedCount`，**返回内部值 `n − 1`**；非法给可见文案（如「床号要在 1~N 之间」）。`Hud.tsx` 用它；非法时**用现有 Toast 给可见反馈且不发送**（可点击界面不能静默失败）；
    5. `app.css`：加 `.hud-jump` / `.hud-jump-row` / `.hud-jump-input`（引用 tokens，别写内联样式）。
  - **不做**：不加冷却（瞬移没有归属副作用，5 条/秒上行限流够）；不做「跳到某个人」；不做「点床号牌跳过去」（可点性不可见，且与「点床 = 躺下」撞语义）；不改 `lie` / `walk` 的语义；不新增错误码。
  - **测试**：
    - `protocol.test.ts` 的上行列表（`goHome` → `hop`）；
    - **Hall 级**（照 `src/hall/tests/bed-switch.test.ts` 的 FakeSocket 形态）：① `hop` 不带床号（我有归属）→ 落点 = 我自己床脚前；② `hop { bedNo: 别人的床 }` → 落到**那张**床脚前（不看归属/占用）；③ `hop { bedNo: bedCount }`（越界）→ **一条 pos 都没有**、位置不变；④ 在床上发 `hop { bedNo }` → 先 `state(roaming)` 再 `pos`；
    - **纯函数** `bed-jump.test.ts`：`'0'` / `'1'` / `bedCount` / `bedCount + 1` / `'abc'` / `''` / 带空格 / 内部值换算（`'1'` → `bedNo 0`）。
  - **验收（≤5 条）**：① `npm test` + `npm run typecheck` + `npm run lint:design` 全绿；② Hall 级 4 类 + 纯函数 8 类逐条有断言；③ `grep -rn "goHome" src/ docs/` **零命中**；④ **浏览器复验交主会话**（见下）；⑤ `CHANGELOG.md`：把 Unreleased 里那条 `goHome` 的措辞改成 `hop`，并在同一条里补上「可输入床号跳到任意床脚」。
  - **主会话浏览器复验（我会做）**：手机视口下点「⇢」→ 输入 `13` → 回车：小人**一步**到 13 号床脚前、相机同时对准；输入 `0` / `99999` / `abc` → 出现可见提示且**人不动**；躺在床上输入 → 先起身再跳；直接点 HUD 那条床号 → 仍是「回我的床」；输入框是数字键盘、字号 ≥16px、展开时可用视口变化后相机仍正确夹取。