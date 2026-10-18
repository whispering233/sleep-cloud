/**
 * 软键盘（`docs/ui/DESIGN.md`「软键盘」）：键盘吃掉多少视口，`visualViewport` 是**唯一**来源。
 *
 * 两个数写到 `.app-shell` 的内联样式上——`.world-layer`（`inset: 0`）与 `.chat-panel`（贴底）
 * 因此由**同一处**让出键盘那一块：面板抬到键盘上沿，世界层只被裁掉底部（画布像素尺寸由插槽面板的冻结守着）。
 * 所以既不需要 `interactive-widget`，也不靠 `ResizeObserver` 兜底，浏览器 relayout 布局视口与否都不影响结果。
 *
 * 算数在 `world/rules.ts` 的 `keyboardOf`（纯函数，DOM-free 才能单测）；这一层只负责订阅与写样式。
 */
import { keyboardOf } from './world/rules';

/**
 * 订阅 `visualViewport` 的 `resize` 与 `scroll`（iOS 聚焦时 pan 走 `scroll`），把缩小量与 pan 写到宿主的
 * 内联样式上。键盘是**连续动画**（iOS 滑入逐帧变高、Android 可能只发一次），所以每次事件都由
 * **当前值**重算一遍，不累加增量。
 */
export function trackKeyboard(shell: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const sync = (): void => {
    const state = keyboardOf(window.innerHeight, viewport);
    // 缩 shell 的下边缘：面板让出键盘那一块（画布像素尺寸不跟着变，插槽面板开着时冻结）
    shell.style.insetBlockEnd = `${state.shrink}px`;
    // `position: fixed` 相对**布局视口**定位，而 `offsetTop > 0` 表示视觉视口顶边落在布局视口顶边
    // **下方**（屏幕顶上显示的是布局 y = offsetTop 的内容）——所以 shell 要同量**下移**才对得上屏幕，
    // 用 `-pan` 会让它再往上错 2×pan。
    shell.style.transform = state.pan === 0 ? '' : `translateY(${state.pan}px)`;
  };

  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  sync();
  return () => {
    viewport.removeEventListener('resize', sync);
    viewport.removeEventListener('scroll', sync);
  };
}
