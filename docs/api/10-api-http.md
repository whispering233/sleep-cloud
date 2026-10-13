# 接口设计：HTTP

## 1. 接口清单

| 方法 | 路径 | 用途 | 幂等 |
| :--- | :--- | :--- | :--- |
| GET | `/api/me` | 读取当前会话（无会话则签发匿名会话） | 是 |
| POST | `/api/age-confirm` | 提交 18 岁自述确认 | 是 |
| POST | `/api/nickname` | 设置昵称并上报本地时区 | 是 |
| GET | `/api/halls` | 厅列表（大区选择用，含元信息） | 是 |
| POST | `/api/hall` | 切换所属大区 | 是 |
| GET | `/api/halls/{hallId}/ws` | WebSocket 升级（进入大厅） | — |

**没有的接口**：注册、登录、退出、找回床位、删除账号。第一版全部不存在。

## 2. 匿名会话的建立

| 时机 | 行为 |
| :--- | :--- |
| 无 cookie | 签发新的匿名会话，并**根据请求携带的时区信息推荐一个大区**写入会话 |
| cookie 验签失败 | 视为无 cookie，静默签发新的（返回 `1001`，前端无需处理） |
| cookie 有效 | 直接返回会话内容 |

**推荐大区的依据**：平台在请求对象上提供的时区字段（`cf.timezone`），服务端据此挑选最接近的大区。**不依赖客户端上报**（本地开发环境下该字段可能为空，此时回落到第一个大区）。

## 3. 接口详情

### 3.1 GET /api/me

| 响应字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| userId | 是 | string | — | 不透明标识，供前端区分「自己」 |
| hallId | 是 | string | 厅注册表中的 id | 当前所属大区 |
| bedNo | 否 | number | 0 ~ capacity-1 | 该厅中的床位号；未认领时为空 |
| nickname | 否 | string | 1~16 字符 | 未设置时为空 |
| ageConfirmed | 是 | boolean | — | 是否已完成 18 岁自述 |
| needsNickname | 是 | boolean | — | 是否需要先设昵称才能进入 |
| timezone | 是 | string | IANA 时区名 | 服务端为该会话记录的本地时区 |

```json
{
    "code": "0",
    "msg": "success",
    "data": {
        "userId": "u_7f3a91",
        "hallId": "asia-1",
        "bedNo": 42,
        "nickname": "小明",
        "ageConfirmed": true,
        "needsNickname": false,
        "timezone": "Asia/Shanghai"
    }
}
```

### 3.2 POST /api/age-confirm

| 请求字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| confirmed | 是 | boolean | 必须为 true | 必须显式为 true 才记录 |

| code | 场景 |
| :--- | :--- |
| `"0"` | 成功 |
| `"1001"` | 会话失效（前端重新拉取 `/api/me` 即可） |

**注意**：这是**自述**，不是核验。服务端只记录布尔值，不收集任何身份材料。

### 3.3 POST /api/nickname

| 请求字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| nickname | 是 | string | 1~16 字符 | 首尾空白会被去除；剥离控制字符 |
| timezone | 否 | string | IANA 时区名 | 上报失败或非法时回退到会话既有值或厅时区（返回 `1006`） |

| code | 场景 |
| :--- | :--- |
| `"0"` | 成功 |
| `"1004"` | 昵称超长 |
| `"1005"` | 昵称命中敏感词 |
| `"1006"` | 时区无法识别（昵称仍会保存） |

**允许重名。** 界面上以「床号 + 昵称」区分，不做唯一性检查。

**昵称存在两处，两处都要写**：新昵称写入会话 cookie（供在场广播），若当前已认领床位则**同时更新 `bed.owner_name` 快照**（否则离线后的睡痕会显示旧名字）。详见 `api-public.md` §2.1。

### 3.4 GET /api/halls

| 响应字段 | 是否必选 | 数据类型 | 备注 |
| :--- | :--- | :--- | :--- |
| halls | 是 | array | 厅列表 |
| halls[].id | 是 | string | 厅标识 |
| halls[].name | 是 | string | 显示名 |
| halls[].timezone | 是 | string | 厅固定时区（决定厅的昼夜） |
| halls[].capacity | 是 | number | 床位数 |
| halls[].acceptedBeds | 是 | number | **已被认领的床位数**（用于提示「快满了」） |
| halls[].current | 是 | boolean | 是否为当前所属大区 |

```json
{
    "code": "0",
    "msg": "success",
    "data": {
        "halls": [
            {
                "id": "asia-1",
                "name": "亚洲厅",
                "timezone": "Asia/Shanghai",
                "capacity": 256,
                "acceptedBeds": 87,
                "current": true
            }
        ]
    }
}
```

**说明**：`acceptedBeds` 是**归属数**（有主的床），不是在线人数。在线人数由 WebSocket 快照下发，避免为此单独开一个轮询接口。

### 3.5 POST /api/hall

| 请求字段 | 是否必选 | 数据类型 | 备注 |
| :--- | :--- | :--- | :--- |
| hallId | 是 | string | 目标厅标识 |

| code | 场景 |
| :--- | :--- |
| `"0"` | 成功（写回会话 cookie） |
| `"2001"` | 厅不存在 |
| `"2002"` | 目标厅床位已全部被认领 |

**切换大区的后果**：当前 WebSocket 连接会被要求断开重连（前端收到断开后重新走升级流程）。原厅的床位仍是你的（归属保留），30 天不出现才会被释放。**因此一个用户可能在不同厅各有一张床**——这是换来「用户可自由选择大区」的代价，接受。

## 4. 不需要接口的部分

| 项 | 为什么不需要 HTTP 接口 |
| :--- | :--- |
| 在线人数、厅内现状 | 由 WebSocket 快照与增量事件下发 |
| 床位占用情况 | 同上（快照里带全部床位状态） |
| 认领/释放床位 | 由 WebSocket 的「躺下」「起身」意图隐式完成 |
| 聊天、私聊、表情 | 全部走 WebSocket |
