import { describe, expect, it } from 'vitest';

import { HALL_LEVELS } from '../../shared/layout';
import type { BedRow } from '../bed-store';
import { checkLie, lieVerdictFor } from '../bed-rules';

/** 前两档的容量由级表推导（`docs/design/20-layout.md` §3.1）。 */
const FIRST = (HALL_LEVELS[0] as { capacity: number }).capacity;
const SECOND = (HALL_LEVELS[1] as { capacity: number }).capacity;

const bed = (overrides: Partial<BedRow> = {}): BedRow => ({
  bedNo: 7,
  state: 'empty',
  ownerUserId: null,
  ownerName: null,
  ownerAppearance: null,
  ...overrides,
});

const input = (overrides: Partial<Parameters<typeof checkLie>[0]> = {}) => ({
  bedNo: 7,
  bedCount: FIRST,
  inBed: false,
  userId: 'u_me',
  bed: bed(),
  ...overrides,
});

describe('躺下的五重校验', () => {
  it('空床可以躺，并且要认领归属', () => {
    expect(checkLie(input())).toEqual({ ok: true, claiming: true });
  });

  it('自己的床（空着）可以躺，不需要再认领', () => {
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_me', ownerName: '我' }) }))).toEqual({ ok: true, claiming: false });
  });

  it('床号越界（≥ 当前 bedCount）→ 3001；降级后旧外圈的床号也算越界', () => {
    expect(checkLie(input({ bedNo: -1 }))).toEqual({ ok: false, code: '3001' });
    expect(checkLie(input({ bedNo: FIRST }))).toEqual({ ok: false, code: '3001' }); // 第 2 级才有的床
    expect(checkLie(input({ bedNo: SECOND, bedCount: SECOND }))).toEqual({ ok: false, code: '3001' });
    expect(checkLie(input({ bedNo: SECOND - 1, bedCount: SECOND }))).toEqual({ ok: true, claiming: true });
    expect(checkLie(input({ bedNo: 1.5 }))).toEqual({ ok: false, code: '3001' });
  });

  it('没有行 = 无主空床（惰性行）：允许躺下并认领，不是 3001', () => {
    expect(checkLie(input({ bed: undefined }))).toEqual({ ok: true, claiming: true });
    expect(checkLie(input({ bed: undefined, bedNo: FIRST - 1 }))).toEqual({ ok: true, claiming: true });
  });

  it('已经躺在床上 → 3004', () => {
    expect(checkLie(input({ inBed: true }))).toEqual({ ok: false, code: '3004' });
  });

  it('床被占用（有人或**未过期的**睡痕）→ 3002', () => {
    expect(checkLie(input({ bed: bed({ state: 'lying', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ state: 'asleep', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ state: 'trace', ownerUserId: 'u_other' }) }))).toEqual({ ok: false, code: '3002' });
  });

  it('床属于别人（归属未过期）→ 3003', () => {
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_other', ownerName: '别人' }) }))).toEqual({ ok: false, code: '3003' });
  });

  it('过期睡痕 / 过期归属都由上游推导成「无占用、无主」，这里只看制度事实 → 可以认领', () => {
    // `bed-store.effectiveBed` 把过期睡痕算成 empty、把过期归属算成无主，取行时就已经是这个形状
    expect(checkLie(input({ bed: bed({ state: 'empty', ownerUserId: null }) }))).toEqual({ ok: true, claiming: true });
  });

  it('没有行的床 + 我已经有一张床 → 3007（一人一床对惰性行同样成立）', () => {
    expect(checkLie(input({ bed: undefined, ownedBedNo: 7 }))).toEqual({ ok: false, code: '3007' });
  });

  it('可认领的床、而我已经有一张床 → 3007（一人一床，不能换床）', () => {
    const owned = input({ bed: bed({ bedNo: 3 }), ownedBedNo: 7 });
    expect(checkLie(owned)).toEqual({ ok: false, code: '3007' });
    // 寻路到达后再校验的那条路径走同一个函数
    expect(lieVerdictFor(owned)).toEqual({ ok: false, code: '3007' });
  });

  it('目标就是自己那张 → 允许躺（不报 3007，也不再认领）', () => {
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_me', ownerName: '我' }), ownedBedNo: 7 }))).toEqual({
      ok: true,
      claiming: false,
    });
  });

  it('归属已过期（我当前没有床）→ 允许认领，不是 3007', () => {
    expect(checkLie(input({ ownedBedNo: undefined }))).toEqual({ ok: true, claiming: true });
    expect(checkLie(input({ bed: bed({ bedNo: 3 }), ownedBedNo: undefined }))).toEqual({ ok: true, claiming: true });
  });

  it('优先级：床被占用（3002）/ 属于别人（3003）都先于「我已有床」（3007）', () => {
    expect(checkLie(input({ bed: bed({ state: 'lying' }), ownedBedNo: 7 }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_other' }), ownedBedNo: 7 }))).toEqual({ ok: false, code: '3003' });
  });

  it('优先级：已在床上先报 3004，而不是去挑床的毛病', () => {
    expect(lieVerdictFor(input({ inBed: true, bed: bed({ state: 'lying', ownerUserId: 'u_other' }) }))).toEqual({
      ok: false,
      code: '3004',
    });
  });
});