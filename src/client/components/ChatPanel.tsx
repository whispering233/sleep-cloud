import { useEffect, useRef, useState } from 'react';

import { getState, subscribe } from '../store';
import type { ChatLine } from '../store';
import { sendChat } from '../ws';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';

/**
 * 底部常驻的全局聊天（见 `docs/ui/DESIGN.md`）：消息列表 + 一行输入，窄屏也不收进菜单。
 * 消息流来自服务端广播（含自己发的那条），不做本地乐观回显。
 */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatLine[]>(getState().messages);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setMessages(getState().messages);
    // 位置节拍每秒也会通知十次：数组引用没变就直接跳过，别让插值频率传染给界面
    return subscribe((state) => setMessages((prev) => (prev === state.messages ? prev : state.messages)));
  }, []);

  // 来新消息就贴到底：日志区是滚动的，不跟着走就看不见最新那条
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  return (
    <section className="chat-panel" aria-label="聊天">
      <ol className="chat-log" aria-live="polite" ref={logRef}>
        {messages.map((line, index) => (
          <li key={index} className={line.own ? 'chat-message-own' : 'chat-message-other'}>
            <span className="chat-message-name">{line.name}</span>
            {`：${line.text}`}
          </li>
        ))}
      </ol>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return; // 空消息由服务端兜底 4003，这里只是不发
          sendChat(draft);
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
