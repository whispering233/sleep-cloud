import type { Scene } from '../../shared/scene';

/** 一个格子在世界坐标里的边长（缩放由相机决定）。 */
export const TILE = 32;

export interface SceneIndex {
  scene: Scene;
  widthPx: number;
  heightPx: number;
  /** 床号 → 格子坐标 */
  bedAt(bedNo: number): { x: number; y: number } | undefined;
}

const cache = new Map<string, Promise<SceneIndex>>();

/** 场景资源按 guid 取一次就缓存：**一份数据两个读者**，客户端这边就是这里（见 `docs/design/config.md` §5）。 */
export function loadSceneIndex(sceneGuid: string): Promise<SceneIndex> {
  const cached = cache.get(sceneGuid);
  if (cached) return cached;

  const loading = (async (): Promise<SceneIndex> => {
    const response = await fetch(`/scenes/${sceneGuid}.json`);
    if (!response.ok) throw new Error(`场景资源加载失败：${sceneGuid}（${response.status}）`);
    const scene = (await response.json()) as Scene;
    const positions = new Map(scene.beds.map((bed) => [bed.bedNo, { x: bed.x, y: bed.y }]));
    return {
      scene,
      widthPx: scene.width * TILE,
      heightPx: scene.height * TILE,
      bedAt: (bedNo) => positions.get(bedNo),
    };
  })();

  cache.set(sceneGuid, loading);
  return loading;
}
