# API 接口索引

## 公共约定

| 文档 | 内容 |
| :--- | :--- |
| `api-public.md` | 传输、会话、公共请求头、公共响应体、时间与限制 |
| `error-code.md` | 全部错误码与使用规则（含为第二版预留的风控码段） |

## HTTP 接口

| 方法 | 路径 | 用途 | 文档 |
| :--- | :--- | :--- | :--- |
| GET | `/api/me` | 读取会话（无则签发匿名会话） | `10-api-http.md` |
| POST | `/api/age-confirm` | 18 岁自述确认 | `10-api-http.md` |
| POST | `/api/nickname` | 设置昵称并上报本地时区 | `10-api-http.md` |
| GET | `/api/halls` | 厅列表（大区选择） | `10-api-http.md` |
| POST | `/api/hall` | 切换所属大区 | `10-api-http.md` |
| GET | `/api/halls/{hallId}/ws` | WebSocket 升级（进入大厅） | `20-api-ws.md` |
| GET | `/api/health` | 部署冒烟检查（无业务数据） | `10-api-http.md` |

## WebSocket 协议

| 方向 | 消息类型 |
| :--- | :--- |
| 上行（意图） | `hello` / `walk` / `lie` / `rise` / `sleep` / `chat` / `whisper` / `emote` |
| 下行（事实） | **描述人**：`snapshot` / `join` / `leave` / `state` / `pos`；**描述床**：`bed`；**消息与错误**：`chat` / `whisper` / `emote` / `error` |

详见 `20-api-ws.md`。

## 设计原则（贯穿全部接口）

| 原则 | 说明 |
| :--- | :--- |
| **上行是意图，下行是事实** | 客户端上报的坐标、床位号、身份一律不作为事实 |
| **不做没有需求方的接口** | 注册、登录、头像上传、搜索、好友、通知全部不存在 |
| **能走 WebSocket 就不开 HTTP** | 在线人数、床位占用、聊天都不设 HTTP 接口 |
| **错误码预留** | 风控相关的 `5xxx` 段第一版不返回，但枚举必须存在 |
