import { describe, expect, it } from 'vitest';

import {
  ART_SCALE,
  AUDIT_TTL_MS,
  AUTO_SLEEP_MS,
  BED_H,
  BED_OWNERSHIP_TTL_MS,
  BED_SWITCH_COOLDOWN_MS,
  BED_W,
  BLOCK_PURGE_MS,
  CELL_H,
  CELL_W,
  CHAT_MAX_LEN,
  CHAT_BUBBLE_MS,
  DAILY_WAKE_UTC_HOUR,
  GRACE_MS,
  HALL_ID,
  IDENTITY_FORGET_MS,
  MAX_DPR,
  NICKNAME_MAX_LEN,
  POOL_SIZE,
  RESERVE_W,
  TICK_MS,
  UPSTREAM_RATE_PER_SEC,
  WALK_SPEED_PX_PER_S,
  WALL_BODY,
  WALL_WIDTH,
  AISLE,
  ZOOM_TIERS,
} from '../constants';
import { readDoc, tableRows } from './doc';

/** `docs/design/config.md` §1 的三行（厅标识 / 布局版本 / 床位数） */
const docSingleHall = tableRows(readDoc('design/config.md'), '## 1. 只有一个厅', '## 2. 时间常量');
const docValue = (item: string): string =>
  (docSingleHall.find(([name]) => (name ?? '').replaceAll('`', '') === item)?.[1] ?? '').replaceAll('`', '');

/** `docs/design/20-layout.md` §2 几何常量表：常量名 → 文档里的值。 */
const docGeometry = tableRows(readDoc('design/20-layout.md'), '## 2. 床位与格子规格', '## 3. 级表与厅的边界');
const docConstant = (name: string): number => {
  for (const [item, value] of docGeometry) {
    // `BED_W` / `BED_H` 那一行把两个名字写在同一个单元格里
    const names = (item ?? '').replaceAll('`', '').split('/').map((part) => part.trim());
    const index = names.indexOf(name);
    if (index >= 0) return Number((value ?? '').split('/')[index]?.trim());
  }
  throw new Error(`docs/design/20-layout.md §2 没有常量 ${name}`);
};

/** `docs/design/config.md` §3 限制表：项名 → 文档里的值。 */
const docLimit = (name: string): number => {
  const rows = tableRows(readDoc('design/config.md'), '## 3. 限制', '## 4. 密钥');
  return Number((rows.find(([item]) => (item ?? '').replaceAll('`', '') === name)?.[1] ?? '').replaceAll('`', ''));
};

describe('常量与 docs/design/config.md、20-layout.md 一致', () => {
  it('时间常量（§2）', () => {
    expect(GRACE_MS).toBe(60_000);
    expect(AUTO_SLEEP_MS).toBe(300_000);
    expect(TICK_MS).toBe(100);
    expect(WALK_SPEED_PX_PER_S).toBe(220);
    expect(DAILY_WAKE_UTC_HOUR).toBe(20);
    expect(BED_OWNERSHIP_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(BED_SWITCH_COOLDOWN_MS).toBe(10_000);
    expect(CHAT_BUBBLE_MS).toBe(8_000);
    expect(IDENTITY_FORGET_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(BLOCK_PURGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(AUDIT_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('几何常量（`20-layout.md` §2）与列距/行距逐条等于文档里的值', () => {
    expect(ART_SCALE).toBe(docConstant('ART_SCALE'));
    expect(BED_W).toBe(docConstant('BED_W'));
    expect(BED_H).toBe(docConstant('BED_H'));
    expect(AISLE).toBe(docConstant('AISLE'));
    expect(RESERVE_W).toBe(docConstant('RESERVE_W'));
    expect(CELL_W).toBe(docConstant('CELL_W'));
    expect(CELL_H).toBe(docConstant('CELL_H'));
    expect(WALL_BODY).toBe(docConstant('WALL_BODY'));
    expect(WALL_WIDTH).toBe(docConstant('WALL_WIDTH'));
  });

  it('格 = 走道 + 床 + 预留位；格高 = 床高 + 床脚前走道', () => {
    expect(CELL_W).toBe(AISLE + BED_W + RESERVE_W);
    expect(CELL_H).toBe(BED_H + AISLE);
  });

  it('限制（§3）', () => {
    expect(UPSTREAM_RATE_PER_SEC).toBe(5);
    expect(NICKNAME_MAX_LEN).toBe(16);
    expect(CHAT_MAX_LEN).toBe(200);
    expect(POOL_SIZE).toBe(64);
    expect(MAX_DPR).toBe(docLimit('MAX_DPR'));
  });

  it('缩放档位表（§3）：四档与文档逐档一致（界面不自己写数）', () => {
    // 这一格是 `0.175 / 0.5 / 0.75 / 1`，比单值的 `docLimit` 多一个拆分
    const rows = tableRows(readDoc('design/config.md'), '## 3. 限制', '## 4. 密钥');
    const value = (rows.find(([item]) => (item ?? '').replaceAll('`', '') === 'ZOOM_TIERS')?.[1] ?? '').replaceAll('`', '');
    expect([...ZOOM_TIERS]).toEqual(value.split('/').map((part) => Number(part.trim())));
  });

  it('单厅（§1）：厅标识逐字来自文档', () => {
    expect(HALL_ID).toBe(docValue('厅标识'));
  });
});