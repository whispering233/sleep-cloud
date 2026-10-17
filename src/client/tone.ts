import type { ClientState } from './store';

/** 档位：`0` 漫游 / `1` 躺下 / `2` 睡下（`docs/ui/DESIGN.md` 的「三档色调」）。 */
export type Tone = 0 | 1 | 2;

/**
 * 每一档的减光 α（`TONE_ALPHA[Tone]`）。上限 `0.22` 由**最小的字**决定：
 * `neutral-muted` 在 α=0.22 时衬地板 4.57:1（12px 的 AA 门槛 4.5:1），再压深就不合格。
 */
export const TONE_ALPHA = [0, 0.12, 0.22] as const;

/**
 * 档 = **我自己的显示态**：在厅里走动是 `0`，睁眼躺着是 `1`，睡着是 `2`。
 *
 * **不读时钟、不读全厅**：一条视觉通道只能有一个驱动，而「大家都睡下了」由画面里的
 * 睡着者与睡痕自己表达（`docs/ui/DESIGN.md` 的「三档色调」）。快照还没到（`me` 为空）
 * 按 `0`——厅还没画出来，不能先暗下去。`trace` 不会出现在自己身上（服务端只给自己发
 * `roaming` / `lying` / `asleep`），万一落到这条路径也按 `0`，不发明第四档。
 */
export function toneOf(state: ClientState): Tone {
  const me = state.me;
  if (!me) return 0;
  if (me.state === 'lying') return 1;
  if (me.state === 'asleep') return 2;
  return 0;
}
