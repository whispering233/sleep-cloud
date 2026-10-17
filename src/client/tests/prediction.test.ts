import { describe, expect, it } from 'vitest';

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
import { anchorPrediction, beginPrediction, predictionPointAt } from '../prediction';
import { applyError, applyLeave, applyPos, applySnapshot, applyState, beginWalk, clearPrediction, getState, setState } from '../store';

const BED_COUNT = (HALL_LEVELS[0] as HallLevel).capacity;

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

const snapshot = (): SnapshotMessage => ({
  t: 'snapshot',
  layoutVersion: LAYOUT_VERSION,
  serverTs: 1_000_000,
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

describe('自身外推：重锚', () => {
  it('重锚到权威点与该批时刻，沿**同一条**折线继续（路径不重算）', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const first = prediction.path[0] as Point;
    const second = prediction.path[1] as Point;

    // 权威点已经越过了第一个拐点（服务端说我在那一段里）
    const authority = along(FROM, prediction.path, Math.hypot(first.x - FROM.x, first.y - FROM.y) + 30);
    const anchored = anchorPrediction(prediction, authority.x, authority.y, 1_350);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    expect(anchored.anchorTs).toBe(1_350);
    expect(predictionPointAt(anchored, 1_350)).toEqual(authority);
    // 走过的拐点被剪掉：剩下的仍是原折线的尾巴（没有重算、也没有回头）
    expect(anchored.path).toEqual(prediction.path.slice(1));
    expect(prediction.path.slice(prediction.path.length - anchored.path.length)).toEqual(anchored.path);

    const ahead = predictionPointAt(anchored, 1_450);
    expect(Math.hypot(ahead.x - first.x, ahead.y - first.y)).toBeGreaterThan(Math.hypot(authority.x - first.x, authority.y - first.y));
    expect(ahead).toEqual(along(authority, anchored.path, WALK_SPEED_PX_PER_S / 10));
    expect(second).toBeDefined();
  });

  it('重锚只是换个锚点与时刻（锚点原地不动时折线一个字不变，时钟重新起算）', () => {
    const prediction = beginPrediction(FROM, TO, BED_COUNT, 1_000);
    if (!prediction) throw new Error('折线应当存在');
    const anchored = anchorPrediction(prediction, FROM.x, FROM.y, 1_100);
    if (!anchored) throw new Error('这是同一条折线上的一拍，不该作废');

    expect(anchored.path).toEqual(prediction.path);
    expect(predictionPointAt(anchored, 1_300)).toEqual(along(FROM, anchored.path, WALK_SPEED_PX_PER_S / 5));
    // 重锚把「推进的起点」也挪到了新时刻：推进量只算重锚之后的那一段
    expect(predictionPointAt(anchored, 1_300)).not.toEqual(along(FROM, anchored.path, (WALK_SPEED_PX_PER_S * 300) / 1000));
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
