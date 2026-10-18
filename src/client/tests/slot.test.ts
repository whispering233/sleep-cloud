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
  it('= 聊天面板上沿 − HUD 下沿（shell 高 − HUD 高 − 聊天面板高的实边写法）', () => {
    expect(slotHeightOf({ shellTop: 0, hudBottom: 29, panelTop: 600 })).toBe(571);
  });

  it('HUD 还没挂上时退化成整个 shell 的高度', () => {
    expect(slotHeightOf({ shellTop: 0, hudBottom: undefined, panelTop: 600 })).toBe(600);
  });

  it('外壳被键盘缩到比 HUD 还矮时退成 0，不给负高度', () => {
    expect(slotHeightOf({ shellTop: 40, hudBottom: 80, panelTop: 50 })).toBe(0);
  });
});