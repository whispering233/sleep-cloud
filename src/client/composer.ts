/**
 * 输入会话状态机（`docs/design/60-interaction-shell.md` §2）。
 *
 * DOM 焦点只是入口之一，不是状态本体：焦点会被卸载、被抢走、被系统手势吞掉。
 * 所以状态住 store，进出都走这里的两条纯函数。**纯状态、不碰 DOM**。
 */
export type ComposerState = 'idle' | 'typing';

export type ComposerEvent =
  | { kind: 'focus-in' }
  | { kind: 'exit' }
  | { kind: 'lost-focus' }
  | { kind: 'offline' };

export function composerReducer(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.kind) {
    case 'focus-in':
      return 'typing';
    case 'exit':
    case 'lost-focus':
    case 'offline':
      return 'idle';
    default:
      return state;
  }
}
