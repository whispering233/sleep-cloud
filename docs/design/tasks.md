# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

## HUD 三段化（显示性信息 / 可点击 / 设置齿轮）

**设计已定稿**（去向：`../ui/DESIGN.md` 的 `hud` / `hud-numeric`、`hud-action` / `hud-settings`、`hud-menu` 三行；`00-master-design.md` §9 与「导航」行）。**协议零改动、服务端零改动。**

- [ ] **卡 1：HUD 派生视图加「空床」与「延迟」两个字段**
  - `src/client/hud-view.ts`：`HudView` 加 `emptyBeds?: number`（= `hall.bedCount − ownedBeds.size`；`hall` 未到时为 `undefined`）、`rttMs?: number`（读 `ClientState.rttMs`）；`sameHudView` 逐项补齐。
  - `src/client/store.ts`：`ClientState` 加 `rttMs?: number`（本卡只加字段，采样在卡 2）。
  - `src/client/tests/hud.test.ts`：改现有 `toEqual` 断言的期望值（新字段会多出来）；新增「空床 = bedCount − ownedBeds.size」「没有任何归属时等于 bedCount」「hall 未到时 undefined」「rttMs 变化会换视图对象」。
  - 验收：`npm test` 与 `npm run typecheck` 全绿。

- [ ] **卡 2：延迟采样（chat / emote 回投）**
  - 新增 `src/client/latency.ts`（**纯函数**，不碰 DOM / WebSocket）：记「刚发出的是哪一类意图、什么时候发的」，命中「自己那条回投」时给出 RTT；同一类意图只留最新一次待配对样本。
  - `src/client/ws.ts`：`sendChat` / `sendEmote` 成功发送后登记样本；下行 `chat` 且 `message.id === me.id`、`emote` 且 `message.id === me.id` 时算 RTT 写 `setState({ rttMs })`；收到 `snapshot` 或 socket 关闭时清样本。
  - 新增 `src/client/tests/latency.test.ts`：命中与未命中、样本被后一次覆盖、旧样本不产生 RTT、`snapshot` 清理后不再产生样本。
  - 注意：**不加任何 ping 消息、不加持久定时器**（`docs/api/20-api-ws.md` §1）。
  - 验收：`npm test` 与 `npm run typecheck` 全绿。

- [ ] **卡 3：HUD 三段布局 + 按钮外观 + `GO` 文案**
  - `src/client/components/Hud.tsx`：拆成显示组（`在线 n` / `空床 n` / `延迟 ms`，缺值不占位、延迟无样本显示 `—`）、可点击组（`床号 n ↑` + `GO`）、齿轮占位（卡 4 填内容）。删掉 `⇢`。
  - `src/client/styles/app.css`：`.hud` 三段（组间 12px > 组内 8px、不画分隔线）、显示组 `flex-wrap`、可点击组与齿轮钉最右垂直居中；按钮改描边胶囊（1px `claimed`、`radius-full`、44px、底透明）；`focus-visible` 名单同步。
  - 硬约束：显示组与按钮**只能靠外观区分**；HUD 通栏仍是 `pointer-events: none`，只有按钮自己收回来。
  - 验收：`npm test`、`npm run typecheck`；`ui-verifier` 在 **393×852 手机视口**（DPR 3）逐条核对（见卡 5）。

- [ ] **卡 4：齿轮 + 版本号浮层**
  - `vite.config.ts`：构建期把 `package.json` 的 `version` 注入为 `__APP_VERSION__`（读文件，不改协议）；新增 `src/client/globals.d.ts` 声明它。
  - `src/client/components/Hud.tsx`：齿轮按钮（内联 SVG、`currentColor` 描边、20×20、44×44、`aria-label="设置"`、`aria-expanded`）+ 浮层（一行 `v{版本}`）+ 透明遮罩；收起路径 = 遮罩 / `Esc` / 再点齿轮。**遮罩必须吃掉那一下点击**（否则会同时触发世界走路）。
  - `src/client/styles/app.css`：`.hud-settings`、`.hud-menu`（锚在齿轮下方右对齐）、`.hud-scrim`。
  - 验收：`npm run build` 通过且浮层显示 `v0.0.3`（与 `package.json` 一致）；`ui-verifier` 手机视口复核（见卡 5）。

- [ ] **卡 5：手机视口验收（`ui-verifier`，只报不修）**
  - 393×852 / DPR 3 本地站点：三段顺序与分组间距、按钮外观与 44px 触摸目标、`GO` 展开输入行、显示组折行时不遮住最右齿轮、齿轮浮层开合三条路径、点遮罩不会让小人走路。
  - 一次不超过 10 条检查项；工具不可用就如实写「未能验证」。
