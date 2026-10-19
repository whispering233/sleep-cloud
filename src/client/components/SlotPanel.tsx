import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { slotActive, slotHeightOf, subscribeSlot } from '../slot';

/**
 * 插槽面板的壳（`docs/design/50-slot-panel.md` §3、§5、§6）：挂在聊天面板**下沿**，高度撑到可用视口下沿。
 *
 * - **位置**由 CSS 给定（`.chat-panel` 的绝对定位子元素、`inset-block-start: 100%`），
 *   高度 = 可用视口下沿 − 聊天面板下沿，由这里量出来写成一个 inline px（两个盒子各挂 ResizeObserver）。
 *   绝对定位的子元素不撑开 `.chat-panel`，所以可用视口 / 取景 / 夹取一概不受影响。
 * - **开关**只看触发源（`../slot.ts`），不看键盘——键盘弹没弹在部分内核里测不出来。`hidden` 用不了
 *   （`display: none` 过渡不了）：换成 `data-open`（CSS 做 `opacity` / `transform` 过渡）+ `inert`
 *   （退场期间不可点、不可 Tab、不被读屏读到）。
 * - 它不是浮层：没有背景变暗、不做焦点陷阱、不抢焦点（打开时焦点仍在输入行）；出口是
 *   「点面板空白」，由 `onBlankPointerDown` 给出（面板盖住画布，画布那条出口在这一态不可达）。
 */
export function SlotPanel({
  onBlankPointerDown,
  dockShift = 0,
  children,
}: {
  /** 点在面板**空白**（没落在内容上）的那一下：由调用方收焦点 → 触发源清 active → 面板退场 */
  onBlankPointerDown: () => void;
  /** 聊天面板当前的贴顶位移（px）：它靠 `transform` 走位，布局值里吃不进去，量高度时要自己加上 */
  dockShift?: number;
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(slotActive);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    setActive(slotActive());
    return subscribeSlot(() => setActive(slotActive()));
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const shell = root.closest<HTMLElement>('.app-shell');
    const panel = root.closest<HTMLElement>('.chat-panel');
    if (!shell || !panel) return;

    // 量**布局**值（`offsetTop` / `offsetHeight` / `clientHeight` 不吃 transform）再补上贴顶位移，
    // 所以过渡进行中量到的也是终点位置。提示条只在断连时占位、私聊行只在有目标时出现——都要重算
    const sync = (): void => {
      setHeight(
        slotHeightOf({
          panelBottom: panel.offsetTop + panel.offsetHeight + dockShift,
          viewportBottom: shell.clientHeight,
        }),
      );
    };
    const observer = new ResizeObserver(sync);
    for (const box of [shell, panel]) observer.observe(box);
    sync();
    return () => observer.disconnect();
  }, [dockShift]);

  return (
    <div
      ref={rootRef}
      className="slot-panel"
      data-open={active ? '' : undefined}
      inert={!active}
      // 高度写成一个 inline px：宽度不设（`inset-inline: 0` 撑满聊天面板），内容自己滚动
      style={{ height: `${height}px` }}
      onPointerDown={(event) => {
        // 只有落在**面板自己**上的那一下算「点空白」：内容里的按钮冒泡上来不该顺手退场
        // （内容要保住焦点的话仍须在 `pointerdown` 里 `preventDefault()`，见 §7）
        if (event.target === event.currentTarget) onBlankPointerDown();
      }}
    >
      {active ? children : null}
    </div>
  );
}