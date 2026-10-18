import { describe, expect, it } from 'vitest';

import {
  createAccumulator,
  emptyWindow,
  percentile50,
  sampleProbe,
  stepRegress,
  summarizeWindow,
} from '../move-probe';
import type { ProbeAccumulator } from '../move-probe';

const at = (x: number, y: number) => ({ x, y });

/** 沿 +x 走的一串画面点（每步 10px）→ 累加器；倒退累加的起点。 */
const walkingEast = (): ProbeAccumulator => {
  const accumulator = createAccumulator();
  for (let step = 0; step < 3; step += 1) sampleProbe(accumulator, { point: at(step * 10, 0) });
  return accumulator;
};

describe('p50 / max', () => {
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
  });

  it('一行里四个字段各给 p50 与 max', () => {
    const line = summarizeWindow({
      leadMs: [240, 250, 260],
      regressPx: [0, 0, 0],
      posAge: [4, 2, 9],
      tickSpan: [100, 102, 101],
    });
    expect(line).toBe(
      '[move-probe] leadMs p50=250 max=260 | regressPx p50=0 max=0 | posAge p50=4 max=9 | tickSpan p50=101 max=102',
    );
  });

  it('没有样本的字段不占位（不补 0）', () => {
    const line = summarizeWindow({ ...emptyWindow(), posAge: [1, 2] });
    expect(line).toContain('leadMs p50=- max=-');
    expect(line).toContain('posAge p50=1.5 max=2');
  });

  it('一个样本都没有时不出行', () => {
    expect(summarizeWindow(emptyWindow())).toBeUndefined();
  });
});

describe('倒退累加', () => {
  it('正向位移不累加', () => {
    expect(walkingEast().window.regressPx).toEqual([0, 0, 0]);
  });

  it('逆向位移按投影累加（斜着退也只算逆着上一方向的那一段）', () => {
    const accumulator = walkingEast();
    sampleProbe(accumulator, { point: at(14, 8) }); // 退 6px（另 8px 是垂直分量）
    sampleProbe(accumulator, { point: at(3, 17) }); // 新方向是斜的，再沿它退 6/8 的比例
    expect(accumulator.window.regressPx.slice(3)).toEqual([6, 0]);
  });

  it('退着走一步之后，方向就跟着掉头（继续退不算倒退）', () => {
    const accumulator = walkingEast();
    sampleProbe(accumulator, { point: at(10, 0) }); // 退 10px，方向变为 −x
    sampleProbe(accumulator, { point: at(7, 0) }); // 继续沿 −x 走：相对新方向是前进
    expect(accumulator.window.regressPx.slice(3)).toEqual([10, 0]);
  });

  it('拐弯（垂直方向）不误报', () => {
    const accumulator = walkingEast();
    // 从 (20,0) 起沿 +y 走：位移与上一方向（+x）的点积为 0
    sampleProbe(accumulator, { point: at(20, 10) });
    sampleProbe(accumulator, { point: at(20, 20) });
    expect(accumulator.window.regressPx).toEqual([0, 0, 0, 0, 0]);
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
    expect(accumulator.step).toBeUndefined();
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

  it('第一帧没有方向可逆 → 倒退量为 0，并把第一帧当作方向的起点', () => {
    const first = stepRegress(undefined, at(5, 5));
    expect(first.regressPx).toBe(0);
    expect(first.step).toEqual({ point: at(5, 5), direction: { x: 0, y: 0 } });
    expect(stepRegress(first.step, at(5, 15)).regressPx).toBe(0);
    expect(stepRegress({ point: at(5, 15), direction: { x: 0, y: 1 } }, at(5, 5)).regressPx).toBe(10);
  });
});
