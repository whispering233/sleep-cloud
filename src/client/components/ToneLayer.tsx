import { useEffect, useRef, useState } from 'react';

import { getState, subscribe } from '../store';
import { TONE_ALPHA, toneOf } from '../tone';
import type { Tone } from '../tone';

/**
 * 三档减光层：整屏一层中性黑，`opacity` 跟着**我自己的显示态**走（`docs/ui/DESIGN.md` 的
 * `tone-layer` 行）。它必须同时盖住画布与 DOM——界面也是亮面，只压画布会让面板成为全屏最亮的地方。
 *
 * **落档不缓动**：入场后的第一份快照、以及每次重连后的第一份，都一步到位。过渡开着的话，
 * 会先按「快照还没到」的 `0` 档画一帧再补一段渐暗——那是一段没人要的假动画。
 */
export function ToneLayer() {
  const [tone, setTone] = useState<Tone>(() => toneOf(getState()));
  /** 过渡开关：落档那一帧必须是 `transition: none`（同一帧里既改 `opacity` 又开过渡，浏览器会直接补出动画） */
  const [animate, setAnimate] = useState(false);
  /** 上一次通知时「连着、且快照已到」吗：只有**变成**这样时才需要排一次「开过渡」 */
  const ready = useRef(false);
  /** 已排上的开过渡帧（`0` = 没排）：走完两次 `requestAnimationFrame` 才能保证落档那一帧先画出去 */
  const frame = useRef(0);

  useEffect(() => {
    const sync = (): void => {
      const state = getState();
      const next = toneOf(state);
      // 位置节拍每 100 ms 也会通知一次：档位没变就不换 state，整层不逐拍重渲染
      setTone((prev) => (prev === next ? prev : next));

      const isReady = state.connection === 'online' && state.me !== undefined;
      if (isReady === ready.current) return;
      ready.current = isReady;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (!isReady) {
        // 断线 / 还没有快照：关掉过渡，于是重连后的第一份快照同样一步到位
        setAnimate(false);
        return;
      }
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          setAnimate(true);
        });
      });
    };

    sync();
    const unsubscribe = subscribe(sync);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      // 开发期的 StrictMode 会「装好 → 卸掉 → 再装」：不重置就再也不会开过渡
      ready.current = false;
    };
  }, []);

  return (
    <div
      className="tone-layer"
      aria-hidden="true"
      style={{ opacity: TONE_ALPHA[tone], transition: animate ? undefined : 'none' }}
    />
  );
}
