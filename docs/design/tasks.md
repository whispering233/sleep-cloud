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
