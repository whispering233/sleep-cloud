import { PROBE_TIMEOUT_MS, RECONNECT_BACKOFF_MS } from '../shared/constants';

/**
 * 客户端连接态与它的迁移规则：**纯函数**，时间一律由入参 `now` 传入。
 * 这里不 import WebSocket / DOM / React，也不起任何计时器——计时器全在 `ws.ts` 的连接管理器里，
 * 它只负责「什么时候问这些函数」，判据都在这里（可单测）。
 *
 * 三态语义见 `docs/api/20-api-ws.md` §5.1：`connecting` = 建连/重连中（还没收到 `snapshot`）、
 * `online` = 已收到 `snapshot`、`offline` = 探活超时或收到 `close` / `error`。
 * 它**只是渲染层的显示态**，与「人在不在场」（服务端的事实）无关。
 */
export type Connection = 'connecting' | 'online' | 'offline' | 'halted';

/**
 * 停住的三种原因（`close` 的 `reason` 语义，见 `docs/api/20-api-ws.md` §5.1.1）：
 * `blocked` = 命中封禁、`replaced` = 同一身份在别处打开了新连接、`stale` = 布局版本不符。
 */
export type HaltReason = 'blocked' | 'replaced' | 'stale';

export interface ConnState {
  connection: Connection;
  /** 连续失败的连接次数：退避取 `backoffMs(failures)`，收到 `snapshot` 后归零。 */
  failures: number;
  /** 已发出、还在等 `pong` 的探活时刻（本地时钟）；`undefined` = 没有在飞的探活。 */
  probeSentAt?: number;
  /** 有值 = 已停住：**不再自动重连**，恢复只有刷新页面。 */
  halt?: HaltReason;
}

/** 进厅的起点：正在建第一条连接。 */
export function initialConnState(): ConnState {
  return { connection: 'connecting', failures: 0 };
}

/** 开始建连（首次或重连）：任何一条新连接都从 `connecting` 起，并丢掉上一条连接的在飞探活。 */
export function connecting(state: ConnState): ConnState {
  return { ...state, connection: 'connecting', probeSentAt: undefined };
}

/** 收到 `snapshot` = 真的通了：三态归 `online`，退避归零。 */
export function online(): ConnState {
  return { connection: 'online', failures: 0 };
}

/**
 * `close` 的 `reason` → 停止重连的原因；`undefined` = 按退避重连。
 * **必须看 `reason` 而不是 `code`**：`replaced` 用的就是 `1000`（正常关闭），只看 code 会把
 * 「被顶掉」当成断网，两个标签页互相顶、各自无限重连（见 `docs/api/20-api-ws.md` §5.1.1）。
 */
export function haltReasonOf(reason: string): HaltReason | undefined {
  if (reason === 'blocked') return 'blocked';
  if (reason === 'replaced') return 'replaced';
  if (reason === '2003') return 'stale';
  return undefined;
}

/**
 * 停住：不再自动重连（退避计时器由调用方清掉）。它**不可逆**——`connecting` / `online` / `offline`
 * 都不会从它转回去，恢复只能刷新页面。
 */
export function halted(state: ConnState, reason: HaltReason): ConnState {
  return { connection: 'halted', failures: state.failures, halt: reason };
}

/** 探活超时，或收到 `close` / `error`：三态归 `offline`，退避进一档（封顶末档，永不放弃）。 */
export function offline(state: ConnState): ConnState {
  return { connection: 'offline', failures: Math.min(state.failures + 1, RECONNECT_BACKOFF_MS.length) };
}

/** 发出一次探活：记下时刻，`PROBE_TIMEOUT_MS` 内没有 `pong` 就判死。 */
export function probing(state: ConnState, now: number): ConnState {
  return { ...state, probeSentAt: now };
}

/**
 * 收到 `pong`：这次探活结束。
 * **任何「关于自己的下行」都不算**——`ping` 要的是「探测路径当前通不通」，别人的聊天挡不住它。
 */
export function settled(state: ConnState): ConnState {
  return state.probeSentAt === undefined ? state : { ...state, probeSentAt: undefined };
}

/** 在飞的探活是否已经超时（没有在飞探活时恒为假）。 */
export function probeTimedOut(state: ConnState, now: number): boolean {
  return state.probeSentAt !== undefined && now - state.probeSentAt >= PROBE_TIMEOUT_MS;
}

/** 第 `failures` 次失败之后要等多久（超出末档就夹在末档：可以一直等下去，但不再等得更久）。 */
export function backoffMs(failures: number): number {
  const index = Math.min(Math.max(failures - 1, 0), RECONNECT_BACKOFF_MS.length - 1);
  return RECONNECT_BACKOFF_MS[index] as number;
}

/**
 * 该不该发起一次重连尝试：页面 hidden 期间不试（省电，回到前台由探活接手）；
 * `connecting` 期间不试（一次只允许一条连接在飞）；停住之后**恒不试**。
 */
export function shouldReconnect(state: ConnState, hidden: boolean): boolean {
  return !hidden && state.halt === undefined && state.connection === 'offline';
}
