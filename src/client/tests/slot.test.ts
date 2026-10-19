import { describe, expect, it } from 'vitest';

import { setSlotSource, slotActive, slotHeightOf, subscribeSlot } from '../slot';

describe('插槽面板的触发源登记', () => {
  it('没有源就是关；任一源 active 就是开（面板显示 = 任一源 active）', () => {
    expect(slotActive()).toBe(false);
    setSlotSource('chat-input', true);
    expect(slotActive()).toBe(true);
    setSlotSource('stats', true);
    setSlotSource('chat-input', false);
    expect(slotActive()).toBe(true); // 还有 stats 开着
    setSlotSource('stats', false);
    expect(slotActive()).toBe(false);
  });

  it('同值不通知：位置节拍之类的重入不该让订阅者白渲染', () => {
    let notified = 0;
    const off = subscribeSlot(() => {
      notified += 1;
    });
    setSlotSource('chat-input', true);
    setSlotSource('chat-input', true);
    expect(notified).toBe(1);
    setSlotSource('chat-input', false);
    setSlotSource('chat-input', false);
    expect(notified).toBe(2);
    off();
    setSlotSource('chat-input', true);
    expect(notified).toBe(2);
    setSlotSource('chat-input', false);
  });

  it('开关由源自己负责：一个源关掉不影响另一个源', () => {
    setSlotSource('a', true);
    setSlotSource('b', true);
    setSlotSource('a', false);
    expect(slotActive()).toBe(true);
    setSlotSource('b', false);
    expect(slotActive()).toBe(false);
  });
});

describe('插槽面板高度', () => {
  it('= 可用视口下沿 − 聊天面板下沿', () => {
    expect(slotHeightOf({ panelBottom: 348, viewportBottom: 852 })).toBe(504);
  });

  it('面板下沿已经越过视口下沿时退成 0，不给负高度', () => {
    expect(slotHeightOf({ panelBottom: 900, viewportBottom: 852 })).toBe(0);
  });
});
