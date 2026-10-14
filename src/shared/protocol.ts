/**
 * 大厅 WebSocket 协议的共享类型。**与 `docs/api/20-api-ws.md` 一致**，由单元测试比对文档强制保证。
 *
 * 上行是意图，下行是事实（见 `docs/design/architecture.md` §2.1）。
 */

import type { ErrorCode } from './error-code';

/** 人物显示态（主体是「一个人」）。`roaming` 不写进数据库。 */
export type PersonState = 'roaming' | 'lying' | 'asleep' | 'trace';

/** 小人外观（第一版固定几种；不提供用户选择入口）。 */
export const APPEARANCES = ['a1', 'a2', 'a3'] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** 表情枚举（第一版固定几个；非法值静默丢弃）。 */
export const EMOTE_IDS = ['wave', 'zzz', 'heart', 'cry', 'hug'] as const;
export type EmoteId = (typeof EMOTE_IDS)[number];

/** 朝向：0 下 / 1 左 / 2 上 / 3 右。 */
export type Facing = 0 | 1 | 2 | 3;

/** 「人在哪」：不在床上带坐标，在床上带床号（位置就是他的床）。 */
export type PersonPlacement =
  | { state: 'roaming'; x: number; y: number }
  | { state: 'lying' | 'asleep' | 'trace'; bedNo: number };

/** 厅内可见的人。三类占用者（走动的、床上在线的、睡痕）用同一结构表达。 */
export type Person = { id: string; name: string; appearance: Appearance } & PersonPlacement;

/**
 * 自己的完整状态：比 `people` 条目多一个**归属位**。
 *
 * 归属与占用是两个正交维度：在床上时 `bedNo` 是「我占着哪张床」；
 * 而在厅里走动时，客户端仍必须知道「哪张床是我的」才能画暖灯标记，所以归属单独给一个字段。
 */
export type SelfPerson = Person & { ownedBedNo?: number };

// ————————————————————————— 下行（服务端 → 客户端） —————————————————————————

export interface HallInfo {
  id: string;
  name: string;
  timezone: string;
  capacity: number;
  online: number;
}

export interface SnapshotMessage {
  t: 'snapshot';
  sceneGuid: string;
  serverTs: number;
  hall: HallInfo;
  me: SelfPerson;
  /** 归属表：所有有主的床的床号。**不带名字**（名字全部来自 `people`）。 */
  ownedBeds: number[];
  /** 可见的人，含睡痕条目（名字取自 `bed.owner_name` 快照）。 */
  people: Person[];
}

export type JoinMessage = { t: 'join' } & Person;

export interface LeaveMessage {
  t: 'leave';
  id: string;
}

/** 某人显示态变化：躺下、起床、睡着、变成睡痕、睡痕恢复。不携带名字与外观。 */
export type StateMessage = { t: 'state'; id: string } & PersonPlacement;

/** 位置节拍（每 100 ms 一条，已合并）：`[用户id, x, y, 朝向]`。 */
export interface PosMessage {
  t: 'pos';
  ts: number;
  items: Array<[id: string, x: number, y: number, facing: Facing]>;
}

/** 床位归属变化：认领（`owned: true`）或 30 天未出现后释放（`owned: false`）。 */
export interface BedMessage {
  t: 'bed';
  bedNo: number;
  owned: boolean;
}

export interface ChatMessage {
  t: 'chat';
  id: string;
  text: string;
  ts: number;
}

export interface WhisperMessage {
  t: 'whisper';
  fromId: string;
  toId: string;
  text: string;
  ts: number;
}

export interface EmoteMessage {
  t: 'emote';
  id: string;
  emoteId: EmoteId;
}

export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
}

export type DownstreamMessage =
  | SnapshotMessage
  | JoinMessage
  | LeaveMessage
  | StateMessage
  | PosMessage
  | BedMessage
  | ChatMessage
  | WhisperMessage
  | EmoteMessage
  | ErrorMessage;

// ————————————————————————— 上行（客户端 → 服务端） —————————————————————————

export interface UpstreamPayloads {
  /** 握手。必须是首条消息。 */
  hello: { sceneGuid: string; tz?: string };
  /** 「我要去这一格」。会覆盖当前路径；目标为当前格时视为原地不动。 */
  walk: { x: number; y: number };
  /** 「我要躺这张床」= 走过去 + 躺下的复合意图；该床尚未被认领时同时完成认领。 */
  lie: { bedNo: number };
  rise: Record<string, never>;
  sleep: Record<string, never>;
  chat: { text: string };
  whisper: { toId: string; text: string };
  emote: { id: EmoteId };
}

export type UpstreamType = keyof UpstreamPayloads;

export type UpstreamMessage = {
  [K in UpstreamType]: { t: K } & UpstreamPayloads[K];
}[UpstreamType];

/** 运行时可枚举的上行类型名（顺序与 `docs/api/20-api-ws.md` §3 表格一致）。 */
export const UPSTREAM_TYPES = [
  'hello',
  'walk',
  'lie',
  'rise',
  'sleep',
  'chat',
  'whisper',
  'emote',
] as const satisfies readonly UpstreamType[];

/** 运行时可枚举的下行类型名（顺序与 `docs/api/20-api-ws.md` §4 表格一致）。 */
export const DOWNSTREAM_TYPES = [
  'snapshot',
  'join',
  'leave',
  'state',
  'pos',
  'bed',
  'chat',
  'whisper',
  'emote',
  'error',
] as const satisfies readonly DownstreamMessage['t'][];
