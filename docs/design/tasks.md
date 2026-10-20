# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

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
