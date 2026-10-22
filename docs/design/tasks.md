# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

## 卡 1：游戏条目改「文件夹注册 + 构建期扫描」

**目标**：游戏代码搬出 `src`，条目由构建期扫描产生（`140-games-page.md` §3、§4.1）。

**改动面**

- 新增 `games/skyline/meta.ts`（`{ title, blurb, base }`）与 `games/skyline/index.ts`（现 `src/client/games/skyline.ts` **原样搬**，只改 type import 路径）；删掉 `src/client/games/skyline.ts`
- `src/client/games/registry.ts`：手写表 → 两条 `import.meta.glob`（`*/meta.ts` eager、`*/index.ts` lazy），`id` 取文件夹名，`load` 包成 `() => import(...)`
- `tsconfig.client.json` 的 `include` 加 `"games"`
- 新增 `src/client/tests/games-registry.test.ts`：①每个 `games/<id>/` 都有 `meta.ts` + `index.ts`，`meta` 三字段齐、`base` 是正整数；②`games/**` 除同目录相对 import 外零项目 import（扫文件文本即可，不要引打包器）
- `CHANGELOG.md` [Unreleased] 一条

**验收**

1. **先验扫描可行性**：`npm run build` 通过 —— `import.meta.glob('../../../games/*/…')` 跨出 vite `root: 'src/client'` 是否成立。**不成立就停下来报告，不自行改目录结构**
2. `npm run typecheck`、`npm test` 通过
3. 产物里 skyline 仍是独立 chunk（首屏不含它）
4. `npm run dev:web` 打开游戏页：列表显示「窗」，点进去画面正常

**禁止**：不动返回栈、不动具体页 chrome、不动 `host.ts` 的缩放逻辑、不给游戏开任何项目 import

## 卡 2：游戏页返回栈（列表 / 具体页两层）+ 具体页零 chrome

**目标**：`140-games-page.md` §2 的返回栈与零 chrome 落地。

**改动面**

- 新增 `src/client/nav.ts`（通用分层：`pushLevel` / `back` / `onPop` / 加载时 `replaceState` 归位 / `depth`）
- `src/client/components/GamesOverlay.tsx`：`playing` → `level: 'list' | 'game'`；`popstate` 驱动；`Esc` 与列表页「返回」都调 `back()`；**具体页不渲染任何胶囊**；进具体页把焦点给舞台容器（`tabindex="-1"`），返回列表时还给刚点的条目
- `src/client/components/GamesOverlay.tsx` 停住分支：强制关页时先 `history.go(-depth)` 再归位
- `src/client/store.ts`：`openGames` 压 `list`；页内不再直调 `closeGames()`
- `src/client/styles/app.css`：列表页胶囊文案改「返回」、类名不动；`[data-playing]` 下不显示它
- 新增 `src/client/tests/games-nav.test.ts`：`levelOf(state)` 表驱动 + 一条配对不变量
- `CHANGELOG.md` [Unreleased] 一条

**验收（ui-verifier，Android 模拟器）**

1. 列表点条目 → 按一次 `adb shell input keyevent 4` → 回列表；再按一次 → 回大厅。**两次都不退出站点**（URL 不变、连接不断）
2. 具体页截图：画面上**没有任何按钮**（尤其左上角）
3. 桌面：`Esc` 同序；刷新回大厅
4. 封禁 / 被顶替强制关页后按返回键 → 落在大厅，不落空列表

**上限**：两个条目、四次返回；不转屏、不做长时间浸泡

**禁止**：不改 `host.ts`、不改游戏契约、不给说明面板 / 求签 / 反馈接返回栈（写进 `backlog.md` 的那条）
