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

/** 每日唤醒时刻（UTC 20:00 = 北京 04:00）。同时刻做两件事：归属释放 + 缩级评估。 */
export const DAILY_WAKE_UTC_HOUR = 20;

/** 归属释放阈值：最后一次出现距今超过 30 天（读取时推导 + 每日唤醒结算）。 */
export const BED_OWNERSHIP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

/** 表情在世界内的显示时长。**只用于客户端渲染时推导过期**，服务端不记状态。 */
export const EMOTE_MS = 2500;

/**
 * 聊天气泡在世界里的寿命。同人后来的消息**覆盖**前一条并重置它；过期按「到期时刻 vs 现在」推导
 * （**不挂定时器**），服务端不记状态（见 `docs/design/config.md` §2）。
 */
export const CHAT_BUBBLE_MS = 8_000;

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

/** 素材像素 → 世界像素的固定比。**没有缩放**，1 世界像素 = 1 CSS 像素。 */
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

/** 全局聊天消息长度上限（按字符计）。 */
export const CHAT_MAX_LEN = 200;

/**
 * 世界渲染的对象池大小（**按床视图计**，每张床的贴片与贴图都在同一个视图容器里）。
 * 可见范围约一屏 10 床 + 邻接缓冲，64 足够覆盖两屏抖动。
 */
export const POOL_SIZE = 64;

/**
 * 跳变类位置（`hop` 瞬移）的落位阈值：单次位移超过它就**直接落位、不插值**。
 * 只写给客户端（服务端把位置一步改到位时发的是普通 `pos`，它不需要知道这个值）。
 */
export const TELEPORT_SNAP_PX = 400;