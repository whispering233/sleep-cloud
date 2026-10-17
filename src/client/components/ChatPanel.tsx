import { useEffect, useState } from 'react';

import type { PersonState } from '../../shared/protocol';
import { CHAT_MAX_LEN } from '../../shared/constants';
import { bubbleHintOf } from '../bubble-fit';
import { EMOTE_SHORTCUTS } from '../emotes';
import { clearSelection, getState, subscribe } from '../store';
import type { ClientState } from '../store';
import { sendChat, sendRise, sendSleep, sendWhisper } from '../ws';
import { ConnectionBanner } from './ConnectionBanner';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';

/**
 * 底部常驻的面板（见 `docs/ui/DESIGN.md`）：私聊目标行 + 表情按钮行 + 床上动作行 + 输入行，
 * 窄屏也不收进菜单。**没有消息列表**——聊天只在世界里（头顶那一格气泡，见 `world.ts`），
 * 所以面板高度只跟这几行控件有关。私聊目标就是**唯一选中对象**——点 × 取消选中，
 * 目标离开大厅时选中已被清掉。
 */
interface PanelView {
  selectedId?: string;
  targetName?: string;
  meState?: PersonState;
}

/** 面板只吃这几个字段：位置节拍每秒通知十次，用不上的变化不该渲染。 */
function viewOf(state: ClientState): PanelView {
  return {
    selectedId: state.selectedId,
    targetName: state.selectedId === undefined ? undefined : state.people.get(state.selectedId)?.name,
    meState: state.me?.state,
  };
}

const sameView = (a: PanelView, b: PanelView): boolean =>
  a.selectedId === b.selectedId && a.targetName === b.targetName && a.meState === b.meState;

export function ChatPanel() {
  const [view, setView] = useState<PanelView>(() => viewOf(getState()));
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setView(viewOf(getState()));
    return subscribe((state) => {
      const next = viewOf(state);
      setView((prev) => (sameView(prev, next) ? prev : next));
    });
  }, []);

  const { selectedId, targetName, meState } = view;
  const hint = bubbleHintOf(draft);

  return (
    <section className="chat-panel" aria-label="聊天">
      {/* 连接提示条：占位（不浮层），所以可用视口自动扣掉它；显示与否由自己订阅的连接态决定 */}
      <ConnectionBanner />

      {/* 私聊目标行：查不到名字就不渲染（目标离开时选中已被清掉，这里只是兜底） */}
      {selectedId !== undefined && targetName !== undefined && (
        <div className="whisper-target">
          {`私聊 ${targetName}`}
          <button
            type="button"
            className="whisper-target-clear"
            aria-label="取消私聊"
            onClick={() => clearSelection()}
          >
            ×
          </button>
        </div>
      )}

      {/* 表情常驻一行：一点即发一条只含该 emoji 的聊天消息（选中对象时走私聊） */}
      <div className="emote-bar" role="group" aria-label="表情">
        {EMOTE_SHORTCUTS.map(({ glyph, label }) => (
          <button
            key={glyph}
            type="button"
            className="emote-button"
            aria-label={label}
            onClick={() => (selectedId !== undefined ? sendWhisper(selectedId, glyph) : sendChat(glyph))}
          >
            {glyph}
          </button>
        ))}
      </div>

      {/* 床上动作只在床上出现：不躺着的时候这些按钮没有对象，就不占位 */}
      {meState !== undefined && meState !== 'roaming' && (
        <div className="bed-actions">
          <button type="button" className="action-primary" onClick={() => sendRise()}>
            起身
          </button>
          <button
            type="button"
            className="action-primary"
            disabled={meState === 'asleep'}
            onClick={() => sendSleep()}
          >
            睡了
          </button>
        </div>
      )}

      {/* 输入行上方的弱提示：草稿放不进气泡两行时提前说一声（估算，宁可保守；不拦发送） */}
      {hint !== undefined && <p className="chat-hint">{hint}</p>}

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return; // 空消息由服务端兜底 4003，这里只是不发
          if (selectedId !== undefined) sendWhisper(selectedId, draft);
          else sendChat(draft);
          setDraft('');
        }}
      >
        <TextInput
          value={draft}
          placeholder="说点什么…"
          aria-label="聊天输入框"
          enterKeyHint="send"
          // 只是免得到服务端才吃 4001，**不是**气泡的显示容量（见 `docs/design/config.md` 的 `CHAT_MAX_LEN`）
          maxLength={CHAT_MAX_LEN}
          onChange={(event) => setDraft(event.target.value)}
        />
        <PrimaryAction type="submit">发送</PrimaryAction>
      </form>
    </section>
  );
}
