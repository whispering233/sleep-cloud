# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

**顺序：A → B → C → D。** A 会改 `.chat-panel` 的结构，B 的键盘逻辑必须吃最终结构；反序要改两遍。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。

---

## 卡 A · 底部控制台重排（HUD 只留显示性信息）

依据：`../ui/DESIGN.md` 的 `chat-panel` / `action-row` / `hud` / `hud-action` / `hud-menu` / `bed-switch-mode` 行；`../../AGENTS.md` 硬纪律 26。

范围：`src/client/components/Hud.tsx`（拆成顶部显示条 + 动作行）、`ChatPanel.tsx`（按新顺序挂载）、`src/client/styles/app.css`、`docs/ui/DESIGN.md`（面板高度数字按实测改回）。

**不动**：`src/client/hud-view.ts`（视图仍是一份来源，两个组件都用它）、`world.ts` / `WorldCanvas.tsx`（底边 inset 仍按 `.chat-panel` 量，世界层零改动）。

- [ ] HUD 只剩显示组（在线 / 空床 / 延迟），左对齐、单行，`padding-block` 由 `spacing.sm` 降到 `spacing.xs`
- [ ] 动作行是 `.chat-panel` 的一个子元素：紧贴输入行上方，左 = 床号 / `GO` / 看全厅，右 = 齿轮（中间 `auto` 拉开）；原有门槛照旧（没床不显示床号、换床模式里不显示 `GO`）
- [ ] 门控行（`GO` 的床号输入 / 换床提示）落在动作行与输入行之间，两者互斥
- [ ] 面板子元素顺序按 DESIGN.md：conn-banner → 私聊目标行 → 床上动作行 → 弱提示 → 动作行 → 门控行 → 输入行
- [ ] 齿轮浮层改为**向上**展开（定位基准 = 齿轮那一格），遮罩层级 1 < 浮层 2 < 齿轮 3 仍成立，`tone-layer` 的 4 仍在最上
- [ ] 胶囊描边 `claimed` → `trace`（面板 `secondary` 底上 2.74:1 → 3.72:1）
- [ ] 门控行不再用 HUD 的负外边距与自绘底色（它现在在面板里）
- [ ] 面板 `aria-label` 改为「聊天与操作」；容器类名改成 `.action-row`（`.hud-action` / `.hud-settings-button` 这两个外观族名字可留）
- [ ] `npm test`、`npm run typecheck` 绿
- [ ] ui-verifier（393×852 / DPR 3 手机视口，截图 ≤6 张）：HUD 单行、动作行不换行且两端对齐、齿轮浮层不出屏、描边在面板底上看得见

## 卡 B · 软键盘：视口与相机按 `visualViewport` 走

依据：`../ui/DESIGN.md`「世界相机 · 软键盘」+ Layout 里那条键盘规则；`../../AGENTS.md` 硬纪律 32；`../design/build.md` §7 第 19 条。

范围：`src/client/world/rules.ts`（两个新纯函数 + 单测）、`src/client/world/world.ts`（视口高度来源、冻结夹取与 follow、基线保存/还原）、面板抬升的那一层（`ChatPanel.tsx` 或 `app.css`）、`src/client/world/tests/rules.test.ts`、`build.md` §7 第 19 条补「本地已验的那一半」。

- [ ] 新纯函数 `anchorScroll(...)`：给「旧视口顶 / 新视口顶 / 当前滚屏」返回补偿后的滚屏（**不改取景中心**）。单测：变矮 / 变高 / 同一高度（幂等）
- [ ] 新纯函数 `revealShift(...)`：给「自己 / 新旧可用视口」返回 0 或「刚好露出」的最小位移。单测：在可见区内 → 0；被底部吃掉 → 只推到边界；被顶部吃掉 → 只推回边界
- [ ] 视口高度与面板位置同吃 `visualViewport`（`height` + `offsetTop`）；键盘收起后滚屏**写回基线**
- [ ] 键盘期间：夹取不跑、`follow` 不跑；用户拖拽 / 捏合后把当前滚屏写回基线
- [ ] 键盘动画逐帧触发时不累积误差（每帧都由「基线 + 当前值」重算，不累加增量）
- [ ] `npm test`、`npm run typecheck` 绿
- [ ] 如实写明本地验到了哪一半（纯函数 + 面板抬升的样式路径；真键盘、iOS pan 只能真机）

## 卡 C · 入场层形象选中态

依据：`../ui/DESIGN.md` 的 `entry-overlay` 行。

范围：`src/client/components/EntryOverlay.tsx`、`src/client/styles/app.css`。

- [ ] 选中项：**2px `neutral` 描边 + 右上角 ✓ 角标**（伪元素或绝对定位，44px 触击区不被裁）
- [ ] 未选中：1px `claimed` 描边
- [ ] 两个预览统一预览框（同宽同高、`background-size` 标定、居中）——`girl_stand` 97px 与 `boy_stand` 67px 在同一个尺子里
- [ ] `aria-pressed` 保持；`focus-visible` 轮廓仍看得见（2px 描边不吃掉它）
- [ ] ui-verifier（393×852 / DPR 3，两张截图，各选一次）：一眼看得出选了哪一个

## 卡 D · 表情行：切换键钉右 + emoji 去描边

依据：`../ui/DESIGN.md` 的 `emote-panel` 行。

范围：`src/client/components/ChatPanel.tsx`、`src/client/styles/app.css`、`src/client/emotes.ts`（上限注释）、`src/client/tests/emotes.test.ts`（若断言了类名则同步）。

- [ ] 展开态 `[emoji×5][…][😀]`：emoji 从左边起排，切换键用 `margin-inline-start: auto` 钉右（= 收起态发送键的位置）
- [ ] emoji 项类名 `.emote-item`：无描边、无底色，触击区仍 44×44
- [ ] 切换键类名 `.emote-toggle`：沿用描边胶囊（`.hud-action` 同规格）+ `aria-expanded`
- [ ] `EMOTE_SHORTCUTS` 加注释写死「最多 5 项」的上限理由（第 6 个就会顶到切换键）
- [ ] `npm test`、`npm run typecheck` 绿
- [ ] ui-verifier（393×852，收起 / 展开两张截图）：切换键位置一致、一眼分得清按钮与 emoji

---

下一批候选见 `backlog.md`；真机验收清单在 `build.md` §7（含本地怎么跑真 DPR 3、以及「本机 headless 无触摸面」这条环境限制）。
