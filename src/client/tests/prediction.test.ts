import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BED_H, BED_W, PREDICTION_STALE_MS, WALK_SPEED_PX_PER_S } from '../../shared/constants';
import {
  HALL_LEVELS,
  LAYOUT_VERSION,
  frontPointOf,
  levelIndexOfBedCount,
  positionOf,
  streetBandCount,
  streetBlockCount,
  streetPointAt,
  wallRegionOf,
} from '../../shared/layout';
import type { HallLevel, Point } from '../../shared/layout';
import { findPath } from '../../shared/pathfinding';
import { encodeOwnedBeds } from '../../shared/protocol';
import type { SnapshotMessage } from '../../shared/protocol';
import { anchorPrediction, arcLengthAhead, beginPrediction, predictionPointAt } from '../prediction';
import type { Prediction } from '../prediction';
import { applyError, applyLeave, applyPos, applySnapshot, applyState, beginWalk, clearPrediction, getState, setState } from '../store';

const BED_COUNT = (HALL_LEVELS[0] as HallLevel).capacity;

/**
 * 假时钟的本地「现在」：`applySnapshot` 之后 `clockOffsetMs = serverTs − 这个数`，于是一旦把系统时间
 * 钉在这里，`Date.now() + clockOffsetMs` 就**精确等于** `1_000_000`（快照的服务端时刻）——意图锚点
 * 因此可以逐位断言，不必留容差。
 */
const LOCAL_NOW = 500_000;
const SNAPSHOT_TS = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers({ now: LOCAL_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

/** 街网的左上角与右下角节点：两点一定不在同一条走道上 → 折线有拐点（重锚的剪枝才有戏看）。 */
const region = wallRegionOf(levelIndexOfBedCount(BED_COUNT));
const ROWS = streetBandCount(region) - 1;
const COLS = streetBlockCount(region) - 1;
const FROM = streetPointAt(0, 0, ROWS);
const TO = streetPointAt(ROWS, COLS, ROWS);
/** 一张床的床心：不在街网上（点床 = 躺下，不是走动）。 */
const BED_POINT = positionOf(0) as Point;

/** 折线上从 `from` 出发走 `distance` 像素后的点（**测试自己算一遍**，不复用生产代码）。 */
function along(from: Point, path: Point[], distance: number): Point {
  let previous = from;
  let left = distance;
  for (const point of path) {
    const step = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (step >= left) {
      const ratio = step === 0 ? 0 : left / step;
      return { x: previous.x + (point.x - previous.x) * ratio, y: previous.y + (point.y - previous.y) * ratio };
    }
    left -= step;
    previous = point;
  }
  return previous;
}

/** 折线总长（起点 → 第一个途经点 → … → 终点）。 */
function pathLength(from: Point, path: Point[]): number {
  let total = 0;
  let previous = from;
  for (const point of path) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

/** `point` 在折线上的弧长（离起点多远；落在折线外取最近点）：用来把「画面倒退」变成可比较的标量。 */
function travelled(from: Point, path: Point[], point: Point): number {
  let previous = from;
  let total = 0;
  let best = { distance: Infinity, arc: 0 };
  for (const next of path) {
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    const ratio = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / (length * length)));
    const distance = Math.hypot(point.x - (previous.x + dx * ratio), point.y - (previous.y + dy * ratio));
    if (distance < best.distance) best = { distance, arc: total + length * ratio };
    total += length;
    previous = next;
  }
  return best.arc;
}

const snapshot = (): SnapshotMessage => ({
  t: 'snapshot',
  layoutVersion: LAYOUT_VERSION,
  serverTs: SNAPSHOT_TS,
  hall: { bedCount: BED_COUNT, online: 1 },
  me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: FROM.x, y: FROM.y },
  ownedBeds: encodeOwnedBeds([], BED_COUNT),
  people: [],
});

describe('自身外推：沿共享折线推进', () => {
  it('客户端算出的折线 = 服务端那一次 `findPath`（同一份寻路 → 同一条折线）', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    expect(prediction).toBeDefined();
    expect(prediction?.path).toEqual(findPath(FROM, TO, BED_COUNT));
    expect(pathLength(FROM, prediction?.path ?? [])).toBeGreaterThan(WALK_SPEED_PX_PER_S / 2);
  });

  it('锚点那一刻就是起点；之后按 WALK_SPEED_PX_PER_S 沿折线匀速走', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');

    expect(predictionPointAt(prediction, 1_000)).toEqual(FROM);
    expect(predictionPointAt(prediction, 1_500)).toEqual(along(FROM, prediction.path, WALK_SPEED_PX_PER_S / 2));
    // 锚点时刻之前不倒退（时钟估计抖动时取锚点）
    expect(predictionPointAt(prediction, 900)).toEqual(FROM);

    // 匀速：200ms 与 400ms 两点之间的距离 = 200ms 的步长
    const at200 = predictionPointAt(prediction, 1_200);
    const at400 = predictionPointAt(prediction, 1_400);
    expect(Math.hypot(at400.x - at200.x, at400.y - at200.y)).toBeCloseTo((WALK_SPEED_PX_PER_S * 200) / 1000, 6);
  });

  it('目标点不在街网上 → 不外推（交给服务端的权威值）', () => {
    expect(beginPrediction(FROM, { x: BED_POINT.x + BED_W / 2, y: BED_POINT.y + BED_H / 2 }, BED_COUNT, 1_000)).toBeUndefined();
  });
});

describe('自身外推：弧长（重锚量 `ahead` 的那把尺）', () => {
  /** 起于 (0,0)：先向东 100，再向南 100。 */
  const PATH = [
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const ORIGIN = { x: 0, y: 0 };

  it('Q 在折线上 → 弧长 = 从 P 沿折线走过的距离', () => {
    expect(arcLengthAhead(ORIGIN, PATH, { x: 40, y: 0 })).toBeCloseTo(40, 6);
    expect(arcLengthAhead(ORIGIN, PATH, { x: 100, y: 30 })).toBeCloseTo(130, 6);
  });

  it('Q 在折线外 → 取最近点', () => {
    expect(arcLengthAhead(ORIGIN, PATH, { x: 40, y: 50 })).toBeCloseTo(40, 6);
    expect(arcLengthAhead(ORIGIN, PATH, { x: 130, y: 60 })).toBeCloseTo(160, 6);
  });

  it('Q 投影落在 P 之前，或折线为空 → 0（不靠负弧长吸收）', () => {
    expect(arcLengthAhead(ORIGIN, PATH, { x: -80, y: 0 })).toBe(0);
    expect(arcLengthAhead(ORIGIN, [], { x: 50, y: 50 })).toBe(0);
  });
});

describe('自身外推：重锚', () => {
  it('重锚到权威点与该批时刻，沿**同一条**折线继续（路径不重算）', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const first = prediction.path[0] as Point;

    // 权威点已在第一个拐点之后 30px
    const authority = along(FROM, prediction.path, Math.hypot(first.x - FROM.x, first.y - FROM.y) + 30);
    const renderBefore = predictionPointAt(prediction, 1_350);
    const anchored = anchorPrediction(prediction, authority.x, authority.y, 1_350);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    // 走过的拐点被剪掉：剩下的仍是原折线的尾巴（没有重算、也没有回头）
    expect(anchored.path).toEqual(prediction.path.slice(1));
    expect(prediction.path.slice(prediction.path.length - anchored.path.length)).toEqual(anchored.path);

    // 画面在权威点前方 47px（350ms 走出 77px）→ 锚点时刻回拨 47/220s，画面一动不动
    expect(anchored.anchorTs).toBeCloseTo(1_350 - (47 / WALK_SPEED_PX_PER_S) * 1000, 6);
    expect(predictionPointAt(anchored, 1_350).x).toBeCloseTo(renderBefore.x, 6);
    expect(predictionPointAt(anchored, 1_350).y).toBeCloseTo(renderBefore.y, 6);
    // 锚点时刻那一刻就是权威点
    expect(predictionPointAt(anchored, anchored.anchorTs).x).toBeCloseTo(authority.x, 6);
    expect(predictionPointAt(anchored, anchored.anchorTs).y).toBeCloseTo(authority.y, 6);
    // 之后照旧按 WALK_SPEED_PX_PER_S 走
    expect(travelled(FROM, prediction.path, predictionPointAt(anchored, 1_450))).toBeCloseTo(
      (WALK_SPEED_PX_PER_S * 450) / 1000,
      6,
    );
  });

  it('权威点就是我发出的起点（服务端还没起步）→ 锚点时刻与画面一个字不变', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const anchored = anchorPrediction(prediction, FROM.x, FROM.y, 1_100);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    expect(anchored.anchorTs).toBeCloseTo(prediction.anchorTs, 6);
    expect(anchored.path).toEqual(prediction.path);
    const later = predictionPointAt(prediction, 1_300);
    expect(predictionPointAt(anchored, 1_300).x).toBeCloseTo(later.x, 6);
    expect(predictionPointAt(anchored, 1_300).y).toBeCloseTo(later.y, 6);
  });

  it('权威点在我身后：重锚前后同一时刻的画面点相等（倒退 0px），且 16 拍跨拐点仍单调不减', () => {
    // 短折线（全程 ~3s）：两个拐点、第一段只有 346px，1.5s 就能跨过
    const goal = streetPointAt(2, 2, ROWS);
    const prediction = beginPrediction(FROM, goal, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const path = prediction.path;
    const oneWay = 300;

    let current = prediction;
    let last = 0;
    const frame = (t: number): number => {
      const position = travelled(FROM, path, predictionPointAt(current, t));
      expect(position).toBeGreaterThanOrEqual(last - 1e-9);
      last = position;
      return position;
    };

    // 服务端还在路上（没有 pos）：画面自己往前走
    for (let t = 1_000; t < 1_000 + oneWay; t += 10) frame(t);

    for (let tick = 0; tick < 16; tick += 1) {
      const ts = 1_000 + oneWay + tick * 100;
      const authority = along(FROM, path, (WALK_SPEED_PX_PER_S * (ts - 1_000 - oneWay)) / 1000);
      const before = predictionPointAt(current, ts);
      const anchored = anchorPrediction(current, authority.x, authority.y, ts);
      if (!anchored) throw new Error('同一条折线上的一拍，不该作废');
      const after = predictionPointAt(anchored, ts);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      current = anchored;
      for (let t = ts; t < ts + 100; t += 10) frame(t);
    }

    // 跨过了第一个拐点（证明剪枝之后仍然单调）
    expect(last).toBeGreaterThan(346);
  });

  it('权威点在我身前（服务端换了目标 / 领先）→ 前向跳到权威点，之后每帧都不小于改前', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const ahead = along(FROM, prediction.path, 120);
    const anchored = anchorPrediction(prediction, ahead.x, ahead.y, 1_100);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    expect(anchored.anchorTs).toBeCloseTo(1_100, 6);
    expect(predictionPointAt(anchored, 1_100)).toEqual(ahead);
    for (let t = 1_100; t <= 1_400; t += 10) {
      const before = travelled(FROM, prediction.path, predictionPointAt(prediction, t));
      const after = travelled(FROM, prediction.path, predictionPointAt(anchored, t));
      expect(after).toBeGreaterThanOrEqual(before - 1e-9);
    }
  });

  it('假时间轴（单向时延 0 / 150 / 250 / 500ms）：全程不倒退，稳态领先量 ≈ 单向时延', () => {
    for (const oneWay of [0, 150, 250, 500]) {
      const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
      if (!prediction) throw new Error('折线应当存在');
      const path = prediction.path;

      let current = prediction;
      let last = 0;
      const frame = (t: number): void => {
        const position = travelled(FROM, path, predictionPointAt(current, t));
        expect(position).toBeGreaterThanOrEqual(last - 1e-9);
        last = position;
      };

      // 意图在路上：画面已经自己起步（lead 的名义值就是这一段）
      for (let t = 1_000; t < 1_000 + oneWay; t += 10) frame(t);

      // 服务端在 t0 + oneWay 起步并回一条起点 pos，此后每 100ms 一条
      for (let tick = 0; tick <= 10; tick += 1) {
        const ts = 1_000 + oneWay + tick * 100;
        const authority = along(FROM, path, (WALK_SPEED_PX_PER_S * (ts - 1_000 - oneWay)) / 1000);
        const anchored = anchorPrediction(current, authority.x, authority.y, ts);
        if (!anchored) throw new Error(`oneWay=${oneWay} 第 ${tick} 拍不该作废`);
        current = anchored;
        for (let t = ts; t < ts + 100; t += 10) frame(t);
      }

      const end = 1_000 + oneWay + 1_000;
      const truth = along(FROM, path, (WALK_SPEED_PX_PER_S * (end - 1_000 - oneWay)) / 1000);
      const lead = ((travelled(FROM, path, predictionPointAt(current, end)) - travelled(FROM, path, truth)) / WALK_SPEED_PX_PER_S) * 1000;
      const tolerance = oneWay === 0 ? 1 : oneWay * 0.2;
      expect(Math.abs(lead - oneWay)).toBeLessThanOrEqual(tolerance);
    }
  });
});

describe('自身外推：权威点横向偏离折线（锚点取投影 + 剪枝按弧长）', () => {
  /** 卡住的复现输入：出发 990→、锚点时刻 727；画面在 t=1000 已走 60px，权威点在折线南侧 10px。 */
  const MID: Prediction = { x: 990, y: 128, anchorTs: 727, ts: 1_000, path: [{ x: 2_277, y: 128 }, { x: 2_277, y: 1_432 }] };

  it('权威点横向偏 10px（复现）：画面不动、轨迹不是斜线、拐点不被剪', () => {
    const before = predictionPointAt(MID, 1_000);
    expect(before.x).toBeCloseTo(1_050.06, 6);
    expect(before.y).toBeCloseTo(128, 6);

    const anchored = anchorPrediction(MID, 1_000, 138, 1_000);
    if (!anchored) throw new Error('横向 10px 不该判成传送');

    // 锚点 = 权威点在折线上的**投影**：那 10px 横向偏移不进轨迹
    expect(anchored.x).toBeCloseTo(1_000, 6);
    expect(anchored.y).toBeCloseTo(128, 6);

    // 画面一动不动（改前与改后各差 ≤1px）
    const after = predictionPointAt(anchored, 1_000);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    // 拐点 (2277,128) 仍在（改前被方向点积误删，画面被投到穿床的斜线上）
    expect(anchored.path).toEqual(MID.path);
    expect(anchored.path).not.toBe(MID.path);

    // 之后每一帧都还在原折线上（y 恒 128，直到拐点），即没有变成斜线
    for (let t = 1_000; t <= 3_000; t += 100) expect(predictionPointAt(anchored, t).y).toBeCloseTo(128, 6);
  });

  it('权威点向北偏 10px（反方向横向）：同样不动、同样保拐点', () => {
    const before = predictionPointAt(MID, 1_000);
    const anchored = anchorPrediction(MID, 1_000, 118, 1_000);
    if (!anchored) throw new Error('横向 10px 不该判成传送');

    expect(anchored).toMatchObject({ x: 1_000, y: 128 });
    expect(predictionPointAt(anchored, 1_000).x).toBeCloseTo(before.x, 6);
    expect(predictionPointAt(anchored, 1_000).y).toBeCloseTo(before.y, 6);
    expect(anchored.path).toEqual(MID.path);
  });

  it('拐点落在 `ahead` 之内：剪枝只按锚点走到的弧长，画面不抄近路穿床', () => {
    const pivot = streetPointAt(2, 2, ROWS);
    const prediction = beginPrediction(FROM, pivot, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    // 第一个真拐点（后两个途经点之一）在折线上的弧长
    const corner = pathLength(FROM, prediction.path.slice(0, prediction.path.length - 1));
    const ts = 1_000 + ((corner + 30) / WALK_SPEED_PX_PER_S) * 1000;

    // 权威点在拐点前 20px、画面已在拐点后 30px：`ahead` = 50 跨着拐点
    const authority = along(FROM, prediction.path, corner - 20);
    const anchored = anchorPrediction(prediction, authority.x, authority.y, ts);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    const before = predictionPointAt(prediction, ts);
    const after = predictionPointAt(anchored, ts);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // 画面仍在折线上（拐点之后是沿第二段走的），不是锚点到下一拐点的直线
    const onPath = along(FROM, prediction.path, corner + 30);
    expect(after.x).toBeCloseTo(onPath.x, 6);
    expect(after.y).toBeCloseTo(onPath.y, 6);
    // 只掉掉了与起点重合那个零长度「拐点」，真拐点留着
    expect(anchored.path).toEqual(prediction.path.slice(1));
  });

  it('权威点在画面前方且横向偏 10px：前向跳到投影点，之后每帧不小于改前', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const ahead = along(FROM, prediction.path, 120);
    const anchored = anchorPrediction(prediction, ahead.x, ahead.y - 10, 1_100);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    expect(anchored.anchorTs).toBeCloseTo(1_100, 6);
    expect(predictionPointAt(anchored, 1_100)).toEqual(ahead);
    for (let t = 1_100; t <= 1_400; t += 10) {
      const before = travelled(FROM, prediction.path, predictionPointAt(prediction, t));
      const afterTravelled = travelled(FROM, prediction.path, predictionPointAt(anchored, t));
      expect(afterTravelled).toBeGreaterThanOrEqual(before - 1e-9);
    }
  });
});

describe('自身外推：2 秒冻结', () => {
  it('超过 PREDICTION_STALE_MS 没收到自己的 pos → 停在最后一个外推点，不回退', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');

    const frozen = predictionPointAt(prediction, 1_000 + PREDICTION_STALE_MS);
    expect(frozen).toEqual(along(FROM, prediction.path, (WALK_SPEED_PX_PER_S * PREDICTION_STALE_MS) / 1000));
    // 停在原地，而不是回到权威点
    expect(predictionPointAt(prediction, 1_000 + PREDICTION_STALE_MS + 30_000)).toEqual(frozen);
    expect(frozen).not.toEqual(FROM);

    // 重锚之后才继续走（下一批权威 pos 才是唯一的推进来源）
    const anchored = anchorPrediction(prediction, frozen.x, frozen.y, 1_000 + PREDICTION_STALE_MS);
    if (!anchored) throw new Error('冻结点就在折线上，不该作废');
    expect(predictionPointAt(anchored, 1_000 + PREDICTION_STALE_MS + 100)).not.toEqual(frozen);
  });

  it('权威点跳到了折线以外（hop 传送）→ 外推作废；一跳之内的小偏差仍只是重锚', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');

    // 同一时刻的另一张床脚前：跳变幅度远超 TELEPORT_SNAP_PX
    const elsewhere = streetPointAt(ROWS, 0, ROWS);
    expect(anchorPrediction(prediction, elsewhere.x, elsewhere.y, 1_100)).toBeUndefined();

    // 正常的一拍（时钟估计误差只有几十像素）不能被当成传送
    const near = predictionPointAt(prediction, 1_100);
    expect(anchorPrediction(prediction, near.x + 10, near.y + 10, 1_100)).toBeDefined();
  });
});

describe('自身外推：登记与清除（store）', () => {
  it('发出 walk 意图时登记；关于自己的 pos 重锚', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    const started = getState().prediction;
    if (!started) throw new Error('外推应当已登记');
    expect(started.x).toBe(FROM.x);
    expect(started.y).toBe(FROM.y);
    // 站着不动 → 领先量 0 → 锚点时刻就是真值时刻（假时钟：逐位确定）
    expect(started.anchorTs).toBe(SNAPSHOT_TS);
    expect(started.path).toEqual(findPath(FROM, TO, BED_COUNT));

    // 我的权威位置到了：重锚到该批的时刻
    const authority = along(FROM, started.path, 60);
    applyPos({ t: 'pos', ts: 1_000_200, items: [['u_me', authority.x, authority.y]] });
    const anchored = getState().prediction;
    expect(anchored).not.toBe(started);
    expect(anchored?.anchorTs).toBe(1_000_200);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');
    expect(predictionPointAt(anchored, 1_000_200)).toEqual(authority);
  });

  it('别人的位置不动我的外推；`hop`（位置跳变）作废外推', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    const started = getState().prediction;
    expect(started).toBeDefined();

    // 别人动：我的外推一个字都不变
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 300, 300]] });
    expect(getState().prediction).toBe(started);

    // 我的权威位置跳到了厅的另一头（`hop` 传送）：外推作废
    applyPos({ t: 'pos', ts: 1_000_200, items: [['u_me', FROM.x + 3_000, FROM.y]] });
    expect(getState().prediction).toBeUndefined();
  });

  it('不在线时（上行会被丢掉）不登记外推', () => {
    applySnapshot(snapshot());
    setState({ connection: 'offline' });
    beginWalk(TO);
    expect(getState().prediction).toBeUndefined();
  });

  it('上床 / 离开 / 重连都丢弃外推', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 1 });
    expect(getState().prediction).toBeUndefined();

    applySnapshot(snapshot());
    beginWalk(TO);
    applyLeave({ t: 'leave', id: 'u_me', online: 0 });
    expect(getState().prediction).toBeUndefined();

    applySnapshot(snapshot());
    beginWalk(TO);
    expect(getState().prediction).toBeDefined();
    applySnapshot(snapshot());
    expect(getState().prediction).toBeUndefined();
  });

  it('躺在床上点地面：用**床脚前那一点**当锚点（不等「起身」那条消息回来）', () => {
    applySnapshot(snapshot());
    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 1 });
    beginWalk(TO);

    const prediction = getState().prediction;
    expect(prediction).toBeDefined();
    // 服务端 `standUp` 保留的就是这个位置（`frontPointOf`），所以外推起点与服务端一致
    expect(prediction).toMatchObject(frontPointOf(42) as Point);
    // 折线也确实是「从床脚前走到目标点」那一条
    expect(prediction?.path).toEqual(findPath(frontPointOf(42) as Point, TO, BED_COUNT));
  });

  it('起身（回到 roaming）**不**清外推：起身不改变位置，清掉就把提前起步丢了', () => {
    applySnapshot(snapshot());
    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 1 });
    beginWalk(TO);
    const before = getState().prediction;

    applyState({ t: 'state', id: 'u_me', state: 'roaming', x: FROM.x, y: FROM.y, online: 1 });
    expect(getState().prediction).toBe(before);
  });

  it('「这条意图没生效」的错误码当场丢掉外推（静默类也一样）', () => {
    for (const code of ['3003', '3006', '4002']) {
      applySnapshot(snapshot());
      beginWalk(TO);
      expect(getState().prediction).toBeDefined();
      applyError(code);
      expect(getState().prediction).toBeUndefined();
    }
  });

  it('聊天类错误不清外推（它与走动无关，清了就是打断一趟正当的走路）', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    const before = getState().prediction;

    applyError('4001');
    expect(getState().prediction).toBe(before);
  });

  it('`clearPrediction()`（`hop` 发出去时调它）把外推丢掉，重复调用幂等', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    clearPrediction();
    expect(getState().prediction).toBeUndefined();
    clearPrediction();
    expect(getState().prediction).toBeUndefined();
  });
});

/** 与 `TO` 共用第一段（同一条街行往东）的另一个目标：改目标时画面上那一点正好落在共享的段上。 */
const RETARGET = streetPointAt(0, COLS, ROWS);
/** `RETARGET` 正南的那个街网节点（同列最下一行）：`RETARGET` 方向的折线与它**垂直**。 */
const SOUTH = streetPointAt(ROWS, 0, ROWS);

describe('自身外推：意图锚点取真值 + 领先量（store）', () => {
  it('站定起步：登记那一刻的画面点 = 真值点；首条关于自己的 pos 到达后画面不倒退', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    const started = getState().prediction;
    if (!started) throw new Error('外推应当已登记');
    expect(predictionPointAt(started, SNAPSHOT_TS)).toEqual(FROM);

    const ts = SNAPSHOT_TS + 100;
    const authority = along(FROM, started.path, (WALK_SPEED_PX_PER_S * 100) / 1000);
    const before = predictionPointAt(started, ts);
    applyPos({ t: 'pos', ts, items: [['u_me', authority.x, authority.y]] });
    const anchored = getState().prediction;
    if (!anchored) throw new Error('同一条折线上的一拍，不该作废');

    const after = predictionPointAt(anchored, ts);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(travelled(FROM, started.path, after)).toBeGreaterThanOrEqual(travelled(FROM, started.path, before) - 1e-9);
  });

  it('走路中途改为**垂直**的目标：侧向偏移不算领先量，画面沿新折线的进度不跳', () => {
    applySnapshot(snapshot());
    beginWalk(RETARGET);
    const first = getState().prediction;
    if (!first) throw new Error('外推应当已登记');

    // 走出 55px（= 领先量名义 250ms）时改目标：画面在正东 (83,128)
    vi.setSystemTime(LOCAL_NOW + 250);
    const serverNow = SNAPSHOT_TS + 250;
    const before = predictionPointAt(first, serverNow);
    expect(Math.hypot(before.x - FROM.x, before.y - FROM.y)).toBeCloseTo(55, 6);

    beginWalk(SOUTH);
    const second = getState().prediction;
    if (!second) throw new Error('外推应当已登记');
    expect(second.path).toEqual(findPath(FROM, SOUTH, BED_COUNT));
    // 前提（可证伪的那一点）：旧画面点落在新折线的**侧方**——直线距离 55px，折线上的弧长只有 0。
    // 拿直线距离当领先量 → 锚点时刻凭空前推 250ms → 下面画面就向南多走 55px（变红）。
    const lateral = Math.hypot(before.x - FROM.x, before.y - FROM.y);
    expect(lateral).toBeGreaterThan(travelled(FROM, second.path, before) + 50);

    // 侧向偏移不进领先量：锚点时刻 = 真值时刻，画面沿新折线的进度一点没动
    expect(second.anchorTs).toBeCloseTo(serverNow, 6);
    const after = predictionPointAt(second, serverNow);
    expect(Math.abs(travelled(FROM, second.path, after) - travelled(FROM, second.path, before))).toBeLessThanOrEqual(1);
    expect(Math.hypot(after.x - FROM.x, after.y - FROM.y)).toBeLessThanOrEqual(1);

    // 之后沿新折线单调不减
    let last = travelled(FROM, second.path, after);
    for (let t = serverNow + 16; t <= serverNow + 1_000; t += 16) {
      const position = travelled(FROM, second.path, predictionPointAt(second, t));
      expect(position).toBeGreaterThanOrEqual(last - 1e-9);
      last = position;
    }
  });

  it('躺在床上点地面：锚点时刻 = 真值时刻（离床那一下的位移不进领先量）', () => {
    applySnapshot(snapshot());
    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 1 });
    beginWalk(TO);
    const started = getState().prediction;
    if (!started) throw new Error('外推应当已登记');

    // 床上没有旧外推可带（`applyState` 已经清掉），于是领先量 0、画面就在床脚前
    expect(started.anchorTs).toBe(SNAPSHOT_TS);
    expect(started.ts).toBe(SNAPSHOT_TS);
    expect(predictionPointAt(started, SNAPSHOT_TS)).toMatchObject(frontPointOf(42) as Point);
  });
});

describe('自身外推：保鲜期按「最后一条关于自己的 pos」起算（store）', () => {
  it('带 250ms 领先量的外推：`ts + 2000ms` 之内照常推进，之后冻结且不回退', () => {
    applySnapshot(snapshot());
    beginWalk(TO);
    // 走出 55px（= 250ms）时改目标：那 55px 进的是**锚点时刻**，领先量 250ms
    vi.setSystemTime(LOCAL_NOW + 250);
    beginWalk(RETARGET);
    const prediction = getState().prediction;
    if (!prediction) throw new Error('外推应当已登记');
    const ts = SNAPSHOT_TS + 250;
    expect(prediction.anchorTs).toBe(SNAPSHOT_TS);
    expect(prediction.ts).toBe(ts);
    expect(prediction.ts - prediction.anchorTs).toBeCloseTo(250, 6);
    // 折线比「2000 + 领先量」还长 → 推进量可以被观察到（不是走到头了才不动）
    expect(pathLength(FROM, prediction.path)).toBeGreaterThan((WALK_SPEED_PX_PER_S * (PREDICTION_STALE_MS + 250)) / 1000);

    let last = travelled(FROM, prediction.path, predictionPointAt(prediction, ts));
    expect(last).toBeCloseTo(55, 6);
    for (let t = ts + 16; t <= ts + PREDICTION_STALE_MS; t += 16) {
      const position = travelled(FROM, prediction.path, predictionPointAt(prediction, t));
      expect(position).toBeGreaterThan(last);
      last = position;
    }
    // 冻结点在真值时刻之后 2000ms = 495px（按锚点时刻起算的话 1750ms 就冻死在 440px）
    expect(last).toBeCloseTo((WALK_SPEED_PX_PER_S * (PREDICTION_STALE_MS + 250)) / 1000, 6);
    const frozen = predictionPointAt(prediction, ts + PREDICTION_STALE_MS);
    expect(predictionPointAt(prediction, ts + PREDICTION_STALE_MS + 30_000)).toEqual(frozen);
    expect(frozen).not.toEqual(FROM);
  });

  it('旧外推已冻结时发新意图：不携带幻影领先量（lead = 0），画面就在真值点，且能正常推进', () => {
    applySnapshot(snapshot());
    beginWalk(RETARGET);
    const old = getState().prediction;
    if (!old) throw new Error('外推应当已登记');
    // 3000ms 没有任何关于自己的 pos：旧外推早就冻结在 440px 处（真值点还是 `me.x/y` = FROM）
    vi.setSystemTime(LOCAL_NOW + 3_000);
    const serverNow = SNAPSHOT_TS + 3_000;
    expect(serverNow - old.ts).toBeGreaterThan(PREDICTION_STALE_MS);
    expect(travelled(FROM, old.path, predictionPointAt(old, serverNow))).toBeCloseTo(
      (WALK_SPEED_PX_PER_S * PREDICTION_STALE_MS) / 1000,
      6,
    );

    beginWalk(TO);
    const prediction = getState().prediction;
    if (!prediction) throw new Error('外推应当已登记');
    // 领先量 0：锚点时刻 = 真值时刻 = 发起那一刻，画面点就在锚点（= 真值点）上
    expect(prediction.anchorTs).toBe(serverNow);
    expect(prediction.ts).toBe(serverNow);
    const render = predictionPointAt(prediction, serverNow);
    expect(render.x).toBeCloseTo(FROM.x, 6);
    expect(render.y).toBeCloseTo(FROM.y, 6);

    // 也不一开局就冻死：之后满满 2000ms 照常推进
    let last = 0;
    for (let t = serverNow; t <= serverNow + PREDICTION_STALE_MS; t += 16) {
      const position = travelled(FROM, prediction.path, predictionPointAt(prediction, t));
      expect(position).toBeGreaterThanOrEqual(last);
      last = position;
    }
    expect(last).toBeCloseTo((WALK_SPEED_PX_PER_S * PREDICTION_STALE_MS) / 1000, 6);
  });

  it('陈旧判据取严格：真值陈旧度 1999ms 带领先量（封顶半个保鲜期），2000 / 2001ms 不带', () => {
    // 快照只取一次：假时钟钉在 `LOCAL_NOW` 那一刻，此后 `serverNow = SNAPSHOT_TS + 经过的毫秒数`
    applySnapshot(snapshot());
    for (const [age, fresh] of [[1_999, true], [2_000, false], [2_001, false]] as const) {
      clearPrediction();
      vi.setSystemTime(LOCAL_NOW);
      beginWalk(RETARGET);
      const old = getState().prediction;
      if (!old) throw new Error('外推应当已登记');

      vi.setSystemTime(LOCAL_NOW + age);
      const serverNow = SNAPSHOT_TS + age;
      expect(serverNow - old.ts).toBe(age);
      beginWalk(TO);
      const prediction = getState().prediction;
      if (!prediction) throw new Error('外推应当已登记');

      const render = predictionPointAt(prediction, serverNow);
      if (!fresh) {
        // 恰好等于保鲜期也算陈旧：不携带那个画面点（它冻在 440px 处），画面回到真值点
        expect(serverNow - prediction.anchorTs).toBe(0);
        expect(Math.hypot(render.x - FROM.x, render.y - FROM.y)).toBeLessThanOrEqual(1);
        continue;
      }
      // 带：但那 439.8px（≈1999ms）是幻影，只带到半个保鲜期为止
      expect(serverNow - prediction.anchorTs).toBeCloseTo(PREDICTION_STALE_MS / 2, 6);
      expect(serverNow - prediction.anchorTs).toBeLessThanOrEqual(PREDICTION_STALE_MS / 2);
      expect(travelled(FROM, prediction.path, render)).toBeCloseTo((WALK_SPEED_PX_PER_S * PREDICTION_STALE_MS) / 2_000, 6);
    }
  });

  it('重锚把真值时刻换成那条 `pos` 的时刻：冻结点跟着后移', () => {
    const started = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!started) throw new Error('折线应当存在');
    const authority = along(FROM, started.path, 60);
    const anchored = anchorPrediction(started, authority.x, authority.y, 1_200);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    // 未重锚的那条在 1000 + 2000 冻死；重锚到 1200 的那一拍到同一时刻还在走
    expect(predictionPointAt(started, 1_000 + PREDICTION_STALE_MS + 30_000)).toEqual(
      predictionPointAt(started, 1_000 + PREDICTION_STALE_MS),
    );
    const at = predictionPointAt(anchored, 1_000 + PREDICTION_STALE_MS);
    const next = predictionPointAt(anchored, 1_000 + PREDICTION_STALE_MS + 16);
    expect(Math.hypot(next.x - at.x, next.y - at.y)).toBeCloseTo((WALK_SPEED_PX_PER_S * 16) / 1000, 6);

    // 冻结点后移到 `pos.ts + 保鲜期`：之前还在动，之后一动不动
    const late = predictionPointAt(anchored, 1_200 + PREDICTION_STALE_MS);
    expect(predictionPointAt(anchored, 1_200 + PREDICTION_STALE_MS - 1)).not.toEqual(late);
    expect(predictionPointAt(anchored, 1_200 + PREDICTION_STALE_MS + 30_000)).toEqual(late);
  });
});
