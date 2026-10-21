# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1 · 文档：整屏页期间停渲染

权威文档：`60-interaction-shell.md` §5.2 / I12 / §8 / §9 / §10、`90-about-panel.md` §5、`CHANGELOG.md` `[Unreleased] → Fixed`。

- [x] `60-interaction-shell.md`：§5 拆成 5.1（冻结像素尺寸）与 5.2（整屏页期间停渲染：触发式 `!entered || aboutOpen !== null`、`loop.sleep()`、`resetDelta()` → `wake()` 的理由、幂等、模块级记住的原因、代价）
- [x] `60-interaction-shell.md`：§6 加 I12；§8 加两条拒绝方案（`game.pause()`、降 DPR）；§9 加「恢复瞬间对齐当下」；§10 加 L1 判据 7 与模拟器的三条量化判据
- [x] `90-about-panel.md` §5：`position: fixed` → 与代码一致（`absolute`，锚在 `.app-shell`）
- [x] `CHANGELOG.md`：`[Unreleased] → ### Fixed` 一条

**验证**：`npm run lint:design` 仍是 0 error / 0 warning；两张文档之间没有新增的悬空交叉引用。

## 卡 2 · 代码：世界层在整屏页期间 `sleep`

- `src/client/world-handle.ts`：新增 `setWorldSuspended(next: boolean)`；模块级记住最后一次请求，`setWorldHandle()` 注册时套上当前值（世界层懒加载，App 的 effect 可能先跑）
- `src/client/world/world.ts`：`WorldHandle` 加 `setSuspended(next: boolean)`；`suspended` 布尔守卫，翻转才 `loop.sleep()` / `loop.resetDelta(); loop.wake()`
- `src/client/App.tsx`：`const covered = !entered || aboutOpen !== null` → 一个 effect 调 `setWorldSuspended(covered)`
- `src/client/tests/world-handle.test.ts`：新测两条（晚注册仍拿到暂停态、同一状态重复调用不重复翻转）

**验证**：
- `npm test`、`npm run typecheck` 全绿（L1 判据 7 由新测覆盖）
- L3 模拟器（SwiftShader，`emulator-5556`，配方与 CDP 脚本见 `test.md` §2 与本机 `C:\Users\17677\tmp\`）：① 说明页开着时 `readPixels` 两次逐字节相同；② 覆盖期间不出现 ≥1.8 s 的 rAF 停顿（改前基线 6 次里 5 次出现）；③ 关掉后 `?debug=1` 的 `regressPx` 仍为 0、画面不跳一屏
- L4 真机 Via：点「知道了」立即回大厅（由用户复测）
