import { describe, expect, it } from 'vitest';

import { AISLE, BED_H, BED_W, CELL_H, CELL_W, RESERVE_W, ZOOM_MIN } from '../../../shared/constants';
import { HALL_LEVELS, levelIndexOfBedCount, wallRegionOf } from '../../../shared/layout';
import type { Person } from '../../../shared/protocol';
import { interpolationDelay, nextMotion, positionAt } from '../../motion';
import {
  MARKER_RADIUS,
  PERSON_HIT_PX,
  TRACE_ALPHA,
  alignTargetOf,
  bedDirection,
  bedLook,
  bedMarkerOf,
  cameraBounds,
  clampZoom,
  cameraStep,
  followStep,
  isFaded,
  isMoving,
  keyboardOf,
  personAlpha,
  personFrame,
  personHit,
  personPoint,
  shouldDrawName,
  shouldResize,
  tapTargetFor,
  truncateToLines,
  usableView,
  usableCenterOffset,
} from '../rules';
import type { Occupant, PersonSpot, Size, TapInput } from '../rules';

const sleeper: Person = { id: 'u_1', name: '小明', appearance: 'boy', state: 'asleep', bedNo: 7 };
const walker: Person = { id: 'u_2', name: '阿夜', appearance: 'girl', state: 'roaming', x: 300, y: 280 };
const trace: Person = { id: 'u_3', name: '夜猫', appearance: 'boy', state: 'trace', bedNo: 5 };

describe('床位贴图：占用走墨色三档、归属走填充（空芯 / 纸）', () => {
  const lyingBoy: Occupant = { state: 'lying', appearance: 'boy' };
  const asleepGirl: Occupant = { state: 'asleep', appearance: 'girl' };
  const traceBoy: Occupant = { state: 'trace', appearance: 'boy' };

  it('无主空床是空芯：白填充映射成透明，地板直接透出来', () => {
    expect(bedLook({ owned: false })).toEqual({ frame: 'bed_empty_hollow', alpha: 1, eyes: false, number: true });
  });

  it('有主空床是 claimed 轮廓 + paper 填充', () => {
    expect(bedLook({ owned: true })).toEqual({ frame: 'bed_empty_owned', alpha: 1, eyes: false, number: true });
  });

  it('床上有人换成 line 档的整图：男/女各一张，清醒与睡着共用那张闭眼的', () => {
    expect(bedLook({ owned: true, occupant: lyingBoy }).frame).toBe('bed_boy');
    expect(bedLook({ owned: false, occupant: { state: 'asleep', appearance: 'boy' } }).frame).toBe('bed_boy');
    expect(bedLook({ owned: true, occupant: asleepGirl }).frame).toBe('bed_girl');
  });

  it('睡痕是 trace 档整图，且整张降低不透明度（不能只改轮廓与名字）', () => {
    expect(bedLook({ owned: true, occupant: traceBoy })).toEqual({
      frame: 'bed_boy_trace',
      alpha: TRACE_ALPHA,
      eyes: false,
      number: true,
    });
    expect(TRACE_ALPHA).toBeLessThan(1);
  });

  it('拉远到文字阈以下：贴图与不透明度照旧，床号与睭眼两点一起退役', () => {
    const far = { detail: false } as const;
    expect(bedLook({ owned: false, ...far })).toEqual({ frame: 'bed_empty_hollow', alpha: 1, eyes: false, number: false });
    expect(bedLook({ owned: true, occupant: lyingBoy, ...far })).toEqual({
      frame: 'bed_boy',
      alpha: 1,
      eyes: false,
      number: false,
    });
    const trace = bedLook({ owned: true, occupant: traceBoy, ...far });
    expect(trace.alpha).toBe(TRACE_ALPHA);
    expect(trace.frame).toBe('bed_boy_trace');
  });

  it('只有清醒躺姿在脸上叠两个点（睡着的眼睛本来就是闭着的）', () => {
    expect(bedLook({ owned: true, occupant: lyingBoy }).eyes).toBe(true);
    expect(bedLook({ owned: true, occupant: asleepGirl }).eyes).toBe(false);
    expect(bedLook({ owned: true, occupant: traceBoy }).eyes).toBe(false);
  });

  it('占用优先于归属：有人的床不因「有没有主」换贴图', () => {
    expect(bedLook({ owned: true, occupant: asleepGirl }).frame).toBe(
      bedLook({ owned: false, occupant: asleepGirl }).frame,
    );
  });
});

describe('小人贴图', () => {
  it('外观决定站姿贴图（第一版两种）', () => {
    expect(personFrame('boy')).toBe('boy_stand');
    expect(personFrame('girl')).toBe('girl_stand');
  });
});

describe('「还在走」的判据（渲染的摆动与相机跟随共用）', () => {
  it('漫游中且插值窗口还开着才算走', () => {
    const motion = nextMotion(undefined, 100, 0, 1000);
    expect(isMoving(walker, motion, 1000)).toBe(true);
    expect(isMoving(sleeper, motion, 1000)).toBe(false); // 在床上的人不走
    expect(isMoving(walker, undefined, 1000)).toBe(false); // 没有插值窗口 = 停下即停
    expect(isMoving(walker, motion, 1300)).toBe(false); // 窗口走完（+宽限）就不是「还在走」
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

describe('床角那颗小点：我的床（暖灯色）优先，换床模式里给可搬的空床（`claimed` 色）', () => {
  const marker = (extra: Partial<Parameters<typeof bedMarkerOf>[0]> = {}) =>
    bedMarkerOf({ bedNo: 42, switching: false, owned: false, occupied: false, ...extra });

  it('我的床永远是 `own`（模式内外都一样）', () => {
    expect(marker({ mine: 42 })).toBe('own');
    expect(marker({ mine: 42, switching: true, owned: true })).toBe('own');
  });

  it('不在换床模式里就不画标记：可搬与否不是给眼睛看的', () => {
    expect(marker({ mine: 7 })).toBe('none');
    expect(marker({ switching: false, owned: false, occupied: false })).toBe('none');
  });

  it('模式里只有**无主且无人**的床标可搬：有主、有人、睡痕都不是可搬目标', () => {
    expect(marker({ mine: 7, switching: true })).toBe('selectable');
    expect(marker({ mine: 7, switching: true, owned: true })).toBe('none');
    expect(marker({ mine: 7, switching: true, occupied: true })).toBe('none');
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

  it('床上有人：别人占的床只给提示（与 3002 同文案），自己躺着的床什么都不做；都绝不落成 walk', () => {
    expect(tapTargetFor({ point: { x: 812, y: 316 }, spots: [], selfId: 'u_me', residentId: 'u_other', bedNo: 42 })).toEqual({
      kind: 'notice',
      reason: 'occupied',
    });
    expect(tapTargetFor({ point: { x: 812, y: 316 }, spots: [], selfId: 'u_me', residentId: 'u_me', bedNo: 42 })).toEqual(
      { kind: 'none' },
    );
  });

  it('别人有主但空着的床：只给提示（与 3003 同文案），占用 / 归属优先于「我有床」这条本地闸门', () => {
    const tap = (extra: Partial<TapInput> = {}) =>
      tapTargetFor({ point: { x: 812, y: 316 }, spots: [], selfId: 'u_me', bedNo: 42, owned: true, ...extra });

    // 我还没床：仍是「别人的床」，不是「可以躺」
    expect(tap()).toEqual({ kind: 'notice', reason: 'other-owned' });
    expect(tap({ ownedBedNo: undefined })).toEqual({ kind: 'notice', reason: 'other-owned' });
    // 我有别的床：占用 / 归属优先，报的是「别人的床」而不是「我已经有一张床」
    expect(tap({ ownedBedNo: 7 })).toEqual({ kind: 'notice', reason: 'other-owned' });
    // 换床模式里也换不到有主的床
    expect(tap({ ownedBedNo: 7, switching: true })).toEqual({ kind: 'notice', reason: 'other-owned' });
  });

  it('无主空床：我还没床 / 就是我那张 / 在模式里 → 躺下；我有别的床又不在模式里 → 只给提示', () => {
    const tap = (extra: Partial<TapInput> = {}) => tapTargetFor({ point: { x: 812, y: 316 }, spots: [], bedNo: 42, ...extra });

    // ① 我还没床（没有 ownedBedNo）：新人第一次点空床不会有任何额外步骤
    expect(tap()).toEqual({ kind: 'lie', bedNo: 42 });
    expect(tap({ ownedBedNo: undefined })).toEqual({ kind: 'lie', bedNo: 42 });
    // ② 目标就是我名下那张床：走回去躺下（在床上点它由服务端回 3004 静默）
    expect(tap({ ownedBedNo: 42 })).toEqual({ kind: 'lie', bedNo: 42 });
    expect(tap({ ownedBedNo: 42, switching: true })).toEqual({ kind: 'lie', bedNo: 42 });
    // ③ 我有别的床、在换床模式里：这才是换床
    expect(tap({ ownedBedNo: 7, switching: true })).toEqual({ kind: 'lie', bedNo: 42 });
    // ④ 我有别的床、不在模式里：不发上行，只给提示（换床会当场释放旧床归属）
    expect(tap({ ownedBedNo: 7 })).toEqual({ kind: 'notice', reason: 'has-bed' });
    expect(tap({ ownedBedNo: 7, switching: false })).toEqual({ kind: 'notice', reason: 'has-bed' });
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

describe('相机比例夹取（只缩不放）', () => {
  it('区间内原样返回', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.4)).toBe(0.4);
    expect(clampZoom(ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  it('只缩不放：超过 1× 一律夹到 1×（放大必然被放大采样而糊）', () => {
    expect(clampZoom(1.2)).toBe(1);
    expect(clampZoom(8)).toBe(1);
  });

  it('拉到比下限更远也夹在下限：第 1 级厅正好占满屏宽', () => {
    expect(clampZoom(0.05)).toBe(ZOOM_MIN);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
  });

  it('非有限值退回 1×：两指恰好重合时算出的 Infinity / NaN 不能让相机废掉', () => {
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
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

describe('可用视口（相机取景、夹取与死区都按它算）', () => {
  // 393×852 竖屏：顶部 HUD 60px、底部聊天面板 129px
  const view = { x: 0, y: 0, width: 393, height: 852 };
  const insets = { top: 60, bottom: 129 };

  it('可用高度 = 视口高 − 面板高：只缩高度，宽度与横向原点不变', () => {
    expect(usableView(view, { top: 0, bottom: 129 })).toEqual({ x: 0, y: 0, width: 393, height: 723 });
    expect(usableView(view, insets)).toEqual({ x: 0, y: 60, width: 393, height: 663 });
  });

  it('顶 + 底 ≥ 视口高：退回整个视口（别把相机算崩）', () => {
    expect(usableView(view, { top: 60, bottom: 852 })).toEqual(view);
    expect(usableView(view, { top: 500, bottom: 400 })).toEqual(view);
  });

  it('夹取让地板区的最下边缘滚到面板之上（这正是「最底一行永远到不了」的修复）', () => {
    const region = wallRegionOf(levelIndexOfBedCount((HALL_LEVELS[0] as { capacity: number }).capacity));
    const usable = usableView(view, insets);
    const bounds = cameraBounds(region, view, usable);
    // Phaser 夹的是整视口那个世界视窗矩形：滚到最下时它的下沿 = y + height − 视口高
    const worldViewBottom = bounds.y + bounds.height - view.height;
    const bandBottom = worldViewBottom + (usable.y - view.y) + usable.height;
    expect(bandBottom).toBe(region.y + region.height);
    // 夹取范围横着照旧：可见区比厅窄时不越出厅（厅在负坐标一侧也有余量）
    expect(bounds.width).toBe(Math.max(region.width, view.width));
    expect(bounds.x).toBeCloseTo(region.x - (Math.max(region.width, view.width) - region.width) / 2);
  });

  it('厅比可用视口小：厅在可用带里居中（不因 insets 偏心）', () => {
    const region = { x: 0, y: 0, width: 200, height: 300 };
    const usable = usableView(view, insets);
    const bounds = cameraBounds(region, view, usable);
    expect(bounds.height).toBe(view.height);
    const bandTop = bounds.y + (usable.y - view.y);
    expect(bandTop + usable.height / 2).toBe(region.height / 2);
  });

  it('可用带中心的偏移：底部占位大于顶部 → 为负（**回中要从焦点里减掉它**）', () => {
    const offset = usableCenterOffset(view, { top: 32.8, bottom: 129 });
    expect(offset.x).toBe(0);
    // 可用带中心 = 32.8 + (852 − 32.8 − 129)/2 = 377.9；视口中心 = 426 → 偏移 = −48.1
    expect(offset.y).toBeCloseTo(377.9 - 426, 6);
  });

  it('没有界面占位时偏移为零（等价于按整视口居中）', () => {
    expect(usableCenterOffset(view, { top: 0, bottom: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('回中把焦点放到**可用带中心**（符号写反会让它掉到聊天面板那一边）', () => {
    const tilts = { top: 32.8, bottom: 129 };
    const offset = usableCenterOffset(view, tilts);
    // 传给 `camera.centerOn` 的 y，以及该点最后落在屏幕上的 y
    const centerOnY = 500 - offset.y;
    const screenY = 500 - (centerOnY - view.height / 2);
    const usable = usableView(view, tilts);
    expect(screenY).toBeCloseTo(usable.y + usable.height / 2, 6);
  });

  it('insets 为 0（入场层期间）：夹取与整视口时完全相同', () => {
    const region = wallRegionOf(levelIndexOfBedCount((HALL_LEVELS[0] as { capacity: number }).capacity));
    const usable = usableView(view, { top: 0, bottom: 0 });
    const bounds = cameraBounds(region, view, usable);
    expect(bounds.width).toBe(Math.max(region.width, view.width));
    expect(bounds.height).toBe(region.height);
    expect(bounds.x).toBeCloseTo(region.x);
    expect(bounds.y).toBeCloseTo(region.y);
  });
});

describe('我的床的方位（离屏时的 8 方位字形）', () => {
  // 393×852 竖屏：顶部 HUD 60px、底部聊天面板 129px（与「可用视口」那一组同一组数）
  const view = { x: 0, y: 0, width: 393, height: 852 };
  const insets = { top: 60, bottom: 129 };
  const usable = usableView(view, insets); // { x: 0, y: 60, width: 393, height: 663 }
  const center = { x: usable.x + usable.width / 2, y: usable.y + usable.height / 2 };

  it('八个方位各一例（方位从**可用视口**中心算）', () => {
    expect(bedDirection(usable, { x: center.x, y: 0 })).toBe('n');
    expect(bedDirection(usable, { x: 600, y: 0 })).toBe('ne');
    expect(bedDirection(usable, { x: 600, y: center.y })).toBe('e');
    expect(bedDirection(usable, { x: 600, y: 900 })).toBe('se');
    expect(bedDirection(usable, { x: center.x, y: 900 })).toBe('s');
    expect(bedDirection(usable, { x: -200, y: 900 })).toBe('sw');
    expect(bedDirection(usable, { x: -200, y: center.y })).toBe('w');
    expect(bedDirection(usable, { x: 0, y: 0 })).toBe('nw');
  });

  it('床在可用视口里返回 undefined（含正好压在边缘上）', () => {
    expect(bedDirection(usable, center)).toBeUndefined();
    expect(bedDirection(usable, { x: usable.x, y: usable.y })).toBeUndefined();
    expect(bedDirection(usable, { x: usable.x + usable.width, y: usable.y + usable.height })).toBeUndefined();
  });

  it('刚出边就算离屏：右边缘外是 e、下边缘外是 s', () => {
    expect(bedDirection(usable, { x: usable.x + usable.width + 0.5, y: center.y })).toBe('e');
    expect(bedDirection(usable, { x: center.x, y: usable.y + usable.height + 0.5 })).toBe('s');
  });

  it('床压在聊天面板后面：在整视口里、不在可用视口里 → 判成 s（这正是要用可用视口的原因）', () => {
    const behindPanel = { x: center.x, y: 800 };
    expect(bedDirection(usable, behindPanel)).toBe('s');
    expect(bedDirection(view, behindPanel)).toBeUndefined();
  });

  it('扇区分界在 22.5°：分界上下各取一点，落在 e 与 ne 两侧', () => {
    expect(bedDirection(usable, { x: center.x + 1000, y: center.y - 400 })).toBe('e'); // −21.8°
    expect(bedDirection(usable, { x: center.x + 1000, y: center.y - 430 })).toBe('ne'); // −23.3°
  });

  it('可用视口为空时退回整视口（`usableView` 的既有退化）：床在 HUD 后面不算离屏', () => {
    const collapsed = usableView(view, { top: 60, bottom: 852 });
    expect(collapsed).toEqual(view);
    expect(bedDirection(collapsed, { x: center.x, y: 30 })).toBeUndefined();
  });
});

describe('暖灯标记', () => {
  it('标记半径是常量：1 世界像素 = 1 CSS 像素，且不小于屏幕上的下限', () => {
    expect(MARKER_RADIUS).toBe(5);
  });
});

describe('气泡文字的截断（最多两行，超出加 …）', () => {
  /** 假的量行器：一行 10 个字符。与 Phaser 无关，只验证二分与省略号本身。 */
  const linesOf = (text: string): number => Math.max(1, Math.ceil(text.length / 10));

  it('放得下就原样返回，不动一个字', () => {
    expect(truncateToLines('醒着呢', 2, linesOf)).toBe('醒着呢');
    expect(truncateToLines('a'.repeat(20), 2, linesOf)).toBe('a'.repeat(20));
  });

  it('放不下就截到「补上 … 后仍不超两行」的最长前缀，不多截也不少截', () => {
    const cut = truncateToLines('a'.repeat(31), 2, linesOf);
    expect(cut.endsWith('…')).toBe(true);
    expect(linesOf(cut)).toBeLessThanOrEqual(2);
    // 再多留一个字就是三行：说明截的正是边界（不是靠「截一半」蒙对的）
    expect(linesOf(`${cut.slice(0, -1)}a…`)).toBe(3);
  });

  /** 孤立代理码元：高代理后面没跟低代理，或低代理前面没有高代理。 */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('按字素簇截断：emoji 消息不会留下孤立代理码元', () => {
    const cut = truncateToLines('😴'.repeat(40), 2, linesOf);
    expect(cut.endsWith('…')).toBe(true);
    expect(linesOf(cut)).toBeLessThanOrEqual(2);
    expect(LONE_SURROGATE.test(cut)).toBe(false);
    expect(cut).toBe(`${'😴'.repeat(9)}…`);
  });

  it('按字素簇截断：ZWJ 序列（👨‍👩‍👧‍👦）整簇保留，不被拆散', () => {
    const family = '👨‍👩‍👧‍👦';
    const cut = truncateToLines(family.repeat(30), 2, linesOf);
    const kept = cut.slice(0, -1);
    expect(family.repeat(30).startsWith(kept)).toBe(true);
    expect(kept.length % family.length).toBe(0);
  });

  it('纯中文的截断结果与按码元二分时一致', () => {
    expect(truncateToLines('睡'.repeat(40), 2, linesOf)).toBe(`${'睡'.repeat(19)}…`);
  });
});

describe('名字行的截断（只有一行，超出加 …）', () => {
  /** 同一套假的量行器：一行 10 个字符。 */
  const linesOf = (text: string): number => Math.max(1, Math.ceil(text.length / 10));

  it('放得下就原样返回，不动一个字', () => {
    expect(truncateToLines('小明', 1, linesOf)).toBe('小明');
    expect(truncateToLines('a'.repeat(10), 1, linesOf)).toBe('a'.repeat(10));
  });

  it('放不下就截到「补上 … 后仍只有一行」的最长前缀', () => {
    const cut = truncateToLines('a'.repeat(25), 1, linesOf);
    expect(cut.endsWith('…')).toBe(true);
    expect(linesOf(cut)).toBe(1);
    // 再多留一个字就是两行：说明截的正是边界
    expect(linesOf(`${cut.slice(0, -1)}a…`)).toBe(2);
  });
});

describe('世界几何的其他常量来自共享层（不在这里重复拼写）', () => {
  it('床与格距就是共享常量', () => {
    expect(BED_W).toBe(61);
    expect(BED_H).toBe(100);
    expect(CELL_W).toBe(AISLE + BED_W + RESERVE_W);
    expect(CELL_H).toBe(BED_H + AISLE);
  });
});
describe('进厅 / 重连时相机对准谁', () => {
  const bed = { x: 100, y: 200 };
  const self = { x: 900, y: 800 };

  it('首次进厅对准我的床（我知道我的床在哪）', () => {
    expect(alignTargetOf({ reconnected: false, bedPoint: bed, selfPoint: self })).toEqual(bed);
  });

  it('重连对准我的小人（宽限恢复会把我放回原位，可能在厅的另一头）', () => {
    expect(alignTargetOf({ reconnected: true, bedPoint: bed, selfPoint: self })).toEqual(self);
  });

  it('缺一个就退到另一个（首次进厅还没有床 / 重连时小人还不知道在哪）', () => {
    expect(alignTargetOf({ reconnected: false, selfPoint: self })).toEqual(self);
    expect(alignTargetOf({ reconnected: true, bedPoint: bed })).toEqual(bed);
  });

  it('两个都没有时返回 undefined（调用方退回厅中心）', () => {
    expect(alignTargetOf({ reconnected: false })).toBeUndefined();
    expect(alignTargetOf({ reconnected: true })).toBeUndefined();
  });
});

/**
 * 软键盘：界面只读视觉视口被 pan 了多少（`docs/ui/DESIGN.md`「软键盘」）。
 *
 * **不再算「键盘吃了多高」**：那一量在部分内核里测不出来，而它曾是逐帧写 `.app-shell`
 * 的 `inset-block-end` 的来源——也就是画布逐帧重建、闪烁的根。现在输入框聚焦时整组面板挪到顶部，
 * 界面不需要知道键盘多高。
 */
describe('软键盘：只算 pan', () => {
  it('没有 visualViewport（桌面 / 老浏览器）：不 pan', () => {
    expect(keyboardOf(null)).toEqual({ pan: 0 });
  });

  it('iOS 聚焦时视觉视口被往下挪：取 offsetTop', () => {
    expect(keyboardOf({ offsetTop: 0 })).toEqual({ pan: 0 });
    expect(keyboardOf({ offsetTop: 100 })).toEqual({ pan: 100 });
  });

  it('offsetTop 为负（取整抖动）时归零，不留负数', () => {
    expect(keyboardOf({ offsetTop: -3 }).pan).toBe(0);
  });

  it('取整：不到一个 CSS 像素的抖动不该让外壳重排', () => {
    expect(keyboardOf({ offsetTop: 0.4 })).toEqual({ pan: 0 });
    expect(keyboardOf({ offsetTop: 0.6 })).toEqual({ pan: 1 });
  });

  it('键盘弹起时视觉视口高度变小，但这已不影响任何写样式的结果', () => {
    // 改造前这里会算出 shrink = 336 并写 inset-block-end；现在这个量不存在了
    expect(keyboardOf({ offsetTop: 0 })).toEqual({ pan: 0 });
  });
});

/**
 * 冻结门（`docs/design/60-interaction-shell.md` §5）：打字期间跳过 `scale.resize`，其余一律重算。
 * 手机 393×852 @3 → 画布 1179×2556。
 */
describe('画布尺寸重算的冻结门（`shouldResize`）', () => {
  const full: Size = { width: 1179, height: 2556, dpr: 3 };
  const shorter: Size = { width: 1179, height: 1500, dpr: 3 };

  it('打字态 + 宽度不变 + 高度变小 = 软键盘指纹：冻结', () => {
    expect(shouldResize(full, shorter, true)).toBe(false);
  });

  it('宽度变（分屏 / 拖窗）：立刻重算，不受冻结影响', () => {
    expect(shouldResize(full, { ...shorter, width: 900 }, true)).toBe(true);
  });

  it('高度变高（键盘收起 / 地址栏收放）：立刻重算', () => {
    expect(shouldResize(shorter, full, true)).toBe(true);
  });

  it('旋屏（宽高互换）：立刻重算', () => {
    expect(shouldResize(full, { width: 2556, height: 1179, dpr: 3 }, true)).toBe(true);
  });

  it('DPR 变（换屏 / 缩放）：立刻重算', () => {
    expect(shouldResize(full, { width: 786, height: 1704, dpr: 2 }, true)).toBe(true);
  });

  it('空闲态缩小不冻结：不是键盘，照常重算', () => {
    expect(shouldResize(full, shorter, false)).toBe(true);
  });
});
