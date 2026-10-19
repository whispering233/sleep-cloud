import type { ReactNode } from 'react';

/**
 * 插槽面板的壳（`docs/design/50-slot-panel.md` §3、§5、§6）：**网格第 3 行**，打字态的 `1fr` 让它铺满到屏底。
 *
 * - **位置与高度都由 CSS 网格给**（`docs/design/60-interaction-shell.md` §3）：它和聊天面板都是 `.app-shell`
 *   的网格项，同一栏 → 边框天然对齐；高度是 1fr，没有量高、没有位移、没有 `ResizeObserver`。
 *   它进流之后可用视口自动扣掉它，取景 / 夹取不需要额外信息。
 * - **开关**只看 `active`（= 输入会话是 `typing`，见 `docs/design/60-interaction-shell.md` §2），不看键盘
 *   ——键盘弹没弹在部分内核里测不出来。`hidden` 用不了（`display: none` 过渡不了）：换成 `data-open`
 *   （`opacity` 与 `visibility` 挂同一条过渡，`allow-discrete` 让隐藏发生在末帧——退场期间**仍然吃点击**，
 *   否则那 160ms 里点击会穿到画布）+ `inert`（不可 Tab、不被读屏读到）。
 * - 它不是浮层：没有背景变暗、不做焦点陷阱、不抢焦点（打开时焦点仍在输入行）。出口有两个：
 *   「点面板空白」（由 `onBlankPointerDown` 给出）与动作行右端的「收起」胶囊——面板盖住画布，
 *   所以画布那条出口在这一态不可达。
 */
export function SlotPanel({
  active,
  onBlankPointerDown,
  children,
}: {
  /** 由调用方传（`composer === 'typing'`）：面板显隐只有这一个来源 */
  active: boolean;
  /** 点在面板**空白**（没落在内容上）的那一下：由调用方退场 */
  onBlankPointerDown: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className="slot-panel"
      data-open={active ? '' : undefined}
      inert={!active}
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
