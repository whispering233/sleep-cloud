import words from './blocked-words.json';

/**
 * 内容过滤（服务端专用，见 `10-hall-runtime.md` §8）：词库是生成产物（`tools/words/`，`npm run words`，
 * 见 `docs/design/config.md` §6），两条路径用**不同的词集**：
 *
 * - **检测**（`detect`）：用于昵称，命中即拒绝。词集是**九类 + 手工表再减 10 条拆词残留**——误伤代价是
 *   用户进不来，所以 GFW / 民生 / 补充 / 其他 / COVID / 广告 六类不进昵称。
 * - **打码**（`mask`）：用于聊天，命中词替换为 `*` 后**照常放行**（硬拦截会让发送者意识到被审查并试探绕过）。
 *   误伤代价只是几个星号，所以用全部类目。
 *
 * 匹配前剥离干扰字符与空白、全角转半角、统一小写，因此 `傻·逼`、`傻 逼`、`ＦＵＣＫ` 都会被命中。
 */

/** 昵称用的九类：需要持续收紧的是色情 / 政治类，其余六类只用于聊天打码。 */
const NICKNAME_CATEGORIES = [
  '色情',
  '色情词库',
  '政治',
  '暴恐',
  '涉枪涉爆',
  '反动',
  '贪腐',
  '新思想启蒙',
  '非法网址',
] as const;

/** 从昵称词集里剔除的拆词残留：它们是上面九类里拼出来的日常词，命中就等于进不来。 */
const NICKNAME_FORGIVE = new Set([
  '疫情',
  '肺炎',
  '中央',
  '政府',
  '武汉',
  '总理',
  '北京',
  '兼职',
  '招聘',
  '网络',
]);

const ZERO_WIDTH = '\u200b\u200c\u200d\u2060\ufeff';

/** 匹配前剥离的插入字符（`傻·逼` 这类写法靠它命中）。 */
const INTERFERENCE_CHARS =
  '·・•（）()〈〉〈〉【】[]{}！!？?《》￥$…—-_~`\'"“”‘’、,，。.：:；;';

const interference = new Set([...INTERFERENCE_CHARS, ...ZERO_WIDTH]);

const { categories, curated } = words;

/** 聊天词集：全部类目 + 手工表。 */
export const CHAT_WORDS = normalizeWords([
  ...Object.values(categories).flat(),
  ...curated,
]);

/** 昵称词集：九类 + 手工表，减掉拆词残留与单字词条（`detect` 用它，是 `CHAT_WORDS` 的子集）。
 * 单字不挡昵称：真词库里的单字条目检测力极低，而昵称命中就意味着进不来。 */
export const NICKNAME_WORDS = normalizeWords(
  [...NICKNAME_CATEGORIES.flatMap((name) => categories[name]), ...curated].filter(
    (word) => word.length > 1 && !NICKNAME_FORGIVE.has(word),
  ),
);

interface Span {
  start: number;
  end: number;
  word: string;
}

/** 全角转半角（`ＦＵＣＫ` → `FUCK`）；全角空格本身就是空白，走调用处的空白剥离。 */
function halfWidth(char: string): string {
  const code = char.charCodeAt(0);
  return code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : char;
}

function normalize(input: string): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;
    if (/\s/.test(char) || interference.has(char)) continue;
    text += halfWidth(char).toLowerCase();
    positions.push(index);
  }
  return { text, positions };
}

/** 词表在模块初始化时归一化一次（判定用的是归一化文本，位置由 positions 映回原文）。 */
function normalizeWords(list: readonly string[]): string[] {
  return list.map((word) => normalize(word).text).filter((word) => word.length > 0);
}

/** 找出所有命中的原文区间（重叠或相接的合并为一个，避免重复替换）。 */
function findSpans(input: string, wordList: readonly string[]): Span[] {
  const { text, positions } = normalize(input);
  const spans: Span[] = [];

  for (const word of wordList) {
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

/** 检测入口（昵称用，窄词集）：命中返回那个词，未命中返回 `null`。 */
export function detect(input: string): string | null {
  return findSpans(input, NICKNAME_WORDS)[0]?.word ?? null;
}

/** 打码入口（聊天用，全部类目）：命中词替换为等长的 `*`，循环到不再命中为止，其它内容原样保留。 */
export function mask(input: string): string {
  let out = input;
  // 上限只是防御：替换成 `*` 不会再构成新词，正常一轮就结束。
  for (let round = 0; round < 5; round += 1) {
    const spans = findSpans(out, CHAT_WORDS);
    if (spans.length === 0) return out;
    out = replaceSpans(out, spans);
  }
  return out;
}
