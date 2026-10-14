import { beforeEach, describe, expect, it } from 'vitest';

import type { SnapshotMessage } from '../../shared/protocol';
import { CHAT_LOG_MAX, EMOTE_MS } from '../../shared/constants';
import {
  applyBed,
  applyChat,
  applyEmote,
  applyJoin,
  applyLeave,
  applyPos,
  applySnapshot,
  applyState,
  applyWhisper,
  clearSelection,
  getState,
  selectPerson,
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

describe('客户端聊天消息', () => {
  it('追加时固化名字：发送者随后离开，那一行的名字不变', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_other', text: '我也睡不着', ts: 1_000_200 });
    expect(getState().messages[0]).toMatchObject({ name: '阿夜', text: '我也睡不着', own: false, kind: 'chat' });

    applyLeave({ t: 'leave', id: 'u_other' });
    expect(getState().people.has('u_other')).toBe(false);
    expect(getState().messages[0]?.name).toBe('阿夜');
  });

  it('自己的消息 own 为真，名字取自 me', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_me', text: '有人吗', ts: 1_000_200 });
    expect(getState().messages[0]).toMatchObject({ name: '我', own: true });
  });

  it('超过上限只保留最后 N 条，最旧的被丢掉', () => {
    applySnapshot(snapshot());
    for (let n = 0; n < CHAT_LOG_MAX + 3; n += 1) {
      applyChat({ t: 'chat', id: 'u_other', text: `第 ${n} 条`, ts: 1_000_200 + n });
    }

    const messages = getState().messages;
    expect(messages).toHaveLength(CHAT_LOG_MAX);
    expect(messages[0]?.text).toBe('第 3 条');
    expect(messages[messages.length - 1]?.text).toBe(`第 ${CHAT_LOG_MAX + 2} 条`);
  });
});

describe('选中态', () => {
  it('全局唯一：选了 A 再选 B 只剩 B', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    expect(getState().selectedId).toBe('u_other');

    selectPerson('u_me');
    expect(getState().selectedId).toBe('u_me');
  });

  it('点 × 取消选中', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    clearSelection();
    expect(getState().selectedId).toBeUndefined();
  });

  it('选中对象离开大厅 → 一并取消选中（气泡不能留在空气里）', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    applyLeave({ t: 'leave', id: 'u_other' });
    expect(getState().selectedId).toBeUndefined();
  });

  it('别人离开不影响我的选中态', () => {
    applySnapshot(snapshot());
    applyJoin({ t: 'join', id: 'u_third', name: '第三人', appearance: 'a3', state: 'roaming', x: 2, y: 2 });
    selectPerson('u_other');
    applyLeave({ t: 'leave', id: 'u_third' });
    expect(getState().selectedId).toBe('u_other');
  });

  it('快照重来以新快照为准：选中态被清掉', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    applySnapshot(snapshot());
    expect(getState().selectedId).toBeUndefined();
  });
});

describe('客户端私聊', () => {
  it('追加时固化名字：发送者随后离开，那一行的名字不变', () => {
    applySnapshot(snapshot());
    applyWhisper({ t: 'whisper', fromId: 'u_other', toId: 'u_me', text: '睡了吗', ts: 1_000_300 });
    expect(getState().messages[0]).toMatchObject({
      id: 'u_other',
      name: '阿夜',
      text: '睡了吗',
      own: false,
      kind: 'whisper',
    });

    applyLeave({ t: 'leave', id: 'u_other' });
    expect(getState().messages[0]?.name).toBe('阿夜');
  });

  it('收到的与发出的都进同一条消息流：自己的 own 为真、名字取 me', () => {
    applySnapshot(snapshot());
    applyWhisper({ t: 'whisper', fromId: 'u_me', toId: 'u_other', text: '我睡不着', ts: 1_000_300 });
    expect(getState().messages[0]).toMatchObject({ id: 'u_me', name: '我', own: true, kind: 'whisper' });
  });

  it('与全局消息共用同一条流，并按同一上限截断', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_other', text: '大家好', ts: 1_000_200 });
    applyWhisper({ t: 'whisper', fromId: 'u_other', toId: 'u_me', text: '只给你', ts: 1_000_300 });
    expect(getState().messages.map((line) => line.kind)).toEqual(['chat', 'whisper']);

    for (let n = 0; n < CHAT_LOG_MAX; n += 1) {
      applyWhisper({ t: 'whisper', fromId: 'u_other', toId: 'u_me', text: `私聊 ${n}`, ts: 1_000_400 + n });
    }
    expect(getState().messages).toHaveLength(CHAT_LOG_MAX);
  });
});

describe('客户端表情', () => {
  it('写入显示到期的时刻：约等于现在 + EMOTE_MS', () => {
    const before = Date.now();
    applyEmote({ t: 'emote', id: 'u_other', emoteId: 'wave' });
    const emote = getState().emotes.get('u_other');
    expect(emote?.emoteId).toBe('wave');
    expect(Math.abs((emote?.expiresAt ?? 0) - (before + EMOTE_MS))).toBeLessThanOrEqual(100);
  });

  it('同一个人后来的表情覆盖前一条（不堆叠）', () => {
    applyEmote({ t: 'emote', id: 'u_other', emoteId: 'wave' });
    const first = getState().emotes.get('u_other')?.expiresAt ?? 0;
    applyEmote({ t: 'emote', id: 'u_other', emoteId: 'hug' });
    expect(getState().emotes.size).toBe(1);
    expect(getState().emotes.get('u_other')?.emoteId).toBe('hug');
    expect(getState().emotes.get('u_other')?.expiresAt).toBeGreaterThanOrEqual(first);
  });

  it('快照重来清空表情（重连以新快照为准）', () => {
    applyEmote({ t: 'emote', id: 'u_other', emoteId: 'zzz' });
    applySnapshot(snapshot());
    expect(getState().emotes.size).toBe(0);
  });

  it('发过表情的人离开大厅后，不该再留着他的表情', () => {
    applyEmote({ t: 'emote', id: 'u_other', emoteId: 'wave' });
    expect(getState().emotes.has('u_other')).toBe(true);

    applyLeave({ t: 'leave', id: 'u_other' });
    expect(getState().emotes.has('u_other')).toBe(false);
  });
});
