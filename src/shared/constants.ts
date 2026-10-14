import type { ErrorCode } from './error-code';

/**
 * 常量表。与 `docs/design/config.md` §2 时间常量、§3 限制一致。
 *
 * 这些值是服务端的执行依据；前端直接引用同一份（编译期内联），因此**不需要下发到客户端**
 * （见 `docs/design/config.md` §6）。
 */

/** 断线宽限期：期内重连恢复原状态，超期按是否在床上分流。 */
export const GRACE_MS = 60_000;

/** 在床上无输入满 5 分钟自动转睡着（读取时推导，不挂定时器）。 */
export const AUTO_SLEEP_MS = 300_000;

/** 位置推进与广播合并的目标周期。只在有人走动时启用（内存循环，非持久唤醒）。 */
export const TICK_MS = 100;

/** 走完一格的目标耗时。推进量按**实际经过时间**算，所以节拍抖动不影响移动速度。 */
export const MOVE_MS_PER_TILE = 250;

/** 厅时区 08:00 清理睡痕。 */
export const SLEEP_TRACE_CLEAR_HOUR = 8;

/** 归属释放阈值：最后一次出现距今超过 30 天。 */
export const BED_OWNERSHIP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 每连接上行限流（条/秒），超出丢弃。 */
export const UPSTREAM_RATE_PER_SEC = 5;

/** 昵称长度上限（按字符计）。 */
export const NICKNAME_MAX_LEN = 16;

/** 全局聊天消息长度上限（按字符计）。 */
export const CHAT_MAX_LEN = 200;

/** 场景数据中的床位数，必须等于该厅的 capacity。 */
export const SCENE_BED_COUNT = 256;
