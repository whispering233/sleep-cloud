import { describe, expect, it } from 'vitest';

import type { Person } from '../../../shared/protocol';
import {
  bedOutline,
  hourIn,
  isDaytime,
  markerRadius,
  PERSON_HIT_TILES,
  personAlpha,
  personHit,
  shouldDrawName,
  tapTargetFor,
} from '../rules';
import type { PersonSpot } from '../rules';

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

describe('轻点命中', () => {
  const upper: PersonSpot = { id: 'u_other', x: 3.2, y: 4.1 };
  const lower: PersonSpot = { id: 'u_below', x: 3.4, y: 4.4 };
  const self: PersonSpot = { id: 'u_me', x: 5.5, y: 5.5 };

  it('半径内取 y 最大者（更靠下 = 更靠前，与按 y 排序的遮挡一致）', () => {
    expect(personHit([upper, lower], { x: 3.3, y: 4.2 }, PERSON_HIT_TILES)?.id).toBe('u_below');
    expect(personHit([lower, upper], { x: 3.3, y: 4.2 }, PERSON_HIT_TILES)?.id).toBe('u_below');
    expect(personHit([upper], { x: 5, y: 5 }, PERSON_HIT_TILES)).toBeUndefined();
  });

  it('半径边界：正好等于半径算命中，超出不算', () => {
    const spot: PersonSpot = { id: 'u_a', x: 0, y: 0 };
    expect(personHit([spot], { x: PERSON_HIT_TILES, y: 0 }, PERSON_HIT_TILES)?.id).toBe('u_a');
    expect(personHit([spot], { x: PERSON_HIT_TILES + 0.01, y: 0 }, PERSON_HIT_TILES)).toBeUndefined();
  });

  it('优先级：人 > 床 > 地面', () => {
    expect(tapTargetFor({ point: { x: 3.2, y: 4.1 }, spots: [upper], bedNo: 7, walkable: true })).toEqual({
      kind: 'select',
      id: 'u_other',
    });
    expect(tapTargetFor({ point: { x: 3, y: 3 }, spots: [], bedNo: 7, walkable: true })).toEqual({
      kind: 'lie',
      bedNo: 7,
    });
    expect(tapTargetFor({ point: { x: 3, y: 3 }, spots: [], walkable: true })).toEqual({ kind: 'walk', x: 3, y: 3 });
  });

  it('点自己：不做任何动作（即使自己站在空床上）', () => {
    expect(
      tapTargetFor({ point: { x: 5.5, y: 5.5 }, spots: [self], selfId: 'u_me', bedNo: 9, walkable: false }),
    ).toEqual({ kind: 'none' });
  });

  it('排除自己：自己与别人同时命中时选别人', () => {
    const spots = [self, { id: 'u_other', x: 5.6, y: 5.4 }];
    expect(tapTargetFor({ point: { x: 5.5, y: 5.5 }, spots, selfId: 'u_me', walkable: true })).toEqual({
      kind: 'select',
      id: 'u_other',
    });
  });

  it('空床可以躺（不管有没有主）；床上有人时什么都不做且绝不落成 walk', () => {
    expect(tapTargetFor({ point: { x: 2, y: 2 }, spots: [], bedNo: 42, walkable: false })).toEqual({
      kind: 'lie',
      bedNo: 42,
    });
    expect(
      tapTargetFor({ point: { x: 2, y: 2 }, spots: [], selfId: 'u_me', residentId: 'u_me', bedNo: 42, walkable: false }),
    ).toEqual({ kind: 'none' });
    expect(
      tapTargetFor({ point: { x: 2, y: 2 }, spots: [], residentId: 'u_other', bedNo: 42, walkable: false }),
    ).toEqual({ kind: 'none' });
  });

  it('不可走的格子（墙 / 厅外）：什么都不做', () => {
    expect(tapTargetFor({ point: { x: -1, y: 0 }, spots: [], walkable: false })).toEqual({ kind: 'none' });
  });

  it('走动的目标是整格（向下取整），不是浮点值——不然服务端会回 3006', () => {
    expect(tapTargetFor({ point: { x: 3.9, y: 4.2 }, spots: [], walkable: true })).toEqual({
      kind: 'walk',
      x: 3,
      y: 4,
    });
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
