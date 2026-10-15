import { describe, expect, it } from 'vitest';

import {
  ART_SCALE,
  AUTO_SLEEP_MS,
  BED_GAP,
  BED_H,
  BED_OWNERSHIP_TTL_MS,
  BED_W,
  CHAT_MAX_LEN,
  CHAT_LOG_MAX,
  DAILY_WAKE_UTC_HOUR,
  EMOTE_MS,
  GRACE_MS,
  HALL_ID,
  MAX_DPR,
  NICKNAME_MAX_LEN,
  PITCH_X,
  PITCH_Y,
  POOL_SIZE,
  TICK_MS,
  TRACE_TTL_MS,
  UPSTREAM_RATE_PER_SEC,
  WALK_SPEED_PX_PER_S,
} from '../constants';
import { readDoc, tableRows } from './doc';

/** `docs/design/config.md` §1 的三行（厅标识 / 布局版本 / 床位数） */
const docSingleHall = tableRows(readDoc('design/config.md'), '## 1. 只有一个厅', '## 2. 级表');
const docValue = (item: string): string =>
  (docSingleHall.find(([name]) => (name ?? '').replaceAll('`', '') === item)?.[1] ?? '').replaceAll('`', '');

describe('常量与 docs/design/config.md 一致', () => {
  it('时间常量（§3）', () => {
    expect(GRACE_MS).toBe(60_000);
    expect(AUTO_SLEEP_MS).toBe(300_000);
    expect(TICK_MS).toBe(100);
    expect(WALK_SPEED_PX_PER_S).toBe(130);
    expect(TRACE_TTL_MS).toBe(43_200_000);
    expect(DAILY_WAKE_UTC_HOUR).toBe(20);
    expect(BED_OWNERSHIP_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(EMOTE_MS).toBe(2500);
  });

  it('几何常量（§4）与列距/行距', () => {
    expect(ART_SCALE).toBe(0.5);
    expect(BED_W).toBe(61);
    expect(BED_H).toBe(100);
    expect(BED_GAP).toBe(4);
    expect(PITCH_X).toBe(BED_W + BED_GAP);
    expect(PITCH_Y).toBe(BED_H + 56);
    expect(MAX_DPR).toBe(2);
  });

  it('限制（§5）', () => {
    expect(UPSTREAM_RATE_PER_SEC).toBe(5);
    expect(NICKNAME_MAX_LEN).toBe(16);
    expect(CHAT_MAX_LEN).toBe(200);
    expect(CHAT_LOG_MAX).toBe(50);
    expect(POOL_SIZE).toBe(64);
  });

  it('单厅（§1）：厅标识逐字来自文档', () => {
    expect(HALL_ID).toBe(docValue('厅标识'));
  });
});