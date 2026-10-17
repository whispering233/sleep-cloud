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
  it('各项都从状态里取：床号（归属，**显示值**）、在线人数、空床、延迟', () => {
    // 空床 = 床位数 − 归属数：114 张床里只有表里的这几张有主
    expect(hudViewOf(stateWith({ ownedBeds: new Set([42]) }))).toEqual({
      bedNo: 43,
      online: 37,
      emptyBeds: BED_COUNT - 1,
      rttMs: undefined,
    });
  });

  it('床号是显示值 = 内部床号 + 1：内部 0 显示 1，还没有床时不换算', () => {
    const me = stateWith().me as NonNullable<ClientState['me']>;
    expect(hudViewOf(stateWith({ me: { ...me, ownedBedNo: 0 } })).bedNo).toBe(1);
    expect(hudViewOf(stateWith({ me: { ...me, ownedBedNo: 116 } })).bedNo).toBe(117);
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
    expect(view.bedNo).toBe(43);
  });

  it('快照还没到（没有厅）时在线人数与空床都是 undefined', () => {
    const view = hudViewOf(stateWith({ hall: undefined }));
    expect(view.online).toBeUndefined();
    expect(view.emptyBeds).toBeUndefined();
  });

  it('空床 = 床位数 − 归属数（占用与睡痕不占名额）', () => {
    expect(hudViewOf(stateWith({ ownedBeds: new Set([0, 42, 113]) }))).toMatchObject({ emptyBeds: BED_COUNT - 3 });
  });

  it('没有任何归属时空床等于床位数：刚开厅、一个新来的人就是看到这个数', () => {
    expect(hudViewOf(stateWith({ ownedBeds: new Set() }))).toMatchObject({ emptyBeds: BED_COUNT });
  });

  it('字段变了才算变化：逐个字段改一处都判为变化', () => {
    const base = hudViewOf(stateWith());

    const otherOnline = hudViewOf(stateWith({ hall: { bedCount: BED_COUNT, online: 38 } }));
    const otherBed = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430, ownedBedNo: 43 } }),
    );
    const noBed = hudViewOf(
      stateWith({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430 } }),
    );
    const noHall = hudViewOf(stateWith({ hall: undefined }));

    expect(sameHudView(base, base)).toBe(true);
    for (const other of [otherOnline, otherBed, noBed, noHall]) {
      expect(sameHudView(base, other)).toBe(false);
    }
  });

  it('延迟变了才算变化：`rttMs` 变化会换视图对象，没样本（undefined）也是一步', () => {
    const noSample = hudViewOf(stateWith());
    const sampled = hudViewOf(stateWith({ rttMs: 120 }));

    expect(noSample.rttMs).toBeUndefined();
    expect(sampled.rttMs).toBe(120);
    expect(sameHudView(noSample, sampled)).toBe(false);
    expect(sameHudView(sampled, hudViewOf(stateWith({ rttMs: 121 })))).toBe(false);
    expect(sameHudView(sampled, hudViewOf(stateWith({ rttMs: 120 })))).toBe(true);
  });

  it('空床变了才算变化：归属集合大小变化会换视图对象', () => {
    const base = hudViewOf(stateWith({ ownedBeds: new Set([42]) }));
    expect(sameHudView(base, hudViewOf(stateWith({ ownedBeds: new Set([42, 43]) })))).toBe(false);
    expect(sameHudView(base, hudViewOf(stateWith({ ownedBeds: new Set([43]) })))).toBe(true);
  });

  it('方位字形变了才算变化：离屏时补字形，回到视野内（undefined）再收掉', () => {
    const offScreen = hudViewOf(stateWith({ bedDirection: 'nw' }));
    expect(offScreen.bedDirection).toBe('nw');
    expect(sameHudView(offScreen, hudViewOf(stateWith({ bedDirection: 'nw' })))).toBe(true);
    expect(sameHudView(offScreen, hudViewOf(stateWith({ bedDirection: 's' })))).toBe(false);
    expect(sameHudView(offScreen, hudViewOf(stateWith()))).toBe(false);
  });

  it('改名不换视图：HUD 不显示昵称，昵称变化不该触发重渲染', () => {
    const base = hudViewOf(stateWith());
    const renamed = hudViewOf(
      stateWith({
        me: { id: 'u_me', name: '我改名了', appearance: 'boy', state: 'roaming', x: 812.5, y: 430, ownedBedNo: 42 },
      }),
    );
    expect(sameHudView(base, renamed)).toBe(true);
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
    expect(hudViewOf(getState())).toMatchObject({ bedNo: 43, online: 36 });
  });
});
