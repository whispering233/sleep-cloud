# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

## 卡 2 — 入场层标题右侧显示版本号

### 背景

入场层是「进不去厅」时唯一看得见的界面；版本号现在只在齿轮浮层里（要进了厅才看得见），排查「进不去」时反而拿不到。

### 目标行为

标题「失眠云」同一行、右侧、基线对齐一个 `v{APP_VERSION}`（复用 `src/client/version.ts`，构建期注入，不新增请求），`caption` 档 12px、`neutral-muted`、纯文字**不可选**。

### 改动

- `src/client/components/EntryOverlay.tsx`：标题包一层 `.entry-head`（`div`），标题后加 `<span className="entry-version">v{APP_VERSION}</span>`。
- `src/client/styles/app.css`：`.entry-head`（flex、`align-items: baseline`、`gap: var(--spacing-xs)`）+ `.entry-version`（`--text-caption`、`--color-neutral-muted`、`white-space: nowrap`）。
- 设计文档已改：`docs/ui/DESIGN.md` 的 `entry-overlay` 行。
- `CHANGELOG.md` 加一条 `### Added`。

### 不做

不加点击行为、不做 `user-select` 特例、不新起一行、不动齿轮浮层里那条。

### 验收

- `npm test` / `npm run typecheck` 全绿。
- `ui-verifier`（宿主 Android 模拟器，393×852 竖屏）：版本号在标题右侧同一行、不换行、不溢出卡片；文案与齿轮浮层里那条一致；中文小字在暗底可读。条目上限 5 条。

## 卡 3 — e2e 守卫：一次发送只产生一条 `chat` 上行

### 背景

「一次发送出现两条相同上行帧」在桌面复现不出来（`__frames` 打点实测点「发送」与按回车各 1 条）。要先把现状锁死，再在模拟器上用真 IME 复验。

### 改动

- `e2e/shell.spec.ts`：新增一条用例，复用文件里已有的 `__frames` 打点与 `enterHall()`：点「发送」后断言 `t === 'chat'` 的上行**恰好 1 条**、文本一致；再按回车发第二条，同样恰好 1 条（累积计数 +1 而不是 +2）。
- 不动任何 `src/` 下的代码。

### 验收

- `npm run e2e` 全绿（需先 `npm run dev` 起站点，端口读 `.wrangler/dev-port`）。
- 模拟器上用 Gboard 回车键手工发一条，确认只出现一条上行（若出现 2 条，本卡扩成 bug 修复并在 `CHANGELOG.md` 记录）。

## 卡 4 — 别人（含漫游者）的昵称常显

### 背景

昵称本来就随 `snapshot.people` / `join` 到客户端，每个 `PersonView` 也常驻一个名字 Text；但渲染谓词把漫游者挡掉了，于是「只有点了才看得到别人叫什么」。

### 目标行为

`shouldDrawName` 只保留「不是我」这一条：床上的人、站着的人、走动的人**一律常显**名字，样式与床上那条相同；被选中时改成气泡样式（不额外叠第二个）；自己一律不画；`Z < ZOOM_TEXT_MIN` 时世界文字整体退役（不变）。

### 改动

- `src/client/world/rules.ts`：`shouldDrawName` 去掉 `person.state !== 'roaming' &&`。
- `src/client/world/tests/rules.test.ts`：`walker` 的断言从 `false` 改为 `true`（`sleeper` / 自己两条不变）。
- 设计文档已改：`docs/ui/DESIGN.md` 的名字表与禁令项、`docs/design/00-master-design.md` 的「名字显示」行、`docs/api/20-api-ws.md` 的渲染顺序说明、`docs/design/backlog.md` 新增「私聊的可发现性」。
- `CHANGELOG.md` 加一条 `### Changed`。

### 不做

不做弱化样式（不新增第二档名字样式）、不改槽位优先级（聊天 > 选中名字）、不改协议。

### 验收

- `npm test` / `npm run typecheck` 全绿。
- `ui-verifier`（宿主 Android 模拟器）：走动中的别人名字可见；选中后换成气泡描边样式且只有一个；`Z` 拉到 `全厅` 时名字退役；自己脚下与床上都不画名字。条目上限 6 条；观感（是否太吵）只记录，不改代码。
