import { describe, expect, it } from 'vitest';

import {
  ART_SCALE,
  AUTO_SLEEP_MS,
  BED_H,
  BED_OWNERSHIP_TTL_MS,
  BED_W,
  CELL_H,
  CELL_W,
  CHAT_MAX_LEN,
  CHAT_LOG_MAX,
  DAILY_WAKE_UTC_HOUR,
  EMOTE_MS,
  GRACE_MS,
  HALL_ID,
  MAX_DPR,
  NICKNAME_MAX_LEN,
  POOL_SIZE,
  RESERVE_W,
  TICK_MS,
  TRACE_TTL_MS,
  UPSTREAM_RATE_PER_SEC,
  WALK_SPEED_PX_PER_S,
  WALL_BODY,
  WALL_WIDTH,
  AISLE,
} from '../constants';
import { readDoc, tableRows } from './doc';

/** `docs/design/config.md` §1 的三行（厅标识 / 布局版本 / 床位数） */
const docSingleHall = tableRows(readDoc('design/config.md'), '## 1. 只有一个厅', '## 2. 级表');
const docValue = (item: string): string =>
  (docSingleHall.find(([name]) => (name ?? '').replaceAll('`', '') === item)?.[1] ?? '').replaceAll('`', '');

/** `docs/design/config.md` §4 几何常量表：常量名 → 文档里的值。 */
const docGeometry = tableRows(readDoc('design/config.md'), '## 4. 几何常量', '## 5. 限制');
const docConstant = (name: string): number => {
  for (const [item, value] of docGeometry) {
    // `BED_W` / `BED_H` 那一行把两个名字写在同一个单元格里
    const names = (item ?? '').replaceAll('`', '').split('/').map((part) => part.trim());
    const index = names.indexOf(name);
    if (index >= 0) return Number((value ?? '').split('/')[index]?.trim());
  }
  throw new Error(`docs/design/config.md §4 没有常量 ${name}`);
};

describe('常量与 docs/design/config.md 一致', () => {
  it('时间常量（§3）', () => {
    expect(GRACE_MS).toBe(60_000);
    expect(AUTO_SLEEP_MS).toBe(300_000);
    expect(TICK_MS).toBe(100);
    expect(WALK_SPEED_PX_PER_S).toBe(220);
    expect(TRACE_TTL_MS).toBe(43_200_000);
    expect(DAILY_WAKE_UTC_HOUR).toBe(20);
    expect(BED_OWNERSHIP_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(EMOTE_MS).toBe(2500);
  });

  it('几何常量（§4）与列距/行距逐条等于文档里的值', () => {
    expect(ART_SCALE).toBe(docConstant('ART_SCALE'));
    expect(BED_W).toBe(docConstant('BED_W'));
    expect(BED_H).toBe(docConstant('BED_H'));
    expect(AISLE).toBe(docConstant('AISLE'));
    expect(RESERVE_W).toBe(docConstant('RESERVE_W'));
    expect(CELL_W).toBe(docConstant('CELL_W'));
    expect(CELL_H).toBe(docConstant('CELL_H'));
    expect(WALL_BODY).toBe(docConstant('WALL_BODY'));
    expect(WALL_WIDTH).toBe(docConstant('WALL_WIDTH'));
    expect(MAX_DPR).toBe(docConstant('MAX_DPR'));
  });

  it('格 = 走道 + 床 + 预留位；格高 = 床高 + 床脚前走道', () => {
    expect(CELL_W).toBe(AISLE + BED_W + RESERVE_W);
    expect(CELL_H).toBe(BED_H + AISLE);
  });

  it('限制（§5）', () => {
    expect(UPSTREAM_RATE_PER_SEC).toBe(5);
    expect(NICKNAME_MAX_LEN).toBe(16);
    expect(CHAT_MAX_LEN).toBe(200);
    expect(CHAT_LOG_MAX).toBe(50);
    expect(POOL_SIZE).toBe(64);
  });

  it('单厅（§1）：厅标识逐字来自文档', () => {
    expect(HALL_ID).toBe(docValue('厅标识'));
  });
});