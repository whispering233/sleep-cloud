/**
 * 说明面板的内容（`docs/design/90-about-panel.md` §3.1、§4）：正文是 `about.json` 里的一个字符串数组，
 * 这里只做三件事——解析、指纹、判定；全是纯函数、DOM-free、可单测。
 *
 * 正文随 bundle 走（构建期 JSON import）——没有请求、没有加载态、没有失败分支，改文案只碰那个文件。
 * 改内容**没有第二步**：指纹自动跟上，所有设备下次进厅都会看到这一版（§4）。
 */

import about from './about.json';

/** 内容文件里的行（一个元素一行，顺序即正文顺序；空字符串只是一个空行） */
const RAW_TEXT = about.text.join('\n');

/** 行内片段：要么一段文字，要么一个已校验的 `https://` 链接。不做任何其它行内标记（§4） */
export type AboutInline = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/** 块：小节标题、一段正文、一个列表（连续的 `-` 行合成一个）。结构由文本自己决定，没有预定义字段（§4） */
export type AboutBlock =
  | { kind: 'heading'; parts: AboutInline[] }
  | { kind: 'paragraph'; parts: AboutInline[] }
  | { kind: 'list'; items: AboutInline[][] };

/**
 * 行内链接：`[文字](https://…)`，**只认 `https://`**（白名单只有一条，黑名单式过滤是 XSS 的经典破口），
 * URL 里不允许空白与 `)`（扫到第一个 `)` 收尾，不处理转义括号），主机名不能为空（裸 `https://` 也算坏链接）。
 * 不匹配的一律按字面留在文字里——`http:` / `mailto:` / `javascript:` / 空 url / 坏链接**原样显示**：
 * 作者写错了要看得见才修得掉（§4）。
 */
const INLINE_LINK = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

/** 只把 `[文字](https://…)` 切成链接，其余字节原样当文字（不补全、不丢弃） */
function parseInline(line: string): AboutInline[] {
  const parts: AboutInline[] = [];
  let rest = 0;
  for (const match of line.matchAll(INLINE_LINK)) {
    const at = match.index;
    if (at > rest) parts.push({ kind: 'text', text: line.slice(rest, at) });
    parts.push({ kind: 'link', text: match[1], href: match[2] });
    rest = at + match[0].length;
  }
  if (rest < line.length) parts.push({ kind: 'text', text: line.slice(rest) });
  return parts;
}

/**
 * 正文 → 块（§4）。按行扫，只认两种前缀：`## `（两个井号 + 一个空格）与 `- `（一个横杠 + 一个空格）。
 *
 * - `## x` 独立成一个小节标题，**不**并入相邻块；
 * - 连续的 `- x` 行合成一个列表，非 `- ` 行即结束它（含空行）；
 * - 其余非空行**各自**成一段（段落由行决定，换行即分段）；
 * - 空行只为可读，忽略；空前缀（`## ` / `- ` 后没有字）丢掉。
 *
 * 不猜作者意图：`# x`、`* x`、`1. x` 一律当正文按字面显示。
 */
export function parseAbout(raw: string): AboutBlock[] {
  const blocks: AboutBlock[] = [];
  /** 当前正在累积的列表（块已 push 进 `blocks`，这里只持有它好继续追加条目） */
  let list: AboutInline[][] | null = null;

  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    // 空行只为可读：不产出块，同时打断「连续的 `- ` 行」（`line.trim()` 判空比逐字比较宽容，
    // 但前缀判定必须用原行——否则 `## ` 行尾那个空格被 trim 掉，它就变成正文了）
    if (rawLine.trim() === '') {
      list = null;
      continue;
    }

    if (rawLine.startsWith('## ')) {
      const title = rawLine.slice(3).trim();
      list = null;
      if (title !== '') blocks.push({ kind: 'heading', parts: parseInline(title) });
      continue;
    }

    if (rawLine.startsWith('- ')) {
      const item = rawLine.slice(2).trim();
      if (item === '') continue;
      if (list === null) {
        list = [];
        blocks.push({ kind: 'list', items: list });
      }
      list.push(parseInline(item));
      continue;
    }

    list = null;
    blocks.push({ kind: 'paragraph', parts: parseInline(rawLine.trim()) });
  }

  return blocks;
}

/**
 * 正文 → 内容指纹（§3.1）：先归一化空白（整体 `trim` + 连续空白折成一个空格），
 * 再逐 **UTF-16 码元**算 FNV-1a 32 位（`Math.imul`，初值 `0x811c9dc5`、质数 `0x01000193`），取 base36。
 *
 * 归一化的理由：CRLF 与文件末尾多一个换行不该让全体被多弹一次——**只改排版不算改内容**。
 * **算法写死、不许改**：换算法 / 换参数等于全体用户再弹一次面板；改指纹就当成一次内容变更对待。
 */
export function aboutToken(raw: string): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 这一版正文的指纹（`sc.about.seen` 存的就是它；形如 `1k9f3a2`，落在 ≤ 32 字符窗口内） */
export const ABOUT_TOKEN: string = aboutToken(RAW_TEXT);

/** 这一版正文解析出来的块，渲染直接遍历它 */
export const ABOUT_BLOCKS: AboutBlock[] = parseAbout(RAW_TEXT);

/**
 * 该不该自动弹（§3）：`seen !== ABOUT_TOKEN`。
 * **不校验 `seen` 的格式**：它只被拿去逐字比较，坏值唯一的后果是**再弹一次**（无副作用）。
 */
export function shouldShowAbout(seen: string | undefined): boolean {
  return seen !== ABOUT_TOKEN;
}
