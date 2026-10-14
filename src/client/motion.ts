/**
 * 位置插值（纯计算）。
 *
 * 两条纪律：
 * 1. **不进 React 的渲染循环**——由 Pixi 的 ticker 每帧调用；
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
 * 渲染时往后坐一个节拍。
 *
 * 服务端每 100ms 发一批「此刻在哪」，如果直接用「现在」去求值，收到的瞬间进度就已经是 1，
 * 小人会每隔 100ms 跳一格；往后坐一个节拍就能在【上一批, 本批】这个窗口里平滑地走完。
 * 代价是画面比服务端晚 100ms（不到半格），换来的是平滑。
 */
export const INTERPOLATION_DELAY_MS = 100;

/** 收到一批权威位置时更新插值窗口（时间为服务端时间轴）。 */
export function nextMotion(previous: Motion | undefined, x: number, y: number, ts: number): Motion {
  // 乱序或重复的批次（正常不会出现，TCP 有序）直接忽略，保留已有窗口
  if (previous && ts <= previous.toTs) return previous;
  if (previous) {
    return { fromX: previous.toX, fromY: previous.toY, toX: x, toY: y, fromTs: previous.toTs, toTs: ts };
  }
  return { fromX: x, fromY: y, toX: x, toY: y, fromTs: ts, toTs: ts };
}

/** 在服务端时间 `serverNow` 时这个人应该画在哪（格坐标，格内是小数）。 */
export function positionAt(motion: Motion, serverNow: number): { x: number; y: number } {
  const span = motion.toTs - motion.fromTs;
  if (span <= 0) return { x: motion.toX, y: motion.toY };
  const progress = Math.min(1, Math.max(0, (serverNow - motion.fromTs) / span));
  return {
    x: motion.fromX + (motion.toX - motion.fromX) * progress,
    y: motion.fromY + (motion.toY - motion.fromY) * progress,
  };
}
