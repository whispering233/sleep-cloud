# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 · 舞台位图跟可见像素一致，「窗」改成竖屏基准

设计：`110-games-page.md` §4（`dpr` 语义、外壳重挂）、§8（留背景的代价）。

| 文件 | 改什么 |
| :--- | :--- |
| `src/client/games/host.ts` | `ctxOf` 的 `dpr` 改成 `min(devicePixelRatio, MAX_DPR) × scale`，封顶 `2 × MAX_DPR`；`show()` 里对容器挂 `ResizeObserver`，`scale` 变了（相对上次差 >1%）就 `dispose` + `mount` 重挂**同一个条目**；`close()` 要断开观察器 |
| `src/client/games/registry.ts` | 「窗」的 `base` 改成 `{ w: 320, h: 640 }` |
| `src/client/games/skyline.ts` | 只改注释里那句「1:1 的 320 宽约放 7 栋楼」→ 按新基准描述；行为不变（楼与窗仍只在挂载时生成一次） |
| `src/client/games/types.ts` | `GameCtx.dpr` 的注释与文档逐字一致 |

**约束**：不给 `GameModule` 加 `resize` 钩子（重挂一次就够）；`resize` 重挂不得让页面滚回列表；`dispose` 之后不许再有任何 rAF 或 `ResizeObserver` 活着。

**验收**：真机/模拟器 393×772、DPR 3 下 `canvas.width === Math.round(320 × 3 × scale)`（约 1158，不再固定 960）；舞台上下不再出现大片背景（截图里「窗」铺满可用区）；转屏或改窗口尺寸后画面重画、`canvas` 仍只有一块、`rAF` 仍只有一个循环；三条基线全绿（`npm test` / `npm run typecheck` / `npm run lint:design`）。
