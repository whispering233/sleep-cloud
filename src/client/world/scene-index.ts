import type { Scene } from '../../shared/scene';
import { TILE_PX } from '../../shared/constants';

/** 一个格子在世界坐标里的边长（没有缩放，所以它就是屏幕上的 32 CSS 像素）。 */
export const TILE = TILE_PX;

export interface SceneIndex {
  scene: Scene;
  widthPx: number;
  heightPx: number;
  /** 床号 → 格子坐标 */
  bedAt(bedNo: number): { x: number; y: number } | undefined;
  /** 格子 → 床号（不是床格则 undefined）：命中判定要反查「这一格有没有床」 */
  bedNoAt(x: number, y: number): number | undefined;
  /** 该格能不能走：网格内 ∧ 非障碍格 ∧ 非床格（与服务端 `SceneGrid.isWalkable` 同一套语义） */
  isWalkable(x: number, y: number): boolean;
}

const cache = new Map<string, Promise<SceneIndex>>();

/** 由场景数据建索引（纯函数，便于单测）：与服务端 `SceneGrid.isWalkable` 同一套语义。 */
export function buildSceneIndex(scene: Scene): SceneIndex {
  const positions = new Map(scene.beds.map((bed) => [bed.bedNo, { x: bed.x, y: bed.y }]));
  const bedNoByTile = new Map(scene.beds.map((bed) => [`${bed.x},${bed.y}`, bed.bedNo]));
  const blocked = new Set(scene.blocked.map(([x, y]) => `${x},${y}`));
  return {
    scene,
    widthPx: scene.width * TILE,
    heightPx: scene.height * TILE,
    bedAt: (bedNo) => positions.get(bedNo),
    bedNoAt: (x, y) => bedNoByTile.get(`${x},${y}`),
    isWalkable: (x, y) =>
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < scene.width &&
      y < scene.height &&
      !blocked.has(`${x},${y}`) &&
      !bedNoByTile.has(`${x},${y}`),
  };
}

/** 场景资源按 guid 取一次就缓存：**一份数据两个读者**，客户端这边就是这里（见 `docs/design/config.md` §5）。 */
export function loadSceneIndex(sceneGuid: string): Promise<SceneIndex> {
  const cached = cache.get(sceneGuid);
  if (cached) return cached;

  const loading = (async (): Promise<SceneIndex> => {
    const response = await fetch(`/scenes/${sceneGuid}.json`);
    if (!response.ok) throw new Error(`场景资源加载失败：${sceneGuid}（${response.status}）`);
    return buildSceneIndex((await response.json()) as Scene);
  })();

  cache.set(sceneGuid, loading);
  return loading;
}
