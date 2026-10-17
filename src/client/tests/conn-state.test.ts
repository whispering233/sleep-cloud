import { describe, expect, it } from 'vitest';

import { PROBE_TIMEOUT_MS, RECONNECT_BACKOFF_MS } from '../../shared/constants';
import {
  backoffMs,
  connecting,
  initialConnState,
  offline,
  online,
  probeTimedOut,
  probing,
  settled,
  shouldReconnect,
} from '../conn-state';

describe('连接态迁移（三态）', () => {
  it('起点是 connecting；收到快照才 online；close / error / 探活超时都落 offline', () => {
    const start = initialConnState();
    expect(start.connection).toBe('connecting');

    expect(online().connection).toBe('online');
    expect(offline(start).connection).toBe('offline');
    expect(offline(online()).connection).toBe('offline');
    expect(connecting(offline(online())).connection).toBe('connecting'); // 重连一开始就回到 connecting
  });

  it('开始建连就丢掉上一条连接的在飞探活（旧连接的 pong 不能替新连接作证）', () => {
    expect(connecting(probing(initialConnState(), 1_000)).probeSentAt).toBeUndefined();
  });
});

describe('重连退避', () => {
  it('依次取 1s / 2s / 4s / 8s / 15s，超出末档夹在 15s', () => {
    expect(RECONNECT_BACKOFF_MS).toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);
    expect([0, 1, 2, 3, 4, 5].map(backoffMs)).toEqual([1_000, 1_000, 2_000, 4_000, 8_000, 15_000]);
    expect(backoffMs(6)).toBe(15_000);
    expect(backoffMs(99)).toBe(15_000);
  });

  it('每次失败进一档（封顶末档，永不放弃），一次成功归零', () => {
    let state = initialConnState();
    for (const wait of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      state = offline(state);
      expect(backoffMs(state.failures)).toBe(wait);
    }

    expect(online().failures).toBe(0);
    expect(backoffMs(online().failures)).toBe(1_000);
  });

  it('hidden 期间不重连，回到前台才允许；connecting 期间不重入', () => {
    const dead = offline(initialConnState());
    expect(shouldReconnect(dead, true)).toBe(false);
    expect(shouldReconnect(dead, false)).toBe(true);
    expect(shouldReconnect(connecting(dead), false)).toBe(false);
    expect(shouldReconnect(online(), false)).toBe(false);
  });
});

describe('探活', () => {
  it('发 ping 后 PROBE_TIMEOUT_MS 内没有 pong → 判死', () => {
    const state = probing(initialConnState(), 10_000);
    expect(probeTimedOut(state, 10_000 + PROBE_TIMEOUT_MS - 1)).toBe(false);
    expect(probeTimedOut(state, 10_000 + PROBE_TIMEOUT_MS)).toBe(true);
  });

  it('探活本身不改三态（判死由调用方关连接后走 offline）', () => {
    expect(probing(online(), 10_000).connection).toBe('online');
  });

  it('收到 pong 就不再判死；没有在飞探活时恒为假', () => {
    expect(settled(probing(initialConnState(), 10_000)).probeSentAt).toBeUndefined();
    expect(probeTimedOut(settled(probing(initialConnState(), 10_000)), 99_999)).toBe(false);
    expect(probeTimedOut(initialConnState(), 99_999)).toBe(false);
  });
});
