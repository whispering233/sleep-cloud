import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOVE_MS_PER_TILE, TICK_MS } from '../../../shared/constants';
import type { Person } from '../../../shared/protocol';
import type { Scene } from '../../../shared/scene';
import { HALLS } from '../../../shared/hall-registry';
import { interpolationDelay, nextMotion, positionAt } from '../../motion';
import type { Motion } from '../../motion';
import {
  bedDashSegments,
  bedOutline,
  bedPaintSignature,
  cameraStep,
  dashSegments,
  followStep,
  hourIn,
  isDaytime,
  PERSON_HIT_TILES,
  personAlpha,
  personHit,
  personPoint,
  shouldDrawName,
  tapTargetFor,
  wallGeometry,
} from '../rules';
import type { BedOutline, PersonSpot, Rect } from '../rules';
import { MARKER_RADIUS } from '../views';

const TILE = 32;

/** 场景 `blocked` 是 `[x, y]` 列表；环带按「整行 / 整列全被占满」识别。 */
const ring = (width: number, height: number, thickness: number): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < thickness || y < thickness || x >= width - thickness || y >= height - thickness) cells.push([x, y]);
    }
  }
  return cells;
};

const sleeper: Person = { id: 'u_1', name: '小明', appearance: 'a1', state: 'asleep', bedNo: 7 };
const walker: Person = { id: 'u_2', name: '阿夜', appearance: 'a2', state: 'roaming', x: 3, y: 4 };
const trace: Person = { id: 'u_3', name: '夜猫', appearance: 'a3', state: 'trace', bedNo: 5 };

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
    expect(bedOutline({ owned: true, occupant: 'asleep' })).toEqual({ tier: 'line', dashed: false });
  });

  it('占用优先于归属：别人的床有人睡也是 line 实线', () => {
    expect(bedOutline({ owned: false, occupant: 'asleep' })).toEqual({ tier: 'line', dashed: false });
  });
});

describe('虚线分段', () => {
  it('按「实线段 + 间隔」的周期定段数', () => {
    const segments = dashSegments({ from: { x: 0, y: 0 }, to: { x: 26, y: 0 }, dash: 6, gap: 4 });
    expect(segments).toHaveLength(3);
  });

  it('首段从起点开始、末段正好落在终点（不悬挂半段），覆盖长度等于边长', () => {
    const from = { x: 3, y: 5 };
    const to = { x: 3, y: 31 }; // 竖边：边长 26
    const segments = dashSegments({ from, to, dash: 6, gap: 4 });
    expect(segments[0]).toEqual({ x1: from.x, y1: from.y, x2: from.x, y2: from.y + 6 });
    const last = segments[segments.length - 1];
    expect(last.x2).toBeCloseTo(to.x, 6);
    expect(last.y2).toBeCloseTo(to.y, 6);

    const covered = segments.reduce((sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
    const gaps = segments.slice(1).reduce((sum, s, index) => {
      const previous = segments[index];
      return sum + Math.hypot(s.x1 - previous.x2, s.y1 - previous.y2);
    }, 0);
    expect(covered + gaps).toBeCloseTo(Math.hypot(to.x - from.x, to.y - from.y), 6);
  });

  it('边比一段还短时只给一段：退化也不能跑到边外', () => {
    const segments = dashSegments({ from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, dash: 6, gap: 4 });
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 4, y2: 0 }]);
  });

  it('零长度的边不产生段（不画零长线段）', () => {
    expect(dashSegments({ from: { x: 2, y: 2 }, to: { x: 2, y: 2 }, dash: 6, gap: 4 })).toEqual([]);
  });

  it('中间节拍：边整除「实线段 + 间隔」时第 n 段起点是节拍的累加（只钉末段的话，把末段硬拉到终点的实现也能通过）', () => {
    const dash = 6;
    const gap = 4;
    const segments = dashSegments({ from: { x: 0, y: 0 }, to: { x: 26, y: 0 }, dash, gap });
    expect(segments).toHaveLength(3);
    segments.forEach((segment, index) => {
      expect(segment.x1).toBeCloseTo(index * (dash + gap), 6);
      expect(segment.x2).toBeCloseTo(index * (dash + gap) + dash, 6);
    });
  });
});

describe('一张床的四条边各切成虚线', () => {
  const rect = { x: 10, y: 20, size: 26, dash: 6, gap: 4 };
  const xEdges = [rect.x, rect.x + rect.size];
  const yEdges = [rect.y, rect.y + rect.size];
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.size, y: rect.y },
    { x: rect.x + rect.size, y: rect.y + rect.size },
    { x: rect.x, y: rect.y + rect.size },
  ];
  const segments = bedDashSegments(rect);

  it('段数 = 4 × 每边段数', () => {
    const perSide = dashSegments({ from: corners[0], to: corners[1], dash: rect.dash, gap: rect.gap });
    expect(perSide).toHaveLength(3);
    expect(segments).toHaveLength(4 * perSide.length);
  });

  it('每段都落在矩形边界上（贴着四条边，不越界；顶边与底边方向相反）', () => {
    for (const { x1, y1, x2, y2 } of segments) {
      const inX = Math.min(x1, x2) >= rect.x && Math.max(x1, x2) <= rect.x + rect.size;
      const inY = Math.min(y1, y2) >= rect.y && Math.max(y1, y2) <= rect.y + rect.size;
      const onHorizontal = y1 === y2 && yEdges.includes(y1) && x1 !== x2 && inX;
      const onVertical = x1 === x2 && xEdges.includes(x1) && y1 !== y2 && inY;
      expect(onHorizontal || onVertical).toBe(true);
    }
  });

  it('四个角各出现一次：边与边首尾相接，不漏角也不重复画边', () => {
    for (const corner of corners) {
      const starts = segments.filter((s) => s.x1 === corner.x && s.y1 === corner.y);
      const ends = segments.filter((s) => s.x2 === corner.x && s.y2 === corner.y);
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
    }
  });
});

describe('床位画法签名', () => {
  const empty: BedOutline = { tier: 'claimed', dashed: false };
  const unowned: BedOutline = { tier: 'claimed', dashed: true };
  const occupied: BedOutline = { tier: 'line', dashed: false };
  const ghost: BedOutline = { tier: 'trace', dashed: false };
  const paint = (over: Partial<{ outline: BedOutline; mine: boolean }> = {}): string =>
    bedPaintSignature({ outline: empty, mine: false, ...over });

  it('无变化时签名稳定（否则每一帧都会重建视野里那几十张床的图形）', () => {
    expect(paint()).toBe(paint());
  });

  it('占用梯次变化 → 签名变化（描边色跟着变）', () => {
    expect(paint({ outline: empty })).not.toBe(paint({ outline: occupied }));
    expect(paint({ outline: occupied })).not.toBe(paint({ outline: ghost }));
  });

  it('归属变化 → 签名变化（线型跟着变）', () => {
    expect(paint({ outline: empty })).not.toBe(paint({ outline: unowned }));
  });

  it('我的床标记出现 / 消失 → 签名变化（暖标记不能留在别人的床上）', () => {
    expect(paint({ mine: true })).not.toBe(paint({ mine: false }));
  });
});

describe('墙的几何：环带与内沿', () => {
  it('35×35 一圈 1 格厚的墙：内沿从世界像素 32 到 1088（33 格）', () => {
    const wall = wallGeometry({ width: 35, height: 35, blocked: ring(35, 35, 1) });
    expect(wall.inner).toEqual({ x: 32, y: 32, width: 1056, height: 1056 });
    expect(wall.inner.x + wall.inner.width).toBe(1088);
    expect(wall.band).toEqual({ x: 0, y: 0, width: 1120, height: 1120 });
  });

  it('厚度靠扫描得出，不写死 1 格（两格厚的环带内沿就应该是 64）', () => {
    const wall = wallGeometry({ width: 35, height: 35, blocked: ring(35, 35, 2) });
    expect(wall.inner).toEqual({ x: 64, y: 64, width: 992, height: 992 });
  });

  it('没有 `blocked` 就没有环带：band 为空，内沿就是场景边界', () => {
    const wall = wallGeometry({ width: 35, height: 35, blocked: [] });
    expect(wall.band.width).toBe(0);
    expect(wall.band.height).toBe(0);
    expect(wall.inner).toEqual({ x: 0, y: 0, width: 1120, height: 1120 });
  });

  it('只有内部障碍：不是环带，不能当墙画（否则凭空多出一间房）', () => {
    const wall = wallGeometry({
      width: 35,
      height: 35,
      blocked: [
        [17, 17],
        [18, 17],
        [17, 18],
      ],
    });
    expect(wall.band.width).toBe(0);
    expect(wall.inner).toEqual({ x: 0, y: 0, width: 1120, height: 1120 });
  });

  it('单边缺失：那一侧厚度为 0，内沿贴场景边界', () => {
    const top = ring(35, 35, 1).filter(([, y]) => y === 0);
    const wall = wallGeometry({ width: 35, height: 35, blocked: top });
    expect(wall.inner).toEqual({ x: 0, y: 32, width: 1120, height: 1088 });
  });

  it('`blocked` 的顺序不影响结果（它只是一张占位表）', () => {
    const cells = ring(35, 35, 1);
    expect(wallGeometry({ width: 35, height: 35, blocked: [...cells].reverse() })).toEqual(
      wallGeometry({ width: 35, height: 35, blocked: cells }),
    );
  });
});

/** 三个厅的场景数据就在仓库里（与 `scene.test.ts` 同一读法）：这条用例要盯的是真实出厂的那几份。 */
/** 场景清单**从厅注册表推导**：新增厅时这些测试自动覆盖它的场景，不需第二处人工维护。 */
const SCENE_GUIDS = HALLS.map((hall) => hall.sceneGuid);

function readScene(guid: string): Scene {
  const file = join(process.cwd(), 'public', 'scenes', `${guid}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Scene;
}

/** 退化输入不许把矩形算成 NaN 或负数：`toEqual` 追不回 NaN，得单独钉。 */
const finiteNonNegative = (rect: Rect): boolean =>
  [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value) && value >= 0);

describe.each(SCENE_GUIDS)('出厂场景 %s：外墙环在哪，地面就在哪', (guid) => {
  const scene = readScene(guid);

  it('内沿正好是一圈一格厚的外墙围出的地面——环带掉一格（某侧整行/整列不再全被占满）就露馅', () => {
    // 期望值从 width/height 与 TILE 推出来，不写死 1056：换场景尺寸用例照样成立。
    // 而环带掉一格时该侧厚度退化成 0、内沿胀到场景边界，这里的期望值立刻对不上。
    expect(wallGeometry({ width: scene.width, height: scene.height, blocked: scene.blocked }).inner).toEqual({
      x: TILE,
      y: TILE,
      width: (scene.width - 2) * TILE,
      height: (scene.height - 2) * TILE,
    });
  });

  it('每张床、每个装饰都落在地面之内——按整格占位判定，不用内缩矩形（内缩会让贴墙的越界项看起来合法）', () => {
    const { inner } = wallGeometry({ width: scene.width, height: scene.height, blocked: scene.blocked });
    // 床与装饰的占位区 = 格坐标 × TILE 到 +TILE；`backgrounds`（地板）故意不查：它铺满整个场景、本该盖到墙下。
    // 先收集再一次性断言，失败信息能一次指出是哪几项越界。
    const within = (tileX: number, tileY: number): boolean =>
      tileX * TILE >= inner.x &&
      (tileX + 1) * TILE <= inner.x + inner.width &&
      tileY * TILE >= inner.y &&
      (tileY + 1) * TILE <= inner.y + inner.height;
    const outside: string[] = [];
    for (const bed of scene.beds) {
      if (!within(bed.x, bed.y)) outside.push(`床 ${bed.bedNo} @(${bed.x}, ${bed.y})`);
    }
    for (const decor of scene.decorates) {
      if (!within(decor.x, decor.y)) outside.push(`装饰 ${decor.sprite} @(${decor.x}, ${decor.y})`);
    }
    expect(outside).toEqual([]);
  });
});

describe('墙的几何：退化输入不产生 NaN / 负值', () => {
  it('`blocked` 占满整个场景：地面宽高为 0（不是负数）', () => {
    const width = 7;
    const height = 5;
    const full: Array<[number, number]> = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) full.push([x, y]);
    const wall = wallGeometry({ width, height, blocked: full });
    expect(wall.inner).toEqual({ x: width * TILE, y: height * TILE, width: 0, height: 0 });
    expect(finiteNonNegative(wall.inner)).toBe(true);
  });

  it('`width` 为 0：地面宽为 0，不出现 NaN / 负值', () => {
    const wall = wallGeometry({ width: 0, height: 8, blocked: [] });
    expect(wall.inner).toEqual({ x: 0, y: 0, width: 0, height: 8 * TILE });
    expect(wall.band).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(finiteNonNegative(wall.inner)).toBe(true);
  });

  it('`height` 为 0：地面高为 0，不出现 NaN / 负值', () => {
    const wall = wallGeometry({ width: 8, height: 0, blocked: [] });
    expect(wall.inner).toEqual({ x: 0, y: 0, width: 8 * TILE, height: 0 });
    expect(finiteNonNegative(wall.inner)).toBe(true);
  });

  it('`blocked` 含越界坐标（[-1, 0]、[40, 40]）时结果与不含它们时一致', () => {
    const cells = ring(35, 35, 1);
    const stray: Array<[number, number]> = [
      [-1, 0],
      [40, 40],
    ];
    expect(wallGeometry({ width: 35, height: 35, blocked: [...cells, ...stray] })).toEqual(
      wallGeometry({ width: 35, height: 35, blocked: cells }),
    );
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

  it('点自己：相机居中自己（即使自己站在床上）', () => {
    expect(
      tapTargetFor({ point: { x: 5.5, y: 5.5 }, spots: [self], selfId: 'u_me', bedNo: 9, walkable: false }),
    ).toEqual({ kind: 'recenter' });
    expect(tapTargetFor({ point: { x: 5.5, y: 5.5 }, spots: [self], selfId: 'u_me', walkable: true })).toEqual({
      kind: 'recenter',
    });
  });

  it('点自己的床但人不在命中半径内：`none`（回中只认自己这个点，不认床位）', () => {
    expect(
      tapTargetFor({ point: { x: 2, y: 2 }, spots: [self], selfId: 'u_me', residentId: 'u_me', bedNo: 42, walkable: false }),
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

describe('相机夹取仍交给 Phaser', () => {
  // 没有缩放：默认比例与夹取由 `setBounds` 承担（见 `src/client/world/world.ts`）。
  // 这条用例盯的是「别再把那条路加回纯规则里」。
  it('规则层不再导出相机夹取函数', async () => {
    const rules = await import('../rules');
    for (const gone of ['clampCamera', 'defaultScale', 'outsideCenterBand', 'markerRadius']) {
      expect(Object.keys(rules)).not.toContain(gone);
    }
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
    expect(near).toEqual({ x: 3, y: 4 }); // 一步 50px > 距离 5px → 落到目标，不冲过头

    const near2 = cameraStep({ scroll: { x: 0, y: 0 }, target: { x: 100, y: 0 }, dtMs: 16, maxPxPerS: 500 });
    const near3 = cameraStep({ scroll: near2, target: { x: 100, y: 0 }, dtMs: 16, maxPxPerS: 500 });
    expect(near2.x).toBeGreaterThan(0);
    expect(near3.x).toBeGreaterThan(near2.x);
    expect(near3.x).toBeLessThanOrEqual(100);
  });

  it('帧率无关：同一段 dt 拆成一帧与拆成两帧，累计位移一致', () => {
    const target = { x: 250, y: 0 };
    const one = cameraStep({ scroll: { x: 0, y: 0 }, target, dtMs: 90, maxPxPerS: 500 });
    const first = cameraStep({ scroll: { x: 0, y: 0 }, target, dtMs: 45, maxPxPerS: 500 });
    const second = cameraStep({ scroll: first, target, dtMs: 45, maxPxPerS: 500 });
    expect(Math.abs(second.x - one.x)).toBeLessThanOrEqual(1);

    // 最后一步会落到目标的情形：一帧走完 30px 与拆两帧走完，也要一致
    const short = { x: 30, y: 0 };
    const oneShort = cameraStep({ scroll: { x: 0, y: 0 }, target: short, dtMs: 100, maxPxPerS: 500 });
    const firstShort = cameraStep({ scroll: { x: 0, y: 0 }, target: short, dtMs: 50, maxPxPerS: 500 });
    const secondShort = cameraStep({ scroll: firstShort, target: short, dtMs: 50, maxPxPerS: 500 });
    expect(Math.abs(secondShort.x - oneShort.x)).toBeLessThanOrEqual(1);
    expect(oneShort.x).toBe(30);
    expect(secondShort.x).toBe(30);
  });
});

describe('取位点（`personPoint`）：渲染与跟随共用同一个返回值', () => {
  const motion: Motion = { fromX: 0, fromY: 0, toX: 32, toY: 0, fromTs: 1_000_000, toTs: 1_000_100 };

  it('漫游中 = 渲染用的那一个点（`positionAt` + 本窗口滞后）', () => {
    for (const serverNow of [1_000_050, 1_000_120, 1_000_180]) {
      expect(personPoint({ person: walker, motion, serverNow })).toEqual(
        positionAt(motion, serverNow - interpolationDelay(motion)),
      );
    }
  });

  it('窗口未知时用权威坐标；非漫游用落位点，取不到落位点就没得画', () => {
    expect(personPoint({ person: walker, motion: undefined, serverNow: 1_000_050 })).toEqual({ x: 3, y: 4 });
    expect(personPoint({ person: sleeper, motion, bedPoint: { x: 240, y: 112 }, serverNow: 1_000_050 })).toEqual({
      x: 240,
      y: 112,
    });
    expect(personPoint({ person: sleeper, motion, serverNow: 1_000_050 })).toBeUndefined();
  });
});

describe('跟随每帧的一步（`followStep`）', () => {
  const center = { x: 0, y: 0 };
  const halfWidth = (393 * 0.4) / 2;
  const halfHeight = (852 * 0.4) / 2;

  it('还在死区里：镜头一动不动', () => {
    expect(followStep({ point: { x: 20, y: 30 }, center, halfWidth, halfHeight, dtMs: 26, maxPxPerS: 500 })).toEqual(
      center,
    );
  });

  it('离得远：按 maxPxPerS 追，且不越过', () => {
    const far = followStep({ point: { x: 10000, y: 0 }, center, halfWidth, halfHeight, dtMs: 20, maxPxPerS: 500 });
    expect(far).toEqual({ x: 10, y: 0 });

    // 一步能走完「超出的那一段」时，正好落到「把死区边缘钉在小人身上」的位置，不冲进死区
    const near = followStep({ point: { x: 100, y: 0 }, center, halfWidth, halfHeight, dtMs: 1000, maxPxPerS: 500 });
    expect(near).toEqual({ x: 100 - halfWidth, y: 0 });
  });

  /**
   * 稳态走动：小人从厅中心横着走出去，镜头只在走出死区后开始跟。
   *
   * 修前这条用例是红的：跟随朝**死区边缘**走满「半个死区」，于是每拍冲进死区、随后几帧一动不动，
   * 整幅画面每 ~100ms 回跳一次——28fps 与 38fps 实测都是 4 帧一个脉冲（38fps：13.16, 0, 0, 0），
   * 幅值就是单帧上限 `500 × dt`（≈ 一个 tick 的行走量）。钉住边缘后相机步进 = 小人的步进。
   */
  it('把死区边缘钉在小人身上：稳态段逐帧步进 = 小人的步进，没有 0 帧、没有脉冲', () => {
    const dtMs = 1000 / 38;
    const stepPerTick = (TILE * TICK_MS) / MOVE_MS_PER_TILE; // 12.8px / tick
    const walkPerFrame = (stepPerTick * dtMs) / TICK_MS;
    const me: Person = { ...walker, x: 0, y: 0 };
    let serverNow = 1_000_000;
    let nextTickAt = serverNow;
    let walkX = 0;
    let motion: Motion | undefined;
    let camera = { ...center };
    const cameraSteps: number[] = [];
    const screenOffsets: number[] = [];

    for (let frame = 0; frame < 120; frame += 1) {
      while (nextTickAt <= serverNow) {
        walkX += stepPerTick;
        motion = nextMotion(motion, walkX, 0, nextTickAt);
        nextTickAt += TICK_MS;
      }
      // 一帧（与 `WorldScene.update` 同一顺序）：取位**只算一次**，渲染与跟随都用它
      const point = personPoint({ person: me, motion, serverNow }) as { x: number; y: number };
      screenOffsets.push(point.x - camera.x);
      const next = followStep({ point, center: camera, halfWidth, halfHeight, dtMs, maxPxPerS: 500 });
      cameraSteps.push(Math.hypot(next.x - camera.x, next.y - camera.y));
      camera = next;
      serverNow += dtMs;
    }

    // 前 30 帧是小人从厅中心走进死区：镜头本来就不该动，不在这条用例的范围里
    const steadySteps = cameraSteps.slice(30);
    expect(Math.min(...steadySteps)).toBeGreaterThan(walkPerFrame * 0.8);
    expect(Math.max(...steadySteps)).toBeLessThan(walkPerFrame * 1.2);

    // 小人屏幕上的位置同样不再每拍回跳（旧法是 12~18px 的锯齿）
    const screen = screenOffsets.slice(30);
    expect(Math.max(...screen) - Math.min(...screen)).toBeLessThan(walkPerFrame * 2);
  });
});

describe('暖灯标记', () => {
  it('标记半径是常量：1 世界像素 = 1 CSS 像素，且不小于屏幕上的下限', () => {
    expect(MARKER_RADIUS).toBeGreaterThanOrEqual(5);
    expect(MARKER_RADIUS).toBeLessThan(TILE * 0.6);
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
