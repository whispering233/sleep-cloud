import { describe, expect, it } from 'vitest';

import { CONNECT_BANNER_DELAY_MS, connBannerOf } from '../conn-banner';

describe('连接提示条文案（纯函数）', () => {
  it('online 不显示；offline 显示断线文案（没有「建连时长」也不影响）', () => {
    expect(connBannerOf({ connection: 'online', now: 10_000 })).toEqual({ visible: false, text: '' });
    expect(connBannerOf({ connection: 'offline', now: 10_000 })).toEqual({
      visible: true,
      text: '连接已断开，正在重连…',
    });
  });

  it('connecting 的 3 秒阈值：2999 不显示，3000 显示「正在连接…」', () => {
    const since = 10_000;
    expect(connBannerOf({ connection: 'connecting', connectingSinceMs: since, now: since + 2_999 })).toEqual({
      visible: false,
      text: '正在连接…',
    });
    expect(connBannerOf({ connection: 'connecting', connectingSinceMs: since, now: since + 3_000 })).toEqual({
      visible: true,
      text: '正在连接…',
    });
  });

  it('阈值就是 3000ms；缺 `connectingSinceMs` 时按刚进 connecting 算（不显示）', () => {
    expect(CONNECT_BANNER_DELAY_MS).toBe(3_000);
    expect(connBannerOf({ connection: 'connecting', now: 10_000 }).visible).toBe(false);
  });
});
