# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
>
> **卡 0（文档先行）已完成**：上面这些文档已按新设计改写完毕（单厅 / 无缩放 / 床位自动伸缩 / 取消昼夜 / Phaser 4 / 睡痕 TTL）。
> **已知预期**：文档已先行，代码未跟上，`npm test` 现有 7 条镜像测试会红（`error-code`、`protocol`、`schema`、`error-text`、`hall-registry` 各文件比对文档）。它们随卡 1~4 各自收口，**不要在卡 1 里顺手修**。

> **卡 1 的验收结果（已复验）**：世界层替换成立（Phaser 真正在跑、命中与 DPR 换算正确、无缩放三条路径都成立）；两条阻断已在「卡 1 修轮」修掉：① 认领非自己的空床会撞「一人一床」唯一索引（旧服务端就有的 bug）→ 新增错误码 `3007` + 客户端可见提示；② 走动每格一次单帧瞬移（服务端只在格号变化时发 `pos`，间隔 200~300ms，而客户端按固定 100ms 滞后插值）→ 滞后改成按最近两批的实际间隔自适应。

---

## [ ] 卡 5：HUD 精简 + 入场层删大区

**目标**：用户侧只剩「床号 + 在线人数」；入场只剩「昵称 + 18 岁自述」。

**改动范围**：`src/client/components/{Hud,EntryOverlay}.tsx`、`src/client/hud-view.ts`（删昼夜与厅名）、`src/client/world/rules.ts`（删 `isDaytime`）、`docs` 与 `CHANGELOG` 相应条目

**验收**：`ui-verifier` 手机视口（入场只剩两项、HUD 只有床号与在线、无昼夜文案）；`npm test` 全绿

**依赖**：卡 3（协议字段）

---

## [ ] 卡 6：明暗氛围（困倦度 → 地板底色）

**目标**：`困倦度 = (睡着 + 睡痕) / (在线 + 睡痕)` 驱动地板底色在 `primary` ⇄ `primary-dim` 之间缓动（约 1.5 秒），只在数值签名变化时重算，空厅兜底最亮档。

**改动范围**：世界层（地板对象 1 个）+ `src/client/store.ts`（困倦度派生，别在 100ms 位置节拍里重算）

**验收**：`ui-verifier` 手机视口——多人睡着时地板变暗、有人醒来时变亮、**床与小人的颜色不变**、无「切换感」

**依赖**：卡 4

---

## [ ] 卡 7：收尾

**目标**：把设计变更落实到 `CHANGELOG.md`（按卡补条目，不写任务卡语义）、复核 `README` / `docs` 与代码一致、确认无 PixiJS 残留、把实测项结论回填 `backlog.md`。

**验收**：`npm run build`、`npm test`、`npm run typecheck`、`npm run lint:design` 全绿；全仓 `grep -r pixi` 无命中（除 `CHANGELOG` 历史条目）

**依赖**：卡 1~6
