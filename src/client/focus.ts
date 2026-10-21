import { setComposer } from './store';

/**
 * 可编辑控件 = 会拉起软键盘的那三种（`docs/design/60-interaction-shell.md` §2）。
 * 输入会话的入口与退场对账都吃这一份判定，两处不能有各自的写法。
 */
export function isEditable(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * 落在两块面板里的可编辑控件：入场层也有昵称输入框，进厅时绝不能带着一个「打字态」进来。
 * 举报事由框在**插槽面板**里（聊天面板的兄弟节点），只匹配前者会把「聚焦事由框」判成面板外、
 * 下一帧对账当场退场（`docs/design/60-interaction-shell.md` §2）。
 */
function isPanelEditable(target: EventTarget | null): boolean {
  return isEditable(target) && target.closest('.chat-panel, .slot-panel') !== null;
}

/**
 * 收焦点：聊天面板的出口（发送、点插槽面板空白、收起胶囊）共用同一份。画布上的指针事件被 Phaser `preventDefault`，
 * 浏览器默认的「点别处 = 失焦」不会发生；而插槽面板记着「会在世界里产生可见结果的动作不许依赖按钮抢焦点」
 * （`docs/design/50-slot-panel.md` §3、§6），所以这些出口必须显式收。
 */
export function blurFocusedEditable(): void {
  const active = document.activeElement;
  if (isEditable(active)) active.blur();
}

/**
 * 输入会话的**唯一出口**：幂等，且**不看 `document.activeElement` 是谁**——当前控件可能已经被卸载了
 * （表情行原地替换输入行），那时焦点早就不知去向。状态本身由 store 降级，收焦点只是顺手做的收尾。
 */
export function exitComposer(): void {
  setComposer({ kind: 'exit' });
  blurFocusedEditable();
}

/**
 * 把 DOM 焦点接成输入会话的**入口之一**（§2）：shell 级 `focusin` 进 `typing`，
 * `focusout` 之后**下一帧**对账（控件被卸载不发 `blur`、或焦点被 `GO` 之类的控件抢走）。
 * 对账必须晚一帧：`focusout` 那一刻焦点还没落到下一个控件上。
 */
export function trackComposerFocus(shell: HTMLElement): () => void {
  let frame = 0;

  const onFocusIn = (event: FocusEvent): void => {
    if (isPanelEditable(event.target)) setComposer({ kind: 'focus-in' });
  };

  const onFocusOut = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!isPanelEditable(document.activeElement)) setComposer({ kind: 'lost-focus' });
    });
  };

  shell.addEventListener('focusin', onFocusIn);
  shell.addEventListener('focusout', onFocusOut);
  return () => {
    cancelAnimationFrame(frame);
    shell.removeEventListener('focusin', onFocusIn);
    shell.removeEventListener('focusout', onFocusOut);
  };
}
