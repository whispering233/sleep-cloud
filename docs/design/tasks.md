# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1 · 整屏页可见性：`coversWorld` 单点判据 + 求签页冻结大厅画布

**为什么**：求签页复用 `.entry-overlay`（`position: absolute; inset: 0` + `background-color: var(--color-outside)`，**不透明满屏**），世界在底下连一个像素都看不见，但它不在 `App.tsx` 的 `covered` 公式里 → 2.7 Mpx 画布在整页底下照旧满帧重绘。实机（安卓 Via）的表现与说明面板那次同形：**关页慢**（关之前管线已经堵住，不是卸载慢）。
**根因**：规则被写成了「页面名枚举」（入场层 / 说明面板 / 游戏页），漏一页就静默退化。

### 规则（唯一权威：`60-interaction-shell.md` §5.2）
- 判据是**可见性**，不是页面身份：画面里看不见厅 → 不许出帧。
- 判据只有**一处**：纯函数 `coversWorld`（`src/client/covered.ts`）。其它文件不许再写一份枚举。
- 停法不变：`setWorldSuspended(true)` → `game.loop.sleep()`；恢复 `resetDelta()` → `wake()`（`docs/design/60-interaction-shell.md` §5.2 的「恢复必须重锚」）。

### 改动范围

| 文件 | 改什么 |
| :--- | :--- |
| `src/client/covered.ts`（**新增**） | `export interface WorldCover { hasSession: boolean; entered: boolean; aboutOpen: AboutSource \| null; gamesOpen: boolean; lotOpen: boolean }` + `export function coversWorld(cover: WorldCover): boolean` |
| `src/client/App.tsx` | 删掉内联表达式 `session !== null && (!entered \|\| aboutOpen !== null \|\| gamesOpen)`，改 `const covered = coversWorld({ hasSession: session !== null, entered, aboutOpen, gamesOpen, lotOpen });`。**`useEffect(() => setWorldSuspended(covered), [covered])` 与 `layoutVersion` 那几行不动** |
| `src/client/tests/covered.test.ts`（**新增**） | ①真值表 ②组件清单对账 |
| `CHANGELOG.md` | `## [Unreleased]` 下开 `### Fixed`，写一条：整屏页（含求签页）盖住世界时画布整帧停渲染；「世界要不要出帧」的判据收在 `coversWorld` 一处，不再枚举页面名。**不写任务卡语义** |

### 函数语义（逐字实现，不要自行发挥）
- `hasSession === false` → `false`（四页都还没画，屏上什么都没盖）
- `hasSession === true && entered === false` → `true`（入场层）
- `hasSession === true && entered === true` → 三个页面字段任一为真即 `true`；全假 → `false`
- `aboutOpen` 的判定是 `!== null`（`'auto'` / `'manual'` 都算开着）

### 验收

| # | 判据 | 怎么验 |
| :--- | :--- | :--- |
| A1 | `npm test` 全绿、`npm run typecheck` 干净 | 命令 |
| A2 | 真值表：`hasSession` × `entered` × {无页 / about / games / lot} 穷举，逐例对期望值 | `covered.test.ts` |
| A3 | 多页同开（about + games + lot 全开）仍为 `true` | `covered.test.ts` |
| A4 | 清单对账：扫 `src/client/components/*.tsx` 中 `includes('entry-overlay')` 的文件名，与字面清单 `['AboutOverlay.tsx', 'EntryOverlay.tsx', 'GamesOverlay.tsx', 'LotOverlay.tsx']` **集合相等**（双向：漏页红、清单多余项也红） | `covered.test.ts` |
| A5 | 对账是**正向**的：扫描结果不得为空集（防止扫描根写错导致永远绿） | `covered.test.ts` |
| A6 | 求签页开着时世界层真的停帧：`game.loop.running === false`；关页首帧 delta ≤ 一帧目标（模拟器 / 真机，非桌面仿真） | `ui-verifier`，**最多 6 条** |
| A7 | 回归：入场层、说明面板、游戏页三处开着时行为不变（各 1 条） | `ui-verifier`，并入 A6 的 6 条预算 |

**读文件的写法**：与 `src/client/tests/audio-assets.test.ts` / `type-texts.test.ts` 同一套——`join(process.cwd(), 'src/client/components')` + `node:fs`。`vitest.config.ts` 只收 `src/**/tests/**/*.test.ts`（**不收 `.tsx`**），仓库里也没有 jsdom / @testing-library，所以**不要**试图渲染组件做断言。

### 不做
- 不引入 `document.hidden` 的额外冻结（Phaser 自己 `Game.onHidden → loop.pause()`，浏览器对 hidden 文档本就不派 rAF；无实测证据）。
- 不抽共用的整屏页壳组件（A4 的注释里留一句「将来抽了就改成扫那个组件」即可）。
- 不动 store 字段、不动 `world-handle.ts`、不动世界层的 `suspended` 幂等守卫。
- 求签页不发 `act` 上行（`act` 只定义 `game` / `hall`，无需求方）。
