import type { ReactNode } from 'react';

/**
 * 插槽面板的壳（`docs/design/50-slot-panel.md` §3、§5、§6）：**网格第 3 行**，打字态的 `1fr` 让它铺满到屏底。
 *
 * - **位置与高度都由 CSS 网格给**（`docs/design/60-interaction-shell.md` §3）：它和聊天面板都是 `.app-shell`
 *   的网格项，同一栏 → 边框天然对齐；高度是 1fr，没有量高、没有位移、没有 `ResizeObserver`。
 *   它进流之后可用视口自动扣掉它，取景 / 夹取不需要额外信息。
 * - **开关**只看 `active`（= 输入会话是 `typing`，见 `docs/design/60-interaction-shell.md` §2），不看键盘
 *   ——键盘弹没弹在部分内核里测不出来。`hidden` 用不了（`display: none` 过渡不了）：换成 `data-open`
 *   （`opacity` 与 `visibility` 挂同一条过渡，`allow-discrete`：关闭态靠 `visibility: hidden` 退出命中与
 *   Tab 序）。`inert` 只管「不可 Tab、不被读屏读到」——**它不负责可点性**（会让命中跳过整棵子树）。
 * - **点空白：按下不退场，抬手的 `click` 才退场**（`docs/design/60-interaction-shell.md` §4）。一次点按
 *   手势期间不许把被点的盒子拿掉：按下就退场会让布局当场瞬切，而浏览器在手势收尾补发的兼容鼠标事件是
 *   **按抬手那一刻**重新做命中的——那一下于是成了从画布起手的 tap（发一条 `walk`）。按下只
 *   `preventDefault()`：保住输入框焦点，并让浏览器不再派发兼容鼠标事件。
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
  /** 点面板**空白**（没落在内容上）的那一次点按：抬手（`click`）时交给调用方退场 */
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
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onClick={(event) => {
        // 退场挂在抬手：整次手势期间盒子不换手，兼容鼠标事件就不会补发到画布上（见顶注释）
        if (event.target === event.currentTarget) onBlankPointerDown();
      }}
    >
      {active ? children : null}
    </div>
  );
}
