# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

设计依据：`docs/design/90-about-panel.md`（新建）、`docs/design/40-client-storage.md` §3 的 `sc.about.seen`、`docs/ui/DESIGN.md` 的 `about-panel` / `hud-menu`。

## 卡 1 — 内容模块与判定纯函数

- 新建 `src/client/about.ts`：`ANNOUNCE = { version, intro, sections }`（内容按 `90-about-panel.md` 草稿）+ 纯函数 `shouldShowAbout(seen)`；`ANNOUNCE_VERSION` 即 `ANNOUNCE.version`
- 新建 `src/client/tests/about.test.ts`：`shouldShowAbout` 四种输入（缺键 / 同版本 / 旧版本 / 坏值）+ `ANNOUNCE` 形状（`x.y.z`、`intro` 非空、每节 `title` 与 `items` 非空、每节 ≤ 6 条）
- 验收：`npm test`、`npm run typecheck`

## 卡 2 — 本地键 `sc.about.seen`

- `src/client/prefs.ts`：注册表加 `sc.about.seen`（值 `{ v: 1, seen }`，校验「非空字符串且 ≤ 32 字符」）+ `readAboutSeen()` / `writeAboutSeen(version)`；**不动 `PREFS_VERSION`**
- `src/client/tests/prefs.test.ts`：默认（缺键）/ 写后读回 / 坏值判废并删键 / 文档登记表镜像仍通过
- 验收：`npm test`、`npm run typecheck`

## 卡 3 — 说明面板组件与自动弹出

- 新建 `src/client/components/AboutOverlay.tsx`：卡片（标题 / `intro` / 各节列表 / 自动路径才有的勾选框 / 「知道了」），`Esc` 与按钮同路；关闭时按勾选状态 `writeAboutSeen`
- `src/client/store.ts`：`aboutOpen` + `openAbout()` / `closeAbout()`；`src/client/App.tsx`：挂载时按 `shouldShowAbout(readAboutSeen())` 打开，渲染顺序 `about → entry → hall`
- `src/client/styles/app.css`：复用 `.entry-overlay` 家族，只新增正文段落与小节列表的类
- 验收：`npm test`、`npm run typecheck`；UI 交 `ui-verifier`（≤ 8 条：自动弹出 / 勾选后不再弹 / 取消勾选仍弹 / 卡片内部可滚 / 勾选框与按钮 44px / `Esc` / 减光压住面板 / 关面板后入场层出现）

## 卡 4 — 齿轮菜单「关于失眠云」

- `src/client/components/ActionRow.tsx`：菜单组内第三颗胶囊「关于失眠云」（在天气之后），独立 `key` + `pointerdown` 拦默认，点它关浮层并 `openAbout()`
- 验收：`npm test`、`npm run typecheck`；UI 交 `ui-verifier`（≤ 5 条：打开面板 / 关闭后大厅仍在 / 面板无勾选框 / 与换床模式互不干扰 / `Esc` 关闭）

## 卡 5 — e2e 契约 spec

- 新建 `e2e/about.spec.ts`：① 干净存储首访弹面板、点「知道了」后入场层出现；② 重载不再弹；③ 取消勾选再关、重载仍弹；④ 齿轮「关于失眠云」能打开并关闭
- 验收：`npm run e2e`（先按 `docs/design/test.md` 起站点）
