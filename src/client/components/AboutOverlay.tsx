import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ABOUT_BLOCKS, ABOUT_TOKEN } from '../about';
import type { AboutBlock, AboutInline } from '../about';
import { exitComposer } from '../focus';
import { writeAboutSeen } from '../prefs';
import { closeAbout } from '../store';
import type { AboutSource } from '../store';
import { PrimaryAction } from './PrimaryAction';

export interface AboutOverlayProps {
  /** 为什么打开：只有自动那一次带勾选框、也只有它会写已读（`docs/design/90-about-panel.md` §1、§2） */
  source: AboutSource;
}

/**
 * 行内片段 → 文本节点或链接。**不碰 HTML**（没有 `dangerouslySetInnerHTML`），所以没有注入面；
 * 链接只可能是 `https://`——校验在解析那一侧（`about.ts`），这里拿到的都是已校验的。
 */
function Inline({ parts }: { parts: AboutInline[] }): ReactNode {
  return parts.map((part, index) =>
    part.kind === 'link' ? (
      <a className="about-link" key={index} href={part.href} target="_blank" rel="noopener noreferrer">
        {part.text}
      </a>
    ) : (
      part.text
    ),
  );
}

/** 块 → 元素：小节标题 `h2`、正文 `p`、连续条目一个 `ul` 里的多个 `li`（§5） */
function Block({ block }: { block: AboutBlock }): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <h2 className="about-heading">
          <Inline parts={block.parts} />
        </h2>
      );
    case 'paragraph':
      return (
        <p className="about-intro">
          <Inline parts={block.parts} />
        </p>
      );
    case 'list':
      return (
        <ul className="about-items">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline parts={item} />
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * 说明面板：一页纯文档（`about.json` 解析出来的块）与**唯一的出口**「知道了」（`Esc` 同一条路）。
 * 壳、卡片、标题、主按钮全部复用入场层那套类——它就是同一种「临时整屏页」，不再造第二套排版。
 * 层级靠 DOM 顺序（`App.tsx` 里挂在聊天面板之后、`<ToneLayer />` 之前），所以三档减光照旧盖得住它。
 */
export function AboutOverlay({ source }: AboutOverlayProps) {
  /** 「以后不再自动显示」的勾选：**默认勾着**（读一次就够），取消勾选 = 下次还想看 */
  const [remember, setRemember] = useState(true);
  const knowItRef = useRef<HTMLButtonElement>(null);

  // 打开先退打字态：底部组合按布局回到底部，不会留下一个「键盘位置的面板」（60-interaction-shell.md §2）
  useEffect(() => {
    exitComposer();
  }, []);

  // 焦点给「知道了」，但**不许它把面板滚到底**：`.entry-overlay` 自己可滚，内容超屏时
  // 默认的聚焦会一次性跳到最下面，读者从中间开始看（`docs/design/90-about-panel.md` §5）
  useEffect(() => {
    knowItRef.current?.focus({ preventScroll: true });
  }, []);

  /** 关闭只有一个出口：按钮与 `Esc` 都走这里。自动那一次勾着才记已读（§2） */
  const close = useCallback((): void => {
    if (source === 'auto' && remember) writeAboutSeen(ABOUT_TOKEN);
    closeAbout();
  }, [source, remember]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <div className="entry-overlay">
      <div className="entry-card">
        <h1 className="entry-title">失眠云</h1>

        {ABOUT_BLOCKS.map((block, index) => (
          <Block block={block} key={index} />
        ))}

        {/* 勾选框只在自动那一次出现：手动点开的人不该被问「以后还要不要看」 */}
        {source === 'auto' ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            以后不再自动显示
          </label>
        ) : null}

        <PrimaryAction ref={knowItRef} onClick={close}>
          知道了
        </PrimaryAction>
      </div>
    </div>
  );
}
