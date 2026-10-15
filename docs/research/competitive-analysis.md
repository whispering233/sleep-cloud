# 竞品调研：多人线上睡眠大厅

调研目标：确认「每个用户一张床位、睡眠时有小人睡在床上、失眠者来大厅闲逛交流」这条产品形态，是否已有同类产品；以及可参考的开源项目。

## 1. 结论摘要

| 判断 | 说明 |
| :--- | :--- |
| 形态是否已有 | 有近似形态，但集中在 **VR 平台（VRChat 睡眠房间）** 与 **纯语音/文字陪伴房间** |
| 网页版是否空白 | 「Web + 2D 像素小人 + 每人一张固定床位 + 失眠时段大厅闲逛」这个组合基本空白 |
| 最接近的竞品 | Nylu（网页，Sleep Room 静默共处）、VRChat 睡眠房间（VR，多人躺一起） |
| 最接近的开源同类 | **WheatCloudSleep（小麦云睡觉）**：形态同构，见第 4 节 |
| 最大技术参考 | `cloudflare/workers-chat-demo`（一房间一 Durable Object + WebSocket Hibernation） |
| 最大产品风险 | 深夜陌生人社交的骚扰/未成年人问题；失眠话题的医疗边界 |

## 2. 竞品清单

### 2.1 最接近：多人共处睡眠空间

| 产品 | 形态 | 关键机制 | 可借鉴点 |
| :--- | :--- | :--- | :--- |
| **Nylu**（nylu.app） | 网页 | Sleep Room 多人静默共处；状态标签（Sleeping / Falling asleep / Relaxing / Listening / Wants company / Just here）；goodnight note；房间主题+床+台灯+雨声；Sleep Meet 按年龄分组匹配；「一起睡了 6h10m」时长统计 | 不强迫说话、用「状态」代替对话；长期共处时长成为情感资产；年龄分组 |
| **SleepInLate.com** | 网页（视频房间） | 深夜限定 7 类房间：社交能量 / 安静陪伴 / 深夜游戏 / 反刍者 / 纯语音 / 夜猫子 / After Hours；会员制分档 | 按「今晚的心情」分房间；安静房间与热闹房间隔离 |
| **VRChat 睡眠房间** | VR | Sleep Room、Endless Sleep、真夜中の寝床、NPC.Sleep、舒休吧 sleeping bar 等社区地图 | 已验证需求真实存在（失眠/孤独人群戴头显入睡）；也暴露了未成年人骚扰、儿童破坏氛围的问题 |
| **sleepingwithfriends.com** | 网页 | 接 Garmin/Fitbit/Whoop/Oura，睡眠数据榜单竞技 | 竞争化激励路线，与本项目调性相反，仅作对照 |

### 2.2 空间化多人网页（技术形态参考，非睡眠主题）

| 项目 | 技术 | 可借鉴点 |
| :--- | :--- | :--- |
| **WorkAdventure** | Pixi + 自托管 | 16-bit RPG 虚拟办公室；靠近自动触发通话；房间/地图可定制 |
| **Habbo 系复刻**：`Josedn/bobba_client`、`mathishouis/scuti-renderer` + `scuti-client`、`open-hotel/open-hotel-client` | Pixi / Vue3 / TS | **本项目的形态几乎是 Habbo 的子集**（每人一个房间、可摆家具、有床、可躺下）；渲染引擎与 UI 分离的架构值得抄 |
| `samfisher753/pixelchat` | Canvas + React + Socket.IO | 最小可用「像素小人在地图上走动+聊天」，含 :sit 指令 |
| `deklol/slopwave-habbo-v1` | TS + Pixi | 老客户端兼容运行时，MIT |
| `shoaib-jamal/bithotel` | node + socket.io + p5.js | 小人选择、房间切换、宠物 |
| `GJMattia/Ghotel-Client` | React + Socket.IO + Mongo | 房间内实时同步、家具交互 |

### 2.3 睡眠类产品（非大厅形态，用于需求验证）

| 产品 | 形态 | 说明 |
| :--- | :--- | :--- |
| SleepTown 睡眠小镇 / 梦境旅店 | App | 准时睡觉盖房子；单机 + 小圈圈，无大厅 |
| 幻休 / 睡眠岛 | App | 白噪音 + 鼾声监测 + AI 解读 |
| Naptick / Lulu Light / MoYa | 硬件 | 床头 AI 伴侣 / 光疗 / 软体机器人抱枕 |
| 正岸健康「如眠」/ 速眠 | 数字疗法 | CBT-I，面向 C 端治疗 / 医院管理，医疗属性 |
| 入梦岛（Trae 社区 Demo） | Web 竖屏 3D | 睡前陪伴 + 小岛探索，单人为主，明确引用 CBT-I |
| `lexiaox/somnus-ai` | Web Demo | AI 睡前对话 + 床品传感模拟，纯静态前端 + Python 代理 |

结论：睡眠赛道本身很拥挤，但都是 **单人 + 工具/内容** 路线；「多人 + 空间 + 陪伴」目前只被 VR 满足，网页侧只有 Nylu 一类语音陪伴房，且没有「每人一张可视化床位」。

## 3. Cloudflare 设施上的技术参考

| 参考 | 内容 | 与本项目关系 |
| :--- | :--- | :--- |
| **`cloudflare/workers-chat-demo`** | 一个聊天室 = 一个 Durable Object；WebSocket + 消息广播 + 历史存储 + 基于 IP 的 RateLimiter DO；已迁移到 WebSocket Hibernation API | 「大厅」的官方骨架；README 明确指出不用 Hibernation 会让 DO 因空闲长连接持续计费 duration |
| **`cloudflare/partykit`（PartyServer）** | DO 的 room 抽象：连接生命周期钩子、`broadcast()`、`getConnections(tags)`、hibernation、`partysub` 跨 DO 分片 pubsub | 可省掉自写 WebSocket 样板；需在 `wrangler.jsonc` 手写 DO binding 与 migration |
| **tldraw `templates/sync-cloudflare`** | DO + SQLite 存储 + 房间懒创建 + hibernation resume + presence 光标 | presence（谁在线、在哪张床）与「休眠后恢复会话」的参考实现 |
| **Cloudflare 文档 `websocket-hibernation-server` 示例** | 最小可跑的 Hibernation 服务端代码（`ctx.acceptWebSocket` + `serializeAttachment` + `setWebSocketAutoResponse`） | 起手模板 |
| **Phaser 4 / PixiJS / p5.js** | 2D 渲染 | Habbo 系项目均用 Pixi；本项目选 **Phaser 4**（相机、输入、图集与批量渲染一站齐备，见 `../design/architecture.md` §1）|
| DiceBear / Habbo avatar imager | 头像生成 | 「用户小人」外观方案 |

## 4. WheatCloudSleep 拆解（最接近的开源同类项目）

仓库：<https://github.com/WheatBox/WheatCloudSleep>（本地：`~/projects/WheatCloudSleep`）

| 项 | 值 |
| :--- | :--- |
| 描述 | 「小麦云睡觉软件，很无意义的那种，你需要做的就是打开软件，然后躺下来睡觉」 |
| 许可 | MIT |
| 热度 | 345 star / 35 fork / 11 open issues |
| 时间线 | 2022-08 建仓 → 2023-09-05 最后一次提交（已停滞） |
| 客户端 | GameMaker Studio 2（GML），24 个 sprite、33 个 object，含 `obj_sleeper` / `obj_bed` / `obj_day_and_night` / `obj_emoteRoulette` / `obj_ourPhone` |
| 服务端 | C++20 + asio（coroutine），约 4000 行 |
| 配套 | 场景编辑器独立仓库 `WheatBox/CloudSleepEngine`；官方服务器为「寝室」，B 站视频分发 exe |
| 美术 | `Art/` 下为作者自绘（Boy/Girl/bedBoy/bedGirl/bedEmpty），非 Habbo 拆包资产 |

### 4.1 形态同构度

用户选角色 → 进入「寝室」→ **走到床边右键躺下** → 小人睡在床上、其它人能看到 → 鼠标右键走路、滚轮缩放、空格跟随某位睡客镜头 → Enter 聊天、表情轮盘、私聊、举报、投票踢人 → 昼夜变化。这就是本项目设想的同一件事，只是桌面客户端 + 自建服务器。

### 4.2 值得抄的设计

| 设计 | 说明 |
| :--- | :--- |
| **场景包（cloudpack）与客户端解耦** | 地图由编辑器产出 JSON（`backgrounds` / `decorates` / `beds` 三段列表，每项 x、y、materialId），带 guid；服务端 `config.json` 里填同一个 `cloudpack_guid`，客户端进入时校验 guid 一致 |
| **床位是一等公民** | 服务端 `Room::m_beds` 就是 `vector<SleeperId>`，容量 `max_bed_num=256`；`Sleep(id, bed)` 三重校验（床位号越界 / 自己已睡 / 床位被占）；客户端每张床记 `empty` + `bedSleeperName` |
| **「手机」作为应用平台** | 聊天、相机、自定义壁纸、音乐播放器、相册、举报、内置浏览器全部做成 `obj_ourPhone` 里的 App，世界画面保持干净。这个分层比把 UI 摊在场景上干净得多 |
| **治理栈成体系** | 敏感词（Trie 树 + 干扰字符还原 + super 模式）、违规检测 + 规则 JSON（自动禁言/禁入）、IP 黑名单（10 分钟起，上限 1440 分钟）、投票踢人（10s 等待、20s 冷却、≥3 人同意）、管理员名单、举报记录器、流量统计、配置文件热重载 |
| **房间 = 一个强一致容器** | 一个 `Room` 持有一张 `m_beds` 表、一份成员表、一份投票状态。这个边界与 Cloudflare 一个 Durable Object 完全对齐 |

### 4.3 不能抄的地方（本项目的改造点）

| WheatCloudSleep 的做法 | 问题 | 本项目应采用 |
| :--- | :--- | :--- |
| 裸 TCP + JSON 文本帧（`{"Cmd":"sleep","Args":["3"]}`），无 TLS、无鉴权 | 任何人可伪造 | Workers + WSS + 服务端签发身份 |
| 客户端自报 `name` / `type`，服务器只发一个自增 id | 无账号，无持久归属，换名无成本 | 账号 + 身份签名 + 床位持久归属 |
| **座标由客户端自报**（客户端每 5 秒 `CmdMove` 一次，服务器只转发） | 位置完全不可信 | 服务端权威位置，客户端只发意图 |
| 单进程单房间，匿名进出，`Leave` 即 `GetUp` 清床 | 无法容纳多房间、无法跨设备续睡 | 一个大厅 = 一个 DO，多房间按 id 分片 |
| 必须下载 exe，Windows 桌面为主 | 这是它的天花板：345 star 但无法在手机/浏览器即时体验 | 浏览器打开即用，免安装免运维 |
| 无移动端、无离线通知、无「睡了一整晚」的记录 | 缺少情感资产沉淀 | Nylu 式「一起睡了 6h10m」共处时长 |

### 4.4 结论

WheatCloudSleep 证明了这件产品**有人真的要**（345 star 且作者自认为「很无意义」），同时它的停滞原因也很清楚：桌面客户端 + 自建服务器把体验门槛和运维成本都压在用户与作者身上。本项目的差异点不是功能更花，而是**把同一个形态搬到浏览器 + Cloudflare 免运维**，并补上它缺的账号、持久床位与可信状态。

### 4.5 身份与授权：源码实证（无账号、无鉴权、无加密）

结论：**Wheat 没有注册、登录、token、会话恢复与加密**。它的「用户」就是 TCP 连接本身。

| 环节 | 实际实现 | 源码位置 |
| :--- | :--- | :--- |
| 身份生成 | 每建立一条 TCP 连接就 `MakeSleeperId()` 生成一个新 id，断线即销毁 | `sleeper.cpp` 构造函数 |
| 昵称 | `CmdName` → `m_name = cmd.name`，只过敏感词（不过则回 `CmdError{InvalidName}` 并断线）；**会话中随时可改，无唯一性检查，可重名** | `sleeper.cpp` Reader |
| 性别 | `CmdType` → `m_sex = cmd.sex`，**零校验** | `sleeper.cpp` Reader |
| 权限 | `PermissionMgr::IsAdministrator()` 直接 `return true;`，源码留有 `/* todo 等需要实现管理员权限时放开 */` 与调用点 `//todo 到时候需要根据客户端传过来的字段确定是否有管理员权限` → **所有人都是管理员**，任何人都能发起投票踢人 | `permission_mgr.cpp`、`sleeper.cpp` |
| 入场门槛 | 只有 IP 黑名单（`Room::Join` 里 `IsIpBlocked`），由 `ViolationDetector` 自动加黑并断线。是 IP，不是身份 | `room.cpp`、`sleeper.cpp` |
| 场景校验 | 首条消息必须是 `CmdPackGuid`，与 `room.m_packGuid` 比对；不匹配回 `CmdError{InvalidScene}` 并断线。未收到 guid 前不转发任何房间消息（`DeliverToAll` 里 `if (sleeper->m_receivedPackGuid)`） | `sleeper.cpp`、`room.cpp` |
| 传输层 | 裸 TCP + `\0` 分隔 JSON 文本帧（`async_read_until(sock, buffer, '\0')`，512 字节缓冲），无 TLS | `sleeper.cpp` |
| 踢人判定 | `agree >= 2 * refuse && agree > 2`（至少 3 票同意，且同意数 ≥ 反对数 2 倍）；被踢者与发起者 IP 一并加入黑名单 | `room.cpp` VoteKickOver |
| 持久化 | 进程内内存态（`Room::m_sleepers` / `m_beds`）；落盘的只有日志、流量统计、举报记录、配置文件 | `room.h`、`main.cpp` |

两点可直接借用：

1. **场景包 guid 的校验形态** 等价于「只有持有正确凭据的客户端能连」——本项目把它上移到身份层：DO 的 `/connect` 必须先验签名再升级 WebSocket。
2. **IP 黑名单 + 违规自动加黑 + 双倍观察期**（`block_period_m` 10 分钟起、`max_block_period_m` 1440 分钟、`watch_period_m = 2 × block_period_m`）是一套成熟的渐进惩罚参数，可直接照抄数值。

## 5. 从竞品暴露出的设计风险

1. **深夜陌生人社交的骚扰与未成年人**：VRChat 睡眠房间已被报道出现儿童闯入、骚扰；Nylu 明确分离 under-18 与 18+。大厅必须有年龄门槛与静音/举报机制。
2. **「睡着」无法在网页里被验证**：不要做摄像头/行为检测。用状态自述（Nylu 路线）+ 心跳防掉线。
3. **安静与热闹必须分区**：SleepInLate 把「安静陪伴」和「社交能量」拆房间。一个大厅容纳两种需求会互相破坏。
4. **长连接成本**：WebSocket 必须用 Hibernation API，否则空闲期间持续计费 duration。
5. **床位是稀缺资源**：分配/占用/回收需要单点强一致，DO 正好适合，但要显式定义「离开多久释放床位」。
6. **医疗边界**：失眠话题不要越界到 CBT-I/诊断；竞品均附免责声明。
