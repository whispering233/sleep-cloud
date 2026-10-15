import { HALL_LEVELS } from '../shared/layout';
import type { HallLevel } from '../shared/layout';

/**
 * 级表升降级的**判据**（见 `docs/design/10-hall-runtime.md` §8）。纯函数，SQL 与广播在 `hall.ts`。
 *
 * 两个动作都只写 `meta.bed_count` 并广播一条 `resize`：**不写任何床位行**（新增的床全是无主空床，
 * 砍掉的床全是无主无占用的），所以这里的判据只需要一个数字或一个布尔量。
 */

/**
 * 升级判据：**没有可认领的床**（与出生点同一个查询，见 `10-hall-runtime.md` §9）且未触顶 → 下一档容量。
 * 触顶（已是最后一档）返回 `undefined`，由入场前的判定拦下（`2002`）。
 */
export function nextLevelCapacity(bedCount: number, hasClaimableBed: boolean): number | undefined {
  if (hasClaimableBed) return undefined;
  return HALL_LEVELS.find((level) => level.capacity > bedCount)?.capacity;
}

/**
 * 厅满判据（`2002`）：已经是最后一档**且没有可认领的床**。
 * 只有到这一步才算真的没地方躺；末档一旦有床释放就又是一个空位（行还在、归属已过期的也算）。
 */
export function isHallFull(bedCount: number, hasClaimableBed: boolean): boolean {
  return bedCount === (HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel).capacity && !hasClaimableBed;
}

/**
 * 缩级判据：最外那一圈床**全部无主且无占用**（含未过期睡痕）→ 上一档容量；否则 `undefined`。
 * **一天只跳一档**：跳档需要「这一圈真的没人要了」的判断，实时判定会在人数波动时来回跳。
 */
export function previousLevelCapacity(bedCount: number, outerRingBusy: boolean): number | undefined {
  if (outerRingBusy) return undefined;
  const lower = [...HALL_LEVELS].reverse().find((level: HallLevel) => level.capacity < bedCount);
  return lower?.capacity;
}