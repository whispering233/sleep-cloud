import { describe, expect, it } from 'vitest';

import { dayLabel, hudViewOf, sameHudView } from '../hud-view';
import { applyPos, applySnapshot, applyState, getState } from '../store';
import type { ClientState } from '../store';

/** 只造 HUD 会读的那几个字段：输入面越小，「位置节拍不触发渲染」越容易验证。 */
const stateWith = (overrides: Partial<ClientState> = {}): ClientState => ({
  ...getState(),
  hall: { id: 'asia-1', name: '亚洲厅', timezone: 'Asia/Shanghai', capacity: 256, online: 37 },
  me: { id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1, ownedBedNo: 42 },
  ...overrides,
});

// 厅时区（Asia/Shanghai）的 12:00 与 22:00
const NOON = Date.parse('2025-06-10T04:00:00Z');
const NIGHT = Date.parse('2025-06-10T14:00:00Z');
const snapshotWith = (me: ClientState['me'] = { id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1, ownedBedNo: 42 }) => ({
  t: 'snapshot' as const,
  sceneGuid: 'dorm-asia-01',
  serverTs: 1_000_000,
  hall: { id: 'asia-1', name: '亚洲厅', timezone: 'Asia/Shanghai', capacity: 256, online: 37 },
  me,
  ownedBeds: me?.ownedBedNo === undefined ? [] : [me.ownedBedNo],
  people: [{ id: 'u_other', name: '阿夜', appearance: 'a2' as const, state: 'roaming' as const, x: 5, y: 6 }],
});

describe('HUD 派生视图', () => {
  it('五项都从状态里取：厅名、自己昵称、床号（归属）、在线人数、昼夜', () => {
    expect(hudViewOf(stateWith(), NOON)).toEqual({
      hallName: '亚洲厅',
      nickname: '我',
      bedNo: 42,
      online: 37,
      day: true,
    });
  });

  it('还没有床（没有 ownedBedNo）时床号是 undefined，这一项不显示', () => {
    const view = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1 } }),
      NOON,
    );
    expect(view.bedNo).toBeUndefined();
  });

  it('躺下不改变床号这一项：归属与占用是两个维度', () => {
    const view = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'a1', state: 'asleep', bedNo: 42, ownedBedNo: 42 } }),
      NIGHT,
    );
    expect(view.bedNo).toBe(42);
  });

  it('昼夜按厅的时区算：上海 12:00 是白天、01:00 与 22:00 是夜晚', () => {
    expect(hudViewOf(stateWith(), NOON).day).toBe(true);
    expect(hudViewOf(stateWith(), Date.parse('2025-06-09T17:00:00Z')).day).toBe(false); // 上海 01:00
    expect(hudViewOf(stateWith(), NIGHT).day).toBe(false);
    // 同一个时刻，UTC 厅与上海厅的答案不同：看的是厅的钟，不是用户的
    const evening = Date.parse('2025-06-10T10:30:00Z'); // 上海 18:30 / UTC 10:30
    expect(hudViewOf(stateWith(), evening).day).toBe(false);
    expect(
      hudViewOf(stateWith({ hall: { id: 'utc-1', name: 'UTC 厅', timezone: 'UTC', capacity: 256, online: 1 } }), evening)
        .day,
    ).toBe(true);
  });

  it('昼夜文案只有两个值', () => {
    expect(dayLabel(true)).toBe('白天');
    expect(dayLabel(false)).toBe('夜晚');
  });

  it('时间流逝本身不算变化：同一个状态往后一分钟，昼夜没翻就不换视图', () => {
    expect(sameHudView(hudViewOf(stateWith(), NOON), hudViewOf(stateWith(), NOON + 60_000))).toBe(true);
  });

  it('字段变了才算变化：逐个字段改一处都判为变化', () => {
    const base = hudViewOf(stateWith(), NOON);

    const otherOnline = hudViewOf(
      stateWith({ hall: { id: 'asia-1', name: '亚洲厅', timezone: 'Asia/Shanghai', capacity: 256, online: 38 } }),
      NOON,
    );
    const otherBed = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1, ownedBedNo: 43 } }),
      NOON,
    );
    const otherName = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我改名了', appearance: 'a1', state: 'roaming', x: 1, y: 1, ownedBedNo: 42 } }),
      NOON,
    );
    const noBed = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1 } }),
      NOON,
    );
    const noHall = hudViewOf(stateWith({ hall: undefined }), NOON);

    expect(sameHudView(base, base)).toBe(true);
    for (const other of [otherOnline, otherBed, otherName, noBed, noHall]) {
      expect(sameHudView(base, other)).toBe(false);
    }
    expect(sameHudView(base, hudViewOf(stateWith(), NIGHT))).toBe(false); // 昼夜翻面
  });

  it('位置节拍不换视图：pos 只动 people / motion，HUD 读的字段一个都没变', () => {
    applySnapshot(snapshotWith());
    const before = hudViewOf(getState(), NOON);

    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 6, 6, 0]] });
    expect(sameHudView(before, hudViewOf(getState(), NOON))).toBe(true);
  });

  it('自己的状态变化照常反映：状态消息把人数一起带进来', () => {
    applySnapshot(snapshotWith({ id: 'u_me', name: '我', appearance: 'a1', state: 'roaming', x: 1, y: 1 }));

    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 36 });
    expect(hudViewOf(getState(), NOON)).toMatchObject({ bedNo: 42, online: 36 });
  });
});