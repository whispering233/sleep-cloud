import { describe, expect, it } from 'vitest';

import type { BedRow } from '../bed-store';
import { checkLie, lieVerdictFor } from '../bed-rules';

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
  capacity: 256,
  inBed: false,
  userId: 'u_me',
  bed: bed(),
  ...overrides,
});

describe('躺下的四重校验', () => {
  it('空床可以躺，并且要认领归属', () => {
    expect(checkLie(input())).toEqual({ ok: true, claiming: true });
  });

  it('自己的床（空着）可以躺，不需要再认领', () => {
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_me', ownerName: '我' }) }))).toEqual({ ok: true, claiming: false });
  });

  it('床号越界 → 3001', () => {
    expect(checkLie(input({ bedNo: -1 }))).toEqual({ ok: false, code: '3001' });
    expect(checkLie(input({ bedNo: 256 }))).toEqual({ ok: false, code: '3001' });
    expect(checkLie(input({ bedNo: 1.5 }))).toEqual({ ok: false, code: '3001' });
    expect(checkLie(input({ bed: undefined }))).toEqual({ ok: false, code: '3001' });
  });

  it('已经躺在床上 → 3004', () => {
    expect(checkLie(input({ inBed: true }))).toEqual({ ok: false, code: '3004' });
  });

  it('床被占用（有人或睡痕）→ 3002', () => {
    expect(checkLie(input({ bed: bed({ state: 'lying', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ state: 'asleep', ownerUserId: 'u_me' }) }))).toEqual({ ok: false, code: '3002' });
    expect(checkLie(input({ bed: bed({ state: 'trace', ownerUserId: 'u_other' }) }))).toEqual({ ok: false, code: '3002' });
  });

  it('床属于别人 → 3003', () => {
    expect(checkLie(input({ bed: bed({ ownerUserId: 'u_other', ownerName: '别人' }) }))).toEqual({ ok: false, code: '3003' });
  });

  it('优先级：已在床上先报 3004，而不是去挑床的毛病', () => {
    expect(lieVerdictFor(input({ inBed: true, bed: bed({ state: 'lying', ownerUserId: 'u_other' }) }))).toEqual({
      ok: false,
      code: '3004',
    });
  });
});
