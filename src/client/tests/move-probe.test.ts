import { describe, expect, it } from 'vitest';

import {
  createAccumulator,
  emptyWindow,
  percentile50,
  percentile95,
  sampleProbe,
  summarizeWindow,
} from '../move-probe';
import type { ProbeAccumulator } from '../move-probe';
import type { Prediction } from '../prediction';

const at = (x: number, y: number) => ({ x, y });
const predictionOn = (path: { x: number; y: number }[]): Prediction => ({ x: 0, y: 0, anchorTs: 0, ts: 0, path });

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

  it('一行里四个字段各给 p50 / p95 / max', () => {
    const line = summarizeWindow({
      leadMs: [240, 250, 260],
      regressPx: [0, 0, 0],
      posAge: [4, 2, 9],
      tickSpan: [100, 102, 101],
    });
    expect(line).toBe(
      '[move-probe] leadMs p50=250 p95=260 max=260 | regressPx p50=0 p95=0 max=0 | posAge p50=4 p95=9 max=9 | tickSpan p50=101 p95=102 max=102',
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

describe('倒退只在同一条折线内算', () => {
  /** 折线：向东到 (100,0)，再向北到 (100,100)；拐角在 (100,0)。 */
  const cornerPath = [at(100, 0), at(100, 100)];

  it('同一条折线上前进不累加（含绕拐角：弧长单调）', () => {
    const prediction = predictionOn(cornerPath);
    const accumulator = createAccumulator();
    for (const point of [at(20, 0), at(60, 0), at(100, 10), at(100, 60)]) {
      sampleProbe(accumulator, { point, prediction });
    }
    expect(accumulator.window.regressPx).toEqual([0, 0, 0, 0]);
  });

  it('同一条折线上倒退 30px → 30（绕拐角后往回退也算）', () => {
    const prediction = predictionOn(cornerPath);
    const accumulator = createAccumulator();
    sampleProbe(accumulator, { point: at(60, 0), prediction });
    sampleProbe(accumulator, { point: at(30, 0), prediction }); // 弧长 60 → 30
    sampleProbe(accumulator, { point: at(100, 40), prediction }); // 弧长 140
    sampleProbe(accumulator, { point: at(100, 10), prediction }); // 弧长 110
    expect(accumulator.window.regressPx).toEqual([0, 30, 0, 30]);
  });

  it('换了一条折线（合法掉头改目标）不算倒退', () => {
    const accumulator = createAccumulator();
    sampleProbe(accumulator, { point: at(60, 0), prediction: predictionOn([at(200, 0)]) });
    // 掉头向西：新意图换了一根新数组，画面点相对新锚点仍在前进
    sampleProbe(accumulator, { point: at(55, 0), prediction: predictionOn([at(-200, 0)]) });
    expect(accumulator.window.regressPx).toEqual([0, 0]);
  });

  it('外推消失（hop / 意图被拒）不比较，也不把上一趟的弧长留到下一趟', () => {
    const accumulator = createAccumulator();
    sampleProbe(accumulator, { point: at(60, 0), prediction: predictionOn([at(200, 0)]) });
    sampleProbe(accumulator, { point: at(80, 0) }); // 没有外推：站定的权威点
    expect(accumulator.window.regressPx).toEqual([0, 0]);
    expect(accumulator.trail).toBeUndefined();
    // 重新起步时即便落在旧弧长之前，也不算倒退
    sampleProbe(accumulator, { point: at(10, 0), prediction: predictionOn([at(200, 0)]) });
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
    sampleProbe(accumulator, { posAge: 3, posTs: 1_000 });
    expect(accumulator.window.regressPx).toEqual([]);
    expect(accumulator.trail).toBeUndefined();
  });
});

describe('样本口径', () => {
  it('没有外推 → 跳过 leadMs，其它字段照采', () => {
    const accumulator = createAccumulator();
    sampleProbe(accumulator, { point: at(0, 0), posAge: 2, posTs: 1_000 });
    sampleProbe(accumulator, { point: at(0, 10) });
    expect(accumulator.window.leadMs).toEqual([]);
    expect(accumulator.window.regressPx).toEqual([0, 0]);
    expect(accumulator.window.posAge).toEqual([2]);
  });

  it('tickSpan 只在出现新一批 pos 时记一条，同一批反复采样不算', () => {
    const accumulator = createAccumulator();
    sampleProbe(accumulator, { posTs: 1_000, posAge: 5 });
    sampleProbe(accumulator, { posTs: 1_000, posAge: 40 }); // 同一批：年龄不再采
    sampleProbe(accumulator, { posTs: 1_101, posAge: 3 });
    expect(accumulator.window.tickSpan).toEqual([101]);
    expect(accumulator.window.posAge).toEqual([5, 3]);
  });

  it('快照后 posTs 清空 → 不跨快照算 tickSpan，且不把空档算成节拍', () => {
    const accumulator = createAccumulator();
    sampleProbe(accumulator, { posTs: 1_000 });
    sampleProbe(accumulator, { posTs: undefined }); // 新快照
    sampleProbe(accumulator, { posTs: 9_000 });
    expect(accumulator.window.tickSpan).toEqual([]);
  });

  it('第一帧没有上一采样 → 倒退量为 0，并把这一帧当作折线起点', () => {
    const accumulator: ProbeAccumulator = createAccumulator();
    sampleProbe(accumulator, { point: at(5, 0), prediction: predictionOn([at(10, 0)]) });
    expect(accumulator.window.regressPx).toEqual([0]);
    expect(accumulator.trail).toEqual({ path: [at(10, 0)], arc: 5 });
  });
});
