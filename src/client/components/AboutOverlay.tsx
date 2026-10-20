import { useCallback, useEffect, useState } from 'react';

import { ANNOUNCE, ANNOUNCE_VERSION } from '../about';
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
 * 说明面板：一页纯文档（标题 + 正文 + 各节条目）与**唯一的出口**「知道了」（`Esc` 同一条路）。
 * 壳、卡片、标题、主按钮全部复用入场层那套类——它就是同一种「临时整屏页」，不再造第二套排版。
 * 层级靠 DOM 顺序（`App.tsx` 里挂在聊天面板之后、`<ToneLayer />` 之前），所以三档减光照旧盖得住它。
 */
export function AboutOverlay({ source }: AboutOverlayProps) {
  /** 「以后不再自动显示」的勾选：**默认勾着**（读一次就够），取消勾选 = 下次还想看 */
  const [remember, setRemember] = useState(true);

  // 打开先退打字态：底部组合按布局回到底部，不会留下一个「键盘位置的面板」（60-interaction-shell.md §2）
  useEffect(() => {
    exitComposer();
  }, []);

  /** 关闭只有一个出口：按钮与 `Esc` 都走这里。自动那一次勾着才记已读（§2） */
  const close = useCallback((): void => {
    if (source === 'auto' && remember) writeAboutSeen(ANNOUNCE_VERSION);
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

        <p className="about-intro">{ANNOUNCE.intro}</p>

        {ANNOUNCE.sections.map((section) => (
          <section className="about-section" key={section.title}>
            <h2 className="about-heading">{section.title}</h2>

            <ul className="about-items">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}

        {/* 勾选框只在自动那一次出现：手动点开的人不该被问「以后还要不要看」 */}
        {source === 'auto' ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            以后不再自动显示
          </label>
        ) : null}

        <PrimaryAction autoFocus onClick={close}>
          知道了
        </PrimaryAction>
      </div>
    </div>
  );
}
