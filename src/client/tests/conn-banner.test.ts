import { describe, expect, it } from 'vitest';

import { CONNECT_BANNER_DELAY_MS, connBannerOf } from '../conn-banner';

describe('连接提示条文案（纯函数）', () => {
  it('online 不显示；offline 显示断线文案 + 「尝试连接」按钮（没有「建连时长」也不影响）', () => {
    expect(connBannerOf({ connection: 'online', now: 10_000 })).toEqual({ visible: false, text: '', retry: false });
    expect(connBannerOf({ connection: 'offline', now: 10_000 })).toEqual({
      visible: true,
      text: '连接已断开，正在重连…',
      retry: true,
    });
  });

  it('connecting 的 3 秒阈值：2999 不显示，3000 显示「正在连接…」', () => {
    const since = 10_000;
    expect(connBannerOf({ connection: 'connecting', connectingSinceMs: since, now: since + 2_999 })).toEqual({
      visible: false,
      text: '正在连接…',
      retry: true,
    });
    expect(connBannerOf({ connection: 'connecting', connectingSinceMs: since, now: since + 3_000 })).toEqual({
      visible: true,
      text: '正在连接…',
      retry: true,
    });
  });

  it('阈值就是 3000ms；缺 `connectingSinceMs` 时按刚进 connecting 算（不显示）', () => {
    expect(CONNECT_BANNER_DELAY_MS).toBe(3_000);
    expect(connBannerOf({ connection: 'connecting', now: 10_000 }).visible).toBe(false);
  });

  it('停住的三种文案都常驻，且不再给「尝试连接」按钮（点它只会立刻再失败一次）', () => {
    const now = 100_000;
    expect(connBannerOf({ connection: 'halted', halt: 'blocked', untilAt: null, now })).toEqual({
      visible: true,
      text: '你暂时无法进入',
      retry: false,
    });
    expect(connBannerOf({ connection: 'halted', halt: 'replaced', now })).toEqual({
      visible: true,
      text: '你已在别处打开',
      retry: false,
    });
    expect(connBannerOf({ connection: 'halted', halt: 'stale', now })).toEqual({
      visible: true,
      text: '资源已更新，请刷新页面',
      retry: false,
    });
  });

  it('封禁带到期时间：还有 8 分钟（与入场层同一条文案、同一个换算）', () => {
    const minutes = (n: number) => n * 60_000;
    expect(connBannerOf({ connection: 'halted', halt: 'blocked', untilAt: 100_000 + minutes(8), now: 100_000 })).toEqual({
      visible: true,
      text: '你暂时无法进入 · 还有 8 分钟',
      retry: false,
    });
  });
});
