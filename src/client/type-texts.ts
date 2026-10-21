/**
 * 类型文本（插槽面板的第二个内容，`docs/design/50-slot-panel.md` §附）。
 *
 * 数据包是**静态文件**：`public/fun/type-texts.v{N}.json`，懒加载、静态资源直给（不进 Worker 代码、
 * 不进任何接口）。版本号**只在文件名里**（`TYPE_PACK_VERSION` 是唯一来源，与 `public/_headers`
 * 的 `immutable` 配套，换内容必须改名）；JSON 内的 `schema` 只表**形状**版本。
 *
 * 校验原则：**坏条目丢那一块**（条 → 分类 → 整包），绝不因为一条脏数据把面板弄崩。
 */
import { TYPE_TEXT_MAX_LEN, TYPE_TEXT_MAX_PARAS, TYPE_TEXTS_PER_CATEGORY } from '../shared/constants';

export const TYPE_PACK_VERSION = 1;
export const TYPE_PACK_URL = `/fun/type-texts.v${TYPE_PACK_VERSION}.json`;

/** 分类 id / 条目 id 的长度上限（也是 `sc.read.seen` 白名单的那一条）。 */
const ID_MAX_LEN = 32;

export type TypeTextItem = { id: string; text: string };
export type TypeTextCategory = { id: string; label: string; items: TypeTextItem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

/** 段落切分：连续空行分段，段内单个换行保留（渲染侧靠 `white-space: pre-line`）。 */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function parseItems(raw: unknown[]): TypeTextItem[] {
  const seen = new Set<string>();
  const items: TypeTextItem[] = [];
  for (const entry of raw) {
    if (items.length >= TYPE_TEXTS_PER_CATEGORY) break;
    if (!isRecord(entry)) continue;
    const { id, text } = entry;
    if (!isShortString(id, ID_MAX_LEN) || seen.has(id)) continue;
    if (typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > TYPE_TEXT_MAX_LEN) continue;
    const paragraphs = paragraphsOf(trimmed);
    if (paragraphs.length === 0 || paragraphs.length > TYPE_TEXT_MAX_PARAS) continue;
    seen.add(id);
    items.push({ id, text: trimmed });
  }
  return items;
}

/** 校验数据包。整包形状坏 → `[]`；坏分类丢那一类；坏条目丢那一条。 */
export function parseTypeTextPack(raw: unknown): TypeTextCategory[] {
  if (!isRecord(raw) || raw.schema !== 1 || !Array.isArray(raw.categories)) return [];
  const categories: TypeTextCategory[] = [];
  for (const entry of raw.categories) {
    if (!isRecord(entry)) continue;
    const { id, label, items } = entry;
    if (!isShortString(id, ID_MAX_LEN) || !isShortString(label, ID_MAX_LEN)) continue;
    if (!Array.isArray(items)) continue;
    const parsed = parseItems(items);
    if (parsed.length === 0) continue;
    categories.push({ id, label, items: parsed });
  }
  return categories;
}

/**
 * 可抽的池：`items` 里还没抽过的；**当前条在池里且池长 ≥ 2 时排除它**
 * （否则「再看一遍 / 随机」有 1/N 的概率抽回正在看的那条，用户会以为按钮没反应；
 * 只剩它一条时让它回来，那是数据太少，不是逻辑漏洞）。
 */
function poolOf(
  items: readonly TypeTextItem[],
  seen: readonly string[],
  current?: string,
): TypeTextItem[] {
  const seenSet = new Set(seen);
  const fresh = items.filter((item) => !seenSet.has(item.id));
  if (fresh.length > 1 && current) return fresh.filter((item) => item.id !== current);
  return fresh;
}

/** 池里还剩几条。面板据此在「随机」与「再看一遍」之间选按钮（**不含当前条**，除非只剩它）。 */
export function poolSize(
  items: readonly TypeTextItem[],
  seen: readonly string[],
  current?: string,
): number {
  return poolOf(items, seen, current).length;
}

export type DrawInput = {
  items: readonly TypeTextItem[];
  seen: readonly string[];
  current?: string;
  rand?: () => number;
};

/** 抽一条；池空返回 `null`（调用方据此切到「再看一遍」）。 */
export function drawNext({ items, seen, current, rand = Math.random }: DrawInput): TypeTextItem | null {
  const pool = poolOf(items, seen, current);
  if (pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return pool[index] ?? null;
}

/**
 * 懒加载器。**成功才缓存**（模块级 promise 去重），失败清掉缓存——否则一次网络抖动会让整次
 * 会话都停在错误态。`fetchFn` 可注入只是为了单测。
 */
export function createTypeTextLoader(fetchFn: typeof fetch): () => Promise<TypeTextCategory[]> {
  let cached: Promise<TypeTextCategory[]> | null = null;
  return () => {
    cached ??= fetchFn(TYPE_PACK_URL).then(async (response) => {
      if (!response.ok) throw new Error(`类型文本没取到：${response.status}`);
      const categories = parseTypeTextPack(await response.json());
      // 空包按失败处理：面板给「重试」，而不是显示一个永远空的内容区
      if (categories.length === 0) throw new Error('类型文本没取到：空包');
      return categories;
    });
    cached.catch(() => {
      cached = null;
    });
    return cached;
  };
}

export const loadTypeTextPack = createTypeTextLoader(fetch);
