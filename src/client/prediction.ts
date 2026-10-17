import { PREDICTION_STALE_MS, TELEPORT_SNAP_PX } from '../shared/constants';
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
  /** 锚点（世界像素）：发出意图时的权威点，或最近一条关于自己的 `pos` */
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
  return { x, y, anchorTs: ts, path: dropPassed(prediction.path, { x, y }) };
}

/**
 * 剪掉锚点已经走过的拐点：留着它，推进器会先掉头走回那个拐点（画面上是往回跳一下）。
 * 判据：锚点到拐点的连线在「拐点 → 下一个拐点」方向上的投影为正（= 锚点已在这一段之中或之后）。
 */
function dropPassed(path: Point[], anchor: Point): Point[] {
  let index = 0;
  while (index + 1 < path.length) {
    const from = path[index] as Point;
    const to = path[index + 1] as Point;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if ((anchor.x - from.x) * dx + (anchor.y - from.y) * dy <= 0) break;
    index += 1;
  }
  return index === 0 ? path : path.slice(index);
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
