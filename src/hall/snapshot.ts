import { APPEARANCES } from '../shared/protocol';
import type { Appearance, Person, SnapshotMessage } from '../shared/protocol';
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

export interface SnapshotInput {
  hall: HallConfig;
  serverTs: number;
  online: number;
  me: ConnectionState;
  /** 我拥有的那张床（归属）；还没有床时是 `null` */
  myOwnedBedNo: number | null;
  /** 其它在线连接（**不含自己**） */
  others: ConnectionState[];
  /** 归属表：所有有主的床的床号 */
  ownedBeds: number[];
  traceRows: TracePersonRow[];
}

function tracePerson(row: TracePersonRow): Person {
  const stored = row.appearance as Appearance | null;
  return {
    id: row.userId,
    name: row.name ?? '',
    appearance: stored && APPEARANCES.includes(stored) ? stored : appearanceFor(row.userId),
    state: 'trace',
    bedNo: row.bedNo,
  };
}

/**
 * 把活着的连接分成「在线人数」与「别人的列表」：
 * 未握手的连接不算数（还没向厅里宣布自己），自己只计数、不进 `people`（自己在 `me` 里）。
 */
export function splitLive(
  live: Array<{ self: boolean; connection: ConnectionState | null }>,
): { online: number; others: ConnectionState[] } {
  const others: ConnectionState[] = [];
  let online = 0;
  for (const item of live) {
    if (!item.connection?.ready) continue;
    online += 1;
    if (!item.self) others.push(item.connection);
  }
  return { online, others };
}

/**
 * 生成全量快照（见 `docs/api/20-api-ws.md` §4.1）。
 *
 * 两个正交维度在这里合流：归属走 `ownedBeds`（有主的床，不带名字），占用走 `people`（含睡痕条目）。
 * **已经在线的睡痕行不再重复出现在 `people` 里**——在线连接是更新的真相。
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
    me: {
      ...personFromConnection(input.me),
      ...(input.myOwnedBedNo === null ? {} : { ownedBedNo: input.myOwnedBedNo }),
    },
    ownedBeds: input.ownedBeds,
    people: [
      ...input.others.map(personFromConnection),
      ...input.traceRows.filter((row) => !connected.has(row.userId)).map(tracePerson),
    ],
  };
}
