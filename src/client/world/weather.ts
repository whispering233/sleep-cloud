import * as Phaser from 'phaser';

import type { WeatherKind } from '../prefs';
import { getState } from '../store';
import { COLORS } from './views';

/**
 * 天气层（`docs/ui/DESIGN.md` 的 `weather-layer`、`docs/design/config.md` §4）：**屏幕空间**的并行 Scene。
 *
 * 它不是世界的一部分：自带相机、`zoom = 画布 DPR`、原点挪到左上角，所以这里的坐标单位就是 CSS px——
 * 相机缩放（`全厅` / `1×`）、可用视口、面板换位都不改变雨与雪的样子。它**也不是第二层明暗**：
 * 雨覆盖率约 1.2%、雪的实际绘制像素约 1.5%，三档减光照旧只由 `tone-layer` 那一层负责。
 *
 * **两套发射器常驻、同一时刻只发射一套**（`weather` 是单值，不是三个布尔）。开关只走 `update` 的
 * 400 ms 线性推进：**不挂 tween、不挂定时器**（存活的定时器会让对象无法休眠）。400 ms 说的是**整层
 * alpha**（乘在每颗粒子自己的 alpha 上）；换天气不做「先淡出再淡入」的两段——两套的 alpha 在**同一个
 * 400 ms 窗口里**各自向 1 / 0 走，退场那套的粒子自然落完（雪的 15 s 排空被 alpha 遮住，视觉上 400 ms 就干净）。
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

/**
 * 雪点纹理：6 × 6 CSS px 的圆，**必须双色**——纯 `paper` 与地板只有 1.25:1，漫游档看不见；
 * 「墨边 + 白芯」也正是素材的既有语言（墨线端点 + 白填充端点）。
 */
const FLAKE_SIZE = 6;
const FLAKE_EDGE_R = 2.6;
const FLAKE_CORE_R = 1.4;
/** 每颗 `scale 0.8…1.25` 随机：避免「一堆同尺寸泡泡」的观感。 */
const FLAKE_SCALE = { min: 0.8, max: 1.25 };
/** 速度（CSS px/s）：比雨慢十倍以上才读作雪；横向随机 + 每颗固定的横向加速度 → 轨迹微弯，读作「飘」。 */
const FLAKE_SPEED_Y = { min: 60, max: 110 };
const FLAKE_SPEED_X = { min: -22, max: 22 };
const FLAKE_ACCELERATION_X = { min: -12, max: 12 };
const FLAKE_ALPHA = { min: 0.5, max: 0.85 };
/** 发射率：每 70 ms 一颗 ≈ 14 颗/秒（慢速 + 长寿命，所以只有雨的十分之一）。 */
const FLAKE_QUANTITY = 1;
const FLAKE_FREQUENCY_MS = 70;

/** 出生点在屏幕上方 20px；寿命多留 70px 余量，所以粒子落到下边界之下才死，不是半屏就死。 */
const EMIT_Y = -20;
const LIFESPAN_SPAN_PX = 70;
/** 开 / 关的线性过渡时长（`docs/design/config.md` §4）。 */
const FADE_MS = 400;

const DROP_TEXTURE_KEY = 'rain-drop';
const FLAKE_TEXTURE_KEY = 'snow-flake';

/** 一帧走 `step`：向 `target` 线性推进，不越过它（淡入淡出按实际经过时间算，与帧率无关）。 */
function approach(value: number, target: number, step: number): number {
  return target > value ? Math.min(value + step, target) : Math.max(value - step, target);
}

export class WeatherScene extends Phaser.Scene {
  /** 两套发射器常驻：`weather` 指向哪一套就只发射那一套 */
  private rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 画布 DPR（相机 zoom 就是它）：0 = 还没同步过，首次 `syncSize` 一定写进相机。 */
  private dpr = 0;
  /** 屏幕宽高（CSS px）：发射器的 x 与寿命都按它现算，随宿主尺寸变化。 */
  private width = 0;
  private height = 0;
  /** 两套粒子各自的寿命（ms）：屏幕高变化时重设（各自按最慢一档下落速度算，落到下边界之下才死）。 */
  private rainLifespanMs = 0;
  private snowLifespanMs = 0;
  /** 两套粒子各自的整层不透明度（0…1）：`weather` 指向的那一套向 1 走、另一套向 0 走，同一个 400 ms 窗口。 */
  private rainAlpha = 0;
  private snowAlpha = 0;
  /** 正在发射的那一套：与 store 的 `weather` 同步（停下只停发射、不 kill，存活粒子自然落完）。 */
  private emitting: WeatherKind = 'none';

  constructor() {
    super({ key: 'weather', active: true });
  }

  create(): void {
    // 屏幕空间的两条前提：原点在左上角（默认原点在视口中心，zoom 会绕中心缩放、雨就画到屏幕外）、
    // zoom = DPR。相机视口跟着画布走由 `CameraManager` 的 `scale` RESIZE 监听完成——
    // `Scale.NONE` + 手动 `scale.resize`（`world.ts` 的 `applySize`）也会发那个事件，这里不用自己量。
    // 注意：origin(0,0) 之后 `camera.worldView` 仍然是按「视口中心」算的（Phaser 的已知偏差），
    // 以后要给它加视锥裁剪或命中判定，得自己把那段偏移算进去。
    this.cameras.main.setOrigin(0, 0);
    this.syncSize();

    this.rain = this.add.particles(0, 0, dropTexture(this), {
      // 每颗的 x 在发射那一刻按当前屏幕宽度取随机（屏幕空间，宽度随宿主变）
      x: { onEmit: () => Math.random() * this.width },
      y: EMIT_Y,
      quantity: DROP_QUANTITY,
      frequency: DROP_FREQUENCY_MS,
      speedX: SPEED_X,
      speedY: SPEED_Y,
      alpha: DROP_ALPHA,
      lifespan: this.rainLifespanMs,
      emitting: false,
    });
    this.snow = this.add.particles(0, 0, flakeTexture(this), {
      x: { onEmit: () => Math.random() * this.width },
      y: EMIT_Y,
      quantity: FLAKE_QUANTITY,
      frequency: FLAKE_FREQUENCY_MS,
      speedX: FLAKE_SPEED_X,
      speedY: FLAKE_SPEED_Y,
      accelerationX: FLAKE_ACCELERATION_X,
      scale: FLAKE_SCALE,
      alpha: FLAKE_ALPHA,
      lifespan: this.snowLifespanMs,
      emitting: false,
    });
    // 初值直接是最终态：进厅 / 刷新时不该先看一次 400 ms 的淡入，之后的切换才走 update 的过渡
    const kind = getState().weather;
    this.emitting = kind;
    this.rainAlpha = kind === 'rain' ? 1 : 0;
    this.snowAlpha = kind === 'snow' ? 1 : 0;
    this.rain.setAlpha(this.rainAlpha);
    this.snow.setAlpha(this.snowAlpha);
    this.start(kind);
  }

  update(_time: number, delta: number): void {
    this.syncSize();

    const kind = getState().weather;
    if (kind !== this.emitting) {
      // 换天气只停旧的、起新的（两套的 alpha 在同一个 400 ms 窗口里交叉，不是「先淡出再淡入」的两段）
      this.stop(this.emitting);
      this.start(kind);
      this.emitting = kind;
    }

    // 淡入淡出按实际经过时间推进（与帧率无关），不挂 tween、不挂定时器
    const step = delta / FADE_MS;
    this.rainAlpha = approach(this.rainAlpha, kind === 'rain' ? 1 : 0, step);
    this.snowAlpha = approach(this.snowAlpha, kind === 'snow' ? 1 : 0, step);
    this.rain.setAlpha(this.rainAlpha);
    this.snow.setAlpha(this.snowAlpha);
    // 收口：淡出走完后一定不再有新粒子（`stop()` 在翻转那一帧就叫过了，这里只是让不变量不靠推理）
    if (this.rainAlpha === 0) this.rain.stop();
    if (this.snowAlpha === 0) this.snow.stop();
  }

  /** 起一套粒子。**雪预跑一个寿命**（一帧即满）：15 s 的自然爬满看起来像没反应；雨保持无参 `start()`。 */
  private start(kind: WeatherKind): void {
    if (kind === 'rain') this.rain.start();
    else if (kind === 'snow') this.snow.start(this.snowLifespanMs);
  }

  /** 停一套粒子：只停发射、不 kill——存活粒子自然落完，整层 alpha 会把它们带走。 */
  private stop(kind: WeatherKind): void {
    if (kind === 'rain') this.rain.stop();
    else if (kind === 'snow') this.snow.stop();
  }

  /** DPR、屏幕宽高、两套寿命：都在这一处从 `scale` 现取（画布像素 / DPR = CSS px）。 */
  private syncSize(): void {
    // DPR 的事实源是**画布**（`world.ts` 把它写进 `scale.zoom = 1/dpr`，且已按 `MAX_DPR` 夹过），
    // 而不是 `window.devicePixelRatio`：跨显示器拖窗时画布不会跟着变，读设备值会让粒子与世界不同步。
    const dpr = 1 / this.scale.zoom;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.cameras.main.setZoom(dpr);
    }
    this.width = this.scale.width / dpr;
    this.height = this.scale.height / dpr;
    // 寿命按**最慢的一档下落速度**算，更快的粒子也一定还没落地。**必须跟着速度带下限走**——
    // 写死一个数的话，谁调慢速度带下限，粒子就会在半屏处开始消失，而且没有任何断言会红。
    const rainLifespan = ((this.height + LIFESPAN_SPAN_PX) / SPEED_Y.min) * 1000;
    const snowLifespan = ((this.height + LIFESPAN_SPAN_PX) / FLAKE_SPEED_Y.min) * 1000;
    if (rainLifespan === this.rainLifespanMs && snowLifespan === this.snowLifespanMs) return;
    this.rainLifespanMs = rainLifespan;
    this.snowLifespanMs = snowLifespan;
    // 建发射器之前只记账：构造时才把寿命交给配置
    if (this.rain) this.rain.lifespan = rainLifespan;
    if (this.snow) this.snow.lifespan = snowLifespan;
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

/** 雪点：墨边圆 + 白芯圆，两层都画在 6 × 6 的贴图里（圆心在正中，贴图原点因此是粒子中心）。 */
function flakeTexture(scene: Phaser.Scene): string {
  const graphics = scene.make.graphics();
  graphics.fillStyle(COLORS.line, 1);
  graphics.fillCircle(FLAKE_SIZE / 2, FLAKE_SIZE / 2, FLAKE_EDGE_R);
  graphics.fillStyle(COLORS.paper, 1);
  graphics.fillCircle(FLAKE_SIZE / 2, FLAKE_SIZE / 2, FLAKE_CORE_R);
  graphics.generateTexture(FLAKE_TEXTURE_KEY, FLAKE_SIZE, FLAKE_SIZE);
  graphics.destroy();
  return FLAKE_TEXTURE_KEY;
}
