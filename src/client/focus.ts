/**
 * 收焦点：聊天面板的出口（发送、点插槽面板空白）共用同一份。画布上的指针事件被 Phaser `preventDefault`，
 * 浏览器默认的「点别处 = 失焦」不会发生；而插槽面板记着「会在世界里产生可见结果的动作不许依赖按钮抢焦点」
 * （`docs/design/50-slot-panel.md` §3、§6），所以这两个出口必须显式收。
 */
export function blurFocusedEditable(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
  else if (active instanceof HTMLElement && active.isContentEditable) active.blur();
}