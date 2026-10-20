import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { HAS_POPOVER } from '../popover';
import { getState, subscribe } from '../store';
import { TONE_ALPHA, toneOf } from '../tone';
import type { Tone } from '../tone';

/**
 * 三档减光层：整屏一层中性黑，`opacity` 跟着**我自己的显示态**走（`docs/ui/DESIGN.md` 的
 * `tone-layer` 行）。它必须同时盖住画布与 DOM——界面也是亮面，只压画布会让面板成为全屏最亮的地方。
 *
 * **这一层自己是个 `popover`（`manual`）**：齿轮浮层也是 `popover`，顶层元素之间**不吃 `z-index`**、
 * 只看谁后入场——不自己也在顶层，浮层就会成为全屏最亮的那一块（破 `docs/ui/DESIGN.md` 的
 * 「明暗只有一层」）。代价是**顶层里的顺序得自己维持**：有别的东西入场就把它重新推上去（下面那个 effect）。
 *
 * **没有 Popover API 的内核**（Chromium 100，见 `../popover.ts`）：它不是顶层元素，按 DOM 顺序压住界面
 * 已经成立（它是 `.app-shell` 的最后一个子节点），所以那两处 `popover` 调用整段跳过。
 *
 * **落档不缓动**：入场后的第一份快照、以及每次重连后的第一份，都一步到位。过渡开着的话，
 * 会先按「快照还没到」的 `0` 档画一帧再补一段渐暗——那是一段没人要的假动画。
 */
export function ToneLayer() {
  const [tone, setTone] = useState<Tone>(() => toneOf(getState()));
  /** 减光层那一块：它的开 / 重排都靠 `popover` API */
  const layer = useRef<HTMLDivElement>(null);
  /** 过渡开关：落档那一帧必须是 `transition: none`（同一帧里既改 `opacity` 又开过渡，浏览器会直接补出动画） */
  const [animate, setAnimate] = useState(false);
  /** 上一次通知时「连着、且快照已到」吗：只有**变成**这样时才需要排一次「开过渡」 */
  const ready = useRef(false);
  /** 已排上的开过渡帧（`0` = 没排）：走完两次 `requestAnimationFrame` 才能保证落档那一帧先画出去 */
  const frame = useRef(0);

  // 常驻打开：`popover` 默认是 `display: none`，必须赶在**第一次绘制之前**打开，否则重连那一帧会露出
  // 没有减光的世界（`useLayoutEffect` 而不是 `useEffect`，后者在绘制之后）。重复调用是合法的空操作。
  useLayoutEffect(() => {
    if (!HAS_POPOVER) return;
    layer.current?.showPopover();
  }, []);

  /**
   * 顶层绘制顺序 = **入场顺序**，所以减光层只靠 `popover` 进顶层还不够：齿轮浮层后入场就会压在它上面。
   * 每次别的 `popover` 打开，就把自己重新推上去（`hidePopover()` + `showPopover()` 是唯一的重排手段）。
   * 写在这一层而不是每个触发器里：这样「减光永远在最上面」是一条不变量，新加浮层不必再登记一次。
   *
   * shortcut: `toggle` 是任务级事件，这一刀可能晚一帧（一帧的 12% / 22% 减光差看不出）；
   * 真要一帧不差，得改成各触发器在 showPopover 之后再同步调一次。
   */
  useEffect(() => {
    if (!HAS_POPOVER) return undefined;
    const el = layer.current;
    if (!el) return undefined;
    const raise = (event: Event): void => {
      if (event.target === el) return;
      if ((event as ToggleEvent).newState !== 'open') return;
      if (!el.matches(':popover-open')) return;
      el.hidePopover();
      el.showPopover();
    };
    // `toggle` 不冒泡：只能在捕获阶段收
    document.addEventListener('toggle', raise, true);
    return () => document.removeEventListener('toggle', raise, true);
  }, []);

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
      ref={layer}
      popover={HAS_POPOVER ? 'manual' : undefined}
      aria-hidden="true"
      style={{ opacity: TONE_ALPHA[tone], transition: animate ? undefined : 'none' }}
    />
  );
}
