/**
 * 收焦点：世界层（点画布）、聊天面板（发送、点插槽面板空白）共用同一份，
 * 不写两份。画布上的指针事件被 Phaser `preventDefault`，浏览器默认的「点别处 = 失焦」不会发生
 * （见 `docs/ui/DESIGN.md` 的「软键盘 · 轻点画布」），所以这些出口必须显式收。
 */
export function blurFocusedEditable(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
  else if (active instanceof HTMLElement && active.isContentEditable) active.blur();
}