import * as Phaser from 'phaser';

import { getState } from '../store';
import { COLORS } from './views';

/**
 * 雨层（`docs/ui/DESIGN.md` 的 `rain-layer`、`docs/design/config.md` §4）：**屏幕空间**的并行 Scene。
 *
 * 它不是世界的一部分：自带相机、`zoom = 画布 DPR`、原点挪到左上角，所以这里的坐标单位就是 CSS px——
 * 相机缩放（`全厅` / `1×`）、可用视口、面板换位都不改变雨的样子。它**也不是第二层明暗**：
 * 覆盖率约 1.2%，三档减光照旧只由 `tone-layer` 那一层负责。
 *
 * 开关只走 `update` 的 400 ms 线性推进：**不挂 tween、不挂定时器**（存活的定时器会让对象无法休眠）。
 */

/** 雨滴纹理：2 × 14 CSS px 的竖线，宽度经 DPR 放大后是恒定屏幕粗细。 */
const DROP_W = 2;
const DROP_H = 14;
/** 发射率：每 12 ms 两颗 ≈ 167 颗/秒；寿命按屏幕高算，存活数约 160（基准机）。 */
const DROP_QUANTITY = 2;
const DROP_FREQUENCY_MS = 12;
/** 速度（CSS px/s）：向下为主、略向左偏。 */
const SPEED_Y = { min: 950, max: 1250 };
const SPEED_X = { min: -90, max: -30 };
/** 不透明度区间：只是细雨，不至于把地板压暗。 */
const DROP_ALPHA = { min: 0.24, max: 0.4 };
/** 出生点在屏幕上方 20px；寿命多留 70px 余量，所以粒子落到下边界之下才死，不是半屏就死。 */
const EMIT_Y = -20;
const LIFESPAN_SPAN_PX = 70;
/** 最慢的一档下落速度：寿命按它算，更快的粒子也一定还没落地。**必须跟着 `SPEED_Y.min` 走**——
 *  写死一个数的话，谁调慢速度带下限，雨就会在半屏处开始消失，而且没有任何断言会红。 */
const FALL_PX_PER_S = SPEED_Y.min;
/** 开 / 关的线性过渡时长（`docs/design/config.md` §4）。 */
const FADE_MS = 400;

const DROP_TEXTURE_KEY = 'rain-drop';

export class WeatherScene extends Phaser.Scene {
  private emitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 画布 DPR（相机 zoom 就是它）：0 = 还没同步过，首次 `syncSize` 一定写进相机。 */
  private dpr = 0;
  /** 屏幕宽高（CSS px）：发射器的 x 与寿命都按它现算，随宿主尺寸变化。 */
  private width = 0;
  private height = 0;
  /** 粒子寿命（ms）：屏幕高变化时重设（落到下边界之下才死）。 */
  private lifespanMs = 0;
  /** 雨层整体不透明度（0…1）：`rain` 翻转后 400 ms 线性推进。 */
  private alpha = 0;
  /** 发射器是否在发射：与 store 的 `rain` 同步（`off` 只停发射、不 kill，存活粒子自然落完）。 */
  private emitting = false;

  constructor() {
    super({ key: 'weather', active: true });
  }

  create(): void {
    // 屏幕空间的两条前提：原点在左上角（默认原点在视口中心，zoom 会绕中心缩放、雨就画到屏幕外）、
    // zoom = DPR。相机视口跟着画布走由 `CameraManager` 的 `scale` RESIZE 监听完成——
    // `Scale.NONE` + 手动 `scale.resize`（`world.ts` 的 `applySize`）也会发那个事件，这里不用自己量。
    // 注意：origin(0,0) 之后 `camera.worldView` 仍然是按「视口中心」算的（Phaser 的已知偏差），
    // 以后要给雨加视锥裁剪或命中判定，得自己把那段偏移算进去。
    this.cameras.main.setOrigin(0, 0);
    this.syncSize();

    this.emitter = this.add.particles(0, 0, dropTexture(this), {
      // 每颗的 x 在发射那一刻按当前屏幕宽度取随机（屏幕空间，宽度随宿主变）
      x: { onEmit: () => Math.random() * this.width },
      y: EMIT_Y,
      quantity: DROP_QUANTITY,
      frequency: DROP_FREQUENCY_MS,
      speedX: SPEED_X,
      speedY: SPEED_Y,
      alpha: DROP_ALPHA,
      lifespan: this.lifespanMs,
      emitting: false,
    });
    // 初值直接是最终态：进厅 / 刷新时不该先看一次 400 ms 的淡入，之后的切换才走 update 的过渡
    this.emitting = getState().rain;
    this.alpha = this.emitting ? 1 : 0;
    this.emitter.setAlpha(this.alpha);
    if (this.emitting) this.emitter.start();
  }

  update(_time: number, delta: number): void {
    this.syncSize();

    const rain = getState().rain;
    if (rain !== this.emitting) {
      this.emitting = rain;
      if (rain) this.emitter.start();
      else this.emitter.stop();
    }

    // 淡入淡出按实际经过时间推进（与帧率无关），不挂 tween、不挂定时器
    const step = delta / FADE_MS;
    this.alpha = rain ? Math.min(this.alpha + step, 1) : Math.max(this.alpha - step, 0);
    this.emitter.setAlpha(this.alpha);
    // 收口：淡出走完后一定不再有新粒子（`stop()` 在翻转那一帧就叫过了，这里只是让不变量不靠推理）
    if (!rain && this.alpha === 0) this.emitter.stop();
  }

  /** DPR、屏幕宽高、寿命：都在这一处从 `scale` 现取（画布像素 / DPR = CSS px）。 */
  private syncSize(): void {
    // DPR 的事实源是**画布**（`world.ts` 把它写进 `scale.zoom = 1/dpr`，且已按 `MAX_DPR` 夹过），
    // 而不是 `window.devicePixelRatio`：跨显示器拖窗时画布不会跟着变，读设备值会让雨与世界不同步。
    const dpr = 1 / this.scale.zoom;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.cameras.main.setZoom(dpr);
    }
    this.width = this.scale.width / dpr;
    this.height = this.scale.height / dpr;
    const lifespan = ((this.height + LIFESPAN_SPAN_PX) / FALL_PX_PER_S) * 1000;
    if (lifespan === this.lifespanMs) return;
    this.lifespanMs = lifespan;
    // 建发射器之前只记账：构造时才把寿命交给配置
    if (this.emitter) this.emitter.lifespan = lifespan;
  }
}

/** 纹理运行时生成（不走 `npm run art`：那是手绘素材的管线）：临时 `Graphics` 画完就销毁。 */
function dropTexture(scene: Phaser.Scene): string {
  const graphics = scene.make.graphics();
  graphics.fillStyle(COLORS.line, 1);
  graphics.fillRect(0, 0, DROP_W, DROP_H);
  graphics.generateTexture(DROP_TEXTURE_KEY, DROP_W, DROP_H);
  graphics.destroy();
  return DROP_TEXTURE_KEY;
}
