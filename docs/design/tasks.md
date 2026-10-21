# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

---

## 卡 A：缩放搬进齿轮浮层，档位改由 HUD 常显

**范围**
- `src/client/zoom.ts`：新增 `zoomShortLabel(mode)`（`自由` / `全厅` / `0.5×` / `0.75×` / `1×`，档位文案与 `ZOOM_TIERS` 同源；未知比例回 `${z}×`）。
- `src/client/components/ActionRow.tsx`：删缩放胶囊与 `gate === 'zoom'`（`gate` 收窄为 `'none' | 'jump'`）、删对应 `Esc` effect、删门控行里的 `zoom-row`；齿轮浮层加 `menuView: 'root' | 'zoom'`——root 里「更换床位」之下加一项「缩放 · `zoomShortLabel`」进入二级；二级 = 五个档位（竖排、每项 44px、实心 + `✓` 表选中）+ 一行「返回」；**点一档 `setZoomMode()` 立即生效但不关浮层**；浮层关闭时把 `menuView` 重置回 `root`。
- `src/client/components/Hud.tsx`：`hud-info` 加第 4 段 `缩放 {zoomShortLabel(view.zoomMode)}`（数值 / 档位名用 `.hud-numeric` 同款）。
- `src/client/styles/app.css`：删 `.zoom-row`；补二级视图样式（沿用 `hud-menu-action` 的尺寸节奏，不新增一套间距）。
- 单测：`src/client/tests/zoom.test.ts` 补 `zoomShortLabel` 五个档位 + 未知比例的镜像断言；`src/client/tests/hud.test.ts` 的 `hudViewOf` 整体比对若因新字段变化同步修。

**验收**
1. 动作行不再有缩放胶囊，门控行只剩两个占用者（`GO` 输入 / 换床提示）。
2. 齿轮浮层 root 六项；点「缩放 · 自由」进二级、点 `0.5×` 相机当场锁到 0.5× 且浮层不关、点「返回」回 root、关掉重开回 root。
3. HUD 单行四段，自由档写 `缩放 自由`，固定档写 `缩放 0.5×`。
4. `npm test` / `npm run typecheck` / `npm run lint:design` 全绿。

## 卡 B：动作行重排（床号方胶囊 + 三颗占位入口）

**范围**
- `src/client/components/ActionRow.tsx`：床号胶囊改 44×44 方胶囊（`.hud-action.hud-bed`，`padding: 0`，内容 = 13px 数字 + 12px 方位字形，不写「床号」二字，`aria-label="床号 14"`；已在床上时仍然零上行）；`.hud-settings` 组里在 `hud-read` **之前**插三颗 44×44 内联 SVG 按钮（睡不着留言板 / 求签 / 游戏，描边 `strokeWidth 1.8`、`currentColor`、各自独立 `key` + `onPointerDown` preventDefault + `aria-label` 中文全名），点击只 `showNotice('睡不着留言板 · 还没做')`（三颗各自文案）；非空闲态整组仍是「收起」胶囊。
- `src/client/styles/app.css`：`.action-row` 加 `flex-wrap: wrap; row-gap: 8px`；`@media (max-width: 360px)` 只把 `gap` 收到 4（**删掉** `.hud-action` 的 padding 收紧）；`≤320px` 折行时 `.hud-settings` `margin-inline-start: auto` 右对齐；新增 `.hud-action.hud-bed`。

**验收**
1. 393 宽一行排完（实测总宽 ≈ 360.9 / 可用 367），床号两位数 / 四位数都不溢出。
2. 三颗新图标 44×44、有 `aria-label`、点了只出提示条、**无任何上行**（DevTools WS 帧里没有新消息）。
3. ≤360 不折行；≤320 折成两行且右端图标组右对齐。
4. `npm test` / `npm run typecheck` / `npm run lint:design` 全绿。

## 卡 C：`ui-verifier` 验界面（模拟器）

**范围**：宿主 Windows 的 Android 模拟器（真 Chrome + 真 IME + 触摸分发），站点由 `npm run build && npm run dev` 起、端口读 `.wrangler/dev-port`。

**验收条目（一批 ≤ 8 条）**
1. 393×852 竖屏：动作行一行、无横向滚动；床号两位数与 `GO` 之间距离同设计。
2. `GO` 展开床号输入后动作行不换位；换床模式提示行出现时 `GO` 消失、五颗图标照旧，且提示行与 `GO` 输入互斥。
3. 点三颗新图标各一次 → 提示条出现并自行消失，气泡 / 小人 / 相机都不变。
4. 齿轮 →「缩放 · 自由」→ 二级五点竖排、当前档带 `✓`；点 `0.75×` 相机当场变化且浮层仍在；「返回」回 root。
5. HUD 四段单行：自由档 / 固定档两种文案都对。
6. 打字态：右端整组变「收起」胶囊、点它回底部；左端床号 / `GO` 仍在。
7. 降级路径：控制台执行删掉三个 popover 方法后重进，齿轮浮层仍能开 / `Esc` 关 / 进二级。
8. 截图证据各一张（393 空闲 / 393 二级浮层 / 打字态）。

**边界**：任一条验证不了就如实写「未能验证」，不许凑结论；截图自己留，主会话只要结论 + 失败项描述。