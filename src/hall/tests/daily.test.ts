import { describe, expect, it } from 'vitest';

import { DAILY_WAKE_UTC_HOUR, TRACE_TTL_MS } from '../../shared/constants';
import { HALL_LEVELS } from '../../shared/layout';
import { nextDailyWakeAt, previousDailyWakeAt, shouldSettleDaily } from '../daily';
import { previousLevelCapacity } from '../level-rules';

const at = (iso: string): number => Date.parse(iso);

describe('每日唤醒排期（UTC 20:00，无时区换算）', () => {
  it('今天这一点已过（或正好到点）就取明天，未到就取今天', () => {
    expect(nextDailyWakeAt(at('2025-06-10T19:59:59Z'))).toBe(at('2025-06-10T20:00:00Z'));
    expect(nextDailyWakeAt(at('2025-06-10T20:00:00Z'))).toBe(at('2025-06-11T20:00:00Z'));
    expect(nextDailyWakeAt(at('2025-06-10T20:00:01Z'))).toBe(at('2025-06-11T20:00:00Z'));
    expect(nextDailyWakeAt(at('2025-06-10T23:59:59Z'))).toBe(at('2025-06-11T20:00:00Z'));
  });

  it('跨月跨年都只是「下一个 UTC 20:00」', () => {
    expect(nextDailyWakeAt(at('2025-12-31T21:00:00Z'))).toBe(at('2026-01-01T20:00:00Z'));
    expect(nextDailyWakeAt(at('2026-02-28T21:00:00Z'))).toBe(at('2026-03-01T20:00:00Z'));
  });

  it('最近一个到过的点：正好到点就是它本身（实例重建时排它以便当场补跑）', () => {
    expect(previousDailyWakeAt(at('2025-06-11T20:00:00Z'))).toBe(at('2025-06-11T20:00:00Z'));
    expect(previousDailyWakeAt(at('2025-06-11T19:59:59Z'))).toBe(at('2025-06-10T20:00:00Z'));
    expect(previousDailyWakeAt(at('2025-06-11T20:00:01Z'))).toBe(at('2025-06-11T20:00:00Z'));
  });

  it('两个方向的排期永远落在 UTC 20:00，且相隔一个整天', () => {
    for (const iso of ['2025-01-15T03:00:00Z', '2025-04-15T19:00:00Z', '2025-07-15T21:00:00Z', '2025-10-15T12:00:00Z']) {
      const now = at(iso);
      const next = nextDailyWakeAt(now);
      const previous = previousDailyWakeAt(now);
      expect(new Date(next).getUTCHours()).toBe(DAILY_WAKE_UTC_HOUR);
      expect(new Date(previous).getUTCHours()).toBe(DAILY_WAKE_UTC_HOUR);
      expect(next).toBeGreaterThan(now);
      expect(previous).toBeLessThanOrEqual(now);
      expect(next - previous).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('睡痕 TTL 与每日唤醒是两回事：每日唤醒只结算归属与缩级，睡痕过期不靠它', () => {
    // 12 小时的 TTL 与「一天一次」的排期不是一回事（写在一起是为了钉住「没有清理任务」这条语义）
    expect(TRACE_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe('该不该结算这个 20:00（`meta.daily_wake_at` 约束）', () => {
  const settled = at('2025-06-11T20:00:00Z');

  it('从未结算（undefined）→ 允许补跑一次', () => {
    expect(shouldSettleDaily(at('2025-06-11T03:00:00Z'), undefined)).toBe(true);
  });

  it('越过一个新的 20:00（正好到点也算）→ 结算', () => {
    const previousBoundary = at('2025-06-10T20:00:00Z');
    expect(shouldSettleDaily(at('2025-06-11T20:00:00Z'), previousBoundary)).toBe(true);
    expect(shouldSettleDaily(at('2025-06-11T20:00:01Z'), previousBoundary)).toBe(true);
  });

  it('同一个 20:00 已经结算过 → 不补跑（一天里重建多少次都只结算一次）', () => {
    const moment = [
      '2025-06-11T20:00:00Z',
      '2025-06-11T21:00:00Z',
      '2025-06-11T23:59:59Z',
      '2025-06-12T03:00:00Z',
      '2025-06-12T19:59:59Z',
    ];
    for (const iso of moment) expect(shouldSettleDaily(at(iso), settled), iso).toBe(false);
    expect(shouldSettleDaily(at('2025-06-12T20:00:00Z'), settled)).toBe(true); // 跨到下一个边界才有下一次
  });

  it('两个 20:00 之间最多结算一次：一天里重建多少次都只跑一轮', () => {
    let settledAt: number | undefined = at('2025-06-10T20:00:00Z'); // 上一个边界已经结算过
    let runs = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      const now = at(`2025-06-11T${String(hour).padStart(2, '0')}:17:00Z`);
      if (!shouldSettleDaily(now, settledAt)) continue;
      runs += 1;
      settledAt = previousDailyWakeAt(now); // 与 `runDailyWake()` 写回的是同一个值
    }
    expect(runs).toBe(1);
    expect(settledAt).toBe(at('2025-06-11T20:00:00Z'));
  });

  it('忙厅里对象反复重建也只缩一档：不会一次连缩两档', () => {
    // 每个「重建」＝一个新实例：堆是空的，边界只能从 `meta.daily_wake_at` 读回来
    const third = (HALL_LEVELS[2] as { capacity: number }).capacity;
    const second = (HALL_LEVELS[1] as { capacity: number }).capacity;
    let bedCount = third;
    let settledAt: number | undefined;
    let resizes = 0;
    for (let rebuild = 0; rebuild < 5; rebuild += 1) {
      const now = at('2025-06-11T20:30:00Z') + rebuild * 60_000;
      if (!shouldSettleDaily(now, settledAt)) continue;
      settledAt = previousDailyWakeAt(now); // `runDailyWake()` 写回边界
      const next = previousLevelCapacity(bedCount, 0, false); // 外圈全无主无占用，已用 0
      if (next === undefined) continue;
      bedCount = next;
      resizes += 1;
    }
    expect(resizes).toBe(1);
    expect(bedCount).toBe(second);
  });
});