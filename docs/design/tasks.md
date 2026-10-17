# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

两张卡的关系：**卡 1 先退役旧明暗、把配色翻到明色调（中间态 = 明色调、无档位）**；**卡 2 再加三档**。两张都必须能单独提交、单独回滚，所以卡 1 不能留下「令牌已删、代码还在用」的中间态。

派活给 worker 的硬约束（每张卡都适用）：**一条命令一步**，不要管道 / 重定向 / `&&` / 多行内联脚本；工具不可用就如实写「未能验证」并退出，不要为了凑结论硬撑。

---

## 卡 1：明色调基底（令牌 + 资产 + 退役旧明暗）

**为什么单独一张**：一上就全站可见（含入场首屏），出问题只能整体回滚。

**已完成的前置**：`docs/ui/DESIGN.md`（配色全表、地面/轮廓梯次、「三档色调」）、`00-master-design.md` §5.4/§7、`config.md` §6、`build.md` §7、`backlog.md`、`AGENTS.md` 术语表已先改成明色调。

#### 改动面

- [ ] `npm run tokens` → `src/client/styles/tokens.css|json`（`primary-dim` 消失、新增 `outside`）
- [ ] `npm run art`：管线逻辑与 5 张母图、8 个 variant 名都不动；**`atlas.json` 的 bbox / 锚点 / face 应当不变**（若变了说明动了管线，停下报告）。`atlas.png` 与 `frames.css` 会变，产物入库
- [ ] `src/client/world/views.ts`：删 `COLORS.floorDim`；`outside` 取 `outside` 令牌；其余取色代码不动
- [ ] `src/client/world/world.ts`：删 `ambience` 字段、`applyAmbience()`、对 `COLORS.floorDim` 的引用；相机底色 `COLORS.outside`；`rebuildRegion()` 的地板只画一次
- [ ] `src/client/store.ts`：删 `drowsiness` 字段、`drowsinessOf` import、`setState()` 里的重算
- [ ] 删 `src/client/ambience.ts` 与 `src/client/tests/ambience.test.ts`（卡 2 新建 `tone.ts`）
- [ ] `src/client/styles/app.css`：`.world-layer` 背景改 `var(--color-outside)`；`.entry-overlay` 背景改 `var(--color-outside)`
- [ ] `CHANGELOG.md`：`### Changed` 一条（配色改为明色调；全厅困倦度驱动的明暗退场）

#### 验收（worker 自检，逐条写结果）

- [ ] `npm run typecheck` 与 `npm test` 全绿（`ambience.test.ts` 已删，不应有残留 import）
- [ ] `npm run lint:design` 0 error / 0 warning
- [ ] 本地起站（`npm run build` + `npm run dev`），DPR 3 截三张：**入场层** / **厅内** / **相机推到墙外边缘**。判读：入场满屏是台面色（比卡片暗）、卡片是界面面、厅外比地板暗、面板比地板亮一档、墙带在厅外底色上清楚
- [ ] 不做三档（那是卡 2）；此时"躺着/睡着"不改变任何亮度是**预期**

**回滚**：单卡 revert（令牌、产物、代码、CHANGELOG 同一提交）。

---

## 卡 2：三档减光（漫游 / 躺下 / 睡下）

#### 改动面

- [ ] `src/client/tone.ts`：`toneOf(state)` → `0`（`roaming`）/ `1`（`lying`）/ `2`（`asleep`）；`TONE_ALPHA = [0, 0.12, 0.22]`
- [ ] `src/client/components/ToneLayer.tsx`：`subscribe` 之后**先比档位再 `setState`**（位置节拍每 100ms 也会触发 `setState`，不能每次都重渲染）；渲染一个 `aria-hidden` 的全屏层
- [ ] `src/client/App.tsx`：**只在 `entered` 之后挂载**（入场层不参与档位）
- [ ] `app.css`：`.tone-layer` —— 绝对定位铺满、`background: #000`、`pointer-events: none`、`opacity` 过渡 **≈0.9s**、层级压过 HUD 的 `z-index: 1/2/3`
- [ ] **首帧/重连不缓动**：首次落档（快照到达那一刻）必须一步到位，不能出现"从最亮渐暗"。做法自选（例如首次应用时临时 `transition: none`，下一帧再启用过渡），但验收必须能看出它成立
- [ ] `src/client/tests/tone.test.ts`：三档映射；`lying` 不被当成 `roaming`；自己不会是 `trace`；位置节拍不翻档
- [ ] `CHANGELOG.md`：`### Changed` 一条（明暗由自己的显示态驱动三档）

#### 验收

- [ ] `npm run typecheck` 与 `npm test` 全绿
- [ ] 交 `ui-verifier`（手机视口，393×852 优先；本机拿不到时用 500×852 并如实写明）：三档各一张图（漫游 / 躺下 / 睡着）+ 过渡过程无跳变 + 进厅与重连**不**出现渐暗动画 + 最暗档下床号与聊天气泡仍读得清
- [ ] 人工核对最暗档的对比度口径：`neutral-muted` 衬地板 ≥4.5、三档墨衬地板与床填充 ≥3（文档给了算好的值，只核对是否按 `0.12`/`0.22` 落档）
