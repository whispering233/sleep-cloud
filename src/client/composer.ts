/**
 * 输入会话状态机（`docs/design/60-interaction-shell.md` §2）。
 *
 * DOM 焦点只是入口之一，不是状态本体：焦点会被卸载、被抢走、被系统手势吞掉。
 * 所以状态住 store，进出都走这里的两条纯函数。**纯状态、不碰 DOM**。
 *
 * `reading`（类型文本）是**唯一不从焦点进来**的会话：点动作行的「!」就到，里面没有可编辑控件
 * （`docs/design/50-slot-panel.md` §附）。
 */
export type ComposerState = 'idle' | 'typing' | 'report' | 'reading';

export type ComposerEvent =
  | { kind: 'focus-in' }
  | { kind: 'report' }
  | { kind: 'read' }
  | { kind: 'exit' }
  | { kind: 'lost-focus' }
  | { kind: 'offline' };

export function composerReducer(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.kind) {
    case 'focus-in':
      // `report` 下不降级：事件不带焦点目标，分不清「事由框复焦」与「点聊天输入框」，
      // 降级会当场卸载表单、丢掉已写的事由（§2）
      return state === 'report' ? 'report' : 'typing';
    case 'report':
      return 'report';
    case 'read':
      return 'reading';
    case 'exit':
    case 'lost-focus':
    case 'offline':
      return 'idle';
    default:
      return state;
  }
}
