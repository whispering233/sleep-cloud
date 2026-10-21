/**
 * 常量表。与 `docs/design/config.md` §1 单厅、§2 时间常量、§3 限制、`docs/design/20-layout.md` §2 几何常量一致。
 *
 * 这些值是服务端的执行依据；前端直接引用同一份（编译期内联），因此**不需要下发到客户端**
 * （见 `docs/design/config.md` §6）。
 */

/**
 * 唯一那个厅的标识：房间服务实例名（`idFromName`）。**没有厅注册表、没有大区、没有多厅**
 * （见 `docs/design/config.md` §1）；区间路由用这个常量，会话里不再有「所属厅」。
 */
export const HALL_ID = 'main-1';

/** 断线宽限期：期内重连恢复原状态，超期按是否在床上分流。 */
export const GRACE_MS = 60_000;

/** 在床上无输入满 5 分钟自动转睡着（读取时推导，不挂定时器）。 */
export const AUTO_SLEEP_MS = 300_000;

/** 位置推进与广播合并的目标周期。只在有人走动时启用（内存循环，非持久唤醒）。 */
export const TICK_MS = 100;

/** 走动速度（世界像素/秒）。推进量按**实际经过时间**算，节拍抖动只影响平滑度。 */
export const WALK_SPEED_PX_PER_S = 220;

/** 睡痕存活时长，从「宽限到期时刻」起算。到期由读取时推导（服务端过滤 + 客户端按 `traceUntil` 淡出）。 */
export const TRACE_TTL_MS = 43_200_000;

/** 每日唤醒时刻（UTC 20:00 = 北京 04:00）。同时刻做三件事：归属释放 + 缩级评估 + 留存清理。 */
export const DAILY_WAKE_UTC_HOUR = 20;

/** 归属释放阈值：最后一次出现距今超过 30 天（读取时推导 + 每日唤醒结算）。 */
export const BED_OWNERSHIP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 来源信息留存期：这么久无访问就把 `identity` 的 `last_ip` / `last_country` / `ua_hash` 置空，
 * **行本身留着**（它不指向具体的人，删掉反而让「这个 id 曾经存在」无法解释）。
 * 由每日唤醒执行，见 `docs/design/70-privacy-risk.md` §7。
 */
export const IDENTITY_FORGET_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 到期封禁记录的清理延迟（从 `until_at` 起算）。
 * **`until_at` 为空的永久封禁永不清理**——它就是黑名单本体。
 */
export const BLOCK_PURGE_MS = 30 * 24 * 60 * 60 * 1000;

/** 审计留存期，由每日唤醒删除。 */
export const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * 换床冷却：距**上次认领（含换床）**不足这么久、又要认领另一张无主床 → `3008`。
 * 从 `bed.claimed_at` 读取时推导（**不挂定时器**）；躺回自己那张床不受它影响。
 */
export const BED_SWITCH_COOLDOWN_MS = 10_000;

/**
 * 升级阈值：**已用率 ≥ 75%** 且未触顶就长一档（见 `docs/design/10-hall-runtime.md` §8）。
 * 像 `ArrayList` 一样提前扩容，厅永远留有余量。
 */
export const GROW_USED_RATIO = 0.75;

/**
 * 缩级阈值：**已用率 < 50%**（且外圈全空）才降一档（另一半，见 §8）。
 * 两个阈值必须成对：`50% × 1.37 ≈ 68.5% < 75%`，扩完与缩完都不越界，否则会一天一档地自激。
 */
export const SHRINK_USED_RATIO = 0.5;

/**
 * 聊天气泡在世界里的寿命。同人后来的消息**覆盖**前一条并重置它；过期按「到期时刻 vs 现在」推导
 * （**不挂定时器**），服务端不记状态（见 `docs/design/config.md` §2）。
 */
export const CHAT_BUBBLE_MS = 8_000;

/**
 * 雨声素材（`docs/design/config.md` §4）：8 s 早播小循环 + 30 s 主循环。
 * **版本号写进文件名**：`immutable` 缓存下浏览器不会再来问，换素材必须改名。
 */
export const RAIN_INTRO_URL = '/audio/rain-loop-intro.v1.wav';
export const RAIN_LOOP_URL = '/audio/rain-loop.v1.wav';

/** 早播小循环 → 主循环的交叉淡化时长（秒）。 */
export const RAIN_CROSSFADE_S = 1;

/**
 * 探活超时（**只在客户端**）：发 `ping` 后这么久没有 `pong` → 判连接已死、关掉并重连。
 * 三条探活触发点与动作见 `docs/api/20-api-ws.md` §5.1。
 */
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * 意图无回执超时（**只在客户端**）：发出上行后这么久没收到任何「关于自己的下行」→ 视为可疑，
 * 触发一次探活（不直接判死）。
 */
export const INTENT_ECHO_TIMEOUT_MS = 1_500;

/**
 * 重连退避序列（封顶 15 秒），成功后归零；**页面 hidden 期间不重试**（省电，回到前台由探活接手）。
 * 永不放弃——这个序列不是放弃阈值，只是等待时长表。
 */
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * 自身外推的保鲜期（**只在客户端**）：从「最后一条关于自己的 `pos`」（或发起意图那一刻）起算，
 * 这么久没有任何 `pos` → 停在最后一个外推点（**不回退**到旧权威点，倒退比停住更难受）。
 * 注意基准是**真值时刻**而不是锚点时刻（带入领先量后两者差一个 `lead`）。
 * 见 `docs/design/30-movement-sync.md` §3.7。
 */
export const PREDICTION_STALE_MS = 2_000;

/** 素材像素 → 世界像素的固定比（**常量，不是缩放**）：1× 下 1 世界像素 = 1 CSS 像素；相机可以在这之上拉远（见 `ZOOM_MIN`）。 */
export const ART_SCALE = 0.5;

/** 床宽（世界像素）。素材墨迹 122 × 0.5 = 61。 */
export const BED_W = 61;

/** 床高（世界像素）。素材墨迹 201 × 0.5 = 100.5 取整，丢的 0.5px 不可见。 */
export const BED_H = 100;

/** 走道宽度 = 人高（113 × 0.5 ≈ 56.5）：走道里站得下一个人，也不会压到床。 */
export const AISLE = 56;

/** 每间房留给装饰物的**预留位**宽度（= 一条走道宽）。它是「无边界个人房间」的那块空地，且**不可走**。 */
export const RESERVE_W = 56;

/** 格宽 = `AISLE + BED_W + RESERVE_W`：一座格 = 一条竖走道 + 一间房（房 = 床 + 预留位）。 */
export const CELL_W = AISLE + BED_W + RESERVE_W;

/** 格高 = `BED_H + AISLE`：床 + 床脚前那条横走道（同时是行距）。 */
export const CELL_H = BED_H + AISLE;

/**
 * 可走区从墙矩形四边**再向内缩**这么多：小人（`girl_stand` 站立贴图墨迹 97 × 0.5 = 48.5 宽，半宽 24.25）
 * 不压在墙上，留 1.75 余量；贴墙走道有效宽 = `AISLE` 56 − 26 = 30，仍容得下一个人。
 * 取 26 而不是 28：贴墙那条街列的节点在 `x = −28`，而可走左界 = 墙矩形左沿 + `WALL_BODY` ——
 * 28 会让节点正好贴在边界上（零余量）。
 */
export const WALL_BODY = 26;

/** 墙带厚度（世界像素），画在墙矩形**之外**。 */
export const WALL_WIDTH = 3;

/**
 * 墙外那一圈：相机可以滚到墙外一条走道，于是手机上推到边缘也能看见墙外的底与那条墙带
 * （否则墙永远贴着屏幕最外圈，看起来只是一条细线）。
 * 它**不属于厅**：不铺地板、不可走（可走范围仍是 `wallRegionOf` 内缩 `WALL_BODY`）。
 */
export const OUTSIDE_MARGIN = AISLE;

/**
 * 画布设备像素比上限。基准设备（iPhone 16）是 DPR 3：上限取 2 时画布只有 CSS×2 个像素，
 * 浏览器再放大 1.5× 铺满屏幕，线稿与文字一起发虚；取 3 才与设备像素 1:1。
 * 代价是填充率 ×2.25（相对 2），真机帧率见 `docs/design/build.md` §7 B5。
 */
export const MAX_DPR = 3;

/** 每连接上行限流（条/秒），超出丢弃。 */
export const UPSTREAM_RATE_PER_SEC = 5;

/** 昵称长度上限（按字符计）。 */
export const NICKNAME_MAX_LEN = 16;

/** 后台会话（`sc_admin`）有效期：24 小时。过期重登一次，成本可忽略（见 `docs/api/30-api-admin.md` §2.1）。 */
export const ADMIN_SESSION_MS = 24 * 60 * 60 * 1000;

/** 同一 IP 每分钟登录尝试上限，超出 429；**取不到 IP 时不限速**（本地开发没有那个头）。 */
export const ADMIN_LOGIN_MAX_PER_MIN = 5;

/**
 * UA 哈希的长度（十六进制字符）= 8 字节 = SHA-256 前 8 字节。
 * **是遮挡不是匿名化**（UA 本身熵很低，哈希后照样可枚举反推），见 `docs/design/70-privacy-risk.md` §3.2。
 */
export const UA_HASH_HEX_LEN = 16;

/** 全局聊天消息长度上限（按字符计）。 */
export const CHAT_MAX_LEN = 200;

/** 举报事由上限（**trim 后**按字符计）：空 → `4003`、超长 → `4001`。 */
export const REPORT_REASON_MAX_LEN = 200;

/** 每人的发言缓冲长度，**同时**是举报时拷进 `report.evidence` 的条数（不分「留多少 / 拷多少」）。 */
export const REPORT_EVIDENCE_MAX = 10;

/** 同一对 `(举报人, 被举报人)` 的合并窗口：期内重复举报只加 `count`，窗口按 `last_at` 滑动。 */
export const REPORT_DEDUP_MS = 24 * 60 * 60 * 1000;

/** 举报行（含证据）的留存期，并入每日唤醒同批删除。 */
export const REPORT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** 类型文本（`docs/design/50-slot-panel.md` §附）单条长度上限（**trim 后**按字符计）。 */
export const TYPE_TEXT_MAX_LEN = 200;

/** 单条最多**段数**（连续空行分段）。长度与段数超限都是**丢掉那一条**，不截断。 */
export const TYPE_TEXT_MAX_PARAS = 8;

/**
 * 每个内容分类的条目上限。同时是 `sc.read.seen` 的体积闸门：120 个 ≤ 32 字符的 id ≈ 1 KB
 * （`docs/design/40-client-storage.md` §1.1 判据 3）。
 */
export const TYPE_TEXTS_PER_CATEGORY = 120;

/**
 * 世界渲染的对象池大小（**按床视图计**，每张床的贴片与贴图都在同一个视图容器里）。
 * 1× 时可见范围约一屏 10 床 + 邻接缓冲，64 足够覆盖两屏抖动；**拉远到 `ZOOM_MIN` 时同屏约 190 个床位**，
 * 池子按需增长（上不封顶）。
 */
export const POOL_SIZE = 64;

/**
 * 相机**拉远**的下限（**只缩不放**，上限恒为 1×）。取值依据：第 1 级厅宽 2249px、基准视口宽 393px
 * → `393 / 2249 = 0.1748`，正好把整厅装进屏宽。更高档位的厅拉到下限也看不全（见 `docs/ui/DESIGN.md` 的世界相机）。
 */
export const ZOOM_MIN = 0.175;

/**
 * 世界文字退役阈值：拉远到它以下就不画床号 / 名字 / 聊天气泡 / 睁眼两点
 * （12px 的床号在 0.5 倍下只剩 6px，本来就读不出；同时也是同屏 Text 对象数的闸门）。
 */
export const ZOOM_TEXT_MIN = 0.5;

/**
 * **固定档位表**（`zoomMode` 锁定时取其中一个值；`自由缩放` 不在这张表里，它是「不锁定」的模式）。
 * **最小一档 0.5 就是 `ZOOM_TEXT_MIN`**：固定档永远不会把文字画没。**不进协议**（档位是客户端显示偏好），
 * 值来自 `docs/design/config.md` §3；界面侧的档位文案与它同序同长，靠单测兜住漂移。
 */
export const ZOOM_TIERS = [ZOOM_MIN, 0.5, 0.75, 1] as const;

/**
 * 跳变类位置（`hop` 瞬移）的落位阈值：单次位移超过它就**直接落位、不插值**。
 * 只写给客户端（服务端把位置一步改到位时发的是普通 `pos`，它不需要知道这个值）。
 */
export const TELEPORT_SNAP_PX = 400;