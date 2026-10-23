/// <reference types="vite/client" />
/**
 * 类型文本（插槽面板的第二个内容，`docs/design/50-slot-panel.md` §附）。
 *
 * 源是仓库根的 `fun/<分类 id>/`：`meta.ts` 只放 `label`，**一条文本一个 `.txt`、文件名就是条目 id**。
 * 两个 **eager** `import.meta.glob` 在编译期把正文读成字符串、组装成本模块的常量——**不发任何请求**，
 * 字节跟着 `index` chunk 走，所以**没有版本号、没有加载态、没有错误态**（内容变 ⇒ chunk 哈希变）。
 * 校验在构建期单测（`src/client/tests/type-texts.test.ts` 直接读 `fun/`），运行时没有「坏条目丢那一条」这种降级。
 */

export type TypeTextItem = { id: string; text: string };
export type TypeTextCategory = { id: string; label: string; items: TypeTextItem[] };

/**
 * 切成要显示的行：**任意一个或连续的换行都分一次**——正文里 `\n` 与 `\n\n` 混用，两者都是「换一行」。
 * 每行 trim、空行丢弃；每行在面板里是一个 `<p>`，所以**每行都会首行缩进**（`docs/design/50-slot-panel.md` §附）。
 */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface TypeTextMetaModule {
  meta: { label: string };
}

const metas = import.meta.glob<TypeTextMetaModule>('../../fun/*/meta.ts', { eager: true });
const sources = import.meta.glob<string>('../../fun/*/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** `…/fun/<分类 id>/meta.ts` 与 `…/fun/<分类 id>/<条目 id>.txt` 共用：倒数第二段就是分类 id。 */
function categoryIdOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 2] ?? '';
}

/** 条目 id = 文件名去掉 `.txt`（改名等于换一条：`sc.read.seen` 就认不出它了）。 */
function itemIdOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  return name.replace(/\.txt$/, '');
}

/**
 * 组装成分类表：分类 id = 文件夹名、`label` 取 `meta.ts`、条目 id = 文件名。两边都**按 glob 的 key
 * 排序**，所以顺序只由路径决定（重排文件不会换顺序）。正文 `trim()` 后按 `paragraphsOf` 丢空段，
 * 一条有效段都没有的条目直接跳过——没有分类 id、没有 `label` 的分类也不出现。
 */
function assembleCategories(): TypeTextCategory[] {
  const itemsByCategory = new Map<string, TypeTextItem[]>();
  for (const path of Object.keys(sources).sort()) {
    const text = (sources[path] ?? '').trim();
    if (paragraphsOf(text).length === 0) continue;
    const id = categoryIdOf(path);
    const items = itemsByCategory.get(id) ?? [];
    items.push({ id: itemIdOf(path), text });
    itemsByCategory.set(id, items);
  }

  const categories: TypeTextCategory[] = [];
  for (const path of Object.keys(metas).sort()) {
    const id = categoryIdOf(path);
    const items = itemsByCategory.get(id) ?? [];
    if (items.length === 0) continue;
    const label = metas[path]?.meta.label.trim() ?? '';
    if (label.length === 0) continue;
    categories.push({ id, label, items });
  }
  return categories;
}

/** 一期只有一个分类（首期 = 冷笑话）：面板直接取 `[0]`。 */
export const TYPE_TEXT_CATEGORIES: TypeTextCategory[] = assembleCategories();

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
