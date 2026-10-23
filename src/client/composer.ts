/**
 * 输入会话状态机（`docs/design/60-interaction-shell.md` §2）。
 *
 * DOM 焦点只是入口之一，不是状态本体：焦点会被卸载、被抢走、被系统手势吞掉。
 * 所以状态住 store，进出都走这里的两条纯函数。**纯状态、不碰 DOM**。
 *
 * `reading`（类型文本）与 `feedback`（反馈与建议）是**不从聊天输入框焦点进来**的两种会话：
 * 前者点礼物托盘里的「随机阅读」就到、里面没有可编辑控件；后者从齿轮菜单进、里面有 `autoFocus` 的反馈框
 * （`docs/design/50-slot-panel.md` §附）。
 */
export type ComposerState = 'idle' | 'typing' | 'report' | 'reading' | 'feedback';

export type ComposerEvent =
  | { kind: 'focus-in' }
  | { kind: 'report' }
  | { kind: 'read' }
  | { kind: 'feedback' }
  | { kind: 'exit' }
  | { kind: 'lost-focus' }
  | { kind: 'offline' };

/** 带 `autoFocus` 表单的会话：焦点进来时必须**留在原态**，否则表单会被自己卸掉。 */
const FORM_STATES = new Set<ComposerState>(['report', 'feedback']);

export function composerReducer(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.kind) {
    case 'focus-in':
      // `report` / `feedback` 下不降级：事件不带焦点目标，分不清「表单复焦」与「点聊天输入框」，
      // 降级会当场卸载表单、丢掉已写的内容（§2）
      return FORM_STATES.has(state) ? state : 'typing';
    case 'report':
      return 'report';
    case 'feedback':
      return 'feedback';
    case 'read':
      return 'reading';
    case 'exit':
    case 'offline':
      return 'idle';
    // `reading` 里没有可编辑控件（`50-slot-panel.md` §附），焦点对账没有可对的东西：这条对账本来只服务
    // 「输入框被卸载 / 被抢焦点」，而 `reading` 的油门在点击那一刻就落了地。还留着它，就会在托盘那颗
    // 触发源随面板卸载时误判成退场（实测：面板只活 1 帧）
    case 'lost-focus':
      return state === 'reading' ? 'reading' : 'idle';
    default:
      return state;
  }
}
