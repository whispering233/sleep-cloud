import { describe, expect, it } from 'vitest';

import {
  arcStepOf,
  createAccumulator,
  emptyWindow,
  percentile50,
  percentile95,
  sampleFrame,
  samplePos,
  summarizeWindow,
} from '../move-probe';
import type { ProbeAccumulator } from '../move-probe';
import type { Prediction } from '../prediction';

const at = (x: number, y: number) => ({ x, y });
const predictionOn = (path: { x: number; y: number }[]): Prediction => ({ x: 0, y: 0, anchorTs: 0, ts: 0, path });
const predictionFrom = (x: number, y: number, path: { x: number; y: number }[]): Prediction => ({
  x,
  y,
  anchorTs: 0,
  ts: 0,
  path,
});

describe('p50 / p95 / max', () => {
  it('奇数个样本取正中', () => {
    expect(percentile50([3, 1, 2])).toBe(2);
    expect(percentile50([100, 30, 51, 7, 42])).toBe(42);
  });

  it('偶数个样本取正中两个的平均', () => {
    expect(percentile50([4, 1, 3, 2])).toBe(2.5);
    expect(percentile50([10, 20])).toBe(15);
  });

  it('没有样本时是 undefined（不是 0）', () => {
    expect(percentile50([])).toBeUndefined();
    expect(percentile95([])).toBeUndefined();
  });

  it('p95 取第 ceil(0.95n) 小的样本（20 个样本 = 第 19 小）', () => {
    const values = Array.from({ length: 20 }, (_, index) => index * 10); // 0 … 190
    expect(percentile95(values)).toBe(180);
    expect(percentile95([5])).toBe(5);
  });

  it('一行里各字段按 §6.2 的顺序与字段名给出统计', () => {
    const line = summarizeWindow({
      ...emptyWindow(),
      leadMs: [240, 250, 260],
      regressPx: [0, 0, 0],
      posAge: [4, 2, 9],
      tickSpan: [100, 102, 101],
    });
    expect(line).toBe(
      '[move-probe] leadMs p50=250 p95=260 max=260 | posAge p50=4 p95=9 max=9 | tickSpan p50=101 p95=102 max=102' +
        ' | regressPx p50=0 p95=0 max=0 | reversals 0 | frameDelta p50=- p95=- max=- | selfStepPx p50=- p95=- max=-' +
        ' | camStepPx p50=- p95=- max=- opposed=0/0 | isMovingFlips 0 | pathSwap 0 | suspendGap 0',
    );
  });

  it('p95 与其他统计一样按一位小数取整', () => {
    // 18 个 1 + 7.25 + 9：第 19 小（index 18）就是 7.25
    const line = summarizeWindow({ ...emptyWindow(), tickSpan: [...Array(18).fill(1), 7.25, 9] });
    expect(line).toContain('tickSpan p50=1 p95=7.3 max=9');
  });

  it('没有样本的字段不占位（不补 0）', () => {
    const line = summarizeWindow({ ...emptyWindow(), posAge: [1, 2] });
    expect(line).toContain('leadMs p50=- p95=- max=-');
    expect(line).toContain('posAge p50=1.5 p95=2 max=2');
  });

  it('一个样本都没有时不出行', () => {
    expect(summarizeWindow(emptyWindow())).toBeUndefined();
  });
});

describe('倒退：两个点投影到同一条当前折线上', () => {
  /** 折线：向东到 (100,0)，再向北到 (100,100)；拐角在 (100,0)。 */
  const cornerPath = [at(100, 0), at(100, 100)];

  it('同一折线上把点往回喂 → 步长为负、regressPx 记正数', () => {
    expect(arcStepOf(at(0, 0), [at(200, 0)], at(60, 0), at(30, 0))).toEqual({ step: -30, clampedStart: false });

    const accumulator = createAccumulator();
    const prediction = predictionOn([at(200, 0)]);
    sampleFrame(accumulator, { point: at(60, 0), prediction });
    sampleFrame(accumulator, { point: at(30, 0), prediction });
    expect(accumulator.window.regressPx).toEqual([0, 30]);
  });

  it('同一个点 → 步长为 0、倒退为 0', () => {
    expect(arcStepOf(at(0, 0), [at(200, 0)], at(40, 0), at(40, 0))).toEqual({ step: 0, clampedStart: false });

    const accumulator = createAccumulator();
    const prediction = predictionOn([at(200, 0)]);
    sampleFrame(accumulator, { point: at(40, 0), prediction });
    sampleFrame(accumulator, { point: at(40, 0), prediction });
    expect(accumulator.window.regressPx).toEqual([0, 0]);
    expect(accumulator.window.selfStepPx).toEqual([0]);
    expect(accumulator.window.reversals).toBe(0);
  });

  it('同一条折线上前进不累加（含绕拐角：弧长单调）', () => {
    const prediction = predictionOn(cornerPath);
    const accumulator = createAccumulator();
    for (const point of [at(20, 0), at(60, 0), at(100, 10), at(100, 60)]) {
      sampleFrame(accumulator, { point, prediction });
    }
    expect(accumulator.window.regressPx).toEqual([0, 0, 0, 0]);
  });

  it('同一条折线上倒退 30px → 30（绕拐角后往回退也算）', () => {
    const prediction = predictionOn(cornerPath);
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(60, 0), prediction });
    sampleFrame(accumulator, { point: at(30, 0), prediction }); // 弧长 60 → 30
    sampleFrame(accumulator, { point: at(100, 40), prediction }); // 弧长 140
    sampleFrame(accumulator, { point: at(100, 10), prediction }); // 弧长 110
    expect(accumulator.window.regressPx).toEqual([0, 30, 0, 30]);
  });

  it('reversals 只数幅度过闸的变号（0.5px 以内的抖动不算）', () => {
    const prediction = predictionOn([at(200, 0)]);
    const accumulator = createAccumulator();
    for (const point of [at(60, 0), at(90, 0), at(50, 0), at(80, 0)]) sampleFrame(accumulator, { point, prediction });
    expect(accumulator.window.regressPx).toEqual([0, 0, 40, 0]);
    expect(accumulator.window.reversals).toBe(2); // + → − → +

    const noisy = createAccumulator();
    sampleFrame(noisy, { point: at(60, 0), prediction });
    sampleFrame(noisy, { point: at(90, 0), prediction });
    sampleFrame(noisy, { point: at(89.75, 0), prediction }); // 倒退 0.25px：不记变号
    expect(noisy.window.reversals).toBe(0);
    expect(noisy.window.regressPx).toEqual([0, 0, 0.25]);
  });

  it('折线换掉的那一帧若上一帧点被夹在折线起点 → 记 pathSwap 并跳过该帧', () => {
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(150, 0), prediction: predictionFrom(0, 0, [at(200, 0)]) });
    // 重锚剪枝：锚点前移到 (160,0)，折线换了一个新数组；上一帧点 (150,0) 被夹在新折线起点之前
    sampleFrame(accumulator, { point: at(165, 0), prediction: predictionFrom(160, 0, [at(200, 0)]) });
    expect(accumulator.window.pathSwap).toBe(1);
    expect(accumulator.window.regressPx).toEqual([0]); // 那一帧不采样本（不是记成 0）
    expect(accumulator.window.reversals).toBe(0);
  });

  it('换了一条折线（合法掉头改目标）不算倒退', () => {
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(60, 0), prediction: predictionOn([at(200, 0)]) });
    // 掉头向西：新意图换了一根新数组，画面点相对新锚点仍在前进
    sampleFrame(accumulator, { point: at(55, 0), prediction: predictionOn([at(-200, 0)]) });
    expect(accumulator.window.pathSwap).toBe(1); // 上一帧点被夹在新折线起点 → 那一帧跳过
    expect(accumulator.window.regressPx).toEqual([0]);
  });

  it('外推消失（hop / 意图被拒）不比较，也不把上一趟的轨迹留到下一趟', () => {
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(60, 0), prediction: predictionOn([at(200, 0)]) });
    sampleFrame(accumulator, { point: at(80, 0) }); // 没有外推：站定的权威点
    expect(accumulator.window.regressPx).toEqual([0, 0]);
    expect(accumulator.trail).toEqual({ point: at(80, 0) });
    // 重新起步时即便落在旧弧长之前，也不算倒退（上一帧没有折线，这一帧不可比）
    sampleFrame(accumulator, { point: at(10, 0), prediction: predictionOn([at(200, 0)]) });
    expect(accumulator.window.regressPx).toEqual([0, 0, 0]);
  });

  it('倒退过的行前置 !!，全程正向的行不加前缀', () => {
    const clean = summarizeWindow({ ...emptyWindow(), regressPx: [0, 0, 0] });
    const dirty = summarizeWindow({ ...emptyWindow(), regressPx: [0, 3, 0] });
    expect(clean?.startsWith('!!')).toBe(false);
    expect(dirty?.startsWith('!! ')).toBe(true);
  });

  it('没有画面点时不采倒退样本（躺在床上不走路）', () => {
    const accumulator = createAccumulator();
    samplePos(accumulator, { posAge: 3, posTs: 1_000 });
    expect(accumulator.window.regressPx).toEqual([]);
    expect(accumulator.trail).toBeUndefined();
  });
});

describe('帧级采样', () => {
  const prediction = predictionOn([at(200, 0)]);

  it('frameDelta / selfStepPx / camStepPx / isMovingFlips 每帧采，镜头反向的帧单独计数', () => {
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(0, 0), prediction, camera: at(0, 0), isMoving: false, now: 1_000 });
    sampleFrame(accumulator, { point: at(3, 0), prediction, camera: at(3, 0), isMoving: true, now: 1_016 });
    sampleFrame(accumulator, { point: at(6, 0), prediction, camera: at(1, 0), isMoving: true, now: 1_032 });
    expect(accumulator.window.frameDelta).toEqual([16, 16]);
    expect(accumulator.window.selfStepPx).toEqual([3, 3]);
    expect(accumulator.window.camStepPx).toEqual([3, 2]);
    expect(accumulator.window.camOpposed).toBe(1); // 第三帧：我向东 3px，镜头向西 2px
    expect(accumulator.window.isMovingFlips).toBe(1);
    expect(accumulator.window.regressPx).toEqual([0, 0, 0]);
  });

  it('同一批 pos 反复采样不算新一批（节拍差只在换批时记）', () => {
    const accumulator = createAccumulator();
    samplePos(accumulator, { posTs: 1_000, posAge: 5 });
    samplePos(accumulator, { posTs: 1_000, posAge: 40 }); // 同一批：年龄不再采
    samplePos(accumulator, { posTs: 1_101, posAge: 3 });
    expect(accumulator.window.tickSpan).toEqual([101]);
    expect(accumulator.window.posAge).toEqual([5, 3]);
  });

  it('快照后 posTs 清空 → 不跨快照算 tickSpan，且不把空档算成节拍', () => {
    const accumulator = createAccumulator();
    samplePos(accumulator, { posTs: 1_000 });
    samplePos(accumulator, { posTs: undefined }); // 新快照
    samplePos(accumulator, { posTs: 9_000 });
    expect(accumulator.window.tickSpan).toEqual([]);
  });

  it('帧那一半与 pos 那一半互不干扰：没有外推就不采 leadMs，帧照样采', () => {
    const accumulator = createAccumulator();
    samplePos(accumulator, { posAge: 2, posTs: 1_000 });
    sampleFrame(accumulator, { point: at(0, 0) });
    sampleFrame(accumulator, { point: at(0, 10) });
    expect(accumulator.window.leadMs).toEqual([]);
    expect(accumulator.window.regressPx).toEqual([0, 0]);
    expect(accumulator.window.posAge).toEqual([2]);
  });

  it('第一帧没有上一帧 → 倒退量为 0，并把这一帧当作折线起点', () => {
    const accumulator: ProbeAccumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(5, 0), prediction: predictionOn([at(10, 0)]) });
    expect(accumulator.window.regressPx).toEqual([0]);
    expect(accumulator.window.selfStepPx).toEqual([]);
    expect(accumulator.trail).toEqual({ point: at(5, 0), path: [at(10, 0)] });
  });

  it('单帧位移超过 10px 才记 bigStep，并带上外推与摆动两个判别位', () => {
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(0, 0), prediction, camera: at(0, 0), isMoving: true, now: 1_000 });
    sampleFrame(accumulator, { point: at(4, 0), prediction, camera: at(4, 0), isMoving: true, now: 1_016 });
    expect(accumulator.window.bigStep).toBeUndefined();

    sampleFrame(accumulator, { point: at(120, 0), prediction, camera: at(120, 0), isMoving: false, now: 1_032 });
    expect(accumulator.window.bigStep).toEqual({ px: 116, hadPrediction: true, isMoving: false });

    // 更小的一次不覆盖：窗口里留的是最大的那一次
    sampleFrame(accumulator, { point: at(140, 0), prediction: undefined, camera: at(140, 0), isMoving: false, now: 1_048 });
    expect(accumulator.window.bigStep).toEqual({ px: 116, hadPrediction: true, isMoving: false });
  });

  it('挂起后醒来的第一帧不算帧间隔也不算位移（记 suspendGap，轨迹重新起头）', () => {
    const accumulator = createAccumulator();
    sampleFrame(accumulator, { point: at(0, 0), prediction, camera: at(0, 0), isMoving: true, now: 1_000 });
    sampleFrame(accumulator, { point: at(3, 0), prediction, camera: at(3, 0), isMoving: true, now: 1_016 });
    // 190s 之后醒来：世界被整屏页挂起过
    sampleFrame(accumulator, { point: at(900, 0), prediction, camera: at(900, 0), isMoving: true, now: 191_016 });
    expect(accumulator.window.frameDelta).toEqual([16]);
    expect(accumulator.window.selfStepPx).toEqual([3]);
    expect(accumulator.window.camStepPx).toEqual([3]);
    expect(accumulator.window.suspendGap).toBe(1);
    expect(accumulator.window.isMovingFlips).toBe(0); // 恢复不把摆动闸门算成一次翻转
    expect(accumulator.trail).toBeUndefined();

    // 醒来后的下一帧重新从零起算，不把跨越整屏的位移当成一帧的步长
    sampleFrame(accumulator, { point: at(903, 0), prediction, camera: at(903, 0), isMoving: true, now: 191_032 });
    expect(accumulator.window.selfStepPx).toEqual([3]);
    expect(accumulator.window.frameDelta).toEqual([16, 16]);
  });
});
