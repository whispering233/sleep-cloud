import { useState } from 'react';

import { PrimaryAction } from './components/PrimaryAction';
import { TextInput } from './components/TextInput';

/**
 * 界面骨架：世界层铺满视口（DOM 界面浮在它之上，只占边缘）。
 * 入场层、HUD 数据与聊天接线在后续卡片补上；这里先立住响应式布局与令牌管线。
 */
export function App() {
  const [draft, setDraft] = useState('');

  return (
    <div className="app-shell">
      {/* 世界层：PixiJS 画布将挂在这里（画布不参与 DOM 界面渲染） */}
      <div className="world-layer" aria-hidden="true" />

      <header className="hud">云上睡眠大厅</header>

      <section className="chat-panel" aria-label="聊天">
        <TextInput
          className="chat-composer-input"
          value={draft}
          placeholder="说点什么…"
          aria-label="聊天输入框"
          enterKeyHint="send"
          onChange={(event) => setDraft(event.target.value)}
        />
        <PrimaryAction className="chat-composer-send" type="button">
          发送
        </PrimaryAction>
      </section>
    </div>
  );
}
