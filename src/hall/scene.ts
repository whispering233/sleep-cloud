import type { HallConfig } from '../shared/hall-registry';
import type { Scene } from '../shared/scene';

import americaScene from '../../public/scenes/dorm-america-01.json';
import asiaScene from '../../public/scenes/dorm-asia-01.json';
import europeScene from '../../public/scenes/dorm-europe-01.json';

/**
 * 场景加载与可行走网格推导。
 *
 * **一份数据，两个读者**（见 `docs/design/config.md` §5）：客户端按 `snapshot.sceneGuid` 从静态资源取用，
 * 服务端在构建时读入同一份文件（下面的静态导入）。不得各自维护副本，否则会出现
 * 「服务端认为不可走而客户端画得出」这类分歧。
 */

/** guid → 场景数据。新增厅时在这里加一条导入。 */
const SCENES: Record<string, Scene> = {
  'dorm-asia-01': asiaScene as Scene,
  'dorm-europe-01': europeScene as Scene,
  'dorm-america-01': americaScene as Scene,
};

export interface SceneGrid {
  scene: Scene;
  width: number;
  height: number;
  /** 可行走格数量（校验与监控用） */
  walkableCount: number;
  isWalkable(x: number, y: number): boolean;
  /** 该格是哪张床（不是床格则 undefined） */
  bedNoAt(x: number, y: number): number | undefined;
  bedPosition(bedNo: number): { x: number; y: number } | undefined;
}

const WALKABLE = 1;
const BLOCKED = 2;
const BED_TILE = 3;

/**
 * 场景数据自检：床位数、床号覆盖、坐标范围、床格与障碍格冲突。
 * 不一致属于**配置错误**（见 `docs/design/config.md` §3），启动时就该报错，不要拖到运行期。
 */
export function assertSceneMatchesHall(scene: Scene, hall: HallConfig): void {
  if (scene.guid !== hall.sceneGuid) {
    throw new Error(`场景标识不符：${scene.guid} ≠ ${hall.sceneGuid}`);
  }
  if (scene.beds.length !== hall.capacity) {
    throw new Error(`场景床位数 ${scene.beds.length} ≠ 厅容量 ${hall.capacity}（${hall.id}）`);
  }
  const seen = new Set<number>();
  for (const bed of scene.beds) {
    if (!Number.isInteger(bed.bedNo) || bed.bedNo < 0 || bed.bedNo >= hall.capacity) {
      throw new Error(`床号越界：${bed.bedNo}（${hall.id}）`);
    }
    if (seen.has(bed.bedNo)) throw new Error(`床号重复：${bed.bedNo}（${hall.id}）`);
    seen.add(bed.bedNo);
    if (!inside(scene, bed.x, bed.y)) throw new Error(`床位坐标越界：床 ${bed.bedNo}`);
  }
  for (const [x, y] of scene.blocked) {
    if (!inside(scene, x, y)) throw new Error(`障碍格坐标越界：(${x}, ${y})`);
  }
}

function inside(scene: Scene, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < scene.width && y < scene.height;
}

/** 推导可行走网格：网格内 ∧ 非障碍格 ∧ 非床格。 */
export function deriveGrid(scene: Scene): SceneGrid {
  const { width, height } = scene;
  // 默认整块地板可走，再把障碍与床格覆盖掉
  const flags = new Uint8Array(width * height).fill(WALKABLE);
  const bedNoByTile = new Int32Array(width * height).fill(-1);
  const positions = new Map<number, { x: number; y: number }>();

  for (const [x, y] of scene.blocked) flags[y * width + x] = BLOCKED;
  for (const bed of scene.beds) {
    flags[bed.y * width + bed.x] = BED_TILE;
    bedNoByTile[bed.y * width + bed.x] = bed.bedNo;
    positions.set(bed.bedNo, { x: bed.x, y: bed.y });
  }

  let walkableCount = 0;
  for (const flag of flags) if (flag === WALKABLE) walkableCount += 1;

  return {
    scene,
    width,
    height,
    walkableCount,
    isWalkable: (x, y) => inside(scene, x, y) && flags[y * width + x] === WALKABLE,
    bedNoAt: (x, y) => {
      if (!inside(scene, x, y)) return undefined;
      const bedNo = bedNoByTile[y * width + x] as number;
      return bedNo < 0 ? undefined : bedNo;
    },
    bedPosition: (bedNo) => positions.get(bedNo),
  };
}

/** 按厅加载场景并校验（配置错误在这里就炸，不留到运行期）。 */
export function loadScene(hall: HallConfig): SceneGrid {
  const scene = SCENES[hall.sceneGuid];
  if (!scene) throw new Error(`缺少场景数据：${hall.sceneGuid}`);
  assertSceneMatchesHall(scene, hall);
  return deriveGrid(scene);
}
