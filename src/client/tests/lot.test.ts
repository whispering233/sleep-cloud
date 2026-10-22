import { describe, expect, it } from 'vitest';

import { LOT_POOL_SIZE, LOT_SIGNS, drawLotNo, localDateOf, lotOfDay } from '../lots';

describe('签库（`docs/design/110-lot.md` §5）', () => {
  it('38 条，且 `LOT_POOL_SIZE` 就是它的条数（下标即 `no`，两者必须同步）', () => {
    expect(LOT_POOL_SIZE).toBe(38);
    expect(LOT_SIGNS).toHaveLength(LOT_POOL_SIZE);
  });

  it('只有吉签三档：下签一条都不在库里', () => {
    for (const sign of LOT_SIGNS) expect(['上上', '大吉', '上吉']).toContain(sign.level);
  });

  it('每首恰好四句七言、四字签题、非空的解签与「宜」', () => {
    for (const sign of LOT_SIGNS) {
      expect(sign.poem).toHaveLength(4);
      for (const line of sign.poem) expect(line).toHaveLength(7);
      expect(sign.title).toHaveLength(4);
      expect(sign.reading.length).toBeGreaterThan(0);
      expect(sign.good.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('本地日期（一天一次的判定基准）', () => {
  it('补零到 `YYYY-MM-DD`，走设备本地时区（不用 `toISOString`）', () => {
    expect(localDateOf(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateOf(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('今天那张签（`lotOfDay`）', () => {
  it('同日 → 返回那一支', () => {
    expect(lotOfDay({ date: '2026-10-22', no: 7 }, '2026-10-22')).toEqual(LOT_SIGNS[7]);
  });

  it('跨日 → `null`（昨天那张不算今天求过）', () => {
    expect(lotOfDay({ date: '2026-10-21', no: 7 }, '2026-10-22')).toBeNull();
  });

  it('从没求过 → `null`', () => {
    expect(lotOfDay(undefined, '2026-10-22')).toBeNull();
  });

  it('`no` 越界 → `null`（签库换过内容时判废，不是崩）', () => {
    expect(lotOfDay({ date: '2026-10-22', no: LOT_POOL_SIZE }, '2026-10-22')).toBeNull();
    expect(lotOfDay({ date: '2026-10-22', no: -1 }, '2026-10-22')).toBeNull();
  });
});

describe('抽签（`drawLotNo`）', () => {
  it('等概率落在 `0…37`：两端取整边界都对', () => {
    expect(drawLotNo(() => 0)).toBe(0);
    expect(drawLotNo(() => 0.999999)).toBe(LOT_POOL_SIZE - 1);
  });

  it('38 支都会被抽到，且不会越界（按 `random` 的 1/38 步长走一圈）', () => {
    const seen = new Set<number>();
    for (let step = 0; step < LOT_POOL_SIZE; step += 1) {
      const no = drawLotNo(() => (step + 0.5) / LOT_POOL_SIZE);
      expect(no).toBeGreaterThanOrEqual(0);
      expect(no).toBeLessThan(LOT_POOL_SIZE);
      seen.add(no);
    }
    expect(seen.size).toBe(LOT_POOL_SIZE);
  });
});
