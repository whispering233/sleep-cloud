import type { Point } from '../shared/layout';
import { arcLengthAhead } from './prediction';
import type { Prediction } from './prediction';
import { subscribe } from './store';

/** 输出周期：每 10s 一行（`docs/design/30-movement-sync.md` §6.2）。 */
const PROBE_INTERVAL_MS = 10_000;

/** `reversals` 的幅度门槛：单次步长超过它才算一次变号（滤掉浮点噪声，§6.2）。 */
const REVERSAL_MIN_PX = 0.5;

/**
 * 一个周期内的样本与计数。分布量是数组——哪一项没有样本就是空数组（那一项不占位，也不补 0）；
 * 计数是整数（`reversals` / `camOpposed` / `isMovingFlips` / `pathSwap`）。
 */
export interface ProbeWindow {
  leadMs: number[];
  posAge: number[];
  tickSpan: number[];
  regressPx: number[];
  frameDelta: number[];
  selfStepPx: number[];
  camStepPx: number[];
  /** 与 `selfStepPx` 方向相反的帧数（`camStepPx` 判据的分子，分母是 `camStepPx` 的样本数） */
  camOpposed: number;
  reversals: number;
  isMovingFlips: number;
  pathSwap: number;
}

export const emptyWindow = (): ProbeWindow => ({
  leadMs: [],
  posAge: [],
  tickSpan: [],
  regressPx: [],
  frameDelta: [],
  selfStepPx: [],
  camStepPx: [],
  camOpposed: 0,
  reversals: 0,
  isMovingFlips: 0,
  pathSwap: 0,
});

/**
 * 上一帧的画面点，以及它在**哪条折线**上。倒退要拿它和本帧点投影到同一条折线上比；
 * `path` 只在那一帧有外推时才有——没有外推就是没有可比轨迹。
 */
export interface ProbeTrail {
  point: Point;
  path?: Point[];
}

/** 一帧的观测输入（世界层 `update()` 末尾给）。缺的字段就是没有样本，不补 0。 */
export interface ProbeFrame {
  /** 画面点：外推点，或站定 / 躺在床上时的权威点（与世界层画出来的是同一个点） */
  point?: Point;
  /** 本帧的自身外推：倒退量要用它的锚点与折线做投影 */
  prediction?: Prediction;
  /** 相机 scroll（世界像素） */
  camera?: Point;
  /** 本帧的摆动闸门 `isMoving(me)` */
  isMoving?: boolean;
  /** 本帧的 `performance.now()`（与 Phaser 的 `loop.delta` 无关） */
  now?: number;
}

/** 一批关于自己的 `pos` 到达时给的观测输入（store 订阅）。 */
export interface ProbePos {
  /** `prediction.ts − prediction.anchorTs` */
  leadMs?: number;
  /** `(Date.now() + clockOffsetMs) − pos.ts` */
  posAge?: number;
  /** 这一批 `pos` 的服务端时刻；没有新的一批时也给（内部按变化判断） */
  posTs?: number;
}

/** 探针的累加器：窗口样本 + 上一帧的各项、上一批 `pos` 的时刻。 */
export interface ProbeAccumulator {
  window: ProbeWindow;
  /** 上一帧的画面点与它所在的折线；没有画面点的那一帧清空（没有轨迹连续性） */
  trail?: ProbeTrail;
  /** 上一帧的相机 scroll：`camStepPx` 与「方向相反」的帧数用 */
  camera?: Point;
  /** 上一帧的 `isMoving`：翻转计数用 */
  moving?: boolean;
  /** 上一帧的 `performance.now()`：`frameDelta` 用 */
  frameTs?: number;
  /** 上一次**过闸**的步长符号（±1）；0 = 还没有可比的一次（`reversals` 用） */
  stepSign: number;
  /** 上一批 `pos.ts`；快照后 `lastPosTs` 清空 → 这里跟着清空（不跨快照算 `tickSpan`）。 */
  posTs?: number;
}

export const createAccumulator = (): ProbeAccumulator => ({ window: emptyWindow(), stepSign: 0 });

/**
 * p50（中位数）：偶数个样本取正中两个的平均，奇数个取正中。空样本返回 `undefined`
 * ——「没有样本」与「样本是 0」在下面那一行输出里必须看得出来。
 */
export function percentile50(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * p95（nearest-rank）：第 `ceil(0.95 × n)` 小的那个样本。判据是「p95 > 150ms」，插值只会在
 * 样本很少时外推到样本之外，没有意义。空样本 `undefined`。
 */
export function percentile95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/** 同一折线上两点的弧长差与「上一帧点被夹在折线起点」。 */
export interface ArcStep {
  /** 本帧 − 上一帧的弧长差（px）：负值就是倒退 */
  step: number;
  /** 上一帧点落在折线起点或起点之前（弧长被夹成 0）：换折线的那一帧遇到它就不能比 */
  clampedStart: boolean;
}

/**
 * 把「上一帧点」与「本帧点」**都投影到同一条折线**上取弧长差（§6.2 的 `regressPx` 口径）。
 *
 * 不比折线引用：`anchorPrediction` 每拍用 `dropPassed` 剪一次折线（`path.slice` 换新数组），
 * 比引用会让倒退恒为 0——那是仪器坏了，不是不变量成立。剪枝只砍掉已过的前缀、剩余几何完全相同，
 * 所以两个世界点投影到同一条当前折线上既连续又可比。
 */
export function arcStepOf(origin: Point, path: Point[], previous: Point, point: Point): ArcStep {
  const previousArc = arcLengthAhead(origin, path, previous);
  return { step: arcLengthAhead(origin, path, point) - previousArc, clampedStart: previousArc === 0 };
}

/**
 * 本帧的 `regressPx` 样本；`undefined` = 这一帧不比。只有步长为负的那一段算倒退，
 * 幅度过闸的变号记一次 `reversals`。
 */
function sampleRegress(
  accumulator: ProbeAccumulator,
  previous: ProbeTrail | undefined,
  point: Point,
  prediction: Prediction | undefined,
): number | undefined {
  if (previous === undefined || previous.path === undefined || prediction === undefined) return 0;
  const { step, clampedStart } = arcStepOf(
    { x: prediction.x, y: prediction.y },
    prediction.path,
    previous.point,
    point,
  );
  // 折线换掉的那一帧若上一帧点被夹在折线起点：这一帧不可比，记一次 `pathSwap` 并跳过该帧（§6.2）
  if (previous.path !== prediction.path && clampedStart) {
    accumulator.window.pathSwap += 1;
    return undefined;
  }
  if (Math.abs(step) > REVERSAL_MIN_PX) {
    const sign = Math.sign(step);
    if (accumulator.stepSign !== 0 && sign !== accumulator.stepSign) accumulator.window.reversals += 1;
    accumulator.stepSign = sign;
  }
  return Math.max(0, -step);
}

/** 一帧的观测（世界层每帧调用）：`regressPx` 起的各项（§6.2）。 */
export function sampleFrame(accumulator: ProbeAccumulator, frame: ProbeFrame): void {
  if (frame.now !== undefined) {
    if (accumulator.frameTs !== undefined) accumulator.window.frameDelta.push(frame.now - accumulator.frameTs);
    accumulator.frameTs = frame.now;
  }

  const previous = accumulator.trail;
  const step =
    frame.point !== undefined && previous !== undefined
      ? { x: frame.point.x - previous.point.x, y: frame.point.y - previous.point.y }
      : undefined;

  if (frame.point !== undefined) {
    const regress = sampleRegress(accumulator, previous, frame.point, frame.prediction);
    if (regress !== undefined) accumulator.window.regressPx.push(regress);
    if (step !== undefined) accumulator.window.selfStepPx.push(Math.hypot(step.x, step.y));
    accumulator.trail = { point: frame.point, path: frame.prediction?.path };
  } else {
    // 没有画面点就没有轨迹连续性：下一帧不从这一帧量步长
    accumulator.trail = undefined;
  }

  if (frame.camera !== undefined) {
    const previousCamera = accumulator.camera;
    accumulator.camera = frame.camera;
    if (previousCamera !== undefined) {
      const camX = frame.camera.x - previousCamera.x;
      const camY = frame.camera.y - previousCamera.y;
      accumulator.window.camStepPx.push(Math.hypot(camX, camY));
      // 「符号相反」按方向判（点积 < 0）：二维步长没有单一符号，镜头朝我走的反方向跑才是那一类抖动
      if (step !== undefined && camX * step.x + camY * step.y < 0) accumulator.window.camOpposed += 1;
    }
  }

  if (frame.isMoving !== undefined) {
    if (accumulator.moving !== undefined && accumulator.moving !== frame.isMoving) accumulator.window.isMovingFlips += 1;
    accumulator.moving = frame.isMoving;
  }
}

/**
 * 一批 `pos` 到达时的观测（store 订阅）：`leadMs` / `posAge` / `tickSpan`（§6.2 前三项）。
 * 后两项按**新的一批 `pos`** 计：同一批被反复采样会把它的年龄越采越大、把节拍差采成 0。
 */
export function samplePos(accumulator: ProbeAccumulator, pos: ProbePos): void {
  if (pos.leadMs !== undefined) accumulator.window.leadMs.push(pos.leadMs);
  if (pos.posTs !== accumulator.posTs) {
    if (accumulator.posTs !== undefined && pos.posTs !== undefined) {
      accumulator.window.tickSpan.push(pos.posTs - accumulator.posTs);
    }
    if (pos.posAge !== undefined) accumulator.window.posAge.push(pos.posAge);
  }
  accumulator.posTs = pos.posTs;
}

const round = (value: number): number => Math.round(value * 10) / 10;

function stats(values: number[]): string {
  const p50 = percentile50(values);
  const p95 = percentile95(values);
  return p50 === undefined || p95 === undefined
    ? 'p50=- p95=- max=-'
    : `p50=${round(p50)} p95=${round(p95)} max=${round(Math.max(...values))}`;
}

/** 一个窗口 → 一行；一个样本都没有时返回 `undefined`（没有观测就不打空行）。 */
export function summarizeWindow(window: ProbeWindow): string | undefined {
  const total =
    window.leadMs.length + window.posAge.length + window.tickSpan.length + window.regressPx.length + window.frameDelta.length;
  if (total === 0) return undefined;
  // 倒退必须恒为 0：只要这一窗口里出现过一次，整行前置 `!!`，控制台一眼扫到
  const regressed = window.regressPx.some((px) => px > 0) ? '!! ' : '';
  return (
    `${regressed}[move-probe] leadMs ${stats(window.leadMs)} | posAge ${stats(window.posAge)}` +
    ` | tickSpan ${stats(window.tickSpan)} | regressPx ${stats(window.regressPx)} | reversals ${window.reversals}` +
    ` | frameDelta ${stats(window.frameDelta)} | selfStepPx ${stats(window.selfStepPx)}` +
    ` | camStepPx ${stats(window.camStepPx)} opposed=${window.camOpposed}/${window.camStepPx.length}` +
    ` | isMovingFlips ${window.isMovingFlips} | pathSwap ${window.pathSwap}`
  );
}

/** `?debug=1` 时由 `startMoveProbe` 设上的累加器：世界层每帧那一次调用只读它。 */
let live: ProbeAccumulator | undefined;

/** 世界层每帧的入口（`world.update()` 末尾一次调用）：没开探针时只是一次判空。 */
export function sampleFrameProbe(frame: ProbeFrame): void {
  if (live !== undefined) sampleFrame(live, frame);
}

/**
 * `?debug=1` 的观测探针：每 10s 打一行自身外推与位置同步的聚合指标（§6.2 的各项）。
 * **只在带参数时调用**——它订阅 store、挂一个内存定时器；探针只读状态、不参与任何判定，坏了也不影响走动。
 *
 * `leadMs` / `posAge` / `tickSpan` 在拿到 `pos` 时采；其余各项由世界层每帧交给 `sampleFrameProbe`
 * （画面点本就不进 React 状态，只有世界层每帧算得出来，见 `prediction.ts`）。
 */
export function startMoveProbe(): void {
  const accumulator = createAccumulator();
  live = accumulator;

  subscribe((state) => {
    const prediction = state.prediction;
    samplePos(accumulator, {
      leadMs: prediction && prediction.ts - prediction.anchorTs,
      posAge: state.lastPosTs === undefined ? undefined : Date.now() + state.clockOffsetMs - state.lastPosTs,
      posTs: state.lastPosTs,
    });
  });

  setInterval(() => {
    const line = summarizeWindow(accumulator.window);
    accumulator.window = emptyWindow();
    if (line !== undefined) console.log(line);
  }, PROBE_INTERVAL_MS);
}
