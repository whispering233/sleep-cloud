import { PREDICTION_STALE_MS, TELEPORT_SNAP_PX, WALK_SPEED_PX_PER_S } from '../shared/constants';
import type { Point } from '../shared/layout';
import { advanceMover } from '../shared/movement';
import type { MoverState } from '../shared/movement';
import { findPath } from '../shared/pathfinding';

/**
 * 自身外推（**只对自己**，见 `docs/api/20-api-ws.md` §6）。
 *
 * 为什么可以这样外推：服务端寻路是闭式解、路径与速度都在共享层，所以客户端算出来的轨迹**与服务端一致**，
 * 不是猜。别人的插值滞后买的是「别人路径未知时的平滑」，自己不需要——外推的是「现在」。
 *
 * 三条纪律：
 * 1. **纯函数**：时间一律由入参 `now`（服务端时间轴）传入，这里不读 `Date.now()`（同 `conn-state.ts`）；
 * 2. `findPath` **只在发出意图那一次调用**（`beginPrediction`），之后每帧只沿已算好的折线推进；
 * 3. 外推点绝不进 React 的逐帧状态：由世界层每帧现算（`world.ts` 的 `selfPoint`）。
 */
export interface Prediction {
  /** 锚点（世界像素）：发出意图时的权威点，或最近一条关于自己的 `pos` 在折线上的**投影** */
  x: number;
  y: number;
  /** 锚点对应的服务端时刻 */
  anchorTs: number;
  /** 锚点之后剩余的途经点（最后一个就是目标点） */
  path: Point[];
}

/**
 * 发出 `walk` 意图：用**与服务端同一份** `findPath` 算一次折线。
 * 目标点不在街网上 → 不外推（返回 `undefined`，渲染回落到权威值；服务端也会静默拒掉这条）。
 */
export function beginPrediction(from: Point, to: Point, bedCount: number, now: number): Prediction | undefined {
  const path = findPath(from, to, bedCount);
  return path ? { x: from.x, y: from.y, anchorTs: now, path } : undefined;
}

/**
 * 收到关于自己的 `pos`：用权威点与该批的服务端时刻**重锚**（不重锚就一路分叉，而且再也回不来）。
 * 路径不必重算——服务端与客户端走的是同一条折线，只是锚点往后挪了一拍。
 *
 * 重锚**只许向前收敛**：画面在锚点（权威点的投影）前方多少（`ahead`），锚点时刻就往前挪多少，
 * 于是画面在那一刻一动不动、`lead` 保持（`docs/design/30-movement-sync.md` §3.2）。权威点反而在
 * 我身前时 `ahead = 0` → 画面当场前跳到锚点，仍不倒退。
 *
 * 权威点离我外推的位置太远时返回 `undefined`（**外推作废**，渲染回落到权威值）：`hop` 传送、
 * 或服务端换了目标。判据用 `TELEPORT_SNAP_PX`——与插值判「位置跳变」是同一个阈值，
 * 客户端对「传送」只有这一种口径。
 *
 * **「意图被拒」不走这里**：服务端拒掉一条意图后不会再为那个目标发 `pos`，等不到重锚——
 * 那种情况由 `store.applyError` 就地丢掉外推（见 `MOVE_INTENT_ERRORS`）。
 */
export function anchorPrediction(prediction: Prediction, x: number, y: number, ts: number): Prediction | undefined {
  const predicted = predictionPointAt(prediction, ts);
  if (Math.hypot(x - predicted.x, y - predicted.y) > TELEPORT_SNAP_PX) return undefined;
  const origin = { x: prediction.x, y: prediction.y };
  // 锚点取权威点的**投影**：横向分量不进轨迹，否则画面会被拉到一条斜线上（§3.2）
  const anchor = projectOnPath(origin, prediction.path, { x, y });
  const ahead = Math.max(0, arcLengthAhead(origin, prediction.path, predicted) - anchor.arc);
  return {
    x: anchor.x,
    y: anchor.y,
    anchorTs: ts - (ahead / WALK_SPEED_PX_PER_S) * 1000,
    path: dropPassed(origin, prediction.path, anchor.arc),
  };
}

/**
 * `to` 到折线（起点 `from` → 各途经点）的**最近投影点**及其弧长：重锚用它把权威点搬到折线上，
 * 并量出「画面在锚点前方多少个像素」。投影落在 `from` 之前、或折线为空时停在 `from`（弧长 0）。
 */
function projectOnPath(from: Point, path: Point[], to: Point): Point & { arc: number } {
  let previous = from;
  let travelled = 0;
  let best: Point & { arc: number; distance: number } = { x: from.x, y: from.y, arc: 0, distance: Infinity };
  for (const point of path) {
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const length = Math.hypot(dx, dy);
    const ratio = length === 0 ? 0 : Math.min(1, Math.max(0, ((to.x - previous.x) * dx + (to.y - previous.y) * dy) / (length * length)));
    const x = previous.x + dx * ratio;
    const y = previous.y + dy * ratio;
    const distance = Math.hypot(to.x - x, to.y - y);
    if (distance < best.distance) best = { x, y, arc: travelled + length * ratio, distance };
    travelled += length;
    previous = point;
  }
  return { x: best.x, y: best.y, arc: best.arc };
}

/**
 * `from` 沿折线走到 `to`（投影到折线上的最近点）的弧长：重锚用它量「画面在锚点前方多少个像素」。
 * `to` 在折线外时取最近点；投影落在 `from` 之前（或折线为空）时为 0——那一段不该由锚点时刻吸收。
 */
export function arcLengthAhead(from: Point, path: Point[], to: Point): number {
  return projectOnPath(from, path, to).arc;
}

/**
 * 剪掉**锚点已经走过**的拐点：留着它，推进器会先掉头走回那个拐点（画面上是往回跳一下）。
 * 判据是**弧长**（折线自己走过的距离），与锚点横向偏出折线多少无关——方向点积在那个情形下会剪错。
 * 锚点之后第一个拐点永远留下（最后那个途经点就是目的地，不能被剪掉）。
 */
function dropPassed(from: Point, path: Point[], passedArc: number): Point[] {
  let previous = from;
  let travelled = 0;
  let dropped = 0;
  while (dropped < path.length) {
    const point = path[dropped] as Point;
    travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
    if (travelled >= passedArc) break;
    previous = point;
    dropped += 1;
  }
  return path.slice(Math.max(0, Math.min(dropped, path.length - 1)));
}

/**
 * 外推点：锚点按 `WALK_SPEED_PX_PER_S`（= `advanceMover` 的默认速度）沿折线推进「现在 − 锚点时刻」，
 * 但**最多推进 `PREDICTION_STALE_MS`** —— 超时冻结在最后一个外推点，**不回退**到旧权威点。
 * 推进量按时间算（`advanceMover` 同一条纪律），所以掉帧与节拍抖动只影响平滑度、不影响速度。
 */
export function predictionPointAt(prediction: Prediction, now: number): Point {
  const elapsed = Math.min(Math.max(0, now - prediction.anchorTs), PREDICTION_STALE_MS);
  const mover: MoverState = { x: prediction.x, y: prediction.y, path: [...prediction.path] };
  advanceMover(mover, elapsed);
  return { x: mover.x, y: mover.y };
}
