import { APPEARANCES } from '../shared/protocol';
import { UPSTREAM_TYPES } from '../shared/protocol';
import type { Appearance, Person, UpstreamMessage, UpstreamType } from '../shared/protocol';
import type { ErrorCode } from '../shared/error-code';
import { isWalkable, nearestStreetPoint } from '../shared/layout';
import type { Point } from '../shared/layout';
import type { RateWindow } from './rate-limit';

/**
 * 一条连接上的附加数据（存 WebSocket 的 attachment，跨休眠存活，见 `10-hall-runtime.md` §2）。
 * 位置、路径这类高频量只放这里，不落库：**醒着的人一定有活着的连接**。
 *
 * 坐标一律是**世界像素**（可能是小数）——格模型已删除（见 `docs/design/20-layout.md` §4）。
 */
export interface ConnectionState {
  userId: string;
  name: string;
  appearance: Appearance;
  /** 当前位置（世界像素） */
  x: number;
  y: number;
  /** 在床上时才有 */
  bedNo?: number;
  state: 'roaming' | 'lying' | 'asleep';
  /**
   * 正在走向的目标点（走完就清空）。
   * 路径本身**不存这里**：附件体积要小，而且路径能由街网确定性重算（见 `pathfinding.ts`）。
   */
  target?: Point;
  /** 复合意图：走到目的地之后要做什么（「点床 = 走过去 + 躺下」就靠它） */
  arrivalAction?: 'lie';
  /** 到达后要躺的那张床 */
  arrivalBedNo?: number;
  /** 最后一次输入的时刻：自动睡着由它推导（读取时推导，不挂定时器） */
  lastInputAt: number;
  /** 完成 `hello` 握手之前，不向该连接转发任何房间消息 */
  ready: boolean;
  /**
   * 上行限流的固定窗口计数（见 `rate-limit.ts`）。放附件里是因为它必须**跨休眠存活**：
   * 另开一张内存表会在对象被驱逐后清零，限流就被绕过了。
   */
  rate?: RateWindow;
}

/** 外观由用户标识推导：**没选过形象的人**由它决定，同一个人每次进来长得一样。 */
export function appearanceFor(userId: string): Appearance {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + (char.codePointAt(0) as number)) >>> 0;
  return APPEARANCES[hash % APPEARANCES.length] as Appearance;
}

/**
 * 新意图覆盖当前路径。**到达后动作属于上一个意图，必须一并清掉**：
 * 点床（`arrivalAction = 'lie'`）后、走到之前又点了地面，如果只把 `target` 换掉，走完还是会躺到那张床上
 * （见 `hall.ts` 的 `startWalking` 与 `tick` 的到达分支）。
 */
export function retarget(connection: ConnectionState, target: Point | undefined): ConnectionState {
  return { ...connection, target, arrivalAction: undefined, arrivalBedNo: undefined };
}

/**
 * 位置恢复：把落在街网**之外**的权威位置拉回街上，否则这个人再也走不动（服务端只校验、不吸附
 * 「意图」；这是恢复，不是对意图的吸附）。降级之后旧外圈落在墙外，就靠它拉回来。
 */
export function recoveredPosition(connection: ConnectionState, bedCount: number): ConnectionState {
  if (isWalkable(connection.x, connection.y, bedCount)) return connection;
  const recovered = nearestStreetPoint({ x: connection.x, y: connection.y }, bedCount);
  return recovered ? { ...connection, x: recovered.x, y: recovered.y } : connection;
}

/**
 * 降级之前对一条连接做的事（见 `docs/design/10-hall-runtime.md` §8）：把位置拉回街网，
 * 并**清掉他正在走的那条路径**——那条路径是按旧几何算的，会把他带出墙外。落地状态是「停在街网上」。
 */
export function recoverForShrink(connection: ConnectionState, bedCount: number): ConnectionState {
  return retarget(recoveredPosition(connection, bedCount), undefined);
}

/** 连接 → 协议里「一个人」的条目（在床上带床号，否则带世界像素坐标）。 */
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
  appearance: 'x-sleep-appearance',
} as const;

/**
 * 身份头里的形象：合法值照用，**缺失或非法一律回落到 `appearanceFor(userId)`**。
 * 客户端能伪造这个头没用——它由 Worker 依据验签后的会话写入（与昵称同处）。
 */
export function appearanceFromHeader(raw: string | null | undefined, userId: string): Appearance {
  return APPEARANCES.find((value) => value === raw) ?? appearanceFor(userId);
}

/**
 * 显示态的**推导**（正确性的真正来源，见 `10-hall-runtime.md` §4.3）：
 * 在床上清醒且无输入**满**阈值 → 睡着。边界与到期事件一致（`>=`，两边都算「到点」），
 * 否则闹钟到点的那一刻推导会判成「还没到」，白白丢掉这次唤醒。
 * 定时器只负责「让在看的人及时看到」，不负责正确性。
 */
export function deriveDisplayState(
  connection: ConnectionState,
  now: number,
  autoSleepMs: number,
): ConnectionState['state'] {
  if (connection.state === 'lying' && now - connection.lastInputAt >= autoSleepMs) return 'asleep';
  return connection.state;
}

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
 * 握手门槛（见 `docs/api/20-api-ws.md` §2）：首条必须是 `hello`，布局版本必须一致。
 * 在此之前发业务消息 → `2004`；版本不符 → `2003`。两者都要断开。
 *
 * 校验的对象是**布局版本号**而不是场景标识：几何由共享的纯函数生成，没有场景文件可校验
 * （见 `docs/design/config.md` §1）。
 */
export function guardIncoming(connection: ConnectionState, raw: string, layoutVersion: string): IncomingVerdict {
  const message = parseUpstream(raw);
  if (!message) return { kind: 'ignore' };

  if (message.t === 'hello') {
    if (connection.ready) return { kind: 'ignore' };
    return message.layoutVersion === layoutVersion ? { kind: 'hello' } : { kind: 'reject', code: '2003' };
  }

  if (!connection.ready) return { kind: 'reject', code: '2004' };
  return { kind: 'business', message };
}