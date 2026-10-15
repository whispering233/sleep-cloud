import { describe, expect, it } from 'vitest';

import { LAYOUT_VERSION } from '../../shared/layout';
import { encodeOwnedBeds } from '../../shared/protocol';
import type { Person, SnapshotMessage } from '../../shared/protocol';
import { AMBIENCE_TIME_CONSTANT_MS, ambienceColor, approachColor, drowsinessOf } from '../ambience';
import { applyPos, applySnapshot, applyState, getState } from '../store';
import type { ClientState } from '../store';

const FLOOR = 0x0e1526; // primary
const FLOOR_DIM = 0x080d18; // primary-dim

const person = (id: string, state: Person['state'], bedNo?: number): Person =>
  state === 'roaming'
    ? { id, name: id, appearance: 'boy', state, x: 0, y: 0 }
    : { id, name: id, appearance: 'boy', state, bedNo: bedNo ?? 0 };

const stateWith = (input: { me?: ClientState['me']; people?: Person[]; online?: number }): Pick<ClientState, 'people' | 'me' | 'hall'> => ({
  me: input.me ?? { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 0, y: 0 },
  people: new Map((input.people ?? []).map((p) => [p.id, p])),
  hall: { bedCount: 114, online: input.online ?? 1 },
});

describe('全厅困倦度', () => {
  it('空厅（没有在线也没有睡痕）兜底最亮档：不把画面压暗', () => {
    expect(drowsinessOf(stateWith({ online: 0 }))).toBe(0);
  });

  it('只有我醒着 → 0；只有我睡着了 → 1', () => {
    expect(drowsinessOf(stateWith({ online: 1 }))).toBe(0);
    expect(
      drowsinessOf(stateWith({ online: 1, me: { id: 'u_me', name: '我', appearance: 'boy', state: 'asleep', bedNo: 1 } })),
    ).toBe(1);
  });

  it('lying（睁眼躺着）不算困倦——那正是「睡不着的人」', () => {
    expect(
      drowsinessOf(stateWith({ online: 1, me: { id: 'u_me', name: '我', appearance: 'boy', state: 'lying', bedNo: 1 } })),
    ).toBe(0);
  });

  it('分子含睡痕、分母是「在线 + 睡痕」：1 人睡着 + 1 条睡痕、在线 3 → 0.5', () => {
    expect(
      drowsinessOf(
        stateWith({ online: 3, people: [person('u_a', 'asleep', 2), person('u_b', 'trace', 3), person('u_c', 'roaming')] }),
      ),
    ).toBe(0.5);
  });

  it('全部离线只留睡痕时趋近最暗档（分母不为 0）', () => {
    expect(drowsinessOf(stateWith({ online: 0, people: [person('u_a', 'trace', 2), person('u_b', 'trace', 3)] }))).toBe(1);
  });

  it('夹在 0~1（在线人数少于睡着人数这种反常输入也不越界）', () => {
    const value = drowsinessOf(stateWith({ online: 1, people: [person('u_a', 'asleep', 2), person('u_b', 'asleep', 3)] }));
    expect(value).toBe(1);
  });
});

describe('氛围色', () => {
  it('两端与中点：t=0 是最亮档、t=1 是最暗档、t=0.5 是两者的整数中点', () => {
    expect(ambienceColor(FLOOR, FLOOR_DIM, 0)).toBe(FLOOR);
    expect(ambienceColor(FLOOR, FLOOR_DIM, 1)).toBe(FLOOR_DIM);
    expect(ambienceColor(FLOOR, FLOOR_DIM, 0.5)).toBe(0x0b111f); // (11,17,31)
  });

  it('越界的 t 被夹住', () => {
    expect(ambienceColor(FLOOR, FLOOR_DIM, -3)).toBe(FLOOR);
    expect(ambienceColor(FLOOR, FLOOR_DIM, 9)).toBe(FLOOR_DIM);
  });

  it('靠近：相等时不动；朝目标单调靠近；约一个时间常数后走完大部分', () => {
    expect(approachColor(FLOOR, FLOOR, 16)).toBe(FLOOR);
    const afterOneFrame = approachColor(FLOOR, FLOOR_DIM, 16);
    expect(afterOneFrame).not.toBe(FLOOR);
    expect(afterOneFrame).not.toBe(FLOOR_DIM);

    let value = FLOOR;
    for (let i = 0; i < 90; i += 1) value = approachColor(value, FLOOR_DIM, 16); // ≈1.5s @60fps
    expect(value).toBe(FLOOR_DIM);
  });

  it('帧率无关：同一段时间里「一大步」与「多步小走」最终都落到目标色', () => {
    const coarse = approachColor(FLOOR, FLOOR_DIM, AMBIENCE_TIME_CONSTANT_MS * 4);
    let fine = FLOOR;
    for (let i = 0; i < 120; i += 1) fine = approachColor(fine, FLOOR_DIM, 16); // ≈1.9s @60fps
    expect(coarse).toBe(FLOOR_DIM);
    expect(fine).toBe(FLOOR_DIM);
  });
});

describe('store 里的重算时机', () => {
  const snapshot = (): SnapshotMessage => ({
    t: 'snapshot',
    layoutVersion: LAYOUT_VERSION,
    serverTs: 1_000_000,
    hall: { bedCount: 114, online: 2 },
    me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 0, y: 0 },
    ownedBeds: encodeOwnedBeds([], 114),
    people: [{ id: 'u_a', name: '阿夜', appearance: 'girl', state: 'asleep', bedNo: 2 }],
  });

  it('快照与 state 消息会重算困倦度（1 人睡着、在线 2 → 0.5）', () => {
    applySnapshot(snapshot());
    expect(getState().drowsiness).toBe(0.5);

    applyState({ t: 'state', id: 'u_a', online: 2, state: 'roaming', x: 10, y: 10 });
    expect(getState().drowsiness).toBe(0);
  });

  it('位置节拍不重算：pos 只动 motion，困倦度保持原值', () => {
    applySnapshot(snapshot());
    const before = getState().drowsiness;
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_a', 40, 40]] });
    expect(getState().drowsiness).toBe(before);
  });
});