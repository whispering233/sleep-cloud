import type { Connection } from './conn-state';

/**
 * 连接提示条的文案判据：**纯函数**，时间一律由入参 `now` 传入（与 `conn-state.ts` 同一套写法）。
 * 语义见 `docs/api/20-api-ws.md` §5.1：`connecting` 的头 3 秒**不显示**（否则每次进厅闪一下）、
 * `offline` 与超过 3 秒的 `connecting` 显示，且**不自动消失**（唯一的消失条件是重连成功）。
 */
export const CONNECT_BANNER_DELAY_MS = 3_000;

export interface ConnBanner {
  visible: boolean;
  text: string;
}

/** `connectingSinceMs` 是进入 `connecting` 的本地时刻；不在建连中时传 `undefined`。 */
export function connBannerOf(input: {
  connection: Connection;
  connectingSinceMs?: number;
  now: number;
}): ConnBanner {
  if (input.connection === 'online') return { visible: false, text: '' };
  if (input.connection === 'offline') return { visible: true, text: '连接已断开，正在重连…' };

  const elapsed = input.connectingSinceMs === undefined ? 0 : input.now - input.connectingSinceMs;
  return { visible: elapsed >= CONNECT_BANNER_DELAY_MS, text: '正在连接…' };
}
