/**
 * 软键盘（`docs/ui/DESIGN.md`「软键盘」）：界面**不读键盘高度**，只读视觉视口被 pan 了多少。
 *
 * 进入打字态时整个底部组合挪到 HUD 下方（`docs/design/60-interaction-shell.md` §2、§3），
 * 顶部与键盘天然不重叠，所以「键盘吃掉多高」这个量整个不需要了——而它正是画布逐帧重建、闪烁的根。
 *
 * 唯一留下的写成一处：iOS 聚焦时浏览器会平移视觉视口，`position: fixed` 的 `.app-shell`
 * 跟着布局视口走、所以就错位了，用 `translateY(offsetTop)` 拉回屏幕。**只写 transform**，不改尺寸。
 *
 * 算数在 `world/rules.ts` 的 `keyboardOf`（纯函数，DOM-free 才能单测）；这一层只负责订阅与写样式。
 */
import { keyboardOf } from './world/rules';

/**
 * 订阅 `visualViewport` 的 `resize` 与 `scroll`（iOS 聚焦时 pan 走 `scroll`），把 pan 写到宿主的内联样式上。
 * pan 是**连续动画**（iOS 滑入逐帧变高、Android 可能只发一次），所以每次事件都由**当前值**重算，不累加增量。
 */
export function trackKeyboard(shell: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const sync = (): void => {
    const { pan } = keyboardOf(viewport);
    // `position: fixed` 相对**布局视口**定位，而 `offsetTop > 0` 表示视觉视口顶边落在布局视口顶边
    // **下方**（屏幕顶上显示的是布局 y = offsetTop 的内容）——所以 shell 要同量**下移**才对得上屏幕，
    // 用 `-pan` 会让它再往上错 2×pan。
    shell.style.transform = pan === 0 ? '' : `translateY(${pan}px)`;
  };

  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  sync();
  return () => {
    viewport.removeEventListener('resize', sync);
    viewport.removeEventListener('scroll', sync);
  };
}
