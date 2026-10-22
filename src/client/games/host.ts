import { MAX_DPR } from '../../shared/constants';
import type { GameCtx, GameEntry } from './types';

/**
 * 游戏舞台（`docs/design/110-games-page.md` §4）：按条目的 `base` 建一块舞台，等比缩放
 * （`scale = min(cw/bw, ch/bh)`）、居中、裁掉溢出，然后把它交给游戏。
 * **同一时刻只挂一个**：换条目先 `dispose` 再 `mount`；关闭 = `dispose` + 清空容器。
 *
 * 舞台的定位与裁剪全在 `app.css`（`.games-stage` / `.games-stage-inner`），这里只写三个自定义属性
 * ——`base` 是条目数据，等比缩放的那个数 CSS 推不出来，除这三个属性外一律不碰样式。
 */
export interface GameHost {
  /** 挂一个条目：`load` 是异步的，慢的那次回来时若已经换了条目（或页面已关），它直接作废。 */
  show(entry: GameEntry): void;
  /** 关闭：`dispose` 当前条目并清空容器（幂等）。 */
  close(): void;
}

export function createGameHost(container: HTMLElement): GameHost {
  let dispose: (() => void) | undefined;
  /** 挂载序号：`load` 是异步的，一个慢 chunk 可能落到已经换人的舞台上 */
  let seq = 0;
  /** 台上的条目与它上次算出的 `scale`：观察器只认「`scale` 变了」，不看容器尺寸本身 */
  let current: GameEntry | undefined;
  let lastScale = 0;
  let observer: ResizeObserver | undefined;

  /** 收掉台上那一个。`dispose` 只停游戏自己起的东西，清空容器是这里的事 */
  const teardown = (): void => {
    dispose?.();
    dispose = undefined;
    container.replaceChildren();
  };

  const mount = (entry: GameEntry, scale: number): void => {
    teardown();
    const token = ++seq;

    const el = document.createElement('div');
    el.className = 'games-stage-inner';
    el.style.setProperty('--games-w', `${entry.base.w}px`);
    el.style.setProperty('--games-h', `${entry.base.h}px`);
    el.style.setProperty('--games-scale', `${scale}`);
    container.append(el);

    void entry.load().then(
      (module) => {
        // 换了条目 / 关了页面：这次回来的模块一次都没挂过，没有要清的
        if (token !== seq) return;
        dispose = module.default.mount(el, ctxOf(entry.base, scale));
      },
      // 条目 chunk 没拿到（离线 / 文件名变了）：舞台留空。游戏是观赏物，一条失败的观赏物不打断大厅
      () => undefined,
    );
  };

  /** 转屏 / 窗口尺寸变（§4）：`scale` 变了就用同一个条目重挂，页面不退回列表 */
  const remount = (): void => {
    if (!current) return;
    const scale = fitScale(container, current.base);
    // 1% 阈值挡亚像素抖动。容器是 `position: absolute; inset: 0`（`app.css`），舞台内容与 `transform`
    // 都不改它的尺寸 → 这次重挂不会再喂出一次回调
    if (Math.abs(scale - lastScale) <= lastScale * 0.01) return;
    lastScale = scale;
    mount(current, scale);
  };

  return {
    show: (entry) => {
      current = entry;
      const scale = fitScale(container, entry.base);
      lastScale = scale;
      mount(entry, scale);
      observer?.disconnect();
      observer = new ResizeObserver(remount);
      observer.observe(container);
    },
    close: () => {
      seq += 1;
      current = undefined;
      observer?.disconnect();
      observer = undefined;
      teardown();
    },
  };
}

/** 等比缩放到容器内；容器还没布局（宽或高为 0）时按 1 算，免得缩放成 0 或 `NaN`。 */
function fitScale(container: HTMLElement, base: GameCtx['base']): number {
  const scale = Math.min(container.clientWidth / base.w, container.clientHeight / base.h);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 交给游戏的上下文：`dpr` = 每基准像素对应的设备像素（含舞台 `scale`，§4），`now` 是单调时钟。 */
// shortcut: 跨显示器拖窗口改了 DPR 不重挂（容器尺寸不变，观察器不触发），刷新即可
function ctxOf(base: GameCtx['base'], scale: number): GameCtx {
  const dpr = Math.min(Math.min(window.devicePixelRatio || 1, MAX_DPR) * scale, MAX_DPR * 2);
  return { base, dpr: Number.isFinite(dpr) && dpr > 0 ? dpr : 1, now: () => performance.now() };
}
