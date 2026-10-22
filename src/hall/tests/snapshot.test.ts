import { describe, expect, it } from 'vitest';

import { LAYOUT_VERSION } from '../../shared/layout';
import { decodeOwnedBeds } from '../../shared/protocol';
import type { Person } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { buildSnapshot, onlineCountOf, splitLive } from '../snapshot';
import type { TraceBedRow } from '../bed-store';

const BED_COUNT = 114;

function connection(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    userId: 'u_me',
    name: '我',
    appearance: 'boy',
    x: 812.5,
    y: 430,
    state: 'roaming',
    lastInputAt: 0,
    ready: true,
    ...overrides,
  };
}

function traceRow(overrides: Partial<TraceBedRow> = {}): TraceBedRow {
  return { bedNo: 5, userId: 'u_trace', name: '夜猫', appearance: 'girl', ...overrides };
}

const snapshot = (overrides: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
  buildSnapshot({
    layoutVersion: LAYOUT_VERSION,
    serverTs: 1000,
    bedCount: BED_COUNT,
    online: 1,
    me: connection(),
    myOwnedBedNo: null,
    others: [],
    ownedBeds: [],
    traceRows: [],
    offlineOccupants: [],
    ...overrides,
  });

describe('快照组装', () => {
  it('自己在 me 里，不出现在 people 里；厅只有床位数与在线人数', () => {
    const message = snapshot();

    expect(message.me).toMatchObject({ id: 'u_me', name: '我', state: 'roaming', x: 812.5, y: 430 });
    expect(message.people).toEqual([]);
    expect(message.hall).toEqual({ bedCount: BED_COUNT, online: 1 });
    expect(message.layoutVersion).toBe(LAYOUT_VERSION);
    expect(message.serverTs).toBe(1000);
  });

  it('归属走位图：解码回来就是有主的床号', () => {
    const message = snapshot({ ownedBeds: [5, 42, 113] });
    expect(typeof message.ownedBeds).toBe('string');
    expect(decodeOwnedBeds(message.ownedBeds, BED_COUNT)).toEqual([5, 42, 113]);
  });

  it('睡痕条目来自数据库行：名字与外观取快照值，带 bedNo', () => {
    const message = snapshot({ ownedBeds: [5], traceRows: [traceRow()] });

    expect(message.people).toEqual([
      { id: 'u_trace', name: '夜猫', appearance: 'girl', state: 'trace', bedNo: 5 },
    ]);
  });

  it('宽限中的床上离线者照旧是 lying/asleep（睡痕还没到，占用不能凭空消失）', () => {
    const message = snapshot({
      ownedBeds: [5],
      offlineOccupants: [{ bedNo: 5, state: 'asleep', userId: 'u_sleeper', name: '阿雅', appearance: 'girl' }],
    });

    expect(message.people).toEqual([
      { id: 'u_sleeper', name: '阿雅', appearance: 'girl', state: 'asleep', bedNo: 5 },
    ]);
  });

  it('库里外观值不合法时回落到按标识推导', () => {
    const person = snapshot({ ownedBeds: [5], traceRows: [traceRow({ appearance: 'nope' })] }).people[0];
    expect(person?.state).toBe('trace');
    expect(['boy', 'girl']).toContain(person?.appearance);
  });

  it('已经在线的睡痕行不重复出现（在线连接是更新的真相）', () => {
    const message = snapshot({
      online: 2,
      others: [connection({ userId: 'u_trace', state: 'roaming' })],
      ownedBeds: [5],
      traceRows: [traceRow()],
    });

    expect(message.people).toEqual([
      { id: 'u_trace', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430 },
    ]);
  });

  it('卧室里的在线者带床号、不带坐标', () => {
    const message = snapshot({
      online: 2,
      others: [connection({ userId: 'u_sleeper', state: 'asleep', bedNo: 7 })],
    });

    expect(message.people[0]).toEqual({
      id: 'u_sleeper',
      name: '我',
      appearance: 'boy',
      state: 'asleep',
      bedNo: 7,
    });
  });
});

describe('在线人数与别人的列表', () => {
  const ready = connection({ userId: 'u_ready' });
  const notReady = connection({ userId: 'u_not_ready', ready: false });

  it('自己只计数、不进 others；未握手的连接不算数', () => {
    const me = connection(); // 自己的 userId 是 u_me，与下面的 u_ready 不同人
    expect(
      splitLive([
        { self: true, connection: me },
        { self: false, connection: ready },
        { self: false, connection: notReady },
        { self: false, connection: null },
      ]),
    ).toEqual({ online: 2, others: [ready] });

    expect(splitLive([{ self: true, connection: me }])).toEqual({ online: 1, others: [] });
  });

  it('空厅是 0 人', () => {
    expect(splitLive([])).toEqual({ online: 0, others: [] });
  });

  it('同一个人两条连接只算一人（旧连接被顶掉前还在连接列表里）', () => {
    const older = connection({ userId: 'u_ready' });
    expect(onlineCountOf([{ connection: ready }, { connection: older }])).toBe(1);
    expect(
      splitLive([
        { self: false, connection: ready },
        { self: false, connection: older },
      ]).online,
    ).toBe(1);
  });

  it('未握手的连接不算人数', () => {
    expect(onlineCountOf([{ connection: notReady }, { connection: null }])).toBe(0);
  });

  it('同一个人的其它连接不进 others（开新标签页时旧连接还没被摘掉）', () => {
    const mine = connection(); // 自己的 userId 是 u_me
    const olderMe = connection();
    const { online, others } = splitLive(
      [
        { self: true, connection: mine },
        { self: false, connection: olderMe },
        { self: false, connection: ready },
      ],
      mine.userId,
    );
    expect(online).toBe(2);
    expect(others).toEqual([ready]);
  });

  it('别人的两条连接只进 others 一次', () => {
    const first = connection({ userId: 'u_other' });
    const second = connection({ userId: 'u_other' });
    expect(
      splitLive([
        { self: false, connection: first },
        { self: false, connection: second },
      ]).others,
    ).toEqual([first]);
  });
});

describe('自己的归属位', () => {
  it('有床时 me 带 ownedBedNo；没有床时不带这个字段', () => {
    expect(snapshot({ myOwnedBedNo: 42, ownedBeds: [42] }).me).toMatchObject({ ownedBedNo: 42 });
    expect('ownedBedNo' in snapshot().me).toBe(false);
  });
});

describe('活动声明（act）跟着快照下发', () => {
  it('在游戏页的人带 act：自己的 me 与别人的 people 条目都带', () => {
    const message = snapshot({
      me: connection({ act: 'game' }),
      others: [connection({ userId: 'u_other', act: 'game' })],
    });

    expect(message.me.act).toBe('game');
    expect(message.people[0]).toMatchObject({ id: 'u_other', act: 'game' });
  });

  it('在看厅（字段省略）：me 与 people 都没有 act 键', () => {
    const message = snapshot({ others: [connection({ userId: 'u_other' })] });

    expect('act' in message.me).toBe(false);
    expect('act' in (message.people[0] as Person)).toBe(false);
  });
});
