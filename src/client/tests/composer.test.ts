import { describe, expect, it } from 'vitest';

import { composerReducer, type ComposerEvent, type ComposerState } from '../composer';

const EVENTS: ComposerEvent[] = [
  { kind: 'focus-in' },
  { kind: 'report' },
  { kind: 'read' },
  { kind: 'feedback' },
  { kind: 'exit' },
  { kind: 'lost-focus' },
  { kind: 'offline' },
];
const EXIT_EVENT_KINDS = new Set(['exit', 'lost-focus', 'offline']);

/** 长度 1..maxLength 的全部事件序列（7 种事件，长度 4 共 7^4 = 2401 条）。 */
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

/**
 * 由序列直接推出的终态（不复用 reducer，免得两边一起错）：
 * 先找到尾巴（最后一次退出类事件之后）里最后一个**非焦点**事件：
 * 没有就只剩 `focus-in` → `typing`；是 `report` / `feedback` → 原态（这两种会话下的 `focus-in` 不降级）；
 * 是 `read` → 后面再有 `focus-in` 就降级成 `typing`，否则停在 `reading`。
 */
function expectedState(events: ComposerEvent[]): ComposerState {
  let lastExit = -1;
  events.forEach((event, index) => {
    if (EXIT_EVENT_KINDS.has(event.kind)) lastExit = index;
  });
  const tail = events.slice(lastExit + 1);
  const lastNonFocus = [...tail].reverse().find((event) => event.kind !== 'focus-in');
  if (lastNonFocus === undefined) return tail.length === 0 ? 'idle' : 'typing';
  if (lastNonFocus.kind === 'report' || lastNonFocus.kind === 'feedback') return lastNonFocus.kind;
  return tail[tail.length - 1].kind === 'focus-in' ? 'typing' : 'reading';
}

describe('输入会话状态机', () => {
  it('穷举长度 ≤ 4 的全部序列：退出类事件把状态清回 idle，之后再按序列重建', () => {
    const all = sequences(4);
    expect(all).toHaveLength(7 + 49 + 343 + 2401);
    for (const events of all) {
      expect(run(events)).toBe(expectedState(events));
      // 剪到第一次退出为止必须已经回到 idle（幂等的前半句）
      const exitAt = events.findIndex((event) => EXIT_EVENT_KINDS.has(event.kind));
      if (exitAt >= 0) expect(run(events.slice(0, exitAt + 1))).toBe('idle');
    }
  });

  it('任意状态都有一条到 idle 的路（没有死状态）：存在某个事件一步到 idle', () => {
    for (const state of ['idle', 'typing', 'report', 'reading', 'feedback'] as ComposerState[]) {
      expect(EVENTS.some((event) => composerReducer(state, event) === 'idle')).toBe(true);
    }
  });

  it('举报入口：idle / typing 都进 report，重复点仍是 report', () => {
    expect(composerReducer('idle', { kind: 'report' })).toBe('report');
    expect(composerReducer('typing', { kind: 'report' })).toBe('report');
    expect(composerReducer('report', { kind: 'report' })).toBe('report');
  });

  it('feedback 入口：idle / typing / reading 都进 feedback，焦点进来不降级', () => {
    expect(composerReducer('idle', { kind: 'feedback' })).toBe('feedback');
    expect(composerReducer('typing', { kind: 'feedback' })).toBe('feedback');
    expect(composerReducer('reading', { kind: 'feedback' })).toBe('feedback');
    expect(run([{ kind: 'feedback' }, { kind: 'focus-in' }])).toBe('feedback');
    // 退场之后同样的事件序列才回到 typing
    expect(run([{ kind: 'feedback' }, { kind: 'exit' }, { kind: 'focus-in' }])).toBe('typing');
  });

  it('report 下 focus-in 不降级（事由框复焦不能卸掉表单）', () => {
    expect(run([{ kind: 'report' }, { kind: 'focus-in' }])).toBe('report');
    expect(run([{ kind: 'report' }, { kind: 'focus-in' }, { kind: 'focus-in' }])).toBe('report');
    // 一旦退场，同样的事件序列才回到 typing
    expect(run([{ kind: 'report' }, { kind: 'exit' }, { kind: 'focus-in' }])).toBe('typing');
  });

  it('三条真实退场：举报态下断线 / 焦点对账失败 / 收起都回 idle', () => {
    expect(run([{ kind: 'report' }, { kind: 'exit' }])).toBe('idle');
    expect(run([{ kind: 'report' }, { kind: 'lost-focus' }])).toBe('idle');
    expect(run([{ kind: 'report' }, { kind: 'offline' }])).toBe('idle');
    expect(run([{ kind: 'report' }, { kind: 'exit' }, { kind: 'exit' }])).toBe('idle');
  });

  it('idle 收到 focus-in 才进 typing，其余退场事件保持 idle', () => {
    expect(composerReducer('idle', { kind: 'focus-in' })).toBe('typing');
    expect(composerReducer('typing', { kind: 'focus-in' })).toBe('typing');
    expect(composerReducer('idle', { kind: 'exit' })).toBe('idle');
    expect(composerReducer('idle', { kind: 'lost-focus' })).toBe('idle');
    expect(composerReducer('idle', { kind: 'offline' })).toBe('idle');
  });

  it('reading 会话：入口只有 read，焦点进输入框降级为 typing，三条退场都回 idle', () => {
    expect(composerReducer('idle', { kind: 'read' })).toBe('reading');
    // 重复点入口不算状态变化
    expect(composerReducer('reading', { kind: 'read' })).toBe('reading');
    // 读的时候去输入就是「收起阅读」：焦点进来一律降级
    expect(run([{ kind: 'read' }, { kind: 'focus-in' }])).toBe('typing');
    for (const kind of EXIT_EVENT_KINDS) {
      expect(run([{ kind: 'read' }, { kind } as ComposerEvent])).toBe('idle');
    }
  });

  it('reducer 是纯函数：同一输入两次调用结果相同', () => {
    for (const state of ['idle', 'typing', 'report', 'reading', 'feedback'] as ComposerState[]) {
      for (const event of EVENTS) {
        expect(composerReducer(state, event)).toBe(composerReducer(state, event));
      }
    }
  });
});
