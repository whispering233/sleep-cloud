import type { Point } from '../shared/layout';
import { arcLengthAhead, predictionPointAt } from './prediction';
import type { Prediction } from './prediction';
import { getState, subscribe } from './store';

/** 输出周期：每 10s 一行（`docs/design/30-movement-sync.md` §6.2）。 */
const PROBE_INTERVAL_MS = 10_000;

/** 一个周期内各字段的样本。哪一项没有样本就是空数组（那一项不占位，也不补 0）。 */
export interface ProbeWindow {
  leadMs: number[];
  regressPx: number[];
  posAge: number[];
  tickSpan: number[];
}

export const emptyWindow = (): ProbeWindow => ({ leadMs: [], regressPx: [], posAge: [], tickSpan: [] });

/**
 * 上一采样的**折线身份**：`prediction.path` 的数组引用与当时沿它的弧长。
 * 倒退只在同一条折线内量——换了数组就是换了轨迹（新意图、重锚时剪枝），
 * 那一下的位移方向本来就是新的，不能当倒退。
 */
export interface ProbeTrail {
  path: Point[];
  arc: number;
}

/** 一帧的观测输入。缺的字段就是没有样本：没有外推时没有 `leadMs`，还没收到过 `pos` 时没有后两项。 */
export interface ProbeFrame {
  /**
   * 画面点（现算，见 `predictionPointAt`）：有外推时是外推点，`roaming` 但没有外推时是权威点 `me.x/y`。
   * 站定也照样采样——弧长不变，倒退恒为 0。
   */
  point?: Point;
  /** 画面点所在的外推：倒退量要用它的 `path` 引用与锚点算弧长；没有外推就是没有轨迹。 */
  prediction?: Prediction;
  /** `prediction.ts − prediction.anchorTs` */
  leadMs?: number;
  /** `(Date.now() + clockOffsetMs) − pos.ts`，只在**新的一批** `pos` 到达时给 */
  posAge?: number;
  /** 这一批 `pos` 的服务端时刻；没有新的一批时也给（内部按变化判断） */
  posTs?: number;
}

/** 探针的累加器：窗口样本 + 上一采样的折线弧长 + 上一批 `pos` 的时刻。 */
export interface ProbeAccumulator {
  window: ProbeWindow;
  trail?: ProbeTrail;
  /** 上一批 `pos.ts`；快照后 `lastPosTs` 清空 → 这里跟着清空（不跨快照算 `tickSpan`）。 */
  posTs?: number;
}

export const createAccumulator = (): ProbeAccumulator => ({ window: emptyWindow() });

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

/**
 * 一帧的倒退像素：只在**同一条折线**内比弧长，`max(0, 上次弧长 − 本次弧长)`。
 * 折线引用没变时锚点也没变（`beginPrediction` 与 `anchorPrediction` 都新建数组），弧长可以直接相减。
 */
function regressStep(accumulator: ProbeAccumulator, point: Point, prediction: Prediction | undefined): number {
  if (prediction === undefined) {
    accumulator.trail = undefined;
    return 0;
  }
  const arc = arcLengthAhead({ x: prediction.x, y: prediction.y }, prediction.path, point);
  const previous = accumulator.trail;
  accumulator.trail = { path: prediction.path, arc };
  // 引用变了就是新轨迹（合法掉头 / `hop` 回落 / 剪枝）：不比较
  return previous !== undefined && previous.path === prediction.path ? Math.max(0, previous.arc - arc) : 0;
}

export function sampleProbe(accumulator: ProbeAccumulator, frame: ProbeFrame): void {
  if (frame.point !== undefined) {
    accumulator.window.regressPx.push(regressStep(accumulator, frame.point, frame.prediction));
  }
  if (frame.leadMs !== undefined) accumulator.window.leadMs.push(frame.leadMs);
  // 后两项按**新的一批 `pos`** 计：同一批被反复采样会把它的年龄越采越大、把节拍差采成 0
  if (frame.posTs !== undefined && frame.posTs !== accumulator.posTs) {
    if (accumulator.posTs !== undefined) accumulator.window.tickSpan.push(frame.posTs - accumulator.posTs);
    if (frame.posAge !== undefined) accumulator.window.posAge.push(frame.posAge);
  }
  accumulator.posTs = frame.posTs;
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
  const total = window.leadMs.length + window.regressPx.length + window.posAge.length + window.tickSpan.length;
  if (total === 0) return undefined;
  // 倒退必须恒为 0：只要这一窗口里出现过一次，整行前置 `!!`，控制台一眼扫到
  const regressed = window.regressPx.some((px) => px > 0) ? '!! ' : '';
  return `${regressed}[move-probe] leadMs ${stats(window.leadMs)} | regressPx ${stats(window.regressPx)} | posAge ${stats(window.posAge)} | tickSpan ${stats(window.tickSpan)}`;
}

/**
 * `?debug=1` 的观测探针：每 10s 打一行自身外推与位置同步的聚合指标（§6.2 的四个字段）。
 * **只在带参数时调用**——它订阅 store、挂一个内存定时器，不调用就没有任何开销；
 * 探针只读状态、不参与任何判定，坏了也不影响走动。
 *
 * 画面点与 `leadMs` 现算（外推点本就不进 React 状态，见 `prediction.ts`），
 * 所以这里采到的就是世界层画的那个点。
 */
export function startMoveProbe(): void {
  const accumulator = createAccumulator();

  subscribe((state) => {
    const serverNow = Date.now() + state.clockOffsetMs;
    const prediction = state.prediction;
    const me = state.me;
    const point = prediction
      ? predictionPointAt(prediction, serverNow)
      : me?.state === 'roaming'
        ? { x: me.x, y: me.y }
        : undefined;
    sampleProbe(accumulator, {
      point,
      prediction,
      leadMs: prediction && prediction.ts - prediction.anchorTs,
      posAge: state.lastPosTs === undefined ? undefined : serverNow - state.lastPosTs,
      posTs: state.lastPosTs,
    });
  });

  setInterval(() => {
    const line = summarizeWindow(accumulator.window);
    accumulator.window = emptyWindow();
    if (line !== undefined) console.log(line);
  }, PROBE_INTERVAL_MS);
}
