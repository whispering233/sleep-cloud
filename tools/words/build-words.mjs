#!/usr/bin/env node
/**
 * 内容过滤词库生成（`npm run words`）：`konsheng/Sensitive-lexicon`（MIT）的 15 个类目 + 手工表 `curated.txt`
 * → `src/shared/blocked-words.json`。产物入库、不挂进 build：词表变更走一次部署（见 `docs/design/config.md` §6）。
 *
 * 只取 `FILES` 里那 15 个类目：`零时-Tencent.txt` 与 `网易前端过滤敏感词库.txt` 是第三方转存（作者的 MIT
 * 覆盖不到），且含 505 个单字词条——实测让日常聊天 9.2% 的字符变星号却不增加检测力（真实信号都是 2 字以上短语）。
 *
 * 输出必须**幂等**：同一 commit + 同一份 `curated.txt` 跑两次，`git diff` 必须为空。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const REPO = 'konsheng/Sensitive-lexicon';
/** 固定 commit：上游词库会变，判定口径不能跟着变。 */
const COMMIT = 'd967c30b053fa40b06c5a0dddf0be493f2dfae46';
const RAW = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Vocabulary/`;

/** 类目名 → 上游文件名；这里的顺序就是 JSON 里 `categories` 的顺序。 */
const FILES = [
  ['色情', '色情类型.txt'],
  ['色情词库', '色情词库.txt'],
  ['政治', '政治类型.txt'],
  ['暴恐', '暴恐词库.txt'],
  ['涉枪涉爆', '涉枪涉爆.txt'],
  ['反动', '反动词库.txt'],
  ['贪腐', '贪腐词库.txt'],
  ['新思想启蒙', '新思想启蒙.txt'],
  ['非法网址', '非法网址.txt'],
  ['GFW', 'GFW补充词库.txt'],
  ['民生', '民生词库.txt'],
  ['补充', '补充词库.txt'],
  ['其他', '其他词库.txt'],
  ['COVID', 'COVID-19词库.txt'],
  ['广告', '广告类型.txt'],
];

const CURATED = join(HERE, 'curated.txt');
const OUT = join(ROOT, 'src', 'shared', 'blocked-words.json');

function lines(text) {
  return text
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function fetchLines(file) {
  const response = await fetch(RAW + encodeURI(file));
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return lines(await response.text());
}

const categories = {};
for (const [name, file] of FILES) categories[name] = [...new Set(await fetchLines(file))];

const curated = [...new Set(lines(readFileSync(CURATED, 'utf8')))];

const data = {
  meta: {
    source: `https://github.com/${REPO}`,
    license: 'MIT',
    commit: COMMIT,
    generator: 'npm run words（tools/words/build-words.mjs）',
    excluded: ['零时-Tencent.txt', '网易前端过滤敏感词库.txt'],
  },
  categories,
  curated,
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);

const total = Object.values(categories).reduce((sum, list) => sum + list.length, 0);
console.log(`blocked-words.json: ${FILES.length} 类 ${total} 条 + curated ${curated.length} 条`);
