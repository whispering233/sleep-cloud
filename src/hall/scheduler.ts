/**
 * 到期事件调度器（见 `docs/design/10-hall-runtime.md` §4.4）。
 *
 * 平台每个对象只有**一个**持久唤醒槽位，而我们需要多个到期时刻，所以用一个按到期时间排序的
 * **内存最小堆**桥接：堆顶就是槽位该写的值。持久唤醒只负责「及时」，正确性来自读取时推导（§4.3）——
 * 因此这个堆不必持久化，对象重建时从当前连接集合与床位状态推导一遍即可（丢的只是通知）。
 */

/** 到期事件的类型：宽限到期、自动睡着到期、每日唤醒。 */
export type DueKind = 'grace' | 'autosleep' | 'daily';

export interface DueEvent {
  kind: DueKind;
  /** 关联主体（人）；每日唤醒没有主体，用空串占位 */
  userId: string;
  /** 到期时刻（epoch 毫秒） */
  at: number;
}

export interface DueHeap {
  readonly size: number;
  /** 插入或覆盖：同一个主体同一类事件**只保留一条**（新的覆盖旧的） */
  upsert(event: DueEvent): void;
  /** 移除某个主体的事件（没有就什么都不做） */
  remove(kind: DueKind, userId: string): void;
  /** 最早的到期事件 */
  peek(): DueEvent | undefined;
  /** 弹出所有已到期的事件（按时间升序） */
  drainDue(now: number): DueEvent[];
  clear(): void;
}

const keyOf = (kind: DueKind, userId: string): string => `${kind}:${userId}`;

/**
 * 每个主体每类事件只保留一条：否则「躺在床上的人每说一句话」都会留下一条旧条目，
 * 而每一条旧条目到点都会白醒一次对象——「个位数到几十次/天」的唤醒预算经不起这么花。
 */
export function createDueHeap(): DueHeap {
  const items: DueEvent[] = [];
  const index = new Map<string, number>();

  const swap = (a: number, b: number): void => {
    const left = items[a] as DueEvent;
    const right = items[b] as DueEvent;
    items[a] = right;
    items[b] = left;
    index.set(keyOf(right.kind, right.userId), a);
    index.set(keyOf(left.kind, left.userId), b);
  };

  const siftUp = (start: number): void => {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((items[parent] as DueEvent).at <= (items[i] as DueEvent).at) return;
      swap(parent, i);
      i = parent;
    }
  };

  const siftDown = (start: number): void => {
    let i = start;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < items.length && (items[left] as DueEvent).at < (items[smallest] as DueEvent).at) smallest = left;
      if (right < items.length && (items[right] as DueEvent).at < (items[smallest] as DueEvent).at) smallest = right;
      if (smallest === i) return;
      swap(smallest, i);
      i = smallest;
    }
  };

  const remove = (kind: DueKind, userId: string): void => {
    const key = keyOf(kind, userId);
    const at = index.get(key);
    if (at === undefined) return;

    const last = items.pop() as DueEvent;
    index.delete(key);
    if (at === items.length) return; // 删的正好是最后一个，不需要再补位

    items[at] = last;
    index.set(keyOf(last.kind, last.userId), at);
    siftUp(at);
    siftDown(at);
  };

  const pop = (): DueEvent | undefined => {
    const top = items[0];
    if (!top) return undefined;
    remove(top.kind, top.userId);
    return top;
  };

  return {
    get size() {
      return items.length;
    },

    upsert(event) {
      const key = keyOf(event.kind, event.userId);
      const at = index.get(key);
      if (at === undefined) {
        items.push(event);
        index.set(key, items.length - 1);
        siftUp(items.length - 1);
        return;
      }

      const previous = (items[at] as DueEvent).at;
      items[at] = event;
      if (event.at < previous) siftUp(at);
      else siftDown(at);
    },

    remove,

    peek() {
      return items[0];
    },

    drainDue(now) {
      const due: DueEvent[] = [];
      while (items.length > 0 && (items[0] as DueEvent).at <= now) {
        const event = pop();
        if (event) due.push(event);
      }
      return due;
    },

    clear() {
      items.length = 0;
      index.clear();
    },
  };
}
