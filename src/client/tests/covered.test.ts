import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { coversWorld } from '../covered';
import type { WorldCover } from '../covered';

type OpenPage = 'none' | 'about-auto' | 'about-manual' | 'games' | 'lot';

/** 一页开着的快照：跑真值表用 */
function coverOf(hasSession: boolean, entered: boolean, page: OpenPage): WorldCover {
  return {
    hasSession,
    entered,
    aboutOpen: page === 'about-auto' ? 'auto' : page === 'about-manual' ? 'manual' : null,
    gamesOpen: page === 'games',
    lotOpen: page === 'lot',
  };
}

// 哪天把这四页抽成共用的整屏页壳组件，下面那条清单对账要改成扫那个组件
const SCREEN_PAGES = ['AboutOverlay.tsx', 'EntryOverlay.tsx', 'GamesOverlay.tsx', 'LotOverlay.tsx'];

/** 组件目录里真正用了 `.entry-overlay` 的文件名：判据漏一页，这里就红 */
function entryOverlayComponents(): string[] {
  const dir = join(process.cwd(), 'src/client/components');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => readFileSync(join(dir, name), 'utf8').includes('entry-overlay'));
}

describe('coversWorld（docs/design/60-interaction-shell.md §5.2 / I13）', () => {
  it('真值表：hasSession × entered × 开着的页', () => {
    const cases: [boolean, boolean, OpenPage, boolean][] = [
      // `/api/me` 还没回来：四页都没画，屏上什么都没盖
      [false, false, 'none', false],
      [false, false, 'about-auto', false],
      [false, false, 'about-manual', false],
      [false, false, 'games', false],
      [false, false, 'lot', false],
      // 还没进厅：入场层盖着
      [true, false, 'none', true],
      [true, false, 'about-auto', true],
      [true, false, 'about-manual', true],
      [true, false, 'games', true],
      [true, false, 'lot', true],
      // 进厅之后：只有三页之一开着才盖
      [true, true, 'none', false],
      [true, true, 'about-auto', true],
      [true, true, 'about-manual', true],
      [true, true, 'games', true],
      [true, true, 'lot', true],
    ];
    for (const [hasSession, entered, page, expected] of cases) {
      expect([hasSession, entered, page, coversWorld(coverOf(hasSession, entered, page))]).toEqual([
        hasSession,
        entered,
        page,
        expected,
      ]);
    }
  });

  it('三页同开仍为 true', () => {
    expect(coversWorld({ hasSession: true, entered: true, aboutOpen: 'manual', gamesOpen: true, lotOpen: true })).toBe(
      true,
    );
  });

  it('每个用 `.entry-overlay` 的组件都在判据里（集合相等，双向）', () => {
    expect(entryOverlayComponents().sort()).toEqual([...SCREEN_PAGES].sort());
  });

  it('扫描结果不是空集（扫描根写错时这条红，而不是让上一条永远绿）', () => {
    expect(entryOverlayComponents().length).toBeGreaterThan(0);
  });
});
