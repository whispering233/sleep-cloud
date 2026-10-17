# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

当前中间态：配色已是明色调、旧的全厅困倦度明暗已退役，**尚无档位**（躺下/睡着不改亮度）。下一张卡补三档。

派活给 worker 的硬约束：**一条命令一步**，不要管道 / 重定向 / `&&` / 多行内联脚本；工具不可用就如实写「未能验证」并退出，不要为了凑结论硬撑。

---

## 卡：三档减光（漫游 / 躺下 / 睡下）

#### 改动面

- [ ] `src/client/tone.ts`：`toneOf(state)` → `0`（`roaming`）/ `1`（`lying`）/ `2`（`asleep`）；`TONE_ALPHA = [0, 0.12, 0.22]`
- [ ] `src/client/components/ToneLayer.tsx`：`subscribe` 之后**先比档位再 `setState`**（位置节拍每 100ms 也会触发 `setState`，不能每次都重渲染）；渲染一个 `aria-hidden` 的全屏层
- [ ] `src/client/App.tsx`：**只在 `entered` 之后挂载**（入场层不参与档位）
- [ ] `app.css`：`.tone-layer` —— 绝对定位铺满、`background: #000`、`pointer-events: none`、`opacity` 过渡 **≈0.9s**、层级压过 HUD 的 `z-index: 1/2/3`
- [ ] **首帧/重连不缓动**：首次落档（快照到达那一刻）必须一步到位，不能出现「从最亮渐暗」
- [ ] `src/client/tests/tone.test.ts`：三档映射；`lying` 不被当成 `roaming`；自己不会是 `trace`；位置节拍不翻档
- [ ] `CHANGELOG.md`：`### Changed` 一条（明暗由自己的显示态驱动三档）

#### 验收

- [ ] `npm run typecheck` 与 `npm test` 全绿
- [ ] 交 `ui-verifier`（手机视口；本机拿不到 393 宽时用 500×852 + DPR 3 并如实写明）：三档各一张图（漫游 / 躺下 / 睡着）+ 过渡过程无跳变 + 进厅与重连**不**出现渐暗动画 + 最暗档下床号与聊天气泡仍读得清
- [ ] 核对最暗档的对比度口径：`neutral-muted` 衬地板 ≥4.5、三档墨衬地板与床填充 ≥3（文档给了算好的值，只核对是否按 `0.12`/`0.22` 落档）
