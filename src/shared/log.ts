/**
 * 日志的单一出口（见 `docs/design/100-log.md` §4）。**任何事件只能经由这里产出。**
 *
 * 出口本身绝不抛：`Hall` 的消息主路径上抛一次就会打断整次广播，丢日志可以，丢广播不行（§1）。
 */

/** §3 事件契约：每个事件允许出现的字段。拼错的名字在这里就没有容身之地。 */
const EVENT_FIELDS = {
  enter: ['fresh', 'online'],
  lie: ['bed', 'from'],
  sleep: ['bed', 'auto'],
  wake: ['bed', 'dwellMs'],
  chat: ['len', 'dm'],
  report: ['target', 'dup'],
  block: ['until', 'by'],
  settle: ['wakes', 'traces', 'from', 'to', 'ms'],
  tick: ['online', 'used', 'beds', 'level'],
  snapshot: ['bytes', 'people', 'beds'],
  reject: ['code', 'intent'],
  censor: ['kind', 'n'],
  drop: ['kind', 'n'],
  err: ['where', 'code'],
  suppressed: ['n'],
} as const;

export type Ev = keyof typeof EVENT_FIELDS;
type Scalar = string | number | boolean;

/** 事件字段。`uid`（`userId`）是唯一允许跟随所有事件的身份字段（§3）。 */
export type Fields<E extends Ev> = { uid?: string } & {
  [K in (typeof EVENT_FIELDS)[E][number]]: Scalar;
};

/** 静默降级的四种来源（§3 的 `drop.kind`）。 */
export type DropKind = 'send' | 'skip' | 'parse' | 'limit';

/** 受闸门的四类事件（§4.3）：一分钟一共只放 30 条。 */
const GATED: ReadonlySet<Ev> = new Set(['reject', 'censor', 'drop', 'err']);

const GATE_LIMIT = 30;
const GATE_WINDOW_MS = 60_000;
const SUPPRESSED_WINDOW_MS = 5 * 60_000;
const DROP_THRESHOLD = 20;
const DROP_WINDOW_MS = 5 * 60_000;

/** 闸门与聚合只活在模块内存里：对象被驱逐就归零，它是安全网不是账本（§4.3）。 */
let gateWindowStart = 0;
let gateCount = 0;
let suppressedCount = 0;
let suppressedAt = 0;
const drops = new Map<DropKind, { n: number; since: number }>();

function write(name: Ev, fields: Record<string, Scalar>): void {
  console.log({ ev: name, ...fields });
}

function pick<E extends Ev>(name: E, fields: Fields<E>): Record<string, Scalar> {
  const kept: Record<string, Scalar> = {};
  const allowed: readonly string[] = EVENT_FIELDS[name];
  for (const key of allowed) {
    const value = (fields as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      kept[key] = value;
    }
  }
  if (typeof fields.uid === 'string') kept.uid = fields.uid;
  return kept;
}

/** 这一条能不能写；写不了就把计数留给 `suppressed`。 */
function gateOpen(now: number): boolean {
  if (now - gateWindowStart >= GATE_WINDOW_MS) {
    gateWindowStart = now;
    gateCount = 0;
  }
  if (gateCount < GATE_LIMIT) {
    gateCount += 1;
    return true;
  }
  suppressedCount += 1;
  return false;
}

/**
 * 首次超限立刻汇总一条，之后每 5 分钟最多一条。
 * shortcut: 结算只在调用到达时发生（没有定时器）, 需要准实时汇总时再引入持久唤醒或内存循环。
 */
function flushSuppressed(now: number): void {
  if (suppressedCount === 0 || now - suppressedAt < SUPPRESSED_WINDOW_MS) return;
  const n = suppressedCount;
  suppressedCount = 0;
  suppressedAt = now;
  write('suppressed', { n });
}

/** 产出一条事件：`ev` 不在表里整条丢弃，字段不在它那一列也丢弃（§4.1）。 */
export function ev<E extends Ev>(name: E, fields: Fields<E>): void {
  try {
    if (!Object.hasOwn(EVENT_FIELDS, name)) return;
    const now = Date.now();
    if (!GATED.has(name) || gateOpen(now)) write(name, pick(name, fields));
    flushSuppressed(now);
  } catch {
    // 永不抛（§4.2）：丢日志可以，丢广播不行
  }
}

/** 异常（§3 的 `err`）。 */
export function err(fields: Fields<'err'>): void {
  ev('err', fields);
}

/**
 * 静默降级（§3 的 `drop`）：单次失败不值得一条日志，按 `kind` 攒到 20 次或 5 分钟再写一条带 `n` 的（§4.4）。
 *
 * shortcut: 5 分钟那一条也要等下一次调用才结算, 有常驻定时器可用时改为按时间 flush。
 */
export function drop({ kind, n = 1 }: { kind: DropKind; n?: number }): void {
  try {
    const now = Date.now();
    const bucket = drops.get(kind) ?? { n: 0, since: now };
    bucket.n += n;
    drops.set(kind, bucket);
    if (bucket.n < DROP_THRESHOLD && now - bucket.since < DROP_WINDOW_MS) return;
    drops.delete(kind);
    ev('drop', { kind, n: bucket.n });
  } catch {
    // 永不抛（§4.2）
  }
}