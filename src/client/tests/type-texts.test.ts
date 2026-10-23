import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TYPE_TEXT_MAX_LEN,
  TYPE_TEXT_MAX_PARAS,
  TYPE_TEXTS_PER_CATEGORY,
} from '../../shared/constants';
import {
  drawNext,
  paragraphsOf,
  poolSize,
  TYPE_TEXT_CATEGORIES,
  type TypeTextItem,
} from '../type-texts';

/**
 * 真实数据在仓库根的 `fun/<分类>/`（测试从仓库根目录跑，和 `games-registry.test.ts` 同一套读法）。
 * 正文在**编译期**就进了包、运行时没有降级，所以「数据对不对」只能在这里直接读源码目录拦一遍
 * （`docs/design/50-slot-panel.md` §附「数据与来源」）。
 */
const FUN_DIR = join(process.cwd(), 'fun');
/** 条目 id 就是文件名；长度上限也是 `sc.read.seen` 白名单的那一条。 */
const FILE_ID = /^[a-z0-9-]{1,32}$/;

const categoryDirs = readdirSync(FUN_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** 一个分类目录里的正文文件（名字去掉 `.txt` 就是条目 id）。 */
function textFilesOf(categoryId: string): string[] {
  return readdirSync(join(FUN_DIR, categoryId))
    .filter((name) => name.endsWith('.txt'))
    .sort();
}

function itemsOf(...texts: string[]): TypeTextItem[] {
  return texts.map((text, index) => ({ id: `x${index}`, text }));
}

describe('类型文本数据', () => {
  it('每个分类目录都有 meta.ts，扫描器为它产出一个分类，且 label 非空', () => {
    expect(TYPE_TEXT_CATEGORIES.map((category) => category.id).sort()).toEqual(categoryDirs);
    expect(TYPE_TEXT_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of TYPE_TEXT_CATEGORIES) {
      expect([category.id, 'meta.ts', existsSync(join(FUN_DIR, category.id, 'meta.ts'))]).toEqual([
        category.id,
        'meta.ts',
        true,
      ]);
      expect([category.id, category.label, category.label.trim().length > 0]).toEqual([
        category.id,
        category.label,
        true,
      ]);
    }
  });

  it('文件名合法、每类非空且 ≤ TYPE_TEXTS_PER_CATEGORY，条目 id 与目录内容一一对应', () => {
    for (const category of TYPE_TEXT_CATEGORIES) {
      const files = textFilesOf(category.id);
      expect([category.id, files.length > 0]).toEqual([category.id, true]);
      expect([category.id, files.length <= TYPE_TEXTS_PER_CATEGORY]).toEqual([category.id, true]);
      const ids = files.map((file) => file.replace(/\.txt$/, ''));
      expect([category.id, ids.filter((id) => !FILE_ID.test(id))]).toEqual([category.id, []]);
      expect([category.id, category.items.map((item) => item.id)]).toEqual([category.id, ids]);
    }
  });

  it('每条正文非空、长度与段数在上限内，且与扫描器读到的一字不差', () => {
    for (const category of TYPE_TEXT_CATEGORIES) {
      textFilesOf(category.id).forEach((file, index) => {
        const text = readFileSync(join(FUN_DIR, category.id, file), 'utf8').trim();
        const paragraphs = paragraphsOf(text);
        expect([category.id, file, category.items[index]?.text]).toEqual([category.id, file, text]);
        expect([category.id, file, text.length, text.length <= TYPE_TEXT_MAX_LEN]).toEqual([
          category.id,
          file,
          text.length,
          true,
        ]);
        expect([category.id, file, paragraphs.length > 0]).toEqual([category.id, file, true]);
        expect([category.id, file, paragraphs.length <= TYPE_TEXT_MAX_PARAS]).toEqual([
          category.id,
          file,
          true,
        ]);
      });
    }
  });
});

describe('抽签', () => {
  it('池空给 null；连续抽只出不同的 id，抽完正好是全部', () => {
    const items = itemsOf('a', 'b', 'c');
    const seen: string[] = [];
    for (;;) {
      const drawn = drawNext({ items, seen, rand: () => 0 });
      if (!drawn) break;
      seen.push(drawn.id);
    }
    expect(seen.sort()).toEqual(items.map((item) => item.id).sort());
    expect(drawNext({ items, seen, rand: () => 0 })).toBeNull();
  });

  it('池长 ≥2 时不抽回当前条（「再看一遍」后不能原地不动）', () => {
    const items = itemsOf('a', 'b', 'c');
    for (const rand of [0, 0.4, 0.99]) {
      expect(drawNext({ items, seen: [], current: 'x0', rand: () => rand })?.id).not.toBe('x0');
    }
    expect(poolSize(items, [], 'x0')).toBe(2);
  });

  it('只剩当前条时它回到池里（数据太少，不是逻辑漏洞）', () => {
    const items = itemsOf('a');
    expect(poolSize(items, [], 'x0')).toBe(1);
    expect(drawNext({ items, seen: [], current: 'x0', rand: () => 0 })?.id).toBe('x0');
    expect(drawNext({ items, seen: ['x0'], current: 'x0' })).toBeNull();
  });
});

describe('正文切分', () => {
  it('行切分：单换行与连续换行都分行、空白行丢弃', () => {
    expect(paragraphsOf('甲\n\n乙')).toEqual(['甲', '乙']);
    expect(paragraphsOf('甲\n乙')).toEqual(['甲', '乙']);
    expect(paragraphsOf('甲\n\n\n乙')).toEqual(['甲', '乙']);
    expect(paragraphsOf('  甲  \n\n  \n\n 乙 ')).toEqual(['甲', '乙']);
    expect(paragraphsOf('甲\r\n乙')).toEqual(['甲', '乙']);
    expect(paragraphsOf(' \n\n  ')).toEqual([]);
  });
});
