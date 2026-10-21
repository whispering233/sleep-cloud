import { ZOOM_TIERS } from '../shared/constants';

/**
 * 世界缩放档位（**客户端本地状态**，见 `docs/ui/DESIGN.md` 的世界相机）。
 * **显式锁定的档持久化**（键 `sc.zoom.mode`，见 `docs/design/40-client-storage.md`）；`自由缩放`
 * 下的连续比例是当场操作、不是偏好，不持久化（整页加载后回 `1×`）。
 *
 * 界面层与世界层共用这一个纯模块（界面层只 `import type` 世界层，所以档位不能落在 `world/rules.ts`），
 * 它**不依赖 Phaser**——齿轮浮层里那几项与 HUD 那一段的文案都从这里取，界面不自己写档位的数。
 */
export type ZoomMode =
  | { kind: 'free' }
  /** 比例锁死在 `z`：捏合不改比例，但两指拖动（锚点补偿）照旧 */
  | { kind: 'fixed'; z: number };

/** 与 `ZOOM_TIERS` **同序同长**的档位文案（漂移由 `tests/zoom.test.ts` 兜住）。 */
const ZOOM_TIER_LABELS = ['全厅', '0.5×', '0.75×', '1×'] as const;

/** 档位 → **文案**（齿轮浮层那一项、HUD 那一段）：`free` = 「自由」，`fixed` = 档位表里那一档
 * （查不到的比例回退成数值，界面不至于空着）。 */
export function zoomShortLabel(mode: ZoomMode): string {
  return mode.kind === 'free' ? '自由' : fixedTierLabel(mode.z);
}

/** 固定档 → 档位表里那一档的文案；查不到的比例回退成数值（档位表以外的比例只来自调试）。 */
function fixedTierLabel(z: number): string {
  return ZOOM_TIER_LABELS[ZOOM_TIERS.findIndex((tier) => tier === z)] ?? `${z}×`;
}

/** 浮层里的选项：`自由缩放` 在前，其余与 `ZOOM_TIERS` 同序。 */
export function zoomOptions(): ZoomMode[] {
  return [{ kind: 'free' }, ...ZOOM_TIERS.map((z) => ({ kind: 'fixed' as const, z }))];
}

/** 逐字段比较（React 订阅用它挡住同值的白重渲染）。 */
export function sameZoomMode(a: ZoomMode, b: ZoomMode): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'free' || (b.kind === 'fixed' && a.z === b.z);
}
