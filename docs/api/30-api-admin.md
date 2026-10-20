# 接口设计：后台管理

> 风控语义（封禁的维度、时长、提示口径、留存）见 `../design/70-privacy-risk.md`；本文只管**接口形态与字段**。

## 1. 形态与隔离

| 项 | 决定 | 理由 |
| :--- | :--- | :--- |
| 部署形态 | **同一个 Worker 的子路由**：页面壳 `/admin`（静态文件 `public/admin.html`，随 `public/` 进 `dist`。平台资产默认会把 `/admin.html` 307 到 `/admin`，所以**权威 URL 写 `/admin`**；`npm run dev:web`（Vite）**没有** `html_handling`，那里要用 `/admin.html`，否则会落进 SPA 回退、打开大厅首页），数据接口 `/api/admin/*` | 不需要第二个部署、第二个域名、跨域 cookie。页面壳**不含任何数据**，被公开下载无害（等同任何登录页） |
| 鉴权 | 一个平台密钥 `ADMIN_TOKEN` → 登录接口换一枚**独立的**签名 cookie `sc_admin` | 与 `sc_session` 名字、用途、值域**全部不共享**：一个用户的普通会话 cookie 永远不等于后台权限 |
| 未授权 | **HTTP 401**（不是 `{code:"…"}`） | 错误码表是**用户面**契约（`error-code.md` §1：`msg` 面向开发者、文案由前端按 `code` 映射）。运维面混进 `5xxx` 会让那一段的意义变糊。**这是本项目唯一的契约例外，只限 `/api/admin/*`** |
| 成功响应 | 直接返回数据对象（**不套** `{code,msg,data}`） | 同上，同一处例外 |
| 视觉 | **不套前台视觉令牌**（`../ui/DESIGN.md` 不适用于后台） | 后台是运维面，不是产品面。改用前台令牌会把 `DESIGN.md` 的 lint 绑定到一个不面向用户的页面 |
| 操作者 | 首版恒为 `admin`（单令牌，没有账号表） | 只有一个人用。出现第二个操作者时才需要账号与角色（见 `../design/backlog.md`） |

**为什么不做「独立域名 + 独立 Worker」**：隔离部署面有真实价值，但代价是第二次部署、第二个 secret、跨对象访问。而现在页面壳本来就无数据，隔离买到的只是「后台 URL 不被发现」——那不是安全边界。

## 2. 鉴权

### 2.1 登录

```text
POST /api/admin/login   { "token": "<ADMIN_TOKEN>" }
→ 200  Set-Cookie: sc_admin=…（HttpOnly / SameSite=Strict / Secure / 24 小时）
→ 401  token 不对
→ 429  同一 IP 一分钟内超过 5 次尝试
```

| 细节 | 决定 |
| :--- | :--- |
| 比较方式 | **常量时间比较**（长度先比，再逐字节异或累加），不走 `===` |
| cookie 内容 | 签名 cookie，载荷只有两项：`fp` = `SHA-256(ADMIN_TOKEN)` 的前 8 个十六进制字符、`iat` = 签发时刻。**token 本身不进客户端** |
| 为什么带 `fp` | 换 `ADMIN_TOKEN` 时旧 cookie 立刻失效——否则「撤权」只能等 24 小时过期 |
| 会话时长 | 24 小时（过期重新登录一次，成本可忽略） |
| 登出 | **无状态**：接口只清浏览器侧的 cookie（`Max-Age=0`）。重放旧 cookie 值在 24 小时内仍能过中间件——与 `sc_session` 同一性质。**真正的撤权手段是换 `ADMIN_TOKEN`**（`fp` 不匹配，所有旧 cookie 立刻失效） |
| 登录限速 | **同一 IP 每分钟 5 次**，超限 429。计数放内存（Worker 是无状态的多实例，这个计数只防在线爆破，不追求精确）；**不牵 `backlog.md` 里的按 IP 限流** |
| IP 来源 | 与风控同一条读取路径（平台头）。**取不到 IP 时按「不限速」处理并记一条日志**：本地开发没有这个头，硬拦会让本地无法登录 |

### 2.2 中间件

`/api/admin/*` 除 `login` 外全部先过一道中间件：读 `sc_admin` → 验签 → 核对 `fp` 与当前 `ADMIN_TOKEN` 一致 → 核对未过期。**任一不满足 → 401，不返回任何数据**。

## 3. 接口清单

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| POST | `/api/admin/login` | 换 `sc_admin` |
| POST | `/api/admin/logout` | 清 `sc_admin`（HttpOnly，前端删不掉，所以需要接口） |
| GET | `/api/admin/me` | 只回 `{ ok: true }`：验中间件，也是页面壳判断「刷新后还登着吗」的唯一依据（**不含任何业务数据**） |
| GET | `/api/admin/identities` | 访客台账（分页；可按 IP 精确反查） |
| GET | `/api/admin/identities/:userId` | 单个身份详情 |
| GET | `/api/admin/blocks` | 黑名单（分页） |
| POST | `/api/admin/blocks` | 封禁（新增或改判） |
| DELETE | `/api/admin/blocks/:kind/:value` | 解封 |
| GET | `/api/admin/audit` | 审计（分页） |
| GET | `/api/admin/reports` | 举报明细（分页，只读） |
| GET | `/api/admin/reports/targets` | 举报**按被举报人折叠**（次数多者在前，只读） |

**没有的接口**：删除用户数据、改昵称/形象、禁言、素材上传。这些没有需求方，最后一项也没有管线（见 `../design/backlog.md`）。

## 4. 分页

**只有真正会长大的列表才分页**：`identities`（跟着历史身份数增长）、`audit`（跟着运维动作增长）与 `reports`（跟着举报数增长）。`blocks` 不分页——它是人工动作的产物，几十行量级，与用户规模无关（见 `../db/schema.md` §9）。

| 列表 | 请求 | 响应 | 排序键 |
| :--- | :--- | :--- | :--- |
| `identities` | `?limit=50&before=<ts>&beforeId=<userId>` | `{ items, next: { before, beforeId } \| null }` | `last_seen_at DESC, user_id DESC`（**复合游标**：只按时刻会漏掉同一毫秒的那些行）。**两个参数必须成对给**，只给一半 → 400 |
| `audit` | `?limit=50&before=<id>` | `{ items, next: { before } \| null }` | 自增主键 `id DESC` |
| `reports` | `?limit=50&before=<id>` | `{ items, next: { before } \| null }` | 自增主键 `id DESC` |
| `blocks` | — | `{ items }` | `created_at DESC`（数据库层排好，不再分页） |

`limit` 默认 50、上限 100。**不用 offset**：`before` 分页在「边看边有人进出」时不会翻出重复行，也不依赖行数。`next: null` = 没有下一页。

## 5. 接口详情

### 5.1 `GET /api/admin/identities`

查询参数：`limit` / `before` + `beforeId`（复合游标）/ `ip`（精确匹配 `last_ip`，用于「这条网络还有谁」）/ `name`（昵称**子串**匹配，`%` `_` `\` 已转义）。

**三者与游标可以同时给**：按 IP 或昵称反查时也要能翻页。

| 字段 | 是否必选 | 数据类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `userId` | 是 | string | 身份（L1） |
| `nickname` | 否 | string | 最近一次入场的昵称；`null` = 已过 90 天留存期，或该身份从未写过 |
| `firstSeenAt` / `lastSeenAt` | 是 | number | epoch 毫秒 |
| `lastIp` | 否 | string | `null` = 已过 90 天留存期被清空 |
| `lastCountry` | 否 | string | ISO-3166-1 α2；`"T1"` = TOR |
| `uaHash` | 否 | string | 16 个十六进制字符 |
| `bedNo` | 否 | number | **显示床号**（内部值 +1）；`null` = 当前无床 |
| `online` | 是 | boolean | 此刻是否有活着的连接 |
| `block` | 否 | object | 命中封禁时给 `{ kind, untilAt, reason }`，否则 `null` |

`bedNo` 与 `online` 需要逐行查一次床 + 一次连接集合：**一页 50 行 = 1 次列表查询 + 50 次床单行读 + 50~100 次封禁主键命中**（每行先判 `user` 维，有 `lastIp` 时再判 `ip` 维），`online` 只读内存、不发 SQL。**这个成本是刻意的**——「这人现在有没有床、在不在、是不是被我封过」正是台账最要判读的三件事，为省这一百来次读去多点三次反而更差。

### 5.2 `GET /api/admin/identities/:userId`

在 5.1 的字段之外，多两项：

| 字段 | 说明 |
| :--- | :--- |
| `ipHistory` | 与该身份**同一个 `last_ip` 的其他身份**（最多 20 条，只给 `userId` / `lastSeenAt` / `block`）。这是「清 cookie 换身份」唯一的可见线索 |
| `audit` | 针对该身份的封禁/解封记录（最多 20 条） |

`userId` 不存在 → **404**（不返回空对象：后台要能区分「查错了」与「没有这个人」）。

### 5.3 `POST /api/admin/blocks`

```json
{ "kind": "user" | "ip", "value": "u_…" | "1.2.3.4", "untilAt": 1730000000000 | null, "reason": "刷屏" }
```

| 字段 | 是否必选 | 说明 |
| :--- | :--- | :--- |
| `kind` | 是 | `user` 或 `ip`，其他值 → 400 |
| `value` | 是 | 对应的 userId / IP 字面量，去空白后 1~255 字符。**不校验存在性**：封一个没有记录的值也生效 |
| `untilAt` | 否 | `null` 或缺省 = **永久**；必须是「现在之后」的毫秒数，否则 400（避免手滑填成过去时间，导致「点了封禁但没封上」）。**不设上限**，但要的不是「很久」而是「永久」→ 用 `null` |
| `reason` | 是 | **必填**（审计要它）。1~64 字符。**不下发给被封者** |

响应：

| 字段 | 说明 |
| :--- | :--- |
| `block` | 落库后的 `{ kind, value, untilAt, reason, createdAt }` |
| `created` | `false` = 覆盖了既有的一条（改判，不是新增） |
| `affected` | `{ identities: n, online: m }`。**封 IP 时必须让操作者看见自己在封一片人**：`identities` = 该 IP 名下记录过的身份数，`online` = 此刻在线的连接数 |

副作用（由厅执行，与写库在同一个对象里，见 `../design/70-privacy-risk.md` §5.3）：**遍历命中的在线连接并关闭**（`close(1008, 'blocked')`），写一条审计。

### 5.4 `DELETE /api/admin/blocks/:kind/:value`

| 响应 | 说明 |
| :--- | :--- |
| `{ "removed": true }` | 删掉了 |
| `{ "removed": false }` | 本来就没有 |

**没有 404**：解封是幂等动作，重复点不该报错。写一条审计。

### 5.5 `GET /api/admin/audit`

| 字段 | 说明 |
| :--- | :--- |
| `id` | 自增主键 |
| `at` | epoch 毫秒 |
| `action` | `block` / `unblock` |
| `kind` / `value` | 作用对象 |
| `untilAt` | `null` = 永久 |
| `reason` | 解封时也可能带一条说明 |
| `actor` | 首版恒为 `"admin"` |

### 5.6 `GET /api/admin/reports`

只读列表：参数 `limit` / `before`（自增 `id` 游标），排序 `id DESC`。

| 字段 | 是否必选 | 数据类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | 是 | number | 自增主键（游标） |
| `createdAt` / `lastAt` | 是 | number | 第一次 / 最近一次举报的时刻 |
| `count` | 是 | number | 24 小时窗口内合并的次数 |
| `reporter` | 是 | object | `{ userId, nickname }`；昵称**读时现补**，已过留存期或从未写过 → `null` |
| `target` | 是 | object | 同上。页面点它 = 展开该身份的台账详情（**封禁只在那一处**，见 §5.1） |
| `reason` | 是 | string | 举报人写的事由（**未过内容过滤**，见 `../db/schema.md` §4.4） |
| `evidence` | 是 | array | `[{ text, at }]`，被举报人最近 ≤10 条（已打码）；可能为空数组（举报时那人还没说过话） |

**成本**：一页 50 行 = 1 次列表查询 + 每行两次台账单行读（举报人与被举报人的昵称）。与 §5.1 同一个取舍：为省这一百来次主键读而让运维看不到「是谁报的谁」不划算。

### 5.7 `GET /api/admin/reports/targets`

**同一个人被多少人、报了多少次**——封禁是「对一个人」的动作，而 §5.6 是「对一次举报」排序的，中间这一跳原来靠人脑。按 `target_user_id` 折叠，**次数总和倒序**，不分页（`limit` 默认 50、上限 100；一个厅一晚上的被举报人数远小于这个数）。

| 字段 | 是否必选 | 数据类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `target` | 是 | object | `{ userId, nickname }`，昵称读时现补，口径同 §5.6 |
| `count` | 是 | number | 所有举报行的 `count` **合计**（24 小时并合过的行按并合后的次数算） |
| `reporters` | 是 | number | **不同的举报人个数**（`COUNT(*)`，不是次数） |
| `lastAt` | 是 | number | 最近一次举报的时刻 |
| `reason` | 是 | string | **最近那一行**的事由（更早的事由在 §5.6 的明细里） |

**排序**：`count DESC, lastAt DESC`；同一个人只出现一行。响应用 `{ items }`，**没有 `next`**——排序键不是主键，游标翻页在这里会漏行。

**成本**：一次 `GROUP BY target_user_id` 全表扫（`report` 上没有 `target_user_id` 索引；行数 = 「一对举报人」数，且 90 天就删），每行再补一次昵称单行读。真涨到需要索引时先看 §5.6 的分页是否还够用。

## 6. 错误语义

| 状态码 | 场景 |
| :--- | :--- |
| 200 | 成功（含「解封时本来就没有」） |
| 400 | 参数非法（`kind` 不在枚举、`untilAt` 在过去、`reason` 空或超长） |
| 401 | 未授权（无 cookie / 验签失败 / `fp` 不匹配 / 过期） |
| 404 | `identities/:userId` 不存在 |
| 429 | 登录尝试超限 |
| 500 | 内部错误（日志留真实原因，响应不带细节） |

**不返回任何用户面错误码**，也不复用 `error-code.md`。理由见 §1。

## 7. 与前台的关系

| 项 | 关系 |
| :--- | :--- |
| cookie | `sc_admin` 与 `sc_session` **互不影响**：有后台权限不代表有更好/更坏的玩家身份；反之后台权限也不能把 `sc_session` 换成别人的 |
| 页面 | 后台页是独立静态文件，**不引入前台 React 应用**（不加载 Phaser、不连 WebSocket） |
| 数据 | 后台只经 `/api/admin/*` 读写，**不直连厅的 SQLite**：写操作由厅对象执行，因为它持有连接集合与唯一权威 |
