import type { Person, PersonState } from '../../shared/protocol';

/**
 * 世界画布的纯规则：与 Pixi 无关，可单测。
 * 这些判断是「床位真值表」的直接翻译（见 `docs/ui/DESIGN.md` Components 节）。
 */

/** 轮廓梯次：床上有人 → `line`；睡痕 → `trace`；有主空床 → `claimed`；无主 → 不画。 */
export type BedOutline = 'line' | 'trace' | 'claimed' | null;

export function bedOutline(input: { owned: boolean; occupant?: PersonState }): BedOutline {
  if (input.occupant === 'lying' || input.occupant === 'asleep') return 'line';
  if (input.occupant === 'trace') return 'trace';
  return input.owned ? 'claimed' : null;
}

/** 名字只出现在**有人的床上**，且自己一律不画（地上的自己更不画）。 */
export function shouldDrawName(person: Person, meId: string | undefined): boolean {
  return person.state !== 'roaming' && person.id !== meId;
}

/** 睡痕的小人整体降不透明度：不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色。 */
export function personAlpha(state: PersonState): number {
  return state === 'trace' ? 0.45 : 1;
}

/**
 * 暖灯标记的半径：**有最小屏幕尺寸下限**（缩小时不得消隐，否则找不到我的床）。
 * 上限只用来避免「比床还大」的荒唐值，所以下限优先于上限。
 */
export function markerRadius(scale: number, tile: number): number {
  const minScreenPx = 5;
  const floorRadius = minScreenPx / Math.max(scale, 0.01);
  const ceilingRadius = tile * 0.6;
  return Math.min(Math.max(floorRadius, tile * 0.12), ceilingRadius);
}

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

/** 厅时区里的小时数（时区名非法时回落到 UTC）。 */
export function hourIn(timezone: string, now: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '');
    return Number.isFinite(hour) ? hour % 24 : new Date(now).getUTCHours();
  } catch {
    return new Date(now).getUTCHours();
  }
}

/** 昼夜只看**厅的时区**：厅是共享空间，物理上只能有一片天空。 */
export function isDaytime(timezone: string, now: number): boolean {
  const hour = hourIn(timezone, now);
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}
