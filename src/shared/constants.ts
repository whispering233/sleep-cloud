import type { ErrorCode } from './error-code';

/**
 * 常量表。与 `docs/design/config.md` §3 时间常量、§4 几何常量、§5 限制一致。
 *
 * 这些值是服务端的执行依据；前端直接引用同一份（编译期内联），因此**不需要下发到客户端**
 * （见 `docs/design/config.md` §9）。
 */

/** 断线宽限期：期内重连恢复原状态，超期按是否在床上分流。 */
export const GRACE_MS = 60_000;

/** 在床上无输入满 5 分钟自动转睡着（读取时推导，不挂定时器）。 */
export const AUTO_SLEEP_MS = 300_000;

/** 位置推进与广播合并的目标周期。只在有人走动时启用（内存循环，非持久唤醒）。 */
export const TICK_MS = 100;

/** 走完一格的目标耗时。推进量按**实际经过时间**算，所以节拍抖动不影响移动速度。 */
export const MOVE_MS_PER_TILE = 250;

/**
 * 一格边长（世界像素）。
 *
 * shortcut: 格坐标还留在上行 `walk` 与连接附加数据里，**下行位置一律是世界像素**（格心 = 格号 × 这个值 + 半格）；
 * 几何改成按世界像素生成之后，它连同格坐标一起删。
 */
export const TILE_PX = 32;

/** 厅时区 08:00 清理睡痕。 */
export const SLEEP_TRACE_CLEAR_HOUR = 8;

/** 归属释放阈值：最后一次出现距今超过 30 天。 */
export const BED_OWNERSHIP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 表情在世界内的显示时长。**只用于客户端渲染时推导过期**，服务端不记状态。 */
export const EMOTE_MS = 2500;

/** 床宽（世界像素）。素材墨迹 122 × 0.5。 */
export const BED_W = 61;

/** 床高（世界像素）。素材墨迹 201 × 0.5 取整，丢的 0.5px 不可见。 */
export const BED_H = 100;

/** 床与床之间的视觉间距：床不贴在一起。 */
export const BED_GAP = 4;

/** 走道宽度 = 人高（113 × 0.5 ≈ 56.5）：走道里站得下一个人，也不会压到床。 */
export const AISLE = 56;

/** 每几床一条竖向走道。更密则厅碎，更疏则走动绕远。 */
export const CORRIDOR_EVERY = 4;

/** 列距 = 床宽 + 床间距。 */
export const PITCH_X = BED_W + BED_GAP;

/** 行距 = 床高 + 床脚前走道。 */
export const PITCH_Y = BED_H + AISLE;

/** 每连接上行限流（条/秒），超出丢弃。 */
export const UPSTREAM_RATE_PER_SEC = 5;

/** 昵称长度上限（按字符计）。 */
export const NICKNAME_MAX_LEN = 16;

/** 全局聊天消息长度上限（按字符计）。 */
export const CHAT_MAX_LEN = 200;

/** 客户端本地保留的最近消息条数（只用于显示；服务端不存历史）。 */
export const CHAT_LOG_MAX = 50;

/** 场景数据中的床位数，必须等于该厅的 capacity。 */
export const SCENE_BED_COUNT = 256;
