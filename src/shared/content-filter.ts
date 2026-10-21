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
 *
 * 联系方式与引流（手机号 / 邮箱 / URL / 平台号）另有一套正则，同一份归一化但**保留 `. - _ :`**，
 * 同样只打码不拒绝（把人带出厅的写法管不住，词库再大也没用）。
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

/** 联系方式用同一份归一化，但**保留 `. - _ :`**：邮箱 / URL / 裸域名的判定依赖它们真的在文本里。 */
const CONTACT_INTERFERENCE = new Set(
  [...interference].filter((char) => !'.-_:'.includes(char)),
);

/**
 * 联系方式与引流：命中一律走 `mask` 打码，不拒绝。跑在保留 `. - _ :` 的归一化文本上，
 * 因此 `138-1234-5678` 的分隔符在区间内、被一起打码；`mask` 仍是等长替换。
 * 反例见 `tests/content-filter.test.ts`：`internet` / `laptop` / `home` / `radio` 不得命中，
 * 所以裸域名的 TLD 表小而保守。
 */
const CONTACT_PATTERNS = [
  // 手机号：`1[3-9]` 开头的 11 位，分隔符只允许出现在数字之间（两侧有中文就是硬边界）。
  /(?<![0-9])1[3-9](?:[-_.]?[0-9]){9}(?![0-9])/g,
  // 邮箱：必须有域名点，`a@b` 不算。
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /https?:\/\/[\w./:@%&=+-]+/g,
  /www\.[\w-]+(?:\.[\w-]+)+/g,
  // 裸域名：点必须真在文本里。TLD 表小而保守，`me` / `co` / `so` 会让 `home` / `radio` 这类英文词尾命中。
  /(?<![\w.-])(?:[\w-]+\.)+(?:com|cn|net|org|io|cc|tv|info|top|vip|shop|site|app|xyz|club|link|live)(?![\w-])/g,
  // 平台引流：`qq` / `微信` / `vx` 等后面跟 4 位以上数字或字母，整段打码。
  /(?:qq|微信|vx|v信|企微|威信):?[a-z0-9]{4,}/g,
];

const { categories, curated } = words;

/** 聊天词集：全部类目 + 手工表。 */
export const CHAT_WORDS = normalizeWords([
  ...Object.values(categories).flat(),
  ...curated,
]);

/** 昵称词集：九类 + 手工表，**归一化之后**再剔掉单字与拆词残留（`detect` 用它，是 `CHAT_WORDS` 的子集）。
 * 单字不挡昵称：货真词库里的单字条目检测力极低，而昵称命中就意味着进不来。 */
export const NICKNAME_WORDS = normalizeWords([
  ...NICKNAME_CATEGORIES.flatMap((name) => categories[name]),
  ...curated,
]).filter((word) => word.length > 1 && !NICKNAME_FORGIVE.has(word));

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

function normalize(
  input: string,
  strip: ReadonlySet<string> = interference,
): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;
    const folded = halfWidth(char);
    // 干扰字符在折叠后判定：否则全角标点（`～` `－` `＿` `．`）会绕过剥离（`傻～逼` vs `傻~逼`）。
    if (/\s/.test(folded) || strip.has(char) || strip.has(folded)) continue;
    text += folded.toLowerCase();
    positions.push(index);
  }
  return { text, positions };
}

/** 词表在模块初始化时归一化一次（判定用的是归一化文本，位置由 positions 映回原文）。 */
function normalizeWords(list: readonly string[]): string[] {
  return list.map((word) => normalize(word).text).filter((word) => word.length > 0);
}

/** 重叠或相接的区间合并为一个，避免重复替换。 */
function mergeSpans(spans: Span[]): Span[] {
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

/** 找出所有命中的原文区间。 */
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

  return mergeSpans(spans);
}

/** 联系方式 / 引流命中的原文区间（同一套 `positions` 映回原坐标）。 */
function findContactSpans(input: string): Span[] {
  const { text, positions } = normalize(input, CONTACT_INTERFERENCE);
  const spans: Span[] = [];

  for (const pattern of CONTACT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const at = match.index as number;
      spans.push({
        start: positions[at] as number,
        end: (positions[at + match[0].length - 1] as number) + 1,
        word: match[0],
      });
    }
  }

  return mergeSpans(spans);
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

/** 打码命中：两个类目各自**被替换成 `*` 的字符数**（`100-log.md` §3 的 `censor{kind,n}`）。 */
export interface MaskHits {
  /** 词表命中（`CHAT_WORDS`）。 */
  word: number;
  /** 联系方式 / 引流命中（`CONTACT_PATTERNS`）。 */
  contact: number;
}

export interface MaskResult {
  text: string;
  hits: MaskHits;
}

/** 一类命中区间一共盖住多少字符：类目内部已经合并过重叠，跨类目重叠的各算各的（各自都替换了那些字符）。 */
function replacedChars(spans: readonly Span[]): number {
  let n = 0;
  for (const span of spans) n += span.end - span.start;
  return n;
}

/**
 * 打码入口（聊天用：全部类目 + 联系方式 / 引流）：命中替换为等长的 `*`，循环到不再命中为止，其它内容原样保留。
 * **命中计数与打码是同一趟**（两个类目的区间本来就要各取一次，数的是它们自己的长度，不为了计数再打一次码）。
 */
export function maskDetailed(input: string): MaskResult {
  const hits: MaskHits = { word: 0, contact: 0 };
  let out = input;
  // 上限只是防御：替换成 `*` 不会再构成新词，正常一轮就结束。
  for (let round = 0; round < 5; round += 1) {
    const wordSpans = findSpans(out, CHAT_WORDS);
    const contactSpans = findContactSpans(out);
    const spans = mergeSpans([...wordSpans, ...contactSpans]);
    if (spans.length === 0) break;
    hits.word += replacedChars(wordSpans);
    hits.contact += replacedChars(contactSpans);
    out = replaceSpans(out, spans);
  }
  return { text: out, hits };
}

/** 只要打码后的那一份文本（不需要计数时的入口）。 */
export function mask(input: string): string {
  return maskDetailed(input).text;
}
