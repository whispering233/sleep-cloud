# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是本次三张卡的规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

---

## 卡 A · 轻点画布收键盘与焦点

**依据**：`docs/ui/DESIGN.md`「软键盘」的 `轻点画布` 行（本卡刚新增的那一行）；根因是画布上 `touchstart` / `touchend` / `mousedown` 被 Phaser `preventDefault()`（`TouchManager.js` 只在 `event.target === canvas` 时吃，`MouseManager.preventDefaultDown` 默认 true），浏览器「点空白 = 焦点离开输入框」的默认动作不会发生。

**改动范围（只 1 个文件）**：`src/client/world/world.ts`

1. 文件内私有工具函数（放在轻点判据常量旁边）：
   ```ts
   /** 焦点还在可编辑元素上就收掉它：画布上的指针事件被 Phaser preventDefault，浏览器默认的「点别处 = 失焦」不会发生（见 `docs/ui/DESIGN.md` 的「软键盘 · 轻点画布」）。 */
   function blurFocusedEditable(): void {
     const active = document.activeElement;
     if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
     else if (active instanceof HTMLElement && active.isContentEditable) active.blur();
   }
   ```
2. `onPointerDown`：`this.pruneReleasedPointers();` 之后、`if (this.pointers.size >= 2) return;` **之前**加
   `if (!keyboardNow().open) blurFocusedEditable();`
   ——键盘没开时任何按下（含拖拽 / 捏合）都顺手收焦点：那时没有键盘基线，收焦点不会打回用户的拖拽。
3. `onPointerUp`：轻点判据那一段（`if (!pinched && tracked.moved < TAP_SLOP_PX && pointer.upTime - pointer.downTime < TAP_MS)`）改成
   ```ts
   // 键盘弹着时的轻点 = 只收键盘与焦点，那一下不发意图
   // （落点按收缩后的视口算，随即键盘收起、相机回基线——看着就是点歪了）
   if (keyboardNow().open) {
     blurFocusedEditable();
     return;
   }
   this.dispatchTap(pointer);
   ```
   （`keyboardNow` 这个文件已经 import 了，直接复用。）
4. **不要动** `keyboard.ts` / `keyboardNow()` 的语义，也不要动拖拽 / 捏合 / `rebaseKeyboard` 的分支。

**测试**：本卡无单测（世界层依赖 Phaser 与真实 DOM）。要求 `npm test`（472 passed 基线）与 `npm run typecheck` 全绿。

**验证（`ui-verifier`，手机视口 393×852 / DPR 3 / 合成 touch，逐条取证，每条最多 3 次尝试、总步骤 ≤ 16）**

| # | 操作 | 断言 |
| :--- | :--- | :--- |
| 1 | 聚焦聊天输入框 → 等键盘状态回到「未开」（键盘本来就不会真弹）→ 轻点画布空地 | `document.activeElement` **不再是**输入框；**且那一下照常走**（出现 `walk` 上行 / 小人开始移动） |
| 2 | 伪造 `visualViewport` 使 `keyboardNow().open === true`（配方照 `docs/design/build.md` §7 第 19 条：伪造 `height` 852 → 516 并派发 `resize`）→ 轻点画布空地 | **0 条上行**、小人不动；焦点被收 |
| 3 | 键盘「开着」（同上伪造）→ 在画布上拖拽（位移 > 8px） | **焦点不被收**（`document.activeElement` 仍是输入框） |
| 4 | 键盘「未开」→ 在画布上拖拽 | 相机平移正常；焦点被收（与第 3 条对照） |

真键盘那一半（iOS / Android 各一遍）只在真机上得结论，**不要**在本地硬凑；真机条目已写在 `docs/design/build.md` §7 第 25 条。

**提交**：`fix(world): 轻点画布收键盘与焦点（Phaser 吃了 preventDefault）`

---

## 卡 B · 点别人的床：三类本地提示（与错误码同文案）

**依据**：`docs/ui/DESIGN.md`「谁能躺」新增的两段（三类本地闸门 + 为什么本地判）、`docs/api/error-code.md` §3 的「客户端预判」行、`docs/ui/DESIGN.md` 的 `toast-recoverable` 行。

**现状（要修的回归）**：`rules.ts` 现在 `residentId !== undefined → { kind: 'none' }`（静默），而**别人有主但空着**的床落进 `notice` 却报的是「已经有一张床 · 换床在设置里」——「这张床有人了」「这是别人的床」两条反馈全没了。

**改动范围**

1. `src/client/world/rules.ts`
   - `TapInput` 加 `owned?: boolean`（这张床**有主**：`state.ownedBeds.has(bedNo)`。客户端不知道归属是否过期——这是接受的偏保守一侧，见文档）。
   - `TapTarget` 的 notice 改成带原因：`{ kind: 'notice'; reason: 'occupied' | 'other-owned' | 'has-bed' }`。
   - `tapTargetFor` 的床位分支按这个顺序（服务端优先级 3002 > 3003 > 本地闸门）：
     1. `residentId === selfId` → `{ kind: 'none' }`（对应静默 `3004`；也防止本地外推白走一趟）
     2. `residentId !== undefined` → `notice('occupied')`
     3. `ownedBedNo === bedNo` → `lie`
     4. `owned === true` → `notice('other-owned')`
     5. `ownedBedNo !== undefined && switching !== true` → `notice('has-bed')`
     6. 否则 → `lie`
   - 更新 `tapTargetFor` 上方的文档注释（三类本地闸门 + 服务端优先级）。
2. `src/client/world/world.ts` 的 `dispatchTap`
   - 传 `owned: bedNo !== undefined ? state.ownedBeds.has(bedNo) : undefined`（写进 `tapTargetFor({...})` 的那个对象）。
   - `case 'notice'` 按 `reason` 给文案：`occupied → errorTextFor('3002')`、`other-owned → errorTextFor('3003')`、`has-bed → '已经有一张床 · 换床在设置里'`。
   - **文案不许再抄第二份字面量**：`3002` / `3003` 走 `errorTextFor`（`src/client/error-text.ts`，已由 `docs/api/error-code.md` 镜像测试覆盖）。`errorTextFor` 返回 `undefined` 时**不提示**（直接 return），与其它静默类一致。
3. `src/client/world/tests/rules.test.ts`
   - 改「床上有人时什么都不做且绝不落成 walk」那条：点**别人占**的床 = `{ kind: 'notice', reason: 'occupied' }`；点**自己正躺着**的床仍是 `{ kind: 'none' }`（保留一条）。
   - 新增：别人有主空床 + 我还没床 → `{ kind: 'notice', reason: 'other-owned' }`；别人有主空床 + 我有别的床 → 仍是 `other-owned`（占用 / 归属优先于本地闸门）；无主空床 + 我有别的床 → `{ kind: 'notice', reason: 'has-bed' }`（原有断言只改 reason）。
   - 保持「绝不落成 `walk`」的断言。

**验证（`ui-verifier`，本地浏览器两个客户端，手机视口，逐条取证；每条最多 3 次尝试、总步骤 ≤ 18）**

| # | 操作 | 断言 |
| :--- | :--- | :--- |
| 1 | 客户端 X 认领并躺下床 k（床 k 有主 + 有占用）→ 客户端 Y（**没有床**）点床 k 的**床角**（不要落在小人身上） | toast「这张床有人了」；**Y 的 `lie` 上行 0 条**（小人不动、不出现外推） |
| 2 | 客户端 X 认领床 k 后**起身走到别处**（床 k 有主、空着）→ Y 点床 k | toast「这是别人的床」；Y 的 `lie` 上行 0 条 |
| 3 | Y 自己认领一张无主空床 j（有床）→ 点另一张**无主空床** | toast「已经有一张床 · 换床在设置里」（回归不破）；`lie` 上行 0 条 |
| 4 | Y 躺着时点自己那张床的床角 | **无 toast**、无上行 |
| 5 | Y 点床 k 上小人的身体 | 变成**选中**（头顶名字 / 私聊目标行），不是 toast（命中半径内的人优先） |

**提交**：`fix(world): 点别人的床给出与错误码同文案的提示`

---

## 卡 C · 缩放档位：自由缩放 / 全厅 / 0.5× / 0.75× / 1×

**依据**：`docs/ui/DESIGN.md` 的世界相机（`缩放` / `固定档的下限` / `拉远后的退役`）、`action-row`、新增的 `zoom-picker`、`chat-panel` 的门控行三者互斥；`docs/design/config.md` §3 的 `ZOOM_TIERS`、§6 的「缩放档位」。

**语义（别自己发挥）**：档位是**客户端本地状态、会话内、不持久化**；`固定档` = 比例锁死（捏合不改比例，但两指仍可平移）；`自由缩放` = 今天的行为（捏合 `[0.175, 1]`）；档位表最小一档 0.5 正好是文字退役阈值 → 固定档永远不会把文字画没。

**改动范围**

1. `src/shared/constants.ts`
   `export const ZOOM_TIERS = [ZOOM_MIN, 0.5, 0.75, 1] as const;` + 注释（最小一档 = `ZOOM_TEXT_MIN`、不进协议、值来自 `docs/design/config.md` §3）。
2. `src/client/world/rules.ts`（**这个文件不依赖 Phaser，界面层可以安全 import 它的值**——`hud-view.ts` 已经在 import 它的类型）：
   - `export type ZoomMode = { kind: 'free' } | { kind: 'fixed'; z: number };`
   - `const ZOOM_TIER_LABELS = ['全厅', '0.5×', '0.75×', '1×'] as const;`（**与 `ZOOM_TIERS` 同序同长**，靠单测兜住漂移）
   - `export function zoomModeLabel(mode: ZoomMode): string` → `free` = `'自由缩放'`；`fixed` = `ZOOM_TIER_LABELS[ZOOM_TIERS.indexOf(mode.z)]`，查不到回退 `${mode.z}×`。
   - `export function zoomOptions(): ZoomMode[]` → `[{ kind: 'free' }, ...ZOOM_TIERS.map((z) => ({ kind: 'fixed' as const, z }))]`。
   - `export function sameZoomMode(a: ZoomMode, b: ZoomMode): boolean`（`kind` 与 `z` 逐字段比较；React 订阅用它避免无谓重渲染）。
3. `src/client/store.ts`
   - `ClientState.overview: boolean` → `zoomMode: ZoomMode`（默认 `{ kind: 'free' }`）。
   - `setOverview(on)` → `setZoomMode(mode: ZoomMode)`：`sameZoomMode` 为真就不通知（同值不写）。
4. `src/client/hud-view.ts`：`overview: boolean` → `zoomMode: ZoomMode`；`sameHudView` 改成 `sameZoomMode(a.zoomMode, b.zoomMode)`。
5. `src/client/world-handle.ts`：`toggleOverview()` → `setZoomMode(mode: ZoomMode)`（`world?.setZoomMode(mode)`），注释同步。
6. `src/client/world/world.ts`
   - `WorldHandle.toggleOverview` → `setZoomMode(mode: ZoomMode)`。
   - `setZoomMode(mode)`：写 store（`setZoomMode` from store）+ `fixed` 时把比例应用上去（`this.setZoom(mode.z)`，它内部仍走 `clampZoom`）；`free` 时只解锁、比例保持当前值。
   - `setZoom(next)` **删掉**结尾那行 `setOverview(clamped <= ZOOM_MIN + OVERVIEW_EPS)` 与 `OVERVIEW_EPS` 常量（不再有「已在下限」这个 UI 状态）。
   - `updatePinch()`：`if (getState().zoomMode.kind === 'free') this.setZoom(pinch.zoom * (dist / pinch.dist));`——固定档下**不改比例**，但后面那段锚点补偿照旧（两指拖动 = 平移）。
   - 导入 `setOverview` 改成 `setZoomMode`；`import type { ZoomMode }` 从 `./rules`。
7. `src/client/components/ActionRow.tsx`
   - 门控行状态收成一个：`const [gate, setGate] = useState<'none' | 'jump' | 'switch' | 'zoom'>('none')`，替换 `jumpOpen`（换床模式仍由 `view.switching` 驱动，渲染时**优先级最高**：`view.switching` 为真就渲染换床提示，并且把 `gate` 归零（现有 `closeJump()` 的调用点同步成 `setGate('none')`）。
   - 缩放胶囊：位置就是原来「看全厅 / 回到 1×」那一格，`className="hud-action"`，`aria-label="画布缩放"`，`aria-expanded={gate === 'zoom'}`，文案 = `zoomModeLabel(view.zoomMode)`；点击 = `setGate(gate === 'zoom' ? 'none' : 'zoom')`（开关）。
   - **换床模式期间不渲染这个胶囊**（与 `GO` 一致）。
   - 选项行（`gate === 'zoom' && !view.switching`）：`<div className="gate-row zoom-row">` + `zoomOptions().map(...)` 五个 `<button type="button" className="hud-action zoom-option" aria-pressed={sameZoomMode(option, view.zoomMode)}>`，可见文字 = `zoomModeLabel(option)`；选中项在文字前加一个 `✓ `（可访问名不必再改，`aria-pressed` 已表达）。点一项 → `setZoomMode(option)`（**界面 → `world-handle`，不要直接写 store**）+ `setGate('none')`。
   - `Esc` 收起：现有那个 `menuOpen` 的 effect 里再判 `gate === 'zoom'` 时 `setGate('none')`（依赖数组带上 `gate`）。
   - `GO` 的 `jumpOpen` 全部换成 `gate === 'jump'`；`closeJump()` = `setGate('none')` + `setDraft('')`。
8. `src/client/styles/app.css`（只用既有令牌变量，**不写死色值**）
   - `.zoom-row { flex-wrap: wrap; }`（门控行同款，只多一个可换行：393 宽下五个约 301px，放得下就一行）。
   - `.zoom-option` 沿用 `.hud-action` 的外观（不需要新类也行，但选中态要有类）：选中态照 `docs/ui/DESIGN.md` 的既有规矩——**实心 + ✓**：参考 `.appearance-option-selected`（`color` / `border-color` 用 `var(--color-neutral)`，`box-shadow: inset 0 0 0 1px var(--color-neutral)` 凑 2px 墨线，不动 1px 边框；`::after` 放 `content: '✓'`，`pointer-events: none`）。实心底用 `var(--color-primary)`（与 `.appearance-option` 同源），**不许**新增令牌；改完跑 `npm run lint:design` 与 `npm run tokens`，两者都要 0 error。
9. 测试
   - `src/client/world/tests/rules.test.ts`：`zoomModeLabel(['free'|每一档])`、`zoomOptions()` 长度与顺序、`ZOOM_TIER_LABELS` 与 `ZOOM_TIERS` 同长（防漂移）、`sameZoomMode`。
   - `src/client/tests/hud.test.ts`：`overview: false` → `zoomMode: { kind: 'free' }`；两处 `sameHudView` 断言改成换成 `{ kind: 'fixed', z: 0.75 }` 后不再相等。
   - `src/shared/tests/constants.test.ts`：新增一条镜像断言——`ZOOM_TIERS` 等于 `docs/design/config.md` §3 的 `ZOOM_TIERS` 行（那一格是 `0.175 / 0.5 / 0.75 / 1`，用 `tableRows(...)` 自己按 `/` 拆并 `Number()`，不要用只认单值的 `docLimit`）。

**验证（`ui-verifier`，手机视口 393×852 / DPR 3，逐条取证；每条最多 3 次尝试、总步骤 ≤ 20）**

| # | 操作 | 断言 |
| :--- | :--- | :--- |
| 1 | 看动作行，点缩放胶囊 | 文案先是 `自由缩放`；点开出现 5 个选项：`自由缩放 / 全厅 / 0.5× / 0.75× / 1×`；**一行不溢出**（`scrollWidth <= clientWidth`）、每个按钮高 ≥ 44px、选中项有 ✓ 且与未选中一眼可辨 |
| 2 | 选 `0.75×` | 胶囊文案变 `0.75×`；选项行收起；世界比例 ≈ 0.75（用屏上像素量一个已知世界距离，或读 `camera.zoom / DPR`）；床号与气泡**仍在画** |
| 3 | 固定档下合成双指捏合（比例 1 → 0.6） | 比例不变（±0.005）；两指平移仍生效 |
| 4 | 选 `全厅` | 比例 ≈ 0.175；床号 / 名字 / 气泡全退（只剩贴图与两颗暖标记） |
| 5 | 回到 `自由缩放` | 捏合能改比例（拍照对比） |
| 6 | 齿轮 →「更换床位」进换床模式 | 缩放胶囊**不出现**、门控行是换床提示；退出模式后胶囊回来且档位文案不变 |
| 7 | `GO` 展开时点缩放胶囊 | `GO` 的输入行收起、缩放选项出现（互斥），反向亦然 |
| 8 | 选项行开着按 `Esc`（键盘） | 收起 |

真机项（低端机在 `0.5×` 档同屏约 40 床的帧率、真手指捏合）已写在 `docs/design/build.md` §7 第 26 / 27 条，别在本地硬凑。

**提交**：`feat(world): 缩放档位（自由缩放/全厅/0.5×/0.75×/1×）与动作行胶囊`
