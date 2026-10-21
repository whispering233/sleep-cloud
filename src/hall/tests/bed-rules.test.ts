import { describe, expect, it } from 'vitest';

import { BED_SWITCH_COOLDOWN_MS } from '../../shared/constants';
import { HALL_LEVELS } from '../../shared/layout';
import type { BedRow } from '../bed-store';
import { checkLie } from '../bed-rules';

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

/** 判据的时间基准：冷却全是相对时刻，用固定值免去对 `Date.now()` 的依赖。 */
const NOW = 10_000_000;
const owned = (bedNo: number, claimedAt: number | null) => ({ bedNo, claimedAt });

const input = (overrides: Partial<Parameters<typeof checkLie>[0]> = {}) => ({
  bedNo: 7,
  bedCount: FIRST,
  inBed: false,
  userId: 'u_me',
  bed: bed(),
  now: NOW,
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

  it('床被占用（有人或有睡痕）→ 3002', () => {
    expect(checkLie(input({ bed: bed({ state: 'lying', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ state: 'asleep', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ state: 'trace', ownerUserId: 'u_other' }) }))).toEqual({ ok: false, code: '3002' });
  });

  it('床属于别人（归属未过期）→ 3003', () => {
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_other', ownerName: '别人' }) }))).toEqual({ ok: false, code: '3003' });
  });

  it('过期归属由上游推导成「无主」，这里只看制度事实 → 可以认领', () => {
    // `bed-store.effectiveBed` 把过期归属算成无主，取行时就已经是这个形状
    expect(checkLie(input({ bed: bed({ state: 'empty', ownerUserId: null }) }))).toEqual({ ok: true, claiming: true });
  });

  it('冷却已过：在另一张无主床上躺下 = 换床，带上要释放的旧床号（惰性行同样成立）', () => {
    expect(checkLie(input({ bed: bed({ bedNo: 3 }), owned: owned(7, NOW - BED_SWITCH_COOLDOWN_MS - 1) }))).toEqual({
      ok: true,
      claiming: true,
      releasingBedNo: 7,
    });
    expect(checkLie(input({ bed: undefined, owned: owned(7, NOW - BED_SWITCH_COOLDOWN_MS) }))).toEqual({
      ok: true,
      claiming: true,
      releasingBedNo: 7,
    });
    // 寻路到达后再校验的那条路径走同一个函数
    expect(checkLie(input({ bed: bed({ bedNo: 3 }), owned: owned(7, NOW - 60_000) }))).toEqual({
      ok: true,
      claiming: true,
      releasingBedNo: 7,
    });
  });

  it('距上次认领不足 10 秒就再认领另一张床 → 3008（可恢复）', () => {
    expect(checkLie(input({ bed: bed({ bedNo: 3 }), owned: owned(7, NOW - 9_999) }))).toEqual({
      ok: false,
      code: '3008',
    });
    expect(checkLie(input({ bed: undefined, owned: owned(7, NOW) }))).toEqual({ ok: false, code: '3008' });
  });

  it('`claimedAt` 为空（历史行）→ 视为无冷却，不用旧数据卡住人', () => {
    expect(checkLie(input({ bed: bed({ bedNo: 3 }), owned: owned(7, null) }))).toEqual({
      ok: true,
      claiming: true,
      releasingBedNo: 7,
    });
  });

  it('目标就是自己那张 → 允许躺（不认领、也没有要释放的床）', () => {
    const verdict = checkLie(input({ bed: bed({ ownerUserId: 'u_me', ownerName: '我' }), owned: owned(7, NOW) }));
    expect(verdict).toEqual({ ok: true, claiming: false });
    expect('releasingBedNo' in verdict).toBe(false); // 躺回自己那张完全不受冷却影响
  });

  it('归属已过期（我当前没有床）→ 允许认领，不是 3008', () => {
    expect(checkLie(input({ owned: undefined }))).toEqual({ ok: true, claiming: true });
    expect(checkLie(input({ bed: bed({ bedNo: 3 }), owned: undefined }))).toEqual({ ok: true, claiming: true });
  });

  it('优先级：床被占用（3002）/ 属于别人（3003）都先于冷却（3008）', () => {
    expect(checkLie(input({ bed: bed({ state: 'lying' }), owned: owned(7, NOW) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_other' }), owned: owned(7, NOW) }))).toEqual({
      ok: false,
      code: '3003',
    });
  });

  it('优先级：已在床上先报 3004，而不是去挑床的毛病', () => {
    expect(checkLie(input({ inBed: true, currentBedNo: 7, bed: bed({ state: 'lying', ownerUserId: 'u_me' }) }))).toEqual({
      ok: false,
      code: '3004',
    });
  });
});

describe('在床上点别的床（复合意图：自动起身 → 走过去 → 躺下）', () => {
  /** 我正躺在 7 号床：`inBed` 与 `currentBedNo` 由同一条连接给出（见 `hall.ts` 的 `case 'lie'`）。 */
  const lying = (overrides: Partial<Parameters<typeof checkLie>[0]> = {}) =>
    input({ inBed: true, currentBedNo: 7, owned: owned(7, NOW - 60_000), ...overrides });

  it('① 在床上 + 另一张无主床 → 允许（换床），不是 3004', () => {
    expect(checkLie(lying({ bedNo: 3, bed: bed({ bedNo: 3 }) }))).toEqual({
      ok: true,
      claiming: true,
      releasingBedNo: 7,
    });
    // 无行同样是无主空床（惰性行）
    expect(checkLie(lying({ bedNo: 3, bed: undefined }))).toEqual({ ok: true, claiming: true, releasingBedNo: 7 });
  });

  it('② 在床上 + 自己正躺着的那张 → 3004（静默，什么都不做）', () => {
    expect(checkLie(lying({ bed: bed({ state: 'lying', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3004' });
  });

  it('③ 在床上 + 别人的床 → 3003（不是 3004）', () => {
    expect(checkLie(lying({ bedNo: 3, bed: bed({ bedNo: 3, ownerUserId: 'u_other', ownerName: '别人' }) }))).toEqual({
      ok: false,
      code: '3003',
    });
  });

  it('④ 在床上 + 占用中的床 → 3002', () => {
    expect(checkLie(lying({ bedNo: 3, bed: bed({ bedNo: 3, state: 'lying', ownerUserId: 'u_other' }) }))).toEqual({
      ok: false,
      code: '3002',
    });
  });

  it('⑤ 在床上 + 另一张无主床但冷却中 → 3008（可恢复）', () => {
    expect(
      checkLie(lying({ bedNo: 3, bed: bed({ bedNo: 3 }), owned: owned(7, NOW - 9_999) })),
    ).toEqual({ ok: false, code: '3008' });
  });
});