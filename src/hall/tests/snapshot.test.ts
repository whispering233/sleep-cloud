import { describe, expect, it } from 'vitest';

import { HALLS } from '../../shared/hall-registry';
import type { ConnectionState } from '../connection';
import { buildSnapshot, splitLive } from '../snapshot';
import type { TracePersonRow } from '../snapshot';

const HALL = HALLS[0];

function connection(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    userId: 'u_me',
    name: '我',
    appearance: 'a1',
    timezone: 'Asia/Shanghai',
    x: 1,
    y: 1,
    state: 'roaming',
    ready: true,
    ...overrides,
  };
}

function traceRow(overrides: Partial<TracePersonRow> = {}): TracePersonRow {
  return { bedNo: 5, userId: 'u_trace', name: '夜猫', appearance: 'a2', ...overrides };
}

describe('快照组装', () => {
  it('自己在 me 里，不出现在 people 里', () => {
    const snapshot = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 1,
      me: connection(),
      myOwnedBedNo: null,
      others: [],
      ownedBeds: [],
      traceRows: [],
    });

    expect(snapshot.me).toMatchObject({ id: 'u_me', name: '我', state: 'roaming' });
    expect(snapshot.people).toEqual([]);
    expect(snapshot.hall).toEqual({
      id: HALL.id,
      name: HALL.name,
      timezone: HALL.timezone,
      capacity: HALL.capacity,
      online: 1,
    });
    expect(snapshot.sceneGuid).toBe(HALL.sceneGuid);
  });

  it('睡痕条目来自数据库行：名字与外观取快照值，带 bedNo', () => {
    const snapshot = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 1,
      me: connection(),
      myOwnedBedNo: null,
      others: [],
      ownedBeds: [5],
      traceRows: [traceRow()],
    });

    expect(snapshot.people).toEqual([{ id: 'u_trace', name: '夜猫', appearance: 'a2', state: 'trace', bedNo: 5 }]);
    expect(snapshot.ownedBeds).toEqual([5]);
  });

  it('库里外观值不合法时回落到按标识推导', () => {
    const snapshot = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 1,
      me: connection(),
      myOwnedBedNo: null,
      others: [],
      ownedBeds: [5],
      traceRows: [traceRow({ appearance: 'nope' })],
    });

    const person = snapshot.people[0];
    expect(person?.state).toBe('trace');
    expect(['a1', 'a2', 'a3']).toContain(person?.appearance);
  });

  it('已经在线的睡痕行不重复出现（在线连接是更新的真相）', () => {
    const snapshot = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 2,
      me: connection(),
      myOwnedBedNo: null,
      others: [connection({ userId: 'u_trace', state: 'roaming' })],
      ownedBeds: [5],
      traceRows: [traceRow()],
    });

    expect(snapshot.people).toEqual([
      { id: 'u_trace', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1 },
    ]);
  });

  it('卧室里的在线者带床号、不带坐标', () => {
    const snapshot = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 2,
      me: connection(),
      myOwnedBedNo: null,
      others: [connection({ userId: 'u_sleeper', state: 'asleep', bedNo: 7 })],
      ownedBeds: [],
      traceRows: [],
    });

    expect(snapshot.people[0]).toEqual({
      id: 'u_sleeper',
      name: '我',
      appearance: 'a1',
      state: 'asleep',
      bedNo: 7,
    });
  });
});

describe('在线人数与别人的列表', () => {
  const ready = connection({ userId: 'u_ready' });
  const notReady = connection({ userId: 'u_not_ready', ready: false });

  it('自己只计数、不进 others；未握手的连接不算数（自己不会算两次）', () => {
    expect(
      splitLive([
        { self: true, connection: ready },
        { self: false, connection: ready },
        { self: false, connection: notReady },
        { self: false, connection: null },
      ]),
    ).toEqual({ online: 2, others: [ready] });

    expect(splitLive([{ self: true, connection: ready }])).toEqual({ online: 1, others: [] });
  });

  it('空厅是 0 人', () => {
    expect(splitLive([])).toEqual({ online: 0, others: [] });
  });
});

describe('自己的归属位', () => {
  it('有床时 me 带 ownedBedNo；没有床时不带这个字段', () => {
    const withBed = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 1,
      me: connection({ state: 'roaming' }),
      myOwnedBedNo: 42,
      others: [],
      ownedBeds: [42],
      traceRows: [],
    });
    expect(withBed.me).toMatchObject({ id: 'u_me', state: 'roaming', ownedBedNo: 42 });

    const withoutBed = buildSnapshot({
      hall: HALL,
      serverTs: 1000,
      online: 1,
      me: connection({ state: 'roaming' }),
      myOwnedBedNo: null,
      others: [],
      ownedBeds: [],
      traceRows: [],
    });
    expect('ownedBedNo' in withoutBed.me).toBe(false);
  });
});
