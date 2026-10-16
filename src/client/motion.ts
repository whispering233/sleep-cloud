import { TELEPORT_SNAP_PX } from '../shared/constants';

/**
 * 位置插值（纯计算）。坐标是**世界像素**（`pos.items` 就是世界像素，客户端不再乘格边长）。
 *
 * 两条纪律：
 * 1. **不进 React 的渲染循环**——由 Phaser 的 ticker 每帧调用；
 * 2. **按服务端时间戳插值**，不按「收到两条消息的间隔」推进动画：服务端的节拍只是尽力而为的唤醒。
 */
export interface Motion {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromTs: number;
  toTs: number;
}

/**
 * 渲染时往后坐的那一段滞后：**夹取的下限**，也是窗口跨度未知（≤ 0）时的取值。
 */
export const INTERPOLATION_DELAY_MS = 100;

/** 滞后的上限：服务端偶尔卡一大拍时画面也不至于落后太多（400ms ≈ 一格半的走道，见 `WALK_SPEED_PX_PER_S`）。 */
export const MAX_INTERPOLATION_DELAY_MS = 400;

/**
 * 渲染滞后 = **这个窗口自己的跨度**，夹在 [100ms, 400ms]。
 *
 * 取「本窗口的跨度」而不是「两批的到达间隔」：位置按服务端时间戳求值（文件头纪律 2），
 * 滞后只要等于窗口跨度，收到新批的那一刻求出来的就是上一批的终点——位置连续，不跳格；
 * 随后的 `span` 毫秒里线性走到终点。
 *
 * **不要再乘一个抖动预算系数**：服务端已经每拍必发（跨度等长），额外预算 = 每拍固定制造一个
 * 「滞后 − 跨度」的台阶 + 半程两倍速，正是要消灭的「跳一下→走一段」（见 `docs/api/20-api-ws.md` §4.7）。
 */
export function interpolationDelay(motion: Motion): number {
  const span = motion.toTs - motion.fromTs;
  if (span <= 0) return INTERPOLATION_DELAY_MS;
  return Math.min(MAX_INTERPOLATION_DELAY_MS, Math.max(INTERPOLATION_DELAY_MS, span));
}

/** 收到一批权威位置时更新插值窗口（时间为服务端时间轴）。 */
export function nextMotion(previous: Motion | undefined, x: number, y: number, ts: number): Motion {
  // 乱序或重复的批次（正常不会出现，TCP 有序）直接忽略，保留已有窗口
  if (previous && ts <= previous.toTs) return previous;
  if (previous) {
    if (Math.hypot(x - previous.toX, y - previous.toY) > TELEPORT_SNAP_PX) {
      // 跳变类位置（`goHome` 瞬移）：塌缩成零跨度窗口，`positionAt` 直接给终点（落位、不拉丝）
      return { fromX: x, fromY: y, toX: x, toY: y, fromTs: ts, toTs: ts };
    }
    return { fromX: previous.toX, fromY: previous.toY, toX: x, toY: y, fromTs: previous.toTs, toTs: ts };
  }
  return { fromX: x, fromY: y, toX: x, toY: y, fromTs: ts, toTs: ts };
}

/**
 * 插值窗口收尾的宽限：判「还在走」时把边界往后放宽一点。
 *
 * 服务端的节拍只是尽力而为，最后一批位置常常刚好卡在窗口边界上；一越过 `toTs` 就判没在走，
 * 跟随会在最后一帧上顿一下，而且走完的落位那一帧也会被省掉。
 */
export const MOTION_SLACK_MS = 150;

/**
 * 「这个人此刻正在被插值」：插值窗口还开着（`serverNow` 没越过 `toTs` 再多一个宽限）。
 *
 * 不能拿「`motion` 里有没有条目」当依据——服务端只在移动时发位置，而客户端从不主动删除走完的条目
 * （只在进厅 / 上床 / 离开 / 快照时删）。所以「有条目」只说明【曾经】走过，不说明正在走。
 */
export function isInterpolating(motion: Motion | undefined, serverNow: number): boolean {
  return motion !== undefined && serverNow < motion.toTs + MOTION_SLACK_MS;
}

/** 这批人里只要有一个还在插值（ticker 的重画判定用）。 */
export function anyInterpolating(motions: Iterable<Motion>, serverNow: number): boolean {
  for (const motion of motions) if (isInterpolating(motion, serverNow)) return true;
  return false;
}

/** 在服务端时间 `serverNow` 时这个人应该画在哪（世界像素）。 */
export function positionAt(motion: Motion, serverNow: number): { x: number; y: number } {
  const span = motion.toTs - motion.fromTs;
  if (span <= 0) return { x: motion.toX, y: motion.toY };

  // 跨度超过滞后上限（缺口几十秒、或服务端卡了一大拍）：**不跨这个窗口插值**——跨长窗口插值就是
  // 「快进一格」。直接取窗口那一侧的端点：渲染时间在窗口之前取起点，之后取终点。
  if (span > MAX_INTERPOLATION_DELAY_MS) {
    return serverNow < motion.toTs
      ? { x: motion.fromX, y: motion.fromY }
      : { x: motion.toX, y: motion.toY };
  }

  const progress = Math.min(1, Math.max(0, (serverNow - motion.fromTs) / span));
  return {
    x: motion.fromX + (motion.toX - motion.fromX) * progress,
    y: motion.fromY + (motion.toY - motion.fromY) * progress,
  };
}
