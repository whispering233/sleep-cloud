/**
 * 大厅 WebSocket 协议的共享类型。**与 `docs/api/20-api-ws.md` 一致**，由单元测试比对文档强制保证。
 *
 * 上行是意图，下行是事实（见 `docs/design/architecture.md` §2.1）。所有坐标都是**世界像素**。
 */

import type { ErrorCode } from './error-code';

/** 人物显示态（主体是「一个人」）。`roaming` 不写进数据库。 */
export type PersonState = 'roaming' | 'lying' | 'asleep' | 'trace';

/** 小人外观（两种）：**入场层自己选**；没选的按 `user_id` 派生（见 `docs/api/20-api-ws.md` §3.1）。 */
export const APPEARANCES = ['boy', 'girl'] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** 「人在哪」：不在床上带坐标（世界像素），在床上带床号（位置就是他的床）。 */
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

/** 厅的事实：床位数是**运行时事实**（级表伸缩），不是在厅配置里读来的。**没有厅名、没有时区**。 */
export interface HallInfo {
  bedCount: number;
  online: number;
}

// ————————————————————————— 下行（服务端 → 客户端） —————————————————————————

export interface SnapshotMessage {
  t: 'snapshot';
  /** 布局版本号：客户端据此自检几何是否与本机一致（几何是程序化生成的，没有场景文件） */
  layoutVersion: string;
  serverTs: number;
  hall: HallInfo;
  me: SelfPerson;
  /** 归属位图（base64）：第 `bedNo` 位为 1 表示该床有主。**不带名字**（名字全部来自 `people`） */
  ownedBeds: string;
  /** 可见的人，含睡痕条目（名字取自 `bed.owner_name` 快照） */
  people: Person[];
}

/**
 * `online` 是**服务端算出来的事实**（**按用户去重后的**已握手人数），客户端从 `people` 推导不出来：
 * `people` 里既有睡痕（人已离线），也有床上断线、还在宽限期内的人——两者都不是在线。
 * 所以它只挂在会改变它的三条下行消息上（见 `docs/api/20-api-ws.md` §4）。
 */
export type JoinMessage = { t: 'join'; online: number } & Person;

export interface LeaveMessage {
  t: 'leave';
  id: string;
  online: number;
}

/** 某人显示态变化：躺下、起床、睡着、变成睡痕、睡痕恢复。不携带名字与外观。 */
export type StateMessage = { t: 'state'; id: string; online: number } & PersonPlacement;

/** 位置节拍（每 100 ms 一条，已合并）：`[用户id, x, y]`，世界像素。 */
export interface PosMessage {
  t: 'pos';
  ts: number;
  items: Array<[id: string, x: number, y: number]>;
}

/** 床位归属变化：认领（`owned: true`）或归属被释放（`owned: false`）。 */
export interface BedMessage {
  t: 'bed';
  bedNo: number;
  owned: boolean;
}

/** 床位伸缩：升级（外圈加床）或降级（砍掉最外圈）。归属位图与占用都不需要跟着变。 */
export interface ResizeMessage {
  t: 'resize';
  bedCount: number;
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

export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  /** 封禁（`5002`）的到期时刻（epoch 毫秒）；`null` = 永久。其余错误码不带。 */
  untilAt?: number | null;
}

/** 探活回执：只回给发出 `ping` 的那条连接（不广播）。`ts` 是服务端回执时刻。 */
export interface PongMessage {
  t: 'pong';
  ts: number;
}

export type DownstreamMessage =
  | SnapshotMessage
  | JoinMessage
  | LeaveMessage
  | StateMessage
  | PosMessage
  | BedMessage
  | ResizeMessage
  | ChatMessage
  | WhisperMessage
  | ErrorMessage
  | PongMessage;

// ————————————————————————— 上行（客户端 → 服务端） —————————————————————————

interface UpstreamPayloads {
  /** 握手。必须是首条消息，携带布局版本号。 */
  hello: { layoutVersion: string };
  /**
   * 探活：服务端只回一条 `pong`。**不是输入**——不刷新 `lastInputAt`（躺在床上的人探活时不会把
   * 自动睡着往后推）；**与业务意图共用** §7 的 5 条/秒窗口，超限时**静默丢弃**（不回 `4002`：
   * 探活会唤醒对象，不能变成绕过限流的口子）。见 `docs/api/20-api-ws.md` §3 / §7。
   */
  ping: Record<string, never>;
  /** 「我要去这个世界像素点」。服务端校验它在街网上；不在就回 `3006`，不吸附。 */
  walk: { x: number; y: number };
  /**
   * 「**一跳**」= 直接把我放到某张床**脚前的走道中心**（不寻路、不推进）。
   * **不带 `bedNo` = 我自己那张床**（没有归属时静默忽略）；带上 = 那张床的脚前——**与归属和占用无关**。
   * 在床上则先起身（保留归属）；床号越界（`3001`）时静默忽略。
   */
  hop: { bedNo?: number };
  /** 「我要躺这张床」= 走过去 + 躺下的复合意图；该床可认领时同时完成认领。 */
  lie: { bedNo: number };
  rise: Record<string, never>;
  sleep: Record<string, never>;
  chat: { text: string };
  whisper: { toId: string; text: string };
  /**
   * 举报当前选中的那个人（不要求在线）。事由**不过内容过滤**，只有运维看得到，打码会把要说的事毁掉。
   * 落库（含 24 小时内并入重复）后回 `5003`；空事由 / 举报自己 → `4003`，超长 → `4001`。
   */
  report: { toId: string; reason: string };
  /**
   * 一条反馈 / 建议。**不要求联系方式和回复**：落 `feedback` 表（`user_id` + 正文 + 时刻），
   * 不走内容过滤（只有运维看得到）。成功回 `5004`（唯一的确认信号）；空 → `4003`、超长 → `4001`、
   * 同一身份滚动 24 小时超过 `FEEDBACK_DAILY_MAX` → `4004`（可见）。
   */
  feedback: { text: string };
}

export type UpstreamType = keyof UpstreamPayloads;

export type UpstreamMessage = {
  [K in UpstreamType]: { t: K } & UpstreamPayloads[K];
}[UpstreamType];

/** 运行时可枚举的上行类型名（顺序与 `docs/api/20-api-ws.md` §3 表格一致）。 */
export const UPSTREAM_TYPES = [
  'hello',
  'ping',
  'walk',
  'hop',
  'lie',
  'rise',
  'sleep',
  'chat',
  'whisper',
  'report',
  'feedback',
] as const satisfies readonly UpstreamType[];

/** 运行时可枚举的下行类型名（顺序与 `docs/api/20-api-ws.md` §4 表格一致）。 */
export const DOWNSTREAM_TYPES = [
  'snapshot',
  'join',
  'leave',
  'state',
  'pos',
  'bed',
  'resize',
  'chat',
  'whisper',
  'error',
  'pong',
] as const satisfies readonly DownstreamMessage['t'][];

// ————————————————————————— 归属位图 —————————————————————————

/**
 * 归属位图编解码（见 `docs/api/20-api-ws.md` §4.2）：第 `bedNo` 位为 1 表示该床有主。
 *
 * 为什么不是床号数组：床位数会长到 9558，数组约 50 KB JSON，位图 `ceil(9558/8) = 1195` 字节
 * （base64 后约 1.6 KB）。字节数由 `bedCount` 定，`bedNo ≥ bedCount` 的位无意义。
 */
export function encodeOwnedBeds(bedNos: Iterable<number>, bedCount: number): string {
  const bytes = new Uint8Array(Math.ceil(bedCount / 8));
  for (const bedNo of bedNos) {
    if (!Number.isInteger(bedNo) || bedNo < 0 || bedNo >= bedCount) continue;
    const byte = bytes[bedNo >> 3] as number;
    bytes[bedNo >> 3] = byte | (1 << (bedNo & 7));
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 位图 → 有主的床号（升序）。`bedCount` 之外的位一律忽略。 */
export function decodeOwnedBeds(encoded: string, bedCount: number): number[] {
  const binary = atob(encoded);
  const bedNos: number[] = [];
  for (let index = 0; index < binary.length; index += 1) {
    const byte = binary.charCodeAt(index);
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte & (1 << bit)) === 0) continue;
      const bedNo = index * 8 + bit;
      if (bedNo < bedCount) bedNos.push(bedNo);
    }
  }
  return bedNos;
}