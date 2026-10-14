import { APPEARANCES } from '../shared/protocol';
import { UPSTREAM_TYPES } from '../shared/protocol';
import type { Appearance, Person, UpstreamMessage, UpstreamType } from '../shared/protocol';
import type { ErrorCode } from '../shared/error-code';

/**
 * 一条连接上的附加数据（存 WebSocket 的 attachment，跨休眠存活，见 `10-hall-runtime.md` §2）。
 * 位置、路径这类高频量只放这里，不落库：**醒着的人一定有活着的连接**。
 */
export interface ConnectionState {
  userId: string;
  name: string;
  appearance: Appearance;
  timezone: string;
  x: number;
  y: number;
  /** 在床上时才有 */
  bedNo?: number;
  state: 'roaming' | 'lying' | 'asleep';
  /**
   * 正在走向的目标格（走完就清空）。
   * 路径本身**不存这里**：附件体积要小，而且路径能由场景数据确定性重算（见 `movement.ts`）。
   */
  target?: { x: number; y: number };
  /** 完成 `hello` 握手之前，不向该连接转发任何房间消息 */
  ready: boolean;
}

/** 外观由用户标识推导：第一版不提供选择入口，但同一个人每次进来长得一样。 */
export function appearanceFor(userId: string): Appearance {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + (char.codePointAt(0) as number)) >>> 0;
  return APPEARANCES[hash % APPEARANCES.length] as Appearance;
}

/** 连接 → 协议里「一个人」的条目（在床上带床号，否则带坐标）。 */
export function personFromConnection(connection: ConnectionState): Person {
  const base = { id: connection.userId, name: connection.name, appearance: connection.appearance };
  return connection.state === 'roaming' || connection.bedNo === undefined
    ? { ...base, state: 'roaming', x: connection.x, y: connection.y }
    : { ...base, state: connection.state, bedNo: connection.bedNo };
}

/**
 * Worker → 房间服务的**内部头**：由 Worker 依据验签后的会话写入，客户端无法伪造
 * （房间服务只经由绑定调用，不从公网直接可达）。名字用 URI 编码，否则中文过不了头字段。
 */
export const IDENTITY_HEADERS = {
  userId: 'x-sleep-user-id',
  name: 'x-sleep-name',
  timezone: 'x-sleep-tz',
} as const;

export type IncomingVerdict =
  | { kind: 'ignore' }
  | { kind: 'hello' }
  | { kind: 'business'; message: UpstreamMessage }
  | { kind: 'reject'; code: ErrorCode };

/** 上行报文解析：必须带合法 `t`；非法值静默丢弃（不报错、不断开）。 */
export function parseUpstream(raw: string): UpstreamMessage | null {
  try {
    const value = JSON.parse(raw) as { t?: unknown };
    if (!value || typeof value !== 'object' || typeof value.t !== 'string') return null;
    if (!UPSTREAM_TYPES.includes(value.t as UpstreamType)) return null;
    // SAFETY: 这里只保证 `t` 是已知类型；其余字段（x / y / bedNo / text）由各意图的处理函数各自校验，
    // 不做「解析即信任」——上行永远是意图，不是事实。
    return value as unknown as UpstreamMessage;
  } catch {
    return null;
  }
}

/**
 * 握手门槛（见 `docs/api/20-api-ws.md` §2）：首条必须是 `hello`，场景标识必须一致。
 * 在此之前发业务消息 → `2004`；场景不符 → `2003`。两者都要断开。
 */
export function guardIncoming(connection: ConnectionState, raw: string, sceneGuid: string): IncomingVerdict {
  const message = parseUpstream(raw);
  if (!message) return { kind: 'ignore' };

  if (message.t === 'hello') {
    if (connection.ready) return { kind: 'ignore' };
    return message.sceneGuid === sceneGuid ? { kind: 'hello' } : { kind: 'reject', code: '2003' };
  }

  if (!connection.ready) return { kind: 'reject', code: '2004' };
  return { kind: 'business', message };
}
