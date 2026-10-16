/**
 * 常量表。与 `docs/design/config.md` §1 单厅、§3 时间常量、§4 几何常量、§5 限制一致。
 *
 * 这些值是服务端的执行依据；前端直接引用同一份（编译期内联），因此**不需要下发到客户端**
 * （见 `docs/design/config.md` §9）。
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
export const WALK_SPEED_PX_PER_S = 130;

/** 睡痕存活时长，从「宽限到期时刻」起算。到期由读取时推导（服务端过滤 + 客户端按 `traceUntil` 淡出）。 */
export const TRACE_TTL_MS = 43_200_000;

/** 每日唤醒时刻（UTC 20:00 = 北京 04:00）。同时刻做两件事：归属释放 + 缩级评估。 */
export const DAILY_WAKE_UTC_HOUR = 20;

/** 归属释放阈值：最后一次出现距今超过 30 天（读取时推导 + 每日唤醒结算）。 */
export const BED_OWNERSHIP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 表情在世界内的显示时长。**只用于客户端渲染时推导过期**，服务端不记状态。 */
export const EMOTE_MS = 2500;

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

/** 可走区从墙矩形四边**再向内缩**这么多：小人不压在墙上（贴墙走道有效宽 36px，仍容得下一个人）。 */
export const WALL_BODY = 20;

/** 墙带厚度（世界像素），画在墙矩形**之外**。 */
export const WALL_WIDTH = 3;

/** 画布设备像素比上限：再高只是多花填充率，肉眼看不出。 */
export const MAX_DPR = 2;

/** 每连接上行限流（条/秒），超出丢弃。 */
export const UPSTREAM_RATE_PER_SEC = 5;

/** 昵称长度上限（按字符计）。 */
export const NICKNAME_MAX_LEN = 16;

/** 全局聊天消息长度上限（按字符计）。 */
export const CHAT_MAX_LEN = 200;

/** 客户端本地保留的最近消息条数（只用于显示；服务端不存历史）。 */
export const CHAT_LOG_MAX = 50;

/** 世界渲染的对象池大小。可见范围约 5 床 × 3.5 行（≈ 18 床）+ 邻接缓冲，64 足够覆盖两屏抖动。 */
export const POOL_SIZE = 64;