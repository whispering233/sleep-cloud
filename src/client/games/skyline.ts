/**
 * Skyline（`docs/design/140-games-page.md` §4 的游戏契约）：一排别人的窗，灯按慢节奏随机亮灭。
 * 纯本地观赏物：不 import 大厅模块、不发上行、不读本地存储、不联网，`import` 本文件没有副作用。
 * 基准尺寸由 `registry.ts` 声明，这里一律按 `ctx.base` 画——舞台给多大就画多大。
 */
import type { GameModule } from './types';

/** 换一批灯的时间（ms）与每批里亮灭翻转的比例：慢到不像报警灯，也不会整片同时跳。 */
const LIGHTS_MS = 1800;
const FLIP_RATIO = 0.16;

/** 楼体与窗格（基准坐标，320×640 下 320 宽约放 7 栋楼、纵向约 40 排窗）。 */
const SKY_TOP = '#0a1220';
const SKY_BOTTOM = '#1b2942';
const BUILDING_FILL = '#111a2b';
const WINDOW_LIT = '#e8c98a';
const WINDOW_OFF = '#1c2841';
const WINDOW_W = 5;
const WINDOW_H = 6;
const GAP_X = 4;
const GAP_Y = 5;

const skyline: GameModule = {
  mount(el, ctx) {
    const canvas = document.createElement('canvas');
    canvas.width = ctx.base.w * ctx.dpr;
    canvas.height = ctx.base.h * ctx.dpr;
    canvas.style.width = `${ctx.base.w}px`;
    canvas.style.height = `${ctx.base.h}px`;
    canvas.style.display = 'block';
    el.append(canvas);

    const c = canvas.getContext('2d');
    // 拿不到 2d 上下文：舞台留空，canvas 仍按契约由 dispose 收掉
    if (!c) return () => canvas.remove();
    c.scale(ctx.dpr, ctx.dpr);

    const { w, h } = ctx.base;
    // 楼与窗只在挂载时生成一次：灯只在同一批窗里翻，位置永不重排
    const buildings: { x: number; w: number; top: number }[] = [];
    const windows: { x: number; y: number; lit: boolean }[] = [];
    for (let x = 0; x < w; ) {
      const bw = 34 + Math.floor(Math.random() * 18);
      const top = h * (0.2 + Math.random() * 0.4);
      buildings.push({ x, w: bw, top });
      for (let y = top + 8; y + WINDOW_H <= h; y += WINDOW_H + GAP_Y) {
        for (let wx = x + 6; wx + WINDOW_W <= x + bw - 6; wx += WINDOW_W + GAP_X) {
          windows.push({ x: wx, y, lit: Math.random() < 0.4 });
        }
      }
      x += bw + 4;
    }

    const draw = (): void => {
      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, SKY_TOP);
      sky.addColorStop(1, SKY_BOTTOM);
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);

      c.fillStyle = BUILDING_FILL;
      for (const b of buildings) c.fillRect(b.x, b.top, b.w, h - b.top);

      for (const win of windows) {
        c.fillStyle = win.lit ? WINDOW_LIT : WINDOW_OFF;
        c.fillRect(win.x, win.y, WINDOW_W, WINDOW_H);
      }
    };

    // 灯只在整批翻转那一帧才重画：两批之间一帧都不画，但 rAF 仍然自己管（契约要求）
    let raf = 0;
    let last = ctx.now();
    draw();

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const t = ctx.now();
      if (t - last < LIGHTS_MS) return;
      last = t;
      for (const win of windows) if (Math.random() < FLIP_RATIO) win.lit = !win.lit;
      draw();
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      canvas.remove();
    };
  },
};

export default skyline;
