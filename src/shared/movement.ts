import { WALK_SPEED_PX_PER_S } from './constants';
import type { Point } from './layout';

/**
 * 移动者的推进状态。**只在内存里**（工作集），位置与目标放在连接附加数据上；
 * 对象被驱逐后从附加数据重建（见 `10-hall-runtime.md` §5.3）。
 */
export interface MoverState {
  /** 当前位置（世界像素，权威位置的副本） */
  x: number;
  y: number;
  /** 剩余途经点（不含当前位置；最后一个是目标点） */
  path: Point[];
}

export interface AdvanceResult {
  moved: boolean;
  arrived: boolean;
}

/**
 * 按**实际经过的时间**沿折线推进（不按拍数，也不量化到格）。
 *
 * 云端计时不精确、节拍会抖动，甚至会因为一次阻塞吞掉好几拍：只要按时间算，吞掉的拍会被下一次调用
 * 一次性补上，移动速度保持不变；位置本身是连续的像素量，因此也不需要「本格已走进度」这类状态。
 */
export function advanceMover(mover: MoverState, elapsedMs: number, speedPxPerS = WALK_SPEED_PX_PER_S): AdvanceResult {
  let budget = (Math.max(0, elapsedMs) * speedPxPerS) / 1000;
  let moved = false;

  while (budget > 0 && mover.path.length > 0) {
    const next = mover.path[0] as Point;
    const dx = next.x - mover.x;
    const dy = next.y - mover.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= budget) {
      mover.x = next.x;
      mover.y = next.y;
      mover.path.shift();
      budget -= distance;
      moved = true;
      continue;
    }
    const ratio = budget / distance;
    mover.x += dx * ratio;
    mover.y += dy * ratio;
    budget = 0;
    moved = true;
  }

  return { moved, arrived: mover.path.length === 0 };
}

/** 移动者此刻的位置（成就地是连续像素，不需要再从格号换算）。 */
export function moverPosition(mover: MoverState): Point {
  return { x: mover.x, y: mover.y };
}