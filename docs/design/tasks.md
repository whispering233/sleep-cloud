# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

**本批三张卡的共同判据**：`immutable` 只给**内容寻址**的前缀（URL 不变 ⇒ 内容不变）。判据不是「改动频率低」——一天改十次的构建产物每次换哈希，照样该 immutable；一年改一次的固定名文件反而不许。执行顺序 1 → 2 → 3：卡 2、卡 3 只是把固定 URL 换成哈希 URL，**immutable 的收益要等卡 1 的头规则生效才拿到**。

**设计文档已由主会话改完**（`docs/design/build.md` §3、`docs/ui/DESIGN.md` 两处、`README.md`、`AGENTS.md`）：卡片只改代码、配置、`CHANGELOG.md` 与注释里的路径。**不要再改 `docs/`**；若发现文档与卡片对不上，停下并在回报里指出。

---

## 卡 1：`/assets/*` 缓存头改 immutable

**目标**：Vite 内容哈希产物（`index` / `phaser` / `world` / 游戏 chunk / CSS）不再每次往返校验。

**改动面**

- `public/_headers`：新增 `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`，注释写清判据（路径下全是内容哈希命名，由 Vite 保证）与边界（`/` 是版本指针，**故意不加**）
- `CHANGELOG.md` `[Unreleased]` → `### Changed` 一条（写用户可感知的行为：构建产物的重复访问不再校验；不写「卡」号）

**验收**

1. `npm run build` 通过，`dist/_headers` 里能看到 `/assets/*` 与 `immutable`
2. `npm run dev` 起站点后，`curl -I <端口>/assets/index-<hash>.js` → `cache-control: public, max-age=31536000, immutable`
3. 同一站点 `curl -I <端口>/` → 仍是 `public, max-age=0, must-revalidate`
4. `curl -I <端口>/sprites/atlas.png` → 仍是默认头（证明规则没过宽）

**上限**：1 次 build、3 个 curl；不做真机验证、不跑 ui-verifier

**禁止**：不给 `/`、`/admin*`、`/privacy.html`、`/sprites/*`、`/*` 加 immutable；不碰 `_headers` 现有两条规则；不改 `vite.config.ts`

---

## 卡 2：入场层形象坐标 CSS（`frames.css`）搬进构建

**目标**：`frames.css` 从固定 URL 变成构建产物（哈希名 → 由卡 1 规则覆盖）。

**改动面**

- `tools/art/build-sprites.mjs`：`frames.css` 的输出路径 `public/sprites/frames.css` → `src/client/styles/frames.css`（其它产物位置不动）；文件头注释、日志与产物清单同步
- **同一处必须同时改 CSS 里的图片地址**：生成规则里的 `background-image: url('./atlas.png')` → `url('/sprites/atlas.png')`。理由：相对路径是按 CSS 文件自己的位置解析的，而本卡还没搬图集（图集仍在 `public/sprites/`），`./atlas.png` 会指到 `/styles/atlas.png`（404）；`/` 开头的 URL 是 public 路径，Vite 原样保留。卡 3 会把这里再换成相对路径（那时图集才进构建）
- `src/client/index.html`：`<link rel="stylesheet" href="/sprites/frames.css" />` → `href="./styles/frames.css"`（**必须是相对路径**，Vite 才会处理并改写成哈希名）
- `src/client/styles/app.css`（约 1159 行）注释里的 `public/sprites/frames.css` → `src/client/styles/frames.css`
- 删除 `public/sprites/frames.css`（`git rm`）
- `CHANGELOG.md` `[Unreleased]` → `### Changed` 一条

**验收**

1. `npm run art` 后 `src/client/styles/frames.css` 生成、`public/sprites/frames.css` 不存在
2. `npm run build` 后 `dist/index.html` 的 stylesheet href 指向 `/assets/frames-<hash>.css`，该文件里含 `boy_stand` 的 `background-position`，且 `background-image` 是 `/sprites/atlas.png`（不是 `/styles/atlas.png`）
3. 入场层形象二选一预览与改前**像素级一致**（ui-verifier 1 张截图，393×852）

**上限**：2 张截图、1 次 `npm run art`

**禁止**：不改发射坐标算法、不改预览框尺寸与选中态、不把 `npm run art` 挂进 `npm run build`（产物仍入库）、不改 `public/_headers`

---

## 卡 3：图集（`atlas.png` + `atlas.json`）搬进构建

**目标**：图集 PNG 走内容寻址（卡 1 规则覆盖），JSON 内联进产物（Phaser 4 的 `load.atlas()` 第三参接受对象 → **不发 JSON 请求**）。

**前提（已验证）**：哈希由**内容**派生，与构建号 / 构建时间无关，所以「重新部署」不会改图集 URL；`npm run art` 的输出也是字节确定的（连跑两次 md5 一致）。真正会换 URL 的只有「母图或映射规则变了」，那种情况今天同样要重下 259 kB（URL 不变 → 条件请求 → 200），字节数完全等价。

**改动面**

- `tools/art/build-sprites.mjs`：`atlas.png` + `atlas.json` 输出到 `src/client/assets/sprites/`；**同一处把卡 2 的临时地址 `url('/sprites/atlas.png')` 改成 `url('../assets/sprites/atlas.png')`**（相对 `src/client/styles/frames.css` 指向图集，Vite 会把它改写成哈希 URL 并与 JS 那边去重成同一个文件）；文件头注释与日志同步；**两个 LICENSE 文件留在 `public/sprites/`**（`README.md` / `AGENTS.md` / `20-layout.md` 引用它们，不许改路径）
- `src/client/world/world.ts`（约 225 行）：`this.load.atlas(SPRITES_KEY, '/sprites/atlas.png', '/sprites/atlas.json')` 改为 `import` 两个资源后传值——PNG 用 `?url` 拿哈希 URL，JSON 直接传对象
- 注释里的旧路径同步：`src/client/world/views.ts`（约 25、91 行）、`src/client/components/EntryOverlay.tsx`（约 18 行）
- `CHANGELOG.md` `[Unreleased]` → `### Changed` 一条
- 删除旧 `public/sprites/atlas.png`、`public/sprites/atlas.json`，重跑 `npm run art`

**验收**

1. `npm run build` 后 `dist/assets/` 里存在 `atlas-<hash>.png`，`dist/sprites/` 下没有 `atlas.*`
2. `dist/assets/world-*.js` 里含图集的 `"frames"` 键（证明 JSON 是内联的，不是另发请求）；`dist/assets/frames-*.css` 里的 `background-image` 指向 `/assets/atlas-<hash>.png`
3. 贴图全部正常（ui-verifier 5 张截图：入场层形象、厅内床、小人、睡痕、猫与篝火）
4. 一次 Network 检查：图集只剩一条 PNG 请求，响应头是 `immutable`
5. 确定性：`npm run art` 连跑两次，`atlas.png` 的字节完全相同（哈希名不变）——**已实测成立**（`md5 5e456f1c82f163e012aa96f3291fc5a4`，两次运行 git 零差异）。若改动后这条不成立，说明输出被塞进了时间戳之类的非确定性内容，必须先修掉，否则每次重跑管线都会让全体用户重下 259 kB

**上限**：5 张截图、1 次 Network 检查、1 次 `npm run art`

**禁止**：不改坐标 / 颜色映射算法、不改图集内容、不把 `npm run art` 挂进 `npm run build`、不删或移动两个 LICENSE 文件、不改 `public/_headers`

---

## 本批不做（已决定）

- **游戏代码搬 `public/`**：游戏 chunk 已在 `/assets/` 下、由卡 1 自动覆盖；搬过去缓存收益为 0，唯一动机（不碰 TS 加游戏）今天没有需求方。**不记录、不排期**。
- `/audio/*`、`/fun/*` 搬进构建：两者已 immutable，搬过去缓存收益为 0，只换来「删掉人工 `vN` 纪律」——记进 `backlog.md`，等真的出现「改音频忘升版本号」或「需要线上换素材」时再做。
