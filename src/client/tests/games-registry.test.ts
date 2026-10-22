import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GAMES } from '../games/registry';
import type { GameEntry } from '../games/types';

/**
 * 注册的守护（`docs/design/140-games-page.md` §4.1）：**文件夹即注册**，所以「注册有没有写对」
 * 只能靠扫文件夹来验——缺一半文件、`meta` 少字段、游戏里伸手进项目，都在这里红。
 */
const GAMES_DIR = join(process.cwd(), 'games');
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs)$/;

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

/**
 * `import type` 是唯一允许指回项目的形态：`verbatimModuleSyntax` 下它在产物里一行都不剩（不构成
 * 运行时依赖），而契约接口只有 `src/client/games/types.ts` 一份——复制一份进 `games/` 就是两份契约。
 */
const TYPE_ONLY_IMPORT = /^import\s+type\s[\s\S]*?\bfrom\s+'[^']+';?/gm;

/** 文件里所有 `from '…'` 与副作用 `import '…'` 的说明符 */
function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(TYPE_ONLY_IMPORT, '');
  return [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((match) => match[1]);
}

const dirs = readdirSync(GAMES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const isPositiveInt = (value: unknown): boolean => Number.isInteger(value) && (value as number) > 0;

/** 缺字段时扫描器给出的是 `undefined`（它不校验），所以按可选值看一遍 */
function problemsOf(entry: GameEntry): string[] {
  const meta = entry as { title?: string; blurb?: string; base?: { w?: number; h?: number } };
  const problems: string[] = [];
  if (typeof meta.title !== 'string' || meta.title.trim() === '') problems.push('title');
  if (typeof meta.blurb !== 'string' || meta.blurb.trim() === '') problems.push('blurb');
  if (!isPositiveInt(meta.base?.w)) problems.push('base.w');
  if (!isPositiveInt(meta.base?.h)) problems.push('base.h');
  if (typeof entry.load !== 'function') problems.push('load');
  return problems;
}

describe('游戏条目（games/<id>/ 文件夹即注册）', () => {
  it('每个 games/<id>/ 都有 meta.ts + index.ts，且扫描器为它产出一个条目', () => {
    expect(GAMES.map((entry) => entry.id).sort()).toEqual(dirs);
    for (const id of dirs) {
      expect([id, 'meta.ts', existsSync(join(GAMES_DIR, id, 'meta.ts'))]).toEqual([id, 'meta.ts', true]);
      expect([id, 'index.ts', existsSync(join(GAMES_DIR, id, 'index.ts'))]).toEqual([id, 'index.ts', true]);
    }
  });

  it('meta 三字段齐、base 是正整数、load 可调用', () => {
    const problems = GAMES.flatMap((entry) => problemsOf(entry).map((field) => `${entry.id}: ${field}`));
    expect(problems).toEqual([]);
    // 扫描器一个条目都没扫到 = 列表只剩「还在做」，等同于注册全丢
    expect(GAMES.length).toBeGreaterThan(0);
  });

  it('games/** 除同目录相对 import 外零项目 import', () => {
    const offenders = filesIn(GAMES_DIR)
      .filter((file) => SOURCE_FILE.test(file))
      .flatMap((file) =>
        specifiersOf(file)
          .filter((spec) => !spec.startsWith('./'))
          .map((spec) => `${relative(GAMES_DIR, file)} → ${spec}`),
      );
    expect(offenders).toEqual([]);
  });
});
