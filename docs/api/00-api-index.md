# API 接口索引

## 公共约定

| 文档 | 内容 |
| :--- | :--- |
| `api-public.md` | 传输、会话、公共请求头、公共响应体、时间与限制 |
| `error-code.md` | 全部错误码与使用规则（含为第二版预留的风控码段） |

## HTTP 接口

| 方法 | 路径 | 用途 | 文档 |
| :--- | :--- | :--- | :--- |
| GET | `/api/me` | 读取会话（无则签发匿名会话）+ 下发布局版本 | `10-api-http.md` |
| POST | `/api/age-confirm` | 18 岁自述确认 | `10-api-http.md` |
| POST | `/api/nickname` | 设置昵称 | `10-api-http.md` |
| POST | `/api/appearance` | 选择入场形象（`boy` / `girl`）；非法值忽略并回当前会话 | `10-api-http.md` |
| GET | `/api/ws` | WebSocket 升级（进入大厅） | `20-api-ws.md` |
| GET | `/api/health` | 部署冒烟检查（无业务数据） | `10-api-http.md` |

**只有五个业务接口。** 大区列表与切换（`/api/halls`、`/api/hall`）随「只有一个厅」一起删除。

## 后台接口（运维面）

| 方法 | 路径 | 用途 | 文档 |
| :--- | :--- | :--- | :--- |
| POST | `/api/admin/login` | 用 `ADMIN_TOKEN` 换 `sc_admin` cookie | `30-api-admin.md` |
| POST | `/api/admin/logout` | 清 `sc_admin` | `30-api-admin.md` |
| GET | `/api/admin/me` | 会话自检（只回 `{ ok: true }`） | `30-api-admin.md` |
| GET | `/api/admin/identities` | 访客台账（可按 IP 反查） | `30-api-admin.md` |
| GET | `/api/admin/identities/:userId` | 身份详情 | `30-api-admin.md` |
| GET | `/api/admin/blocks` | 黑名单 | `30-api-admin.md` |
| POST | `/api/admin/blocks` | 封禁（新增或改判） | `30-api-admin.md` |
| DELETE | `/api/admin/blocks/:kind/:value` | 解封 | `30-api-admin.md` |
| GET | `/api/admin/audit` | 审计 | `30-api-admin.md` |
| GET | `/api/admin/reports` | 举报明细（`id` 倒序） | `30-api-admin.md` |
| GET | `/api/admin/reports/targets` | 举报按被举报人折叠（次数 / 举报人数） | `30-api-admin.md` |
| GET | `/api/admin/stats` | 四张统计卡（在线 / 有主床 / 生效封禁 / 近 24 小时举报） | `30-api-admin.md` |
| GET | `/api/admin/feedback` | 反馈与建议（`id` 倒序，只读） | `30-api-admin.md` |

**后台面是契约例外**：未授权回 **HTTP 401**、成功直接返回数据对象，**不套** `{code,msg,data}`（理由见 `30-api-admin.md` §1）。这是唯一例外，只限 `/api/admin/*`。

## WebSocket 协议

| 方向 | 消息类型 |
| :--- | :--- |
| 上行（意图） | `hello` / `ping` / `walk` / `hop` / `lie` / `rise` / `sleep` / `chat` / `whisper` / `report` / `feedback` |
| 下行（事实） | **描述人**：`snapshot` / `join` / `leave` / `state` / `pos`；**描述厅与床**：`bed` / `resize`；**消息与错误**：`chat` / `whisper` / `error`；**探活**：`pong` |

详见 `20-api-ws.md`。

## 设计原则（贯穿全部接口）

| 原则 | 说明 |
| :--- | :--- |
| **上行是意图，下行是事实** | 客户端上报的坐标、床位号、身份一律不作为事实 |
| **不做没有需求方的接口** | 注册、登录、头像上传、搜索、好友、通知全部不存在 |
| **能走 WebSocket 就不开 HTTP** | 在线人数、床位数、床位占用、聊天都不设 HTTP 接口 |
| **删除优于新增** | 单厅之后厅列表与切厅接口直接删掉，而不是留着不用 |
| **错误码预留** | 风控相关的 `5xxx` 段中 `5002`（封禁）/ `5003`（举报回执）/ `5004`（反馈回执）已启用，`5001` 仍预留 |