import { describe, expect, it } from 'vitest';

import { BED_H, BED_W, PITCH_X, PITCH_Y } from '../../../shared/constants';
import type { Person } from '../../../shared/protocol';
import { PITCH_X as PX } from '../../../shared/constants';
import { interpolationDelay, nextMotion, positionAt } from '../../motion';
import type { Motion } from '../../motion';
import {
  PERSON_HIT_PX,
  bedDashSegments,
  bedOutline,
  bedPaintSignature,
  cameraStep,
  dashSegments,
  followStep,
  isFaded,
  personAlpha,
  personHit,
  personPoint,
  shouldDrawName,
  tapTargetFor,
} from '../rules';
import type { PersonSpot } from '../rules';
import { MARKER_RADIUS } from '../views';

const sleeper: Person = { id: 'u_1', name: '小明', appearance: 'boy', state: 'asleep', bedNo: 7 };
const walker: Person = { id: 'u_2', name: '阿夜', appearance: 'girl', state: 'roaming', x: 300, y: 280 };
const trace: Person = { id: 'u_3', name: '夜猫', appearance: 'boy', state: 'trace', bedNo: 5 };

describe('床位轮廓：占用走颜色、归属走线型', () => {
  it('无主空床画出来，用虚线（它是「这里可以躺」的唯一提示）', () => {
    expect(bedOutline({ owned: false })).toEqual({ tier: 'claimed', dashed: true });
  });

  it('有主空床是 claimed 实线', () => {
    expect(bedOutline({ owned: true })).toEqual({ tier: 'claimed', dashed: false });
  });

  it('睡痕是 trace 实线', () => {
    expect(bedOutline({ owned: true, occupant: 'trace' })).toEqual({ tier: 'trace', dashed: false });
  });

  it('床上有人是 line 实线（lying 与 asleep 同梯次）', () => {
    expect(bedOutline({ owned: true, occupant: 'lying' })).toEqual({ tier: 'line', dashed: false });
    expect(bedOutline({ owned: false, occupant: 'asleep' })).toEqual({ tier: 'line', dashed: false });
  });

  it('占用优先于归属：别人的床有人睡也是 line 实线', () => {
    expect(bedOutline({ owned: true, occupant: 'asleep' })).toEqual({ tier: 'line', dashed: false });
  });
});

describe('虚线分段', () => {
  it('按「实线段 + 间隔」的周期定段数', () => {
    expect(dashSegments({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, dash: 6, gap: 4 })).toHaveLength(10);
  });

  it('首段从起点开始、末段正好落在终点（不悬挂半段），覆盖长度等于边长', () => {
    const segments = dashSegments({ from: { x: 0, y: 0 }, to: { x: 57, y: 0 }, dash: 6, gap: 4 });
    expect(segments[0]?.x1).toBe(0);
    expect(segments[segments.length - 1]?.x2).toBeCloseTo(57, 6);
  });

  it('边比一段还短时只给一段：退化也不能跑到边外', () => {
    const segments = dashSegments({ from: { x: 0, y: 0 }, to: { x: 3, y: 0 }, dash: 6, gap: 4 });
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 3, y2: 0 }]);
  });

  it('零长度的边不产生段（不画零长线段）', () => {
    expect(dashSegments({ from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, dash: 6, gap: 4 })).toEqual([]);
  });
});

describe('一张床的四条边各切成虚线', () => {
  const width = 57;
  const height = 96;
  const segments = bedDashSegments({ x: 2, y: 2, width, height, dash: 6, gap: 4 });

  it('每段都贴在这张床的矩形边界上（不越界）', () => {
    for (const segment of segments) {
      for (const [x, y] of [
        [segment.x1, segment.y1],
        [segment.x2, segment.y2],
      ] as Array<[number, number]>) {
        const onEdge =
          (x === 2 || x === 2 + width || y === 2 || y === 2 + height) &&
          x >= 2 &&
          x <= 2 + width &&
          y >= 2 &&
          y <= 2 + height;
        expect(onEdge).toBe(true);
      }
    }
  });

  it('四个角各出现一次：边与边首尾相接，不漏角也不重复画边', () => {
    const corners = [
      { x: 2, y: 2 },
      { x: 2 + width, y: 2 },
      { x: 2 + width, y: 2 + height },
      { x: 2, y: 2 + height },
    ];
    for (const corner of corners) {
      const hits = segments.filter((segment) => segment.x1 === corner.x && segment.y1 === corner.y);
      expect(hits, `角 (${corner.x}, ${corner.y})`).toHaveLength(1);
    }
  });
});

describe('床位画法签名', () => {
  const paint = (outline: ReturnType<typeof bedOutline>, mine: boolean) => bedPaintSignature({ outline, mine });

  it('无变化时签名稳定（否则每一帧都会重建视野里那几十张床的图形）', () => {
    expect(paint(bedOutline({ owned: false }), false)).toBe(paint(bedOutline({ owned: false }), false));
  });

  it('占用梯次 / 归属线型 / 我的床标记 任一变化 → 签名变化', () => {
    const base = paint(bedOutline({ owned: true }), false);
    expect(paint(bedOutline({ owned: true, occupant: 'asleep' }), false)).not.toBe(base);
    expect(paint(bedOutline({ owned: false }), false)).not.toBe(base);
    expect(paint(bedOutline({ owned: true }), true)).not.toBe(base);
  });
});

describe('名字、不透明度与睡痕淡出', () => {
  it('名字只画在有人的床上，且自己不画', () => {
    expect(shouldDrawName(sleeper, 'u_me')).toBe(true);
    expect(shouldDrawName(sleeper, 'u_1')).toBe(false);
    expect(shouldDrawName(walker, 'u_me')).toBe(false);
  });

  it('睡痕的小人整体更暗', () => {
    expect(personAlpha('trace')).toBeLessThan(1);
    expect(personAlpha('roaming')).toBe(1);
    expect(personAlpha('asleep')).toBe(1);
  });

  it('睡痕到期由本地推导（比对 traceUntil，不挂定时器）', () => {
    const untilNow = { ...trace, traceUntil: 1000 };
    expect(isFaded(untilNow, 999)).toBe(false);
    expect(isFaded(untilNow, 1000)).toBe(true);
    expect(isFaded(trace, 10_000_000)).toBe(false); // 没有 traceUntil 的条目（在线者）不会被淡出
  });
});

describe('轻点命中（世界像素）', () => {
  const upper: PersonSpot = { id: 'u_other', x: 300, y: 280 };
  const lower: PersonSpot = { id: 'u_below', x: 306, y: 292 };
  const self: PersonSpot = { id: 'u_me', x: 812.5, y: 430 };

  it('半径内取 y 最大者（更靠下 = 更靠前，与按 y 排序的遮挡一致）', () => {
    expect(personHit([upper, lower], { x: 303, y: 285 }, PERSON_HIT_PX)?.id).toBe('u_below');
    expect(personHit([lower, upper], { x: 303, y: 285 }, PERSON_HIT_PX)?.id).toBe('u_below');
    expect(personHit([upper], { x: 500, y: 500 }, PERSON_HIT_PX)).toBeUndefined();
  });

  it('半径边界：正好等于半径算命中，超出不算', () => {
    const spot: PersonSpot = { id: 'u_a', x: 0, y: 0 };
    expect(personHit([spot], { x: PERSON_HIT_PX, y: 0 }, PERSON_HIT_PX)?.id).toBe('u_a');
    expect(personHit([spot], { x: PERSON_HIT_PX + 0.01, y: 0 }, PERSON_HIT_PX)).toBeUndefined();
  });

  it('优先级：人 > 空床 > 地面', () => {
    expect(tapTargetFor({ point: { x: 300, y: 280 }, spots: [upper], bedNo: 7 })).toEqual({
      kind: 'select',
      id: 'u_other',
    });
    expect(tapTargetFor({ point: { x: 812, y: 316 }, spots: [], bedNo: 7 })).toEqual({ kind: 'lie', bedNo: 7 });
    expect(tapTargetFor({ point: { x: 1092, y: 128 }, spots: [], walkTarget: { x: 1092, y: 128 } })).toEqual({
      kind: 'walk',
      x: 1092,
      y: 128,
    });
  });

  it('点自己：相机居中自己（即使自己站在床上）', () => {
    expect(tapTargetFor({ point: { x: 812, y: 430 }, spots: [self], selfId: 'u_me', bedNo: 9 })).toEqual({
      kind: 'recenter',
    });
    expect(
      tapTargetFor({ point: { x: 812, y: 430 }, spots: [self], selfId: 'u_me', walkTarget: { x: 812, y: 430 } }),
    ).toEqual({ kind: 'recenter' });
  });

  it('点自己的床但人不在命中半径内：`none`（回中只认自己这个点，不认床位）', () => {
    expect(tapTargetFor({ point: { x: 64, y: 64 }, spots: [self], selfId: 'u_me', residentId: 'u_me', bedNo: 42 })).toEqual(
      { kind: 'none' },
    );
  });

  it('排除自己：自己与别人同时命中时选别人', () => {
    const spots = [self, { id: 'u_other', x: 815, y: 428 }];
    expect(tapTargetFor({ point: { x: 812.5, y: 430 }, spots, selfId: 'u_me', walkTarget: { x: 812.5, y: 430 } })).toEqual({
      kind: 'select',
      id: 'u_other',
    });
  });

  it('空床可以躺（不管有没有主）；床上有人时什么都不做且绝不落成 walk', () => {
    expect(tapTargetFor({ point: { x: 812, y: 316 }, spots: [], bedNo: 42 })).toEqual({ kind: 'lie', bedNo: 42 });
    expect(tapTargetFor({ point: { x: 812, y: 316 }, spots: [], residentId: 'u_other', bedNo: 42 })).toEqual({
      kind: 'none',
    });
    expect(tapTargetFor({ point: { x: 812, y: 316 }, spots: [], selfId: 'u_me', residentId: 'u_me', bedNo: 42 })).toEqual(
      { kind: 'none' },
    );
  });

  it('没有可走的街网点（厅外、床缝）：什么都不做（服务端会回 3006，别发）', () => {
    expect(tapTargetFor({ point: { x: -20, y: 0 }, spots: [] })).toEqual({ kind: 'none' });
    expect(tapTargetFor({ point: { x: 100, y: 50 }, spots: [] })).toEqual({ kind: 'none' });
  });

  it('走动的目标就是吸附后的那个点（含小数），不再向下取整到格', () => {
    expect(tapTargetFor({ point: { x: 1092.4, y: 129.6 }, spots: [], walkTarget: { x: 1092.4, y: 128 } })).toEqual({
      kind: 'walk',
      x: 1092.4,
      y: 128,
    });
  });
});

describe('跟随每帧的一步（`cameraStep`）', () => {
  it('步进不超过 maxPxPerS × dt/1000，超大距离也一样', () => {
    const far = cameraStep({ scroll: { x: 0, y: 0 }, target: { x: 10000, y: 0 }, dtMs: 16, maxPxPerS: 500 });
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(8, 6);
    expect(far.y).toBe(0);
  });

  it('单调趋近且不越过目标：距离小于一步时直接落到目标', () => {
    const near = cameraStep({ scroll: { x: 0, y: 0 }, target: { x: 3, y: 4 }, dtMs: 100, maxPxPerS: 500 });
    expect(near).toEqual({ x: 3, y: 4 });
  });

  it('帧率无关：同一段 dt 拆成一帧与拆成两帧，累计位移一致', () => {
    const one = cameraStep({ scroll: { x: 0, y: 0 }, target: { x: 1000, y: 0 }, dtMs: 40, maxPxPerS: 500 });
    const half = cameraStep({ scroll: { x: 0, y: 0 }, target: { x: 1000, y: 0 }, dtMs: 20, maxPxPerS: 500 });
    const two = cameraStep({ scroll: half, target: { x: 1000, y: 0 }, dtMs: 20, maxPxPerS: 500 });
    expect(two.x).toBeCloseTo(one.x, 6);
  });
});

describe('取位点（`personPoint`）：渲染与跟随共用同一个返回值', () => {
  it('漫游中 = 渲染用的那一个点（`positionAt` + 本窗口滞后）', () => {
    const motion = nextMotion(undefined, 100, 0, 1000);
    expect(personPoint({ person: walker, motion, serverNow: 1050 })).toEqual(
      positionAt(motion, 1050 - interpolationDelay(motion)),
    );
  });

  it('窗口未知时用权威坐标；非漫游用落位点，取不到落位点就没得画', () => {
    expect(personPoint({ person: walker, motion: undefined, serverNow: 1000 })).toEqual({ x: walker.x, y: walker.y });
    expect(personPoint({ person: sleeper, motion: undefined, bedPoint: { x: 1, y: 2 }, serverNow: 1000 })).toEqual({
      x: 1,
      y: 2,
    });
    expect(personPoint({ person: sleeper, motion: undefined, serverNow: 1000 })).toBeUndefined();
  });
});

describe('跟随每帧的一步（`followStep`）', () => {
  const center = { x: 500, y: 500 };
  const box = { halfWidth: 100, halfHeight: 100, dtMs: 16, maxPxPerS: 500 };

  it('还在死区里：镜头一动不动', () => {
    expect(followStep({ point: { x: 520, y: 480 }, center, ...box })).toEqual(center);
  });

  it('离得远：按 maxPxPerS 追，且不越过', () => {
    const next = followStep({ point: { x: 1000, y: 500 }, center, ...box });
    expect(next.x).toBeCloseTo(508, 6);
    expect(next.y).toBe(500);
  });
});

describe('暖灯标记', () => {
  it('标记半径是常量：1 世界像素 = 1 CSS 像素，且不小于屏幕上的下限', () => {
    expect(MARKER_RADIUS).toBe(5);
  });
});

describe('世界几何的其他常量来自共享层（不在这里重复拼写）', () => {
  it('床与行走的步长就是共享常量', () => {
    expect(BED_W).toBe(61);
    expect(BED_H).toBe(100);
    expect(PITCH_X).toBe(PX);
    expect(PITCH_Y).toBe(BED_H + 56);
  });
});