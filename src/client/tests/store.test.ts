import { beforeEach, describe, expect, it } from 'vitest';

import type { SnapshotMessage } from '../../shared/protocol';
import {
  applyBed,
  applyJoin,
  applyLeave,
  applyPos,
  applySnapshot,
  applyState,
  getState,
} from '../store';

const snapshot = (overrides: Partial<SnapshotMessage> = {}): SnapshotMessage => ({
  t: 'snapshot',
  sceneGuid: 'dorm-asia-01',
  serverTs: 1_000_000,
  hall: { id: 'asia-1', name: '亚洲厅', timezone: 'Asia/Shanghai', capacity: 256, online: 2 },
  me: { id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1 },
  ownedBeds: [42],
  people: [{ id: 'u_other', name: '阿夜', appearance: 'a2', state: 'roaming', x: 5, y: 6 }],
  ...overrides,
});

beforeEach(() => {
  applySnapshot(snapshot({ ownedBeds: [], people: [] }));
});

describe('客户端状态归约', () => {
  it('快照整体覆盖，并记下与服务端的时钟偏差', () => {
    applySnapshot(snapshot());
    const state = getState();

    expect(state.connected).toBe(true);
    expect(state.sceneGuid).toBe('dorm-asia-01');
    expect(state.people.get('u_other')).toMatchObject({ name: '阿夜', x: 5, y: 6 });
    expect([...state.ownedBeds]).toEqual([42]);
    expect(state.motion.size).toBe(0);
    expect(Math.abs(state.clockOffsetMs - (1_000_000 - Date.now()))).toBeLessThan(1000);
  });

  it('join：插入条目，重复到达就覆盖（幂等），并清掉旧的插值窗口', () => {
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_new', 3, 3, 3]] });
    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'a3', state: 'roaming', x: 7, y: 8 });
    expect(getState().people.get('u_new')).toMatchObject({ name: '新来的', x: 7, y: 8 });
    expect(getState().motion.has('u_new')).toBe(false);

    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'a3', state: 'roaming', x: 9, y: 9 });
    expect(getState().people.size).toBe(1);
    expect(getState().people.get('u_new')).toMatchObject({ x: 9, y: 9 });
  });

  it('state：更新显示态、保留名字与外观，上床后不再插值', () => {
    applySnapshot(snapshot());
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 6, 6, 0]] });
    expect(getState().motion.has('u_other')).toBe(true);

    applyState({ t: 'state', id: 'u_other', state: 'asleep', bedNo: 7 });
    expect(getState().people.get('u_other')).toMatchObject({ name: '阿夜', appearance: 'a2', state: 'asleep', bedNo: 7 });
    expect(getState().motion.has('u_other')).toBe(false);
  });

  it('state：自己的状态变化也走这条消息，并补上归属位', () => {
    applySnapshot(snapshot());
    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42 });

    expect(getState().me).toMatchObject({ id: 'u_me', state: 'lying', bedNo: 42, ownedBedNo: 42 });
    expect(getState().people.has('u_me')).toBe(false); // 自己不进 people

    applyState({ t: 'state', id: 'u_me', state: 'roaming', x: 3, y: 4 });
    expect(getState().me).toMatchObject({ state: 'roaming', x: 3, y: 4, ownedBedNo: 42 }); // 归属保留
  });

  it('state：没见过的人直接忽略（等 join 或下一次快照）', () => {
    applyState({ t: 'state', id: 'u_ghost', state: 'asleep', bedNo: 9 });
    expect(getState().people.has('u_ghost')).toBe(false);
  });

  it('leave：人与插值窗口一起移除', () => {
    applySnapshot(snapshot());
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 6, 6, 0]] });
    applyLeave({ t: 'leave', id: 'u_other' });
    expect(getState().people.has('u_other')).toBe(false);
    expect(getState().motion.has('u_other')).toBe(false);
  });

  it('bed：归属集合增删（占用不走这条消息）', () => {
    applyBed({ t: 'bed', bedNo: 42, owned: true });
    expect([...getState().ownedBeds]).toEqual([42]);
    applyBed({ t: 'bed', bedNo: 42, owned: false });
    expect([...getState().ownedBeds]).toEqual([]);
    applyBed({ t: 'bed', bedNo: 42, owned: false }); // 再删一次也不炸
    expect([...getState().ownedBeds]).toEqual([]);
  });

  it('pos：没有上一个窗口时直接落位，并把权威坐标记进 people', () => {
    applySnapshot(snapshot());
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 5, 7, 0]] });
    const state = getState();
    expect(state.motion.get('u_other')).toMatchObject({ fromX: 5, fromY: 7, toX: 5, toY: 7 });
    expect(state.people.get('u_other')).toMatchObject({ x: 5, y: 7 });
  });
});
