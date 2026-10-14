import { describe, expect, it } from 'vitest';

import type { Person } from '../../../shared/protocol';
import { bedOutline, hourIn, isDaytime, markerRadius, personAlpha, shouldDrawName } from '../rules';

const TILE = 32;

const sleeper: Person = { id: 'u_1', name: '小明', appearance: 'a1', state: 'asleep', bedNo: 7 };
const walker: Person = { id: 'u_2', name: '阿夜', appearance: 'a2', state: 'roaming', x: 3, y: 4 };
const trace: Person = { id: 'u_3', name: '夜猫', appearance: 'a3', state: 'trace', bedNo: 5 };

describe('床位轮廓梯次', () => {
  it('床上有人 > 睡痕 > 有主空床 > 无主不画', () => {
    expect(bedOutline({ owned: true, occupant: 'asleep' })).toBe('line');
    expect(bedOutline({ owned: true, occupant: 'lying' })).toBe('line');
    expect(bedOutline({ owned: true, occupant: 'trace' })).toBe('trace');
    expect(bedOutline({ owned: true })).toBe('claimed');
    expect(bedOutline({ owned: false })).toBeNull();
  });

  it('占用优先于归属：别人的床有人睡也是 line', () => {
    expect(bedOutline({ owned: false, occupant: 'asleep' })).toBe('line');
  });
});

describe('名字与不透明度', () => {
  it('名字只画在有人的床上，且自己不画', () => {
    expect(shouldDrawName(sleeper, 'u_me')).toBe(true);
    expect(shouldDrawName(trace, 'u_me')).toBe(true);
    expect(shouldDrawName(walker, 'u_me')).toBe(false); // 漫游者默认不显示名字
    expect(shouldDrawName(sleeper, 'u_1')).toBe(false); // 自己一律不画
  });

  it('睡痕的小人整体更暗', () => {
    expect(personAlpha('trace')).toBeLessThan(1);
    expect(personAlpha('roaming')).toBe(1);
    expect(personAlpha('asleep')).toBe(1);
  });
});

describe('暖灯标记', () => {
  it('有最小屏幕尺寸下限：缩小时不消失', () => {
    for (const scale of [0.3, 0.5, 1, 2.5]) {
      expect(markerRadius(scale, TILE) * scale).toBeGreaterThanOrEqual(5);
    }
  });

  it('也不允许大到盖住整张床', () => {
    for (const scale of [0.3, 1, 2.5]) {
      expect(markerRadius(scale, TILE)).toBeLessThanOrEqual(TILE * 0.6);
    }
  });
});

describe('昼夜只看厅的时区', () => {
  it('按厅时区取小时数', () => {
    const noonUtc = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(hourIn('UTC', noonUtc)).toBe(12);
    expect(hourIn('Asia/Shanghai', noonUtc)).toBe(20); // UTC+8
  });

  it('06:00–18:00 是白天，其余是夜晚', () => {
    expect(isDaytime('UTC', Date.UTC(2026, 0, 15, 6, 0, 0))).toBe(true);
    expect(isDaytime('UTC', Date.UTC(2026, 0, 15, 17, 59, 0))).toBe(true);
    expect(isDaytime('UTC', Date.UTC(2026, 0, 15, 18, 0, 0))).toBe(false);
    expect(isDaytime('UTC', Date.UTC(2026, 0, 15, 2, 0, 0))).toBe(false);
  });

  it('同一个 UTC 时刻，不同时区的厅昼夜可能不同', () => {
    const moment = Date.UTC(2026, 0, 15, 23, 0, 0); // UTC 23:00
    expect(isDaytime('UTC', moment)).toBe(false);
    expect(isDaytime('Asia/Shanghai', moment)).toBe(true); // 次日 07:00
  });

  it('时区名非法回落到 UTC，不抛异常', () => {
    expect(() => isDaytime('Mars/Olympus', Date.now())).not.toThrow();
  });
});
