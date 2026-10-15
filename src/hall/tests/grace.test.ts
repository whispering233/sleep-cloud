import { describe, expect, it } from 'vitest';

import { GRACE_MS } from '../../shared/constants';
import { graceVerdict } from '../grace';
import type { OccupiedBedRow } from '../grace';

const NOW = 1_000_000;

function row(overrides: Partial<OccupiedBedRow> = {}): OccupiedBedRow {
  return {
    bedNo: 3,
    state: 'lying',
    ownerUserId: 'u_a',
    ownerName: '甲',
    ownerAppearance: 'boy',
    lastSeenAt: NOW - 1000,
    ...overrides,
  };
}

describe('宽限判定（床位推导）', () => {
  it('人还在线 → online（不推导、不动库）', () => {
    expect(graceVerdict(row(), new Set(['u_a']), NOW)).toBe('online');
  });

  it('离线但宽限没到 → waiting（床位保持占用，人还留在 people 里）', () => {
    expect(graceVerdict(row({ lastSeenAt: NOW - GRACE_MS + 1 }), new Set(), NOW)).toBe('waiting');
  });

  it('边界：正好满宽限 → expired', () => {
    expect(graceVerdict(row({ lastSeenAt: NOW - GRACE_MS }), new Set(), NOW)).toBe('expired');
    expect(graceVerdict(row({ lastSeenAt: NOW - GRACE_MS - 1 }), new Set(), NOW)).toBe('expired');
  });

  it('没有最后在线时刻的历史行按 waiting 处理（宁可晚判成睡痕，不可误伤）', () => {
    expect(graceVerdict(row({ lastSeenAt: null }), new Set(), NOW)).toBe('waiting');
  });
});
