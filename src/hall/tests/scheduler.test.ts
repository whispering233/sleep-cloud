import { describe, expect, it } from 'vitest';

import { createDueHeap } from '../scheduler';
import type { DueEvent } from '../scheduler';

const at = (kind: DueEvent['kind'], userId: string, time: number): DueEvent => ({ kind, userId, at: time });

describe('到期事件堆（最小堆）', () => {
  it('堆顶永远是最早的到期事件', () => {
    const heap = createDueHeap();
    heap.upsert(at('autosleep', 'u_b', 300));
    heap.upsert(at('grace', 'u_a', 100));
    heap.upsert(at('autosleep', 'u_c', 200));

    expect(heap.size).toBe(3);
    expect(heap.peek()).toEqual(at('grace', 'u_a', 100));
  });

  it('同一个主体同一类事件只保留一条（否则每句话都留一条会白醒一次的旧条目）', () => {
    const heap = createDueHeap();
    heap.upsert(at('autosleep', 'u_a', 100));
    heap.upsert(at('autosleep', 'u_a', 900));

    expect(heap.size).toBe(1);
    expect(heap.peek()).toEqual(at('autosleep', 'u_a', 900));

    // 不同类事件互不影响（同一个人可以同时有宽限与自动睡着）
    heap.upsert(at('grace', 'u_a', 500));
    expect(heap.size).toBe(2);
    expect(heap.peek()).toEqual(at('grace', 'u_a', 500));
  });

  it('改早与改晚都能落回正确位置', () => {
    const heap = createDueHeap();
    heap.upsert(at('autosleep', 'u_a', 500));
    heap.upsert(at('autosleep', 'u_b', 600));
    heap.upsert(at('autosleep', 'u_c', 700));

    heap.upsert(at('autosleep', 'u_c', 100)); // 改早 → 上浮到顶
    expect(heap.peek()).toEqual(at('autosleep', 'u_c', 100));

    heap.upsert(at('autosleep', 'u_c', 900)); // 改晚 → 沉到底
    expect(heap.peek()).toEqual(at('autosleep', 'u_a', 500));
  });

  it('移除顶部、中间与不存在的都没有问题', () => {
    const heap = createDueHeap();
    heap.upsert(at('autosleep', 'u_a', 100));
    heap.upsert(at('autosleep', 'u_b', 200));
    heap.upsert(at('autosleep', 'u_c', 300));

    heap.remove('autosleep', 'u_a');
    expect(heap.peek()).toEqual(at('autosleep', 'u_b', 200));

    heap.remove('autosleep', 'u_b');
    expect(heap.peek()).toEqual(at('autosleep', 'u_c', 300));

    heap.remove('autosleep', 'u_nobody');
    expect(heap.size).toBe(1);

    heap.remove('autosleep', 'u_c');
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
  });

  it('弹出所有已到期的事件（按时间升序），未到期的一个都不动', () => {
    const heap = createDueHeap();
    heap.upsert(at('autosleep', 'u_c', 300));
    heap.upsert(at('grace', 'u_a', 100));
    heap.upsert(at('autosleep', 'u_b', 200));
    heap.upsert(at('grace', 'u_d', 400));

    expect(heap.drainDue(200)).toEqual([at('grace', 'u_a', 100), at('autosleep', 'u_b', 200)]);
    expect(heap.size).toBe(2);
    expect(heap.peek()).toEqual(at('autosleep', 'u_c', 300));
    expect(heap.drainDue(99)).toEqual([]);
  });

  it('清空后可以重新装填（重建用）', () => {
    const heap = createDueHeap();
    heap.upsert(at('grace', 'u_a', 100));
    heap.clear();

    expect(heap.size).toBe(0);
    heap.upsert(at('grace', 'u_b', 200));
    expect(heap.peek()).toEqual(at('grace', 'u_b', 200));
  });

  it('随机增删后堆顶始终是最小值（堆性质没有在补位时被破坏）', () => {
    const heap = createDueHeap();
    const live = new Map<string, number>();
    let seed = 7;

    for (let step = 0; step < 400; step += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const userId = `u_${seed % 12}`;
      const roll = seed % 3;
      if (roll === 2) {
        heap.remove('autosleep', userId);
        live.delete(userId);
      } else {
        const time = seed % 500;
        heap.upsert(at('autosleep', userId, time));
        live.set(userId, time);
      }

      const expected = live.size === 0 ? undefined : Math.min(...live.values());
      expect(heap.size).toBe(live.size);
      expect(heap.peek()?.at).toBe(expected);
    }
  });
});
