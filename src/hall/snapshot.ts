import { APPEARANCES } from '../shared/protocol';
import type { Appearance, Person, SelfPerson, SnapshotMessage } from '../shared/protocol';
import type { HallConfig } from '../shared/hall-registry';
import { appearanceFor, personFromConnection } from './connection';
import type { ConnectionState } from './connection';

/** 睡痕行（`state = 'trace'` 的床位行）：人已经离线，名字只能来自数据库快照。 */
export interface TracePersonRow {
  bedNo: number;
  userId: string;
  name: string | null;
  appearance: string | null;
}

/** 床上但人已离线、**还在宽限期内**的一行：睡痕还没到，照样留在一个 `people` 条目里。 */
export interface OfflineOccupantRow extends TracePersonRow {
  state: 'lying' | 'asleep';
}

export interface SnapshotInput {
  hall: HallConfig;
  serverTs: number;
  online: number;
  me: ConnectionState;
  /** 我拥有的那张床（归属）；还没有床时是 `null` */
  myOwnedBedNo: number | null;
  /** 其它在线连接（**不含自己**） */
  others: ConnectionState[];
  /** 床上、人已离线但还在宽限期内的占用者（没有连接 → 只能查库） */
  offlineOccupants: OfflineOccupantRow[];
  /** 归属表：所有有主的床的床号 */
  ownedBeds: number[];
  traceRows: TracePersonRow[];
}

/** 自己的条目：比 `people` 里多一个归属位（走路时也要知道哪张床是我的）。 */
function selfPerson(connection: ConnectionState, myOwnedBedNo: number | null): SelfPerson {
  const person: SelfPerson = personFromConnection(connection);
  if (myOwnedBedNo !== null) person.ownedBedNo = myOwnedBedNo;
  return person;
}

function personFromRow(row: TracePersonRow, state: 'lying' | 'asleep' | 'trace'): Person {
  const stored = row.appearance as Appearance | null;
  return {
    id: row.userId,
    name: row.name ?? '',
    appearance: stored && APPEARANCES.includes(stored) ? stored : appearanceFor(row.userId),
    state,
    bedNo: row.bedNo,
  };
}

/**
 * 「在线人数」的定义**只有这一处**：按 `userId` 去重的、已握手（ready）的连接数。
 *
 * 为什么按人去重、而不直接数连接：同一个人开新标签页时，旧连接由服务端 `close()`，但平台的
 * `getWebSockets()` 要等关闭事件派发后才摘掉它——那段窗口里数连接会把同一个人算两次，
 * 而且没有后续消息会纠正它（旧连接的 close 处理以为自己被顶掉，直接早退、不发 `leave`）。
 * 未握手的连接不算数（还没向厅里宣布自己）。
 */
export function onlineCountOf(live: ReadonlyArray<{ connection: ConnectionState | null }>): number {
  const ids = new Set<string>();
  for (const item of live) {
    if (item.connection?.ready) ids.add(item.connection.userId);
  }
  return ids.size;
}

/**
 * 把活着的连接分成「在线人数」与「别人的列表」：
 * 人数口径与 `onlineCountOf` 共用同一份实现；自己只计数、不进 `people`（自己在 `me` 里）。
 *
 * `selfId` 用来排掉**同一个人的其它连接**（开新标签页时旧连接还没被平台摘掉）：
 * 不排掉的话新快照的 `people` 里会出现一条 id 就是自己的条目，而且没有后续消息能纠正它
 * （旧连接的 close 会早退不发 `leave`，`join` 只发给别人，客户端对 `id === me.id` 的 `state` 也不动 `people`）。
 */
export function splitLive(
  live: Array<{ self: boolean; connection: ConnectionState | null }>,
  selfId?: string,
): { online: number; others: ConnectionState[] } {
  const others: ConnectionState[] = [];
  const seen = new Set<string>();
  for (const item of live) {
    const connection = item.connection;
    if (!connection?.ready || item.self || connection.userId === selfId) continue;
    if (seen.has(connection.userId)) continue; // 同一个人的旧连接只留一条
    seen.add(connection.userId);
    others.push(connection);
  }
  return { online: onlineCountOf(live), others };
}

/**
 * 生成全量快照（见 `docs/api/20-api-ws.md` §4.1）。
 *
 * 两个正交维度在这里合流：归属走 `ownedBeds`（有主的床，不带名字），占用走 `people`（含睡痕条目）。
 * **已经在线的睡痕行不再重复出现在 `people` 里**——在线连接是更新的真相。
 *
 * `people` 必须覆盖**每一个占用者**，睡痕与宽限中的床上离线者都没有连接，因此只能查库补录。
 */
export function buildSnapshot(input: SnapshotInput): SnapshotMessage {
  const connected = new Set([input.me.userId, ...input.others.map((other) => other.userId)]);

  return {
    t: 'snapshot',
    sceneGuid: input.hall.sceneGuid,
    serverTs: input.serverTs,
    hall: {
      id: input.hall.id,
      name: input.hall.name,
      timezone: input.hall.timezone,
      capacity: input.hall.capacity,
      online: input.online,
    },
    me: selfPerson(input.me, input.myOwnedBedNo),
    ownedBeds: input.ownedBeds,
    people: [
      ...input.others.map(personFromConnection),
      ...input.offlineOccupants.map((row) => personFromRow(row, row.state)),
      ...input.traceRows.filter((row) => !connected.has(row.userId)).map((row) => personFromRow(row, 'trace')),
    ],
  };
}
