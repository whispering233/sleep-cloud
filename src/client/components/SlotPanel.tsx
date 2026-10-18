import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { slotActive, slotHeightOf, subscribeSlot } from '../slot';

/**
 * 插槽面板的壳（`docs/design/50-slot-panel.md` §2、§5）：顶部 HUD 与聊天面板之间那块区域。
 *
 * - **位置**由 CSS 给定（`.chat-panel` 的绝对定位子元素、`inset-block-end: 100%`），
 *   高度 = shell − HUD − 聊天面板，由这里量出来写成一个 inline px（三个盒子各挂 ResizeObserver）。
 *   绝对定位的子元素不撑开 `.chat-panel`，所以可用视口 / 取景 / 夹取一概不受影响。
 * - **开关**只看触发源（`../slot.ts`），不看键盘——键盘弹没弹在部分内核里测不出来。
 * - 它不是浮层：没有背景变暗、不做焦点陷阱、不抢焦点（打开时焦点仍在输入行）；出口是
 *   「点面板空白」，由 `onBlankPointerDown` 给出（面板盖住画布，画布那条出口在这一态不可达）。
 */
export function SlotPanel({
  onBlankPointerDown,
  children,
}: {
  /** 点在面板**空白**（没落在内容上）的那一下：由调用方收焦点 → 触发源清 active → 面板退场 */
  onBlankPointerDown: () => void;
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
    const hud = shell.querySelector<HTMLElement>('.hud');

    // 三个盒子各挂一个观察者：提示条只在断连时占位、私聊行只在有目标时出现、键盘弹起时 shell 变矮——
    // 每一处都要重算（世界层夹取也在读同一批实占高度）
    const sync = (): void => {
      setHeight(
        slotHeightOf({
          shellTop: shell.getBoundingClientRect().top,
          hudBottom: hud?.getBoundingClientRect().bottom,
          panelTop: panel.getBoundingClientRect().top,
        }),
      );
    };
    const observer = new ResizeObserver(sync);
    for (const box of [shell, hud, panel]) if (box) observer.observe(box);
    sync();
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="slot-panel"
      hidden={!active}
      // 高度写成一个 inline px：宽度不设（`inset-inline: 0` 撑满聊天面板），内容自己滚动
      style={{ height: `${height}px` }}
      onPointerDown={(event) => {
        // 只有落在**面板自己**上的那一下算「点空白」：内容里的按钮冒泡上来不该顺手退场
        // （内容要保住焦点的话仍须在 `pointerdown` 里 `preventDefault()`，见 §6）
        if (event.target === event.currentTarget) onBlankPointerDown();
      }}
    >
      {active ? children : null}
    </div>
  );
}