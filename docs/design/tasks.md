# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。
> 设计前置已随文档提交（`config.md` §3 的 `MAX_DPR`、`ui/DESIGN.md` 基准设备表 /「世界相机」/「不要」清单、`build.md` §7 A9 与 B5、`backlog.md` 的帧率条目）。**代码未跟上期间 `npm test` 的红是预期的**（`constants.test.ts` 的 `MAX_DPR` 镜像断言），由卡 18 收口。

- [ ] 卡 17：世界里的文字按画布 DPR 栅格化（治「气泡文字发虚」）
  - **为什么**：文字走的是「每个 `Text` 自带的离屏 2D canvas 贴图 → 相机 `zoom = 画布 DPR` 放大」这条路，默认栅格密度是 1×，于是高密度屏上字被放大采样 → 糊；气泡底 / 墙 / 床勾勒是几何顶点绘制，所以同一画面里边框清楚、里面的字糊。真机（iPhone / 安卓 DPR 3）已复现。
  - **改（客户端，一处文件）**：`src/client/world/views.ts`
    1. 顶部加 `const TEXT_RESOLUTION = Math.min(window.devicePixelRatio || 1, MAX_DPR);`（`MAX_DPR` 从 `../../shared/constants` 引进来，`ART_SCALE` 那一行旁边）；
    2. 把 `resolution: TEXT_RESOLUTION` 加进 **4 个样式对象**：`BUBBLE_STYLE`（气泡文字与表情都吃它，`CHAT_TEXT_STYLE` 由它展开、自动继承）、床号的内联样式、`bubbleName` 的内联样式、`name` 的内联样式。**不新增任何调用**（`TextStyle` 的构造期 setter 认 `resolution`，Phaser 只在 `resolution === 0` 时才强制改成 1）。
    3. 加一行 `shortcut:` 注释：dpr 在运行中变化（跨显示器拖窗）不重设，刷新即可；移动端 dpr 恒定。
  - **不改**：字号（仍是 `LABEL_PX = 12`）、气泡几何与量测（`Text.width/height` 仍是世界像素，渲染器按 `frame.source.resolution` 还原显示尺寸）、不引入外部字体、不引位图字体、不加缩放、不动相机。
  - **不做**：不做「按可视对象动态调整文字密度」的开关（没有需求方）；不把文字改成 DOM 叠加（违反硬纪律 16/17）。
  - **测试**：本卡无可单测逻辑（一个常量 + 四处样式），`npm test` / `npm run typecheck` 保持全绿；清晰度只能靠浏览器像素取证。
  - **验收（≤5 条）**：① `npm test` + `npm run typecheck` 全绿；② 手机视口 393×852 / DPR 3 下 `canvas.width === 393 × 3`（画布与设备像素 1:1）；③ 气泡文字、床号、名字的截图裁剪与底部面板的 DOM 文字**清晰度同级**（交 `ui-verifier`）；④ 控制台无报错、无失败请求；⑤ `CHANGELOG.md` 的 `[Unreleased]` 加一条 `### Fixed`：世界里的文字按画布 DPR 栅格化。

- [ ] 卡 18：画布 DPR 上限 2 → 3（与基准设备 1:1）
  - **为什么**：`MAX_DPR = 2` 在基准设备（iPhone 16 / DPR 3）上让整块画布只有 CSS×2 个像素，浏览器再放大 1.5× 铺满屏幕——线稿、文字一起发虚；卡 17 只治画布**内**的栅格密度，治不了这一层。
  - **改**：
    1. `src/shared/constants.ts`：`MAX_DPR = 3`，注释改成「基准设备 DPR 3，与设备像素 1:1；代价是填充率 ×2.25（相对 2），真机帧率见 `build.md` §7 B5」；
    2. `src/client/world/world.ts`：两处注释里写死的「画布按 DPR ≤2 放大」（类头注释）与「DPR 上限 2」（`createWorld`）改成 3；
    3. `CHANGELOG.md` 的 `[Unreleased]` 加 `### Changed`：画布设备像素比上限 2 → 3。
  - **不做**：不做「按画布总像素数自适应封顶」（没有需求方，先按固定档位）；不动相机、夹取、跟随、几何。
  - **测试**：`constants.test.ts` 的 `expect(MAX_DPR).toBe(docLimit('MAX_DPR'))` 就是镜像断言，文档已改成 3 —— 本卡落地后它自动转绿（`npm test` 全绿即证明代码与文档一致）。
  - **验收（≤5 条）**：① `npm test` + `npm run typecheck` 全绿（含 `MAX_DPR` 镜像断言）；② `grep -rn "上限 2\|DPR ≤2" src/ docs/` 零命中；③ 手机视口 393×852 / DPR 3 下 `canvas.width === 393 × 3`，拖拽平移与轻点命中不回归（交 `ui-verifier`）；④ 控制台无报错；⑤ `CHANGELOG.md` 条目。
  - **风险**：填充率 ×2.25（相对上限 2）。真机帧率判据与补救顺序写在 `build.md` §7 B5，条目挂在 `backlog.md` 的「Phaser 世界层帧率（真机）」。
