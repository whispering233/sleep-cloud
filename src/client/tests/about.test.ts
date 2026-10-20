import { describe, expect, it } from 'vitest';

import { ANNOUNCE, ANNOUNCE_VERSION, shouldShowAbout } from '../about';

describe('shouldShowAbout（docs/design/90-about-panel.md §3）', () => {
  it('缺键 → 弹（从未确认过任何公告）', () => {
    expect(shouldShowAbout(undefined)).toBe(true);
  });

  it('同版本 → 不弹', () => {
    expect(shouldShowAbout(ANNOUNCE.version)).toBe(false);
  });

  it('旧版本 → 弹', () => {
    expect(shouldShowAbout('0.0.6')).toBe(true);
  });

  it('坏值 → 弹（不校验合法性，坏值唯一后果是再弹一次）', () => {
    for (const bad of ['', '不是版本号', '0.0.70']) expect(shouldShowAbout(bad)).toBe(true);
  });
});

describe('ANNOUNCE 内容形状（docs/design/90-about-panel.md §4）', () => {
  it('version 形如 x.y.z，且 ANNOUNCE_VERSION 就是它', () => {
    expect(ANNOUNCE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ANNOUNCE_VERSION).toBe(ANNOUNCE.version);
  });

  it('intro 非空', () => {
    expect(ANNOUNCE.intro.trim().length).toBeGreaterThan(0);
  });

  it('每节 title 与 items 非空、条目无空串、每节 ≤ 6 条', () => {
    expect(ANNOUNCE.sections.length).toBeGreaterThan(0);
    for (const section of ANNOUNCE.sections) {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.length).toBeLessThanOrEqual(6);
      for (const item of section.items) expect(item.trim().length).toBeGreaterThan(0);
    }
  });
});
