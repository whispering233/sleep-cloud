import { useCallback, useEffect, useRef, useState } from 'react';

import { exitComposer } from '../focus';
import { LOT_SIGNS, drawLotNo, localDateOf, lotOfDay } from '../lots';
import type { LotSign } from '../lots';
import { readLot, writeLot } from '../prefs';
import { closeLot } from '../store';
import { PrimaryAction } from './PrimaryAction';

/** 页面的三个状态（`docs/design/110-lot.md` §2）：摇签只属于「今天这一次求签」，已求时直接出结果。 */
type LotPhase = 'idle' | 'shaking' | 'revealed';

interface LotView {
  /** 打开这一页那一刻的本地日期：页面开着跨零点也按这一次算（关掉重开才重新取） */
  today: string;
  /** 今天那张签；`null` = 还没求 */
  sign: LotSign | null;
  phase: LotPhase;
}

/** 签筒：动作行那颗图标的同一套画法（24 绘制区、`currentColor` 描边），这里放大到 64px。 */
function LotTube({ shaking, dim }: { shaking: boolean; dim: boolean }) {
  const mood = shaking ? ' lot-tube-shake' : dim ? ' lot-tube-dim' : '';
  return (
    <svg
      className={`lot-tube${mood}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5.9 9.8v6.6c0 2.3 2.7 3.5 6.1 3.5s6.1-1.2 6.1-3.5V9.8" />
      <ellipse cx="12" cy="9.8" rx="6.1" ry="1.7" />
      <path d="M8.9 9.6 8.1 5.2M10.6 9.6V3.4M12.4 9.6V2.2M14.2 9.6V3.8M15.4 9.6l.7-4.2" />
      <path d="M6.3 15.2h11.4" />
    </svg>
  );
}

/**
 * 求签页：动作行那颗签筒图标拉起的**独立整屏页**（`docs/design/110-lot.md`）。
 * 复用入场层那套壳（`.entry-overlay` / `.entry-card` / `.entry-title` / `.primary-action`），
 * 只多了签筒、签与结果卡几个类；**层级靠 DOM 顺序**——挂在聊天面板之后、`<ToneLayer />` 之前，
 * 所以三档减光照旧盖得住它（不造第二套明暗语义）。
 *
 * 三态：`idle`（签筒 + 「求签」）→ 点它**先写盘再摇** → `shaking`（1.2 s，点页面任意处跳过）
 * → `revealed`。写盘必须在点下去那一刻：否则跳过动画、中途关页、动画期间刷新都会重复抽，
 * 而「一天一次」是它唯一的约束。
 */
export function LotOverlay() {
  const [view, setView] = useState<LotView>(() => {
    const today = localDateOf(new Date());
    const sign = lotOfDay(readLot(), today);
    return { today, sign, phase: sign === null ? 'idle' : 'revealed' };
  });
  const closeRef = useRef<HTMLButtonElement>(null);

  // 打开先退打字态：底部组合按布局回到底部（`60-interaction-shell.md` §2），与说明面板同一条路
  useEffect(() => {
    exitComposer();
  }, []);

  // 焦点给唯一的出口（带 `preventScroll`：卡片自己可滚，长签文不该一打开就滚到中间）。
  // 摇签期间出口还没出现，等它出现再给
  useEffect(() => {
    if (view.phase !== 'revealed') return;
    closeRef.current?.focus({ preventScroll: true });
  }, [view.phase]);

  const finish = useCallback((): void => {
    setView((prev) => (prev.phase === 'revealed' ? prev : { ...prev, phase: 'revealed' }));
  }, []);

  /** 点「求签」：抽一支 → **先写盘** → 摇。`today` 是打开这一页时取的，跨零点不重算。 */
  const draw = useCallback((): void => {
    const no = drawLotNo(Math.random);
    writeLot({ date: view.today, no });
    setView({ today: view.today, sign: LOT_SIGNS[no] ?? null, phase: 'shaking' });
  }, [view.today]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeLot();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { sign, phase } = view;

  return (
    // 摇签期间点页面任意处 = 跳过（动画只有 1.2 s，不额外画一颗「跳过」按钮）
    <div className="entry-overlay lot-overlay" onClick={phase === 'shaking' ? finish : undefined}>
      <div className="entry-card lot-sheet">
        <h1 className="entry-title">求签</h1>

        {/* 签筒**常驻**（不再按态挂卸）：1.2 s 末它只淡到 0.25，卡片不会因少一层而向上跳。
            `lot-stage` 的固定高度同时留给升起的那支签——它要升 56px，超出就会被卡片上沿裁掉 */}
        <div className="lot-stage">
          <LotTube shaking={phase === 'shaking'} dim={phase === 'revealed'} />
          {/* 升起的那支签：只在摇签期间出现，纯装饰（内容在下面那张卡里） */}
          {phase === 'shaking' ? <span className="lot-stick lot-stick-rise" aria-hidden="true" /> : null}
        </div>

        {sign === null ? (
          <>
            <p className="lot-hint">一天一次，静下心来</p>
            <PrimaryAction onClick={draw}>求签</PrimaryAction>
          </>
        ) : (
          <>
            <div
              className={`lot-sign${phase === 'shaking' ? ' lot-sign-in' : ''}`}
              // 动画到点即终态：不挂定时器（与 `Toast` 同一条做法）
              onAnimationEnd={(event) => {
                if (event.animationName === 'lot-sign-in') finish();
              }}
            >
              <p className="lot-level">{sign.level}</p>
              <h2 className="lot-title">{sign.title}</h2>
              <p className="lot-poem">
                {sign.poem.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
              <p className="lot-reading">{sign.reading}</p>
              <p className="lot-good">宜 · {sign.good}</p>
            </div>

            {/* 小字与出口只在 `revealed` 出现：摇签中露出来会让“签文还没出、按钮已经在等” */}
            {phase === 'revealed' ? (
              <>
                <p className="lot-hint">今日已求 · 明天再来</p>
                <PrimaryAction ref={closeRef} onClick={closeLot}>
                  收起来
                </PrimaryAction>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
