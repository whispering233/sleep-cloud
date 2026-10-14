import type { Tile } from './pathfinding';

/**
 * 移动者的推进状态。**只在内存里**（工作集），位置与目标放在连接附加数据上；
 * 对象被驱逐后从附加数据重建（见 `10-hall-runtime.md` §5.3）。
 */
export interface MoverState {
  /** 当前所在的格（权威位置的副本，写入连接附加数据的那一份） */
  x: number;
  y: number;
  /** 尚未走过的剩余路径（不含当前格） */
  path: Tile[];
  /** 当前这一段（正走向 `path[0]`）已经走了多久 */
  legElapsedMs: number;
}

export interface AdvanceResult {
  moved: boolean;
  arrived: boolean;
}

/**
 * 按**实际经过的时间**推进，不按拍数。
 *
 * 云端计时不精确、节拍会抖动，甚至会因为一次阻塞吞掉好几拍：
 * 只要按时间算，吞掉的拍会被下一次调用一次性补上，移动速度保持不变。
 */
export function advanceMover(mover: MoverState, elapsedMs: number, stepMs: number): AdvanceResult {
  let remaining = mover.legElapsedMs + Math.max(0, elapsedMs);
  let moved = false;

  while (mover.path.length > 0 && remaining >= stepMs) {
    remaining -= stepMs;
    const next = mover.path.shift() as Tile;
    mover.x = next.x;
    mover.y = next.y;
    moved = true;
  }

  mover.legElapsedMs = mover.path.length > 0 ? remaining : 0;
  return { moved, arrived: mover.path.length === 0 };
}
