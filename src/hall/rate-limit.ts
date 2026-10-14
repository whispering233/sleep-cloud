/**
 * 上行限流（见 `docs/design/10-hall-runtime.md` §9）：**固定 1 秒窗口**，每秒整格计数，不引令牌桶。
 * 窗口状态存在连接附加数据里（跨休眠存活），所以这里只做纯计算。
 */
export interface RateWindow {
  windowStart: number;
  count: number;
}

/** 超出限额时**仍然累加计数**：窗口内后续的每条意图都继续被丢弃，不会因为丢弃而重置。 */
export function consumeUpstream(input: {
  window: RateWindow | undefined;
  now: number;
  limit: number;
}): { allowed: boolean; window: RateWindow } {
  const current = input.window;
  if (!current || input.now - current.windowStart >= 1000) {
    return { allowed: true, window: { windowStart: input.now, count: 1 } };
  }
  const count = current.count + 1;
  return { allowed: count <= input.limit, window: { windowStart: current.windowStart, count } };
}
