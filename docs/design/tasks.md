# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
> 设计前置已随文档提交（`config.md` §3 的 `MAX_DPR`、`ui/DESIGN.md` 基准设备表 /「世界相机」/「不要」清单、`build.md` §7 A9 与 B5、`backlog.md` 的帧率条目）。**代码未跟上期间 `npm test` 的红是预期的**（`constants.test.ts` 的 `MAX_DPR` 镜像断言），由卡 18 收口。

- [ ] 卡 18：画布 DPR 上限 2 → 3（与基准设备 1:1）
  - **为什么**：`MAX_DPR = 2` 在基准设备（iPhone 16 / DPR 3）上让整块画布只有 CSS×2 个像素，浏览器再放大 1.5× 铺满屏幕——线稿、文字一起发虚；卡 17 只治画布**内**的栅格密度（已验证：DPR 3 下画布 `width = clientWidth × 2`、文字已按 2× 栅格化，画面仍被放 1.5×），治不了这一层。
  - **改**：
    1. `src/shared/constants.ts`：`MAX_DPR = 3`，注释改成「基准设备 DPR 3，与设备像素 1:1；代价是填充率 ×2.25（相对 2），真机帧率见 `build.md` §7 B5」；
    2. `src/client/world/world.ts`：两处注释里写死的「画布按 DPR ≤2 放大」（类头注释）与「DPR 上限 2」（`createWorld`）改成 3；
    3. `CHANGELOG.md` 的 `[Unreleased]` 加 `### Changed`：画布设备像素比上限 2 → 3。
  - **不做**：不做「按画布总像素数自适应封顶」（没有需求方，先按固定档位）；不动相机、夹取、跟随、几何。
  - **测试**：`constants.test.ts` 的 `expect(MAX_DPR).toBe(docLimit('MAX_DPR'))` 就是镜像断言，文档已改成 3 —— 本卡落地后它自动转绿（`npm test` 全绿即证明代码与文档一致）。
  - **验收（≤5 条）**：① `npm test` + `npm run typecheck` 全绿（含 `MAX_DPR` 镜像断言）；② `grep -rn "上限 2\|DPR ≤2" src/ docs/` 零命中；③ **真 DPR 3** 会话下（`BETTERWRIGHT_CHROMIUM_ARGS="--force-device-scale-factor=3 --window-size=500,939" betterwright run --session … --no-ad-block`；**不要**调 `setViewportSize`——它会把 dpr 打回 1；本机 Chromium 最小窗宽 500，所以拿不到 393 宽）`devicePixelRatio === 3` 且 `canvas.width === canvas.clientWidth × 3`（1500 设备像素）；④ 气泡文字与底部面板的 DOM 文字**清晰度同级**（画布侧允许轻微差别），拖拽平移与轻点命中不回归，控制台无报错、无失败请求；⑤ `CHANGELOG.md` 条目。
  - **风险**：填充率 ×2.25（相对上限 2）。真机帧率判据与补救顺序写在 `build.md` §7 B5，条目挂在 `backlog.md` 的「Phaser 世界层帧率（真机）」。
  - **已知本机限制（写进验证报告，不要为了凑结论拔高）**：betterwright 的 proof PNG 一律 1 输出像素/CSS 像素（产物编码器写死 `scale:"css"`），所以**设备像素级的图像证据在本机拿不到**；清晰度的最终判据是真机（`build.md` §7 A9：气泡字与面板字同屏对比）。
