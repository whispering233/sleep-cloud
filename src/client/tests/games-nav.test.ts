import { afterEach, describe, expect, it, vi } from 'vitest';

import { back, depth, levelOf, onPop, pushLevel } from '../nav';

/** `history.state` 与 `popstate` 里出现的那份东西；大厅层是 `null` */
type FakeState = { sc: string; level: string } | null;

/**
 * 假 history：单测跑在 Node 上（没有 `history` / `window`），压栈与弹栈都走这一份。
 * `go` 直接通知 `popstate` 订阅者，于是 `back()` 之后发生的事与浏览器里一致。
 */
function fakeHistory() {
  const entries: FakeState[] = [null];
  let index = 0;
  const listeners = new Set<(event: { state: FakeState }) => void>();
  return {
    goCalls: 0,
    get state(): FakeState {
      return entries[index];
    },
    pushState(state: FakeState) {
      entries.length = index + 1;
      entries.push(state);
      index += 1;
    },
    replaceState(state: FakeState) {
      entries[index] = state;
    },
    go(steps: number) {
      this.goCalls += 1;
      index += steps;
      for (const listener of listeners) listener({ state: entries[index] });
    },
    addEventListener(type: string, listener: (event: { state: FakeState }) => void) {
      if (type === 'popstate') listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: { state: FakeState }) => void) {
      if (type === 'popstate') listeners.delete(listener);
    },
  };
}

describe('levelOf（docs/design/140-games-page.md §2：唯一状态来源的映射）', () => {
  it('真值表：本模块的标记 → 层级，其余一律 undefined（= 大厅）', () => {
    const cases: [unknown, string][] = [
      [null, 'undefined'],
      [undefined, 'undefined'],
      ['sc.games', 'undefined'],
      [42, 'undefined'],
      [{}, 'undefined'],
      [{ level: 'list' }, 'undefined'],
      [{ sc: 'lot', level: 'list' }, 'undefined'],
      [{ sc: 'games' }, 'undefined'],
      [{ sc: 'games', level: 'hall' }, 'undefined'],
      [{ sc: 'games', level: 'list' }, 'list'],
      [{ sc: 'games', level: 'game' }, 'game'],
    ];
    for (const [state, expected] of cases) {
      expect([state, levelOf(state)]).toEqual([state, expected === 'undefined' ? undefined : expected]);
    }
  });
});

describe('返回栈（一层一条，压与退严格配对）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('压两层后 back() 一次到 list、再一次到 null', () => {
    const fake = fakeHistory();
    vi.stubGlobal('history', fake);
    vi.stubGlobal('window', fake);
    const seen: (string | undefined)[] = [];
    const off = onPop((level) => seen.push(level));

    pushLevel('list');
    pushLevel('game');
    expect(depth()).toBe(2);

    back(0); // 0 层不弹栈：`history.go(0)` 是刷新
    expect(fake.goCalls).toBe(0);

    back();
    expect(seen).toEqual(['list']);
    back();
    expect(seen).toEqual(['list', undefined]);
    expect(depth()).toBe(0);
    expect(levelOf(fake.state)).toBeUndefined();
    expect(fake.goCalls).toBe(2);

    off();
  });
});
