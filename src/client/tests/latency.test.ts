import { describe, expect, it } from 'vitest';

import { beginSample, clearSamples, settleSample } from '../latency';

describe('延迟样本（chat 回投 + 探活 pong）', () => {
  it('命中自己那条回投：RTT = 到达时刻 − 发出时刻，样本用掉', () => {
    const settled = settleSample(beginSample({}, 'chat', 1_000), 'chat', 1_128);
    expect(settled.rttMs).toBe(128);
    expect(settled.pending).toEqual({});
  });

  it('后发覆盖前发：按最新一次发出时刻算，且只结算一次', () => {
    const pending = beginSample(beginSample({}, 'chat', 1_000), 'chat', 1_050);
    const settled = settleSample(pending, 'chat', 1_080);
    expect(settled.rttMs).toBe(30);
    // 同一条样本不能结算第二次：否则第二次回投会凭空多出一个 RTT
    expect(settleSample(settled.pending, 'chat', 1_090).rttMs).toBeUndefined();
  });

  it('没有待配对样本时不产生样本', () => {
    const settled = settleSample({}, 'chat', 1_128);
    expect(settled.rttMs).toBeUndefined();
    expect(settled.pending).toEqual({});
  });

  it('清掉之后不再产生样本（snapshot / 掉线那条路径）', () => {
    const pending = clearSamples();
    expect(pending).toEqual({});
    expect(settleSample(pending, 'chat', 1_128).rttMs).toBeUndefined();
  });

  it('两个类别互不影响：有 chat 样本时 probe 结算不产生 RTT，反之亦然', () => {
    const chatPending = beginSample({}, 'chat', 1_000);
    const probeOnChat = settleSample(chatPending, 'probe', 1_050);
    expect(probeOnChat.rttMs).toBeUndefined();
    expect(probeOnChat.pending).toEqual({ chat: 1_000 });

    const probePending = beginSample({}, 'probe', 2_000);
    const chatOnProbe = settleSample(probePending, 'chat', 2_050);
    expect(chatOnProbe.rttMs).toBeUndefined();
    expect(chatOnProbe.pending).toEqual({ probe: 2_000 });

    // 各归各的：两条各自结算一次，互不吃掉对方的样本
    const both = beginSample(beginSample({}, 'chat', 1_000), 'probe', 1_010);
    const chatSettled = settleSample(both, 'chat', 1_100);
    expect(chatSettled.rttMs).toBe(100);
    expect(settleSample(chatSettled.pending, 'probe', 1_130).rttMs).toBe(120);
  });

  it('本地时钟被往回校准时夹在 0：宁可显示 0ms，也不显示负数', () => {
    expect(settleSample(beginSample({}, 'chat', 1_000), 'chat', 980).rttMs).toBe(0);
  });
});
