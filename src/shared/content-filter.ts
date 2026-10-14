import { BLOCKED_WORDS, INTERFERENCE_CHARS } from './blocked-words';

/**
 * 内容过滤（服务端专用，见 `10-hall-runtime.md` §8）：
 *
 * - **检测**（`detect`）：用于昵称，命中即拒绝，返回命中的词。
 * - **打码**（`mask`）：用于聊天，命中词替换为 `*` 后**照常放行**（硬拦截会让发送者意识到被审查并试探绕过）。
 *
 * 匹配前剥离干扰字符与空白、统一小写，因此 `傻·逼` 与 `傻 逼` 都会被命中。
 */

const ZERO_WIDTH = '\u200b\u200c\u200d\u2060\ufeff';

const interference = new Set([...INTERFERENCE_CHARS, ...ZERO_WIDTH]);

/** 词表在模块初始化时归一化一次（判定用的是归一化文本，位置由 positions 映回原文）。 */
const normalizedWords = BLOCKED_WORDS.map((word) => normalize(word).text).filter(
  (word) => word.length > 0,
);

interface Span {
  start: number;
  end: number;
  word: string;
}

function normalize(input: string): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;
    if (/\s/.test(char) || interference.has(char)) continue;
    text += char.toLowerCase();
    positions.push(index);
  }
  return { text, positions };
}

/** 找出所有命中的原文区间（重叠或相接的合并为一个，避免重复替换）。 */
function findSpans(input: string): Span[] {
  const { text, positions } = normalize(input);
  const spans: Span[] = [];

  for (const word of normalizedWords) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(word, from);
      if (at < 0) break;
      spans.push({
        start: positions[at] as number,
        end: (positions[at + word.length - 1] as number) + 1,
        word,
      });
      from = at + 1;
    }
  }

  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

function replaceSpans(input: string, spans: Span[]): string {
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += input.slice(cursor, span.start) + '*'.repeat(span.end - span.start);
    cursor = span.end;
  }
  return out + input.slice(cursor);
}

/** 检测入口（昵称用）：命中返回那个词，未命中返回 `null`。 */
export function detect(input: string): string | null {
  return findSpans(input)[0]?.word ?? null;
}

/** 打码入口（聊天用）：命中词替换为等长的 `*`，循环到不再命中为止，其它内容原样保留。 */
export function mask(input: string): string {
  let out = input;
  // 上限只是防御：替换成 `*` 不会再构成新词，正常一轮就结束。
  for (let round = 0; round < 5; round += 1) {
    const spans = findSpans(out);
    if (spans.length === 0) return out;
    out = replaceSpans(out, spans);
  }
  return out;
}
