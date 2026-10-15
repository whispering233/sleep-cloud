import { describe, expect, it } from 'vitest';

import { LAYOUT_VERSION } from '../../shared/layout';
import { encodeOwnedBeds } from '../../shared/protocol';
import type { SnapshotMessage } from '../../shared/protocol';
import { hudViewOf, sameHudView } from '../hud-view';
import { applyPos, applySnapshot, applyState, getState } from '../store';
import type { ClientState } from '../store';

const BED_COUNT = 114;

/** 只造 HUD 会读的那几个字段：输入面越小，「位置节拍不触发渲染」越容易验证。 */
const stateWith = (overrides: Partial<ClientState> = {}): ClientState => ({
  ...getState(),
  hall: { bedCount: BED_COUNT, online: 37 },
  me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430, ownedBedNo: 42 },
  ...overrides,
});

const snapshotWith = (
  me: ClientState['me'] = { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430, ownedBedNo: 42 },
): SnapshotMessage => ({
  t: 'snapshot',
  layoutVersion: LAYOUT_VERSION,
  serverTs: 1_000_000,
  hall: { bedCount: BED_COUNT, online: 37 },
  me,
  ownedBeds: encodeOwnedBeds(me?.ownedBedNo === undefined ? [] : [me.ownedBedNo], BED_COUNT),
  people: [{ id: 'u_other', name: '阿夜', appearance: 'girl' as const, state: 'roaming' as const, x: 300, y: 280 }],
});

describe('HUD 派生视图', () => {
  it('三项都从状态里取：自己昵称、床号（归属）、在线人数', () => {
    expect(hudViewOf(stateWith())).toEqual({ nickname: '我', bedNo: 42, online: 37 });
  });

  it('还没有床（没有 ownedBedNo）时床号是 undefined，这一项不显示', () => {
    const view = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430 } }),
    );
    expect(view.bedNo).toBeUndefined();
  });

  it('躺下不改变床号这一项：归属与占用是两个维度', () => {
    const view = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'asleep', bedNo: 42, ownedBedNo: 42 } }),
    );
    expect(view.bedNo).toBe(42);
  });

  it('快照还没到（没有厅）时在线人数是 undefined', () => {
    expect(hudViewOf(stateWith({ hall: undefined })).online).toBeUndefined();
  });

  it('字段变了才算变化：逐个字段改一处都判为变化', () => {
    const base = hudViewOf(stateWith());

    const otherOnline = hudViewOf(stateWith({ hall: { bedCount: BED_COUNT, online: 38 } }));
    const otherBed = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430, ownedBedNo: 43 } }),
    );
    const otherName = hudViewOf(
      stateWith({
        me: { id: 'u_me', name: '我改名了', appearance: 'boy', state: 'roaming', x: 812.5, y: 430, ownedBedNo: 42 },
      }),
    );
    const noBed = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430 } }),
    );
    const noHall = hudViewOf(stateWith({ hall: undefined }));

    expect(sameHudView(base, base)).toBe(true);
    for (const other of [otherOnline, otherBed, otherName, noBed, noHall]) {
      expect(sameHudView(base, other)).toBe(false);
    }
  });

  it('位置节拍不换视图：pos 只动 people / motion，HUD 读的字段一个都没变', () => {
    applySnapshot(snapshotWith());
    const before = hudViewOf(getState());

    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 306, 280]] });
    expect(sameHudView(before, hudViewOf(getState()))).toBe(true);
  });

  it('自己的状态变化照常反映：状态消息把人数一起带进来', () => {
    applySnapshot(snapshotWith({ id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430 }));

    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 36 });
    expect(hudViewOf(getState())).toMatchObject({ bedNo: 42, online: 36 });
  });
});
