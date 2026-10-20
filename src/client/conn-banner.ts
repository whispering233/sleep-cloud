import type { Connection, HaltReason } from './conn-state';
import { blockedTextFor } from './error-text';

/**
 * 连接提示条的文案判据：**纯函数**，时间一律由入参 `now` 传入（与 `conn-state.ts` 同一套写法）。
 * 语义见 `docs/api/20-api-ws.md` §5.1：`connecting` 的头 3 秒**不显示**（否则每次进厅闪一下）、
 * `offline` 与超过 3 秒的 `connecting` 显示，且**不自动消失**（唯一的消失条件是重连成功）。
 * `halted`（§5.1.1）是常驻的：它不消失，也不再自动重连。
 */
export const CONNECT_BANNER_DELAY_MS = 3_000;

export interface ConnBanner {
  visible: boolean;
  text: string;
  /** 「尝试连接」按钮：停住之后**不再出现**——点它只会立刻再失败一次（恢复只有刷新页面）。 */
  retry: boolean;
}

/** `connectingSinceMs` 是进入 `connecting` 的本地时刻；不在建连中时传 `undefined`。 */
export function connBannerOf(input: {
  connection: Connection;
  connectingSinceMs?: number;
  halt?: HaltReason;
  /** 封禁到期时刻（`null` = 永久）：只有 `halt === 'blocked'` 用得上。 */
  untilAt?: number | null;
  now: number;
}): ConnBanner {
  if (input.connection === 'online') return { visible: false, text: '', retry: false };
  if (input.connection === 'halted') {
    return { visible: true, text: haltedTextOf(input.halt, input.untilAt, input.now), retry: false };
  }
  if (input.connection === 'offline') return { visible: true, text: '连接已断开，正在重连…', retry: true };

  const elapsed = input.connectingSinceMs === undefined ? 0 : input.now - input.connectingSinceMs;
  return { visible: elapsed >= CONNECT_BANNER_DELAY_MS, text: '正在连接…', retry: true };
}

/** 停住的三种文案：封禁给到到期时间（不给原因），另两种只说一句该怎么自救。 */
function haltedTextOf(reason: HaltReason | undefined, untilAt: number | null | undefined, now: number): string {
  if (reason === 'blocked') return blockedTextFor(untilAt ?? null, now);
  if (reason === 'replaced') return '你已在别处打开';
  return '资源已更新，请刷新页面';
}
