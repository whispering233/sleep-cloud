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

/** 段内状态：只看段里最后一个非焦点事件（`focus-in` 不换主体，只把 `read` 降成 `typing`）。 */
function stateOfSegment(segment: ComposerEvent[]): ComposerState {
  const last = [...segment].reverse().find((event) => event.kind !== 'focus-in');
  if (last === undefined) return segment.length === 0 ? 'idle' : 'typing';
  if (last.kind === 'report' || last.kind === 'feedback') return last.kind;
  if (last.kind === 'read') return segment[segment.length - 1].kind === 'focus-in' ? 'typing' : 'reading';
  return 'idle';
}

/** `lost-focus` 只在**不是 `reading`** 时算退场事件（`reading` 里没有可编辑控件，没有可对的东西）。 */
function isExitEvent(event: ComposerEvent, segment: ComposerEvent[]): boolean {
  if (event.kind === 'exit' || event.kind === 'offline') return true;
  return event.kind === 'lost-focus' && stateOfSegment(segment) !== 'reading';
}

/**
 * 由序列直接推出终态（不复用 reducer，免得两边一起错）：把序列切成段，退场事件把段清空并开新段，
 * 终态就是最后一段的段内状态。
 */
function expectedState(events: ComposerEvent[]): ComposerState {
  let segment: ComposerEvent[] = [];
  for (const event of events) {
    if (isExitEvent(event, segment)) segment = [];
    // 不是退场的 `lost-focus`（只能发生在 `reading` 里）什么都不做
    else if (event.kind !== 'lost-focus') segment = [...segment, event];
  }
  return stateOfSegment(segment);
}

describe('输入会话状态机', () => {
  it('穷举长度 ≤ 4 的全部序列：退出类事件把状态清回 idle，之后再按序列重建', () => {
    const all = sequences(4);
    expect(all).toHaveLength(7 + 49 + 343 + 2401);
    for (const events of all) {
      expect(run(events)).toBe(expectedState(events));
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

  it('reading 会话：入口只有 read，焦点进输入框降级为 typing，exit / offline 回 idle', () => {
    expect(composerReducer('idle', { kind: 'read' })).toBe('reading');
    // 重复点入口不算状态变化
    expect(composerReducer('reading', { kind: 'read' })).toBe('reading');
    // 读的时候去输入就是「收起阅读」：焦点进来一律降级
    expect(run([{ kind: 'read' }, { kind: 'focus-in' }])).toBe('typing');
    // 焦点对账对 `reading` 是空操作（里面没有可编辑控件，见 `50-slot-panel.md` §附）：
    // 留着它就会在礼物托盘那颗触发源随面板卸载时把刚打开的面板当场退掉
    expect(run([{ kind: 'read' }, { kind: 'lost-focus' }])).toBe('reading');
    // 明确退场与断线照旧
    expect(run([{ kind: 'read' }, { kind: 'exit' }])).toBe('idle');
    expect(run([{ kind: 'read' }, { kind: 'offline' }])).toBe('idle');
  });

  it('reducer 是纯函数：同一输入两次调用结果相同', () => {
    for (const state of ['idle', 'typing', 'report', 'reading', 'feedback'] as ComposerState[]) {
      for (const event of EVENTS) {
        expect(composerReducer(state, event)).toBe(composerReducer(state, event));
      }
    }
  });
});
