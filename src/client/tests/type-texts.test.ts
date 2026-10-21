import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TYPE_TEXT_MAX_LEN,
  TYPE_TEXT_MAX_PARAS,
  TYPE_TEXTS_PER_CATEGORY,
} from '../../shared/constants';
import {
  createTypeTextLoader,
  drawNext,
  paragraphsOf,
  parseTypeTextPack,
  poolSize,
  TYPE_PACK_URL,
  type TypeTextCategory,
  type TypeTextItem,
} from '../type-texts';

/** 真实数据包（`public/fun/`），测试从仓库根目录跑——和 `audio-assets.test.ts` 同一套读法。 */
function readPack(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'fun', name), 'utf8')) as unknown;
}

const pack = readPack('type-texts.v1.json');
const categories = parseTypeTextPack(pack);
const rawItems: unknown[] = (() => {
  const raw = pack as { categories?: { items?: unknown[] }[] };
  return raw.categories?.[0]?.items ?? [];
})();

function categoryOf(id: string): TypeTextCategory {
  const found = categories.find((category) => category.id === id);
  if (!found) throw new Error(`数据包里没有分类 ${id}`);
  return found;
}

function itemsOf(...texts: string[]): TypeTextItem[] {
  return texts.map((text, index) => ({ id: `x${index}`, text }));
}

function withItems(items: unknown[]): unknown {
  return { schema: 1, categories: [{ id: 'c', label: 'C', items }] };
}

function fakeFetch(respond: () => Promise<unknown>): { fetchFn: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    const body = await respond();
    return { ok: true, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, calls: () => calls };
}

describe('类型文本数据包', () => {
  it('一期只有一个分类，且解析后一条都没被丢', () => {
    expect(categories).toHaveLength(1);
    const joke = categoryOf('joke');
    expect(joke.label.trim().length).toBeGreaterThan(0);
    expect(joke.items.length).toBe(rawItems.length);
    expect(joke.items.length).toBeGreaterThan(0);
    expect(joke.items.length).toBeLessThanOrEqual(TYPE_TEXTS_PER_CATEGORY);
  });

  it('每条都守长度与段数上限，id 互不重复', () => {
    const joke = categoryOf('joke');
    for (const item of joke.items) {
      expect(item.text.trim()).toBe(item.text);
      expect(item.text.length).toBeLessThanOrEqual(TYPE_TEXT_MAX_LEN);
      expect(paragraphsOf(item.text).length).toBeGreaterThan(0);
      expect(paragraphsOf(item.text).length).toBeLessThanOrEqual(TYPE_TEXT_MAX_PARAS);
    }
    expect(new Set(joke.items.map((item) => item.id)).size).toBe(joke.items.length);
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

describe('校验', () => {
  it('坏条目丢那一条、其余留下', () => {
    const parsed = parseTypeTextPack(
      withItems([
        { id: 'ok1', text: '正常一条' },
        { id: 'empty', text: '   ' },
        { id: 'long', text: 'x'.repeat(TYPE_TEXT_MAX_LEN + 1) },
        { id: 'paras', text: Array.from({ length: TYPE_TEXT_MAX_PARAS + 1 }, () => 'p').join('\n\n') },
        { id: 'ok1', text: '重复 id' },
        { id: '', text: '空 id' },
        'not an object',
        { id: 'ok2', text: '另一条' },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.items.map((item) => item.id)).toEqual(['ok1', 'ok2']);
  });

  it('整包形状坏返回空数组，分类一个都没条目就丢那一类', () => {
    expect(parseTypeTextPack(null)).toEqual([]);
    expect(parseTypeTextPack({ schema: 2, categories: [] })).toEqual([]);
    expect(parseTypeTextPack({ schema: 1, categories: 'nope' })).toEqual([]);
    expect(
      parseTypeTextPack({ schema: 1, categories: [{ id: 'c', label: 'C', items: [] }] }),
    ).toEqual([]);
  });

  it('段落切分：空行分段、段内换行保留、空白段丢弃', () => {
    expect(paragraphsOf('甲\n\n乙')).toEqual(['甲', '乙']);
    expect(paragraphsOf('甲\n乙')).toEqual(['甲\n乙']);
    expect(paragraphsOf('  甲  \n\n  \n\n 乙 ')).toEqual(['甲', '乙']);
    expect(paragraphsOf(' \n\n  ')).toEqual([]);
  });
});

describe('懒加载', () => {
  it('成功只请求一次（模块级 promise 去重）', async () => {
    const { fetchFn, calls } = fakeFetch(async () => readPack('type-texts.v1.json'));
    const load = createTypeTextLoader(fetchFn);
    const first = await load();
    const second = await load();
    expect(second).toBe(first);
    expect(calls()).toBe(1);
    expect(first.length).toBeGreaterThan(0);
  });

  it('失败与空包都抛错，且不缓存（下一次还能重来）', async () => {
    const bodies: unknown[] = [{ schema: 1, categories: [] }, readPack('type-texts.v1.json')];
    const { fetchFn, calls } = fakeFetch(async () => bodies.shift() ?? readPack('type-texts.v1.json'));
    const load = createTypeTextLoader(fetchFn);
    await expect(load()).rejects.toThrow();
    const categories = await load();
    expect(categories.length).toBeGreaterThan(0);
    expect(calls()).toBe(2);
    expect(TYPE_PACK_URL).toBe('/fun/type-texts.v1.json');
  });
});
