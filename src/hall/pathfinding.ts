import type { SceneGrid } from './scene';

export interface Tile {
  x: number;
  y: number;
}

/**
 * 四向 BFS 寻路。网格最大也就一千多格，BFS 每次调用是微秒级，
 * 不值得为它上 A*（服务端单次调用的 CPU 预算很小，但这里不是瓶颈）。
 *
 * 返回**不含起点、含终点**的格序列；目标不可行走或不可达时返回 `null`。
 */
export function findPath(grid: SceneGrid, from: Tile, to: Tile): Tile[] | null {
  if (!grid.isWalkable(to.x, to.y)) return null;

  const width = grid.width;
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  if (start === goal) return [];

  const cameFrom = new Int32Array(width * grid.height).fill(-1);
  const seen = new Uint8Array(width * grid.height);
  seen[start] = 1;

  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head] as number;
    head += 1;
    if (current === goal) break;

    const cx = current % width;
    const cy = (current - cx) / width;
    for (const [nx, ny] of [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ] as Array<[number, number]>) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= grid.height) continue;
      const index = ny * width + nx;
      if (seen[index] === 1 || !grid.isWalkable(nx, ny)) continue;
      seen[index] = 1;
      cameFrom[index] = current;
      if (index === goal) {
        queue.push(index);
        head = queue.length; // 找到就停
        break;
      }
      queue.push(index);
    }
  }

  if (seen[goal] !== 1) return null;

  const path: Tile[] = [];
  for (let index = goal; index !== start; index = cameFrom[index] as number) {
    if (index < 0) return null; // 理论上不会发生：seen 保证可达
    const x = index % width;
    path.push({ x, y: (index - x) / width });
  }
  return path.reverse();
}
