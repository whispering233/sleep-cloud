import { afterEach, describe, expect, it, vi } from 'vitest';

import { setWorldHandle, setWorldSuspended } from '../world-handle';
import type { WorldHandle } from '../world/world';

const fakeWorld = (): { handle: WorldHandle; setSuspended: ReturnType<typeof vi.fn> } => {
  const setSuspended = vi.fn();
  return {
    handle: {
      destroy: vi.fn(),
      focusMyBed: vi.fn(),
      focusBed: vi.fn(),
      setZoomMode: vi.fn(),
      setSuspended,
    },
    setSuspended,
  };
};

afterEach(() => {
  setWorldHandle(undefined);
  setWorldSuspended(false);
});

describe('世界层的暂停请求（整屏页期间整帧停渲染）', () => {
  it('世界层晚于请求才注册：注册那一刻补上当前的暂停态', () => {
    const { handle, setSuspended } = fakeWorld();

    setWorldSuspended(true);
    setWorldHandle(handle);

    expect(setSuspended).toHaveBeenCalledTimes(1);
    expect(setSuspended).toHaveBeenCalledWith(true);
  });

  it('同一状态重复请求：每次都转发（去重在世界层，界面层不丢调用）', () => {
    const { handle, setSuspended } = fakeWorld();

    setWorldHandle(handle);
    setSuspended.mockClear();
    setWorldSuspended(false);
    setWorldSuspended(false);

    expect(setSuspended).toHaveBeenCalledTimes(2);
    expect(setSuspended).toHaveBeenNthCalledWith(1, false);
    expect(setSuspended).toHaveBeenNthCalledWith(2, false);
  });
});
