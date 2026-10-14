import { describe, expect, it } from 'vitest';

import { SLEEP_TRACE_CLEAR_HOUR } from '../../shared/constants';
import { HALLS } from '../../shared/hall-registry';
import { cleanupMessages, nextCleanupAt, previousCleanupAt } from '../cleanup';

const at = (iso: string): number => Date.parse(iso);

/** 独立于实现：直接用 Intl 读出某时刻在该时区的钟点，用来核对「推出来的就是 08:00」 */
const wallClock = (timezone: string, time: number): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(time);

describe('下一个清理时刻（厅时区 08:00）', () => {
  it('Asia/Shanghai（无夏令时）：今天 08:00 已过就取明天，未到就取今天', () => {
    // 厅时区 06-11 07:30 → 今天（厅时区的今天）还有半小时到点
    expect(nextCleanupAt('Asia/Shanghai', at('2025-06-10T23:30:00Z'))).toBe(at('2025-06-11T00:00:00Z'));
    // 厅时区 06-10 08:30 → 已过，取明天
    expect(nextCleanupAt('Asia/Shanghai', at('2025-06-10T00:30:00Z'))).toBe(at('2025-06-11T00:00:00Z'));
    // 厅时区 06-10 07:59 → 还没到
    expect(nextCleanupAt('Asia/Shanghai', at('2025-06-09T23:59:00Z'))).toBe(at('2025-06-10T00:00:00Z'));
  });

  it('跨日：厅时区的半夜推出来的 08:00 落在 UTC 的次日', () => {
    // 上海 06-10 23:30 → 目标 06-11 08:00（UTC 06-11 00:00）
    expect(nextCleanupAt('Asia/Shanghai', at('2025-06-10T15:30:00Z'))).toBe(at('2025-06-11T00:00:00Z'));
  });

  it('正好 08:00 → 取明天（日界含当天）', () => {
    expect(nextCleanupAt('Asia/Shanghai', at('2025-06-11T00:00:00Z'))).toBe(at('2025-06-12T00:00:00Z'));
    expect(nextCleanupAt('Europe/Berlin', at('2025-03-30T06:00:00Z'))).toBe(at('2025-03-31T06:00:00Z'));
    expect(nextCleanupAt('America/New_York', at('2025-11-02T13:00:00Z'))).toBe(at('2025-11-03T13:00:00Z'));
  });

  it('Europe/Berlin 夏令时切换日：切换两侧的偏移都要对', () => {
    // 3 月 30 日 02:00→03:00（+01:00 → +02:00）：3 月 29 日深夜推出来的明天 08:00 是 +02:00
    expect(nextCleanupAt('Europe/Berlin', at('2025-03-29T22:00:00Z'))).toBe(at('2025-03-30T06:00:00Z'));
    expect(nextCleanupAt('Europe/Berlin', at('2025-03-30T05:00:00Z'))).toBe(at('2025-03-30T06:00:00Z'));
    // 10 月 26 日 03:00→02:00（+02:00 → +01:00）
    expect(nextCleanupAt('Europe/Berlin', at('2025-10-25T22:00:00Z'))).toBe(at('2025-10-26T07:00:00Z'));
    expect(nextCleanupAt('Europe/Berlin', at('2025-10-26T06:59:00Z'))).toBe(at('2025-10-26T07:00:00Z'));
    expect(nextCleanupAt('Europe/Berlin', at('2025-10-26T07:00:00Z'))).toBe(at('2025-10-27T07:00:00Z'));
  });

  it('America/New_York 夏令时切换日：切换两侧的偏移都要对', () => {
    // 3 月 9 日 02:00→03:00（-05:00 → -04:00）
    expect(nextCleanupAt('America/New_York', at('2025-03-08T20:00:00Z'))).toBe(at('2025-03-09T12:00:00Z'));
    expect(nextCleanupAt('America/New_York', at('2025-03-09T11:00:00Z'))).toBe(at('2025-03-09T12:00:00Z'));
    // 11 月 2 日 02:00→01:00（-04:00 → -05:00）
    expect(nextCleanupAt('America/New_York', at('2025-11-02T04:00:00Z'))).toBe(at('2025-11-02T13:00:00Z'));
    expect(nextCleanupAt('America/New_York', at('2025-11-02T12:59:00Z'))).toBe(at('2025-11-02T13:00:00Z'));
  });

  it('切换日整天扫一遍：推出来的时刻永远是该时区的 08:00，且落在 24 小时内（跨日 25 小时）', () => {
    const sweeps: Array<[string, string, string]> = [
      ['Europe/Berlin', '2025-03-29T00:00:00Z', '2025-03-31T00:00:00Z'],
      ['America/New_York', '2025-11-01T00:00:00Z', '2025-11-03T00:00:00Z'],
    ];
    for (const [timezone, from, to] of sweeps) {
      for (let now = at(from); now < at(to); now += 15 * 60 * 1000) {
        const next = nextCleanupAt(timezone, now);
        expect(wallClock(timezone, next)).toBe(
          `${String(SLEEP_TRACE_CLEAR_HOUR).padStart(2, '0')}:00:00`,
        );
        expect(next).toBeGreaterThan(now);
        expect(next - now).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
      }
    }
  });
});

describe('最近一个清理时刻（实例重建时补跑用）', () => {
  it('正好 08:00 就是它本身；前一秒取昨天，后一秒取今天', () => {
    expect(previousCleanupAt('Asia/Shanghai', at('2025-06-11T00:00:00Z'))).toBe(at('2025-06-11T00:00:00Z'));
    expect(previousCleanupAt('Asia/Shanghai', at('2025-06-10T23:59:59Z'))).toBe(at('2025-06-10T00:00:00Z'));
    expect(previousCleanupAt('Asia/Shanghai', at('2025-06-11T00:00:01Z'))).toBe(at('2025-06-11T00:00:00Z'));
  });

  it('夏令时切换日：边界仍是当天的 08:00（柏林切换当天 08:00 之前仍属前一天）', () => {
    // 3 月 30 日（+01:00 → +02:00）：08:00 之前一秒的边界是 3 月 29 日 08:00 CET
    expect(previousCleanupAt('Europe/Berlin', at('2025-03-30T05:59:59Z'))).toBe(at('2025-03-29T07:00:00Z'));
    expect(previousCleanupAt('Europe/Berlin', at('2025-03-30T06:00:00Z'))).toBe(at('2025-03-30T06:00:00Z'));
    expect(previousCleanupAt('Europe/Berlin', at('2025-03-30T06:00:01Z'))).toBe(at('2025-03-30T06:00:00Z'));
    // 10 月 26 日（+02:00 → +01:00）：切换发生在 08:00 之前，边界时刻的偏移是 +01:00
    expect(previousCleanupAt('Europe/Berlin', at('2025-10-26T06:59:59Z'))).toBe(at('2025-10-25T06:00:00Z'));
    expect(previousCleanupAt('Europe/Berlin', at('2025-10-26T07:00:00Z'))).toBe(at('2025-10-26T07:00:00Z'));
    expect(previousCleanupAt('America/New_York', at('2025-03-09T11:59:59Z'))).toBe(at('2025-03-08T13:00:00Z'));
    expect(previousCleanupAt('America/New_York', at('2025-03-09T12:00:00Z'))).toBe(at('2025-03-09T12:00:00Z'));
    expect(previousCleanupAt('America/New_York', at('2025-11-02T12:59:59Z'))).toBe(at('2025-11-01T12:00:00Z'));
    expect(previousCleanupAt('America/New_York', at('2025-11-02T13:00:00Z'))).toBe(at('2025-11-02T13:00:00Z'));
  });

  it('切换日前后扫一遍：边界永远不大于现在，且是该时区的 08:00', () => {
    const sweeps: Array<[string, string, string]> = [
      ['Europe/Berlin', '2025-03-29T00:00:00Z', '2025-03-31T00:00:00Z'],
      ['America/New_York', '2025-11-01T00:00:00Z', '2025-11-03T00:00:00Z'],
    ];
    for (const [timezone, from, to] of sweeps) {
      for (let now = at(from); now < at(to); now += 15 * 60 * 1000) {
        const previous = previousCleanupAt(timezone, now);
        expect(wallClock(timezone, previous)).toBe('08:00:00');
        expect(previous).toBeLessThanOrEqual(now);
        expect(now - previous).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
      }
    }
  });
});

describe('注册表里每个厅时区都算得出 08:00（含无夏令时的上海）', () => {
  it('一年四个采样点上，下一个与最近一个都是该时区的 08:00', () => {
    for (const hall of HALLS) {
      for (const iso of ['2025-01-15T00:00:00Z', '2025-04-15T00:00:00Z', '2025-07-15T00:00:00Z', '2025-10-15T00:00:00Z']) {
        const now = at(iso);
        const next = nextCleanupAt(hall.timezone, now);
        const previous = previousCleanupAt(hall.timezone, now);
        expect(wallClock(hall.timezone, next), hall.id).toBe(`${String(SLEEP_TRACE_CLEAR_HOUR).padStart(2, '0')}:00:00`);
        expect(wallClock(hall.timezone, previous), hall.id).toBe(`${String(SLEEP_TRACE_CLEAR_HOUR).padStart(2, '0')}:00:00`);
        expect(next, hall.id).toBeGreaterThan(now);
        expect(previous, hall.id).toBeLessThanOrEqual(now);
      }
    }
  });
});

describe('清理要发的下行消息', () => {
  it('睡痕逐人一条 leave，归属释放逐床一条 bed，且先睡痕后归属', () => {
    expect(cleanupMessages(['u_a', 'u_b'], [7, 9])).toEqual([
      { t: 'leave', id: 'u_a' },
      { t: 'leave', id: 'u_b' },
      { t: 'bed', bedNo: 7, owned: false },
      { t: 'bed', bedNo: 9, owned: false },
    ]);
  });

  it('归属为空的历史睡痕行不发 leave（不能发出 id: null）', () => {
    expect(cleanupMessages([null, 'u_a'], [])).toEqual([{ t: 'leave', id: 'u_a' }]);
  });

  it('两个任务都没命中时不发任何消息（实例重建的补跑是常态）', () => {
    expect(cleanupMessages([], [])).toEqual([]);
  });
});
