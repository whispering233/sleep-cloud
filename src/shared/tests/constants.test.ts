import { describe, expect, it } from 'vitest';

import {
  AUTO_SLEEP_MS,
  BED_OWNERSHIP_TTL_MS,
  CHAT_MAX_LEN,
  CHAT_LOG_MAX,
  GRACE_MS,
  MOVE_MS_PER_TILE,
  NICKNAME_MAX_LEN,
  SCENE_BED_COUNT,
  SLEEP_TRACE_CLEAR_HOUR,
  TICK_MS,
  UPSTREAM_RATE_PER_SEC,
} from '../constants';

describe('常量与 docs/design/config.md 一致', () => {
  it('时间常量', () => {
    expect(GRACE_MS).toBe(60_000);
    expect(AUTO_SLEEP_MS).toBe(300_000);
    expect(TICK_MS).toBe(100);
    expect(MOVE_MS_PER_TILE).toBe(250);
    expect(SLEEP_TRACE_CLEAR_HOUR).toBe(8);
    expect(BED_OWNERSHIP_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('限制', () => {
    expect(UPSTREAM_RATE_PER_SEC).toBe(5);
    expect(NICKNAME_MAX_LEN).toBe(16);
    expect(CHAT_MAX_LEN).toBe(200);
    expect(CHAT_LOG_MAX).toBe(50);
    expect(SCENE_BED_COUNT).toBe(256);
  });
});
