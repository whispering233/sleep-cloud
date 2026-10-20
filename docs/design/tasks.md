# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`70-privacy-risk.md`（风控与隐私的唯一来源）、`../api/30-api-admin.md`、`../db/schema.md` §4、`../../AGENTS.md`（硬纪律 38–39）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- **worker 不改 `docs/`**：设计已先落文档。只补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。
- 验收：`npm run typecheck` + `npm test` 必须全绿；改到界面壳层的卡另跑 `npm run e2e`（见 `test.md` §1 的 L2）。
- **不要新增接口、不要新开 RPC 方法**：封禁判定只有 `entryStatus(来源)` 一处实现，`/api/me` 与 `hello` 共用。

---

## 卡 3：后台登录（`/admin` + `/api/admin/login`）

**目标**：能用 `ADMIN_TOKEN` 进后台；未授权一律 401。

**改动面**

| 文件 | 做什么 |
| :--- | :--- |
| `public/admin.html` | 壳：一个令牌输入框 + 登录按钮 + 一块空的结果区。**不加载前台 React、不连 WebSocket**；样式内联一小段即可（后台不套前台令牌） |
| `src/worker/admin.ts`（新） | `POST /api/admin/login`（常量时间比较 + 同 IP 每分钟 5 次，超限 429）、`POST /api/admin/logout`（清 cookie）、中间件（验签 `sc_admin` + 核对 `fp` 与当前 `ADMIN_TOKEN` 的 `SHA-256` 前 8 hex + 24 小时有效期） |
| `src/worker/app.ts` | 挂上 `/api/admin/*` 子路由 |
| `src/worker/env.ts` | 加 `ADMIN_TOKEN`；缺省时后台接口一律 401（**不要**回落到某个默认值） |
| `.dev.vars.example` | 加 `ADMIN_TOKEN` 占位 |
| `src/shared/constants.ts` | `ADMIN_SESSION_MS` / `ADMIN_LOGIN_MAX_PER_MIN` |

**验收**

- 单测：无 cookie → 401；错 token → 401；对 token → 200 且下发 `sc_admin`；换 `ADMIN_TOKEN` 后旧 cookie → 401（`fp` 不匹配）。
- 单测：登录 6 次/分钟 → 第 6 次 429。
- 手验：`/admin.html` 输入令牌能进、刷新还在（cookie 未过期）。

---

## 卡 4：后台台账 + 封禁/解封 + 踢连接 + 审计

**目标**：能在后台看见人、封人、解封，且动作留痕。

**改动面**

| 文件 | 做什么 |
| :--- | :--- |
| `src/hall/hall.ts` | 增加一条**内部**分支（内部头 `x-sleep-admin` 才进）：`GET identities` / `GET identities/:id` / `GET blocks` / `POST blocks` / `DELETE blocks/:kind/:value` / `GET audit`，全部按 `../api/30-api-admin.md` §5 的字段返回 |
| `src/hall/hall.ts` | 封禁后**遍历连接并关闭命中的**（`close(1008, 'blocked')`），返回 `affected: {identities, online}` |
| `src/worker/admin.ts` | 把 `/api/admin/*` 转发给厅对象（同 `/api/ws` 的范式），并把 401 中间件放在前面 |
| `public/admin.html` | 三个区：台账（含按 IP 反查、`在线` / `bedNo` 列）、黑名单、审计。**封禁前的确认里必须显示 `affected.identities`**（封 IP 时让操作者看见自己在封一片人） |

**验收**

- 单测：`POST /blocks` 写入 `block` + 一条 `admin_audit`；`created` 在覆盖时为 `false`。
- 单测：`untilAt` 填过去时间 → 400；`kind` 非法 → 400；`reason` 空 → 400。
- 单测：解封一个不存在的值 → 200 且 `removed:false`。
- 单测：封禁命中在线连接时该连接被关闭（用测试 ws 桩）。
- 手验：本机开两个浏览器，A 登录后台封 B 的 IP，B 立刻断开且看到常驻提示。

---

## 卡 5：密钥环（消掉「轮换 = 全员丢床」）

**目标**：签名用 `SESSION_SECRET`，验签先试它、失败再试 `SESSION_SECRET_PREV`。

**改动面**：`src/worker/session.ts`（`readCookieSession` 的验签循环）、`src/worker/env.ts`、`config.md` 已写好的口径对应的常量、`.dev.vars.example`。

**验收**：单测三例——只有当前密钥能验签 / 只有 `_PREV` 能验签（并**重签成新密钥**）/ 两把都不行（`1001` 且换新会话）。`npm test` 全绿。

**注意**：重签必须发生在「验签通过之后」，否则轮换期里每个人的响应都带旧签名，密钥环就永远不会收敛。

---

## 卡 6：每日唤醒挂三个清理

**目标**：来源 90 天清空、到期封禁 +30 天删除、审计 1 年删除，全部并入既有每日唤醒。

**改动面**：`src/hall/risk.ts`（三个清理函数）、`src/hall/hall.ts` 每日唤醒那一支（按顺序调用，**不新增唤醒**）、`src/shared/constants.ts`（`IDENTITY_FORGET_MS` / `BLOCK_PURGE_MS` / `AUDIT_TTL_MS`）。

**验收**：单测三例（边界各一条：89 天不清、91 天清；`until_at` 为空永不删；审计 364 / 366 天）。`npm test` 全绿。

**注意**：清理**不能**删 `identity` 行，只能把三个来源列置空。`block` 与 `identity` 无外键，别顺手加级联。

---

## 卡 7：隐私说明（静态页 + 两处入口）

**目标**：告知可见。

**改动面**

| 文件 | 做什么 |
| :--- | :--- |
| `public/privacy.html` | 六条口径照抄 `70-privacy-risk.md` §8.2，第 6 条照抄 §8.3 的成稿文字（**不要改写**） |
| `src/client/components/EntryOverlay.tsx` | 18 岁自述那一行补一行 12px 灰字入口 |
| 齿轮浮层（`Hud.tsx` 或所在组件） | 加一条同名入口 |

**验收**：手机视口（393×852）下入场层不新增第四个区块、文字不换行溢出；两处入口都能打开静态页。`npm run e2e` 全绿。

**注意**：`privacy.html` 是纯静态文件，**不加接口、不加路由**；`npm run build` 后确认它在 `dist/` 内。

---

## 卡片顺序

```text
卡 3 ──► 卡 4
卡 5（独立）
卡 6（独立）
卡 7（独立，只依赖文案）
```

> **部署顺序**：卡 2 之前不要在生产库手写 `block` 行 —— 那时客户端还不看 `close` 的 `reason`，被封的人会静默无限重连（硬纪律 39）。
