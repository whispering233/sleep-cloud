import { beforeEach, describe, expect, it } from 'vitest';

import { LAYOUT_VERSION } from '../../shared/layout';
import { encodeOwnedBeds } from '../../shared/protocol';
import type { SnapshotMessage } from '../../shared/protocol';
import { applyPos, applySnapshot, applyState, getState } from '../store';
import type { ClientState } from '../store';
import { TONE_ALPHA, toneOf } from '../tone';

const BED_COUNT = 114;

/** 我自己的条目，默认在厅里走动。 */
const meRoaming: SnapshotMessage['me'] = {
  id: 'u_me',
  name: '我',
  appearance: 'boy',
  state: 'roaming',
  x: 812.5,
  y: 430,
  ownedBedNo: 42,
};

/** 我在自己的床上（躺下 / 睡着）：在床上时位置就是那张床，没有坐标。 */
const meInBed = (state: 'lying' | 'asleep', bedNo: number): SnapshotMessage['me'] => ({
  id: 'u_me',
  name: '我',
  appearance: 'boy',
  state,
  bedNo,
  ownedBedNo: bedNo,
});

const snapshot = (me: SnapshotMessage['me'] = meRoaming): SnapshotMessage => ({
  t: 'snapshot',
  layoutVersion: LAYOUT_VERSION,
  serverTs: 1_000_000,
  hall: { bedCount: BED_COUNT, online: 3 },
  me,
  ownedBeds: encodeOwnedBeds([42], BED_COUNT),
  people: [{ id: 'u_other', name: '阿夜', appearance: 'girl', state: 'lying', bedNo: 7 }],
});

/** 只造 `toneOf` 会读的那一个字段（`me`）：输入面越小，「档位由什么决定」越难被别的字段带偏。 */
const stateWithMe = (me: ClientState['me']): ClientState => ({ ...getState(), me });

beforeEach(() => {
  applySnapshot(snapshot());
});

describe('三档减光', () => {
  it('档 = 我自己的显示态：漫游 0、躺下 1、睡下 2', () => {
    expect(toneOf(stateWithMe(meRoaming))).toBe(0);
    expect(toneOf(stateWithMe(meInBed('lying', 42)))).toBe(1);
    expect(toneOf(stateWithMe(meInBed('asleep', 42)))).toBe(2);
  });

  it('α 按档位落：`0` / `0.12` / `0.22`（上限 0.22 由最小的字决定）', () => {
    expect(TONE_ALPHA).toEqual([0, 0.12, 0.22]);
  });

  it('躺下不是漫游：躺着的人一定比漫游暗一档', () => {
    const lying = toneOf(stateWithMe(meInBed('lying', 42)));
    expect(lying).not.toBe(toneOf(stateWithMe(meRoaming)));
    expect(TONE_ALPHA[lying]).toBeGreaterThan(TONE_ALPHA[0]);
  });

  it('快照还没到（`me` 为空）按 0：厅还没画出来，不能先暗下去', () => {
    expect(toneOf(stateWithMe(undefined))).toBe(0);
    expect(toneOf({ ...getState(), me: undefined })).toBe(0);
  });

  it('位置节拍不翻档：`applyPos` 只动位置，档位一直是我自己的显示态', () => {
    applySnapshot(snapshot(meInBed('lying', 42)));
    expect(toneOf(getState())).toBe(1);

    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_me', 812.5, 430], ['u_other', 300, 280]] });
    expect(toneOf(getState())).toBe(1);

    applyPos({ t: 'pos', ts: 1_000_200, items: [['u_me', 900, 500]] });
    expect(toneOf(getState())).toBe(1);
  });

  it('自己的状态变化跟着服务端走：躺下 → 睡着 → 起身各落一档', () => {
    applySnapshot(snapshot(meInBed('lying', 42)));
    expect(toneOf(getState())).toBe(1);

    applyState({ t: 'state', id: 'u_me', online: 3, state: 'asleep', bedNo: 42 });
    expect(toneOf(getState())).toBe(2);

    applyState({ t: 'state', id: 'u_me', online: 3, state: 'roaming', x: 812.5, y: 430 });
    expect(toneOf(getState())).toBe(0);
  });

  it('`trace` 不会出现在自己身上；真落到这条路径按 0（不发明第四档）', () => {
    const meTrace: SnapshotMessage['me'] = { id: 'u_me', name: '我', appearance: 'boy', state: 'trace', bedNo: 42 };
    expect(toneOf(stateWithMe(meTrace))).toBe(0);
  });
});
