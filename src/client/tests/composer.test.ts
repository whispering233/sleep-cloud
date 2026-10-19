import { describe, expect, it } from 'vitest';

import { composerReducer, type ComposerEvent, type ComposerState } from '../composer';

const EVENTS: ComposerEvent[] = [{ kind: 'focus-in' }, { kind: 'exit' }, { kind: 'lost-focus' }, { kind: 'offline' }];
const EXIT_EVENT_KINDS = new Set(['exit', 'lost-focus', 'offline']);

/** 长度 1..maxLength 的全部事件序列（长度 4 的正好 4^4 = 256 条）。 */
function sequences(maxLength: number): ComposerEvent[][] {
  let layer: ComposerEvent[][] = [[]];
  const all: ComposerEvent[][] = [];
  for (let length = 1; length <= maxLength; length += 1) {
    layer = layer.flatMap((prefix) => EVENTS.map((event) => [...prefix, event]));
    all.push(...layer);
  }
  return all;
}

function run(events: ComposerEvent[]): ComposerState {
  return events.reduce<ComposerState>((state, event) => composerReducer(state, event), 'idle');
}

describe('输入会话状态机', () => {
  it('穷举长度 ≤ 4 的全部序列：出现过任一次退出类事件之后状态必为 idle', () => {
    const all = sequences(4);
    expect(all).toHaveLength(4 + 16 + 64 + 256);
    for (const events of all) {
      const exitAt = events.findIndex((event) => EXIT_EVENT_KINDS.has(event.kind));
      if (exitAt < 0) continue;
      // 剪到第一次退出为止就必须回到 idle（幂等的前半句）
      expect(run(events.slice(0, exitAt + 1))).toBe('idle');
      // 终态只由最后一个事件决定：退出类 → idle，focus-in → typing
      expect(run(events)).toBe(events[events.length - 1].kind === 'focus-in' ? 'typing' : 'idle');
    }
  });

  it('任意状态都有一条到 idle 的路（没有死状态）：存在某个事件一步到 idle', () => {
    for (const state of ['idle', 'typing'] as ComposerState[]) {
      expect(EVENTS.some((event) => composerReducer(state, event) === 'idle')).toBe(true);
    }
  });

  it('四条真实路径：聚焦后三种退场都回 idle，重复退出幂等', () => {
    expect(run([{ kind: 'focus-in' }, { kind: 'exit' }])).toBe('idle');
    expect(run([{ kind: 'focus-in' }, { kind: 'lost-focus' }])).toBe('idle');
    expect(run([{ kind: 'focus-in' }, { kind: 'offline' }])).toBe('idle');
    expect(run([{ kind: 'exit' }, { kind: 'exit' }, { kind: 'exit' }])).toBe('idle');
  });

  it('idle 收到 focus-in 才进 typing，其余事件保持 idle', () => {
    expect(composerReducer('idle', { kind: 'focus-in' })).toBe('typing');
    expect(composerReducer('typing', { kind: 'focus-in' })).toBe('typing');
    expect(composerReducer('idle', { kind: 'exit' })).toBe('idle');
    expect(composerReducer('idle', { kind: 'lost-focus' })).toBe('idle');
    expect(composerReducer('idle', { kind: 'offline' })).toBe('idle');
  });

  it('reducer 是纯函数：同一输入两次调用结果相同', () => {
    for (const state of ['idle', 'typing'] as ComposerState[]) {
      for (const event of EVENTS) {
        expect(composerReducer(state, event)).toBe(composerReducer(state, event));
      }
    }
  });
});
