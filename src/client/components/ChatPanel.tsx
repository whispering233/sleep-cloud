import { useEffect, useRef, useState } from 'react';

import type { PersonState } from '../../shared/protocol';
import { EMOTE_LABELS, EMOTE_LIST } from '../emotes';
import { clearSelection, getState, subscribe } from '../store';
import type { ChatLine, ClientState } from '../store';
import { sendChat, sendEmote, sendRise, sendSleep, sendWhisper } from '../ws';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';

/**
 * 底部常驻的面板（见 `docs/ui/DESIGN.md`）：消息列表 + 私聊目标行 + 表情按钮行 + 床上动作行 + 输入行，
 * 窄屏也不收进菜单。消息流来自服务端（含自己发的那条），不做本地乐观回显。
 * 私聊目标就是**唯一选中对象**——点 × 取消选中，目标离开大厅时选中已被清掉。
 */
interface PanelView {
  messages: ChatLine[];
  selectedId?: string;
  targetName?: string;
  meState?: PersonState;
}

/** 面板只吃这几个字段：位置节拍每秒通知十次，用不上的变化不该渲染。 */
function viewOf(state: ClientState): PanelView {
  return {
    messages: state.messages,
    selectedId: state.selectedId,
    targetName: state.selectedId === undefined ? undefined : state.people.get(state.selectedId)?.name,
    meState: state.me?.state,
  };
}

const sameView = (a: PanelView, b: PanelView): boolean =>
  a.messages === b.messages &&
  a.selectedId === b.selectedId &&
  a.targetName === b.targetName &&
  a.meState === b.meState;

const lineClass = (line: ChatLine): string => (line.own ? 'chat-message-own' : 'chat-message-other');

export function ChatPanel() {
  const [view, setView] = useState<PanelView>(() => viewOf(getState()));
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setView(viewOf(getState()));
    return subscribe((state) => {
      const next = viewOf(state);
      setView((prev) => (sameView(prev, next) ? prev : next));
    });
  }, []);

  // 来新消息就贴到底：日志区是滚动的，不跟着走就看不见最新那条
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [view.messages]);

  const { messages, selectedId, targetName, meState } = view;

  return (
    <section className="chat-panel" aria-label="聊天">
      <ol className="chat-log" aria-live="polite" ref={logRef}>
        {messages.map((line, index) => (
          <li key={index} className={lineClass(line)}>
            <span className="chat-message-name">{line.name}</span>
            {'：'}
            {line.kind === 'whisper' ? <span className="chat-message-kind">私聊 · </span> : null}
            {line.text}
          </li>
        ))}
      </ol>

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

      {/* 表情常驻一行：一次点击即发，不进二级菜单 */}
      <div className="emote-bar" role="group" aria-label="表情">
        {EMOTE_LIST.map((id) => (
          <button
            key={id}
            type="button"
            className="emote-button"
            aria-label={EMOTE_LABELS[id]}
            onClick={() => sendEmote(id)}
          >
            {EMOTE_LABELS[id]}
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
          onChange={(event) => setDraft(event.target.value)}
        />
        <PrimaryAction type="submit">发送</PrimaryAction>
      </form>
    </section>
  );
}
