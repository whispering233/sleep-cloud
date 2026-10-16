import tokens from './styles/tokens.json';

/**
 * 「这段文字放得进气泡吗」的**估算**：Phaser-free（没有渲染器也能跑），所以界面层与单测都能直接用它。
 *
 * 分工：**提示用估算（宁可保守）、绘制用实测（必须准）**——画气泡时量的是 Phaser 文字对象的
 * 真实换行（`views.ts` 的 `truncateToLines` + `getWrappedText`），那才是对外的真相；
 * 输入框的提前提示只是「发送前先知道会被截断」，估出的行数不会比真实行数少（未知字符按最宽的一档算）。
 * 气泡的几何常量放这里一份：`views.ts` 与提示共用，改尺寸只改这一处。
 */
const theme = tokens.theme.extend;

/** 气泡文字用的字体（`body` 档第一项）与字号（世界像素 = CSS 像素，见 `docs/ui/DESIGN.md` 的 `caption` 档）。 */
export const FONT_FAMILY = (theme.fontFamily.body as string[])[0];
export const LABEL_PX = 12;

/** 气泡内边距（世界像素，内边距由文字自带）。 */
export const BUBBLE_PAD = 4;
/** 气泡的**宽度上限**（世界像素）。 */
export const CHAT_BUBBLE_MAX_PX = 200;
/** 气泡里最多两行，超出截断加 `…`（见 `views.ts` 的 `fitBubbleText`）。 */
export const CHAT_BUBBLE_MAX_LINES = 2;
/** 文字真正能用的宽度：气泡宽度扣掉左右内边距。 */
export const BUBBLE_TEXT_PX = CHAT_BUBBLE_MAX_PX - BUBBLE_PAD * 2;

/**
 * 12px 本机 Chromium 的**实测**字符宽（世界像素）：中文/全角 `12.00`、拉丁 `7.35`、空格与 `·` `3.81`。
 * 表外的字符（emoji、其它标点…）一律按最宽的中文档算——估多不估少。
 */
const WIDTH_CJK_PX = 12;
const WIDTH_LATIN_PX = 7.35;
const WIDTH_NARROW_PX = 3.81;

function charWidthPx(char: string): number {
  if (char === ' ' || char === '·') return WIDTH_NARROW_PX;
  // ASCII 可打印字符按拉丁算；其余（CJK、全角、表外）都按最宽的一档
  return (char.codePointAt(0) ?? 0) <= 0x7e ? WIDTH_LATIN_PX : WIDTH_CJK_PX;
}

/** 折行：按字符宽度累加，装不下就换行（换行符算一次硬换行）；返回每行各装了几个字。 */
function lineCharCounts(text: string): number[] {
  const lines: number[] = [];
  let count = 0;
  let width = 0;
  for (const char of text) {
    if (char === '\n') {
      lines.push(count);
      count = 0;
      width = 0;
      continue;
    }
    const charPx = charWidthPx(char);
    if (count > 0 && width + charPx > BUBBLE_TEXT_PX) {
      lines.push(count);
      count = 0;
      width = 0;
    }
    count += 1;
    width += charPx;
  }
  if (count > 0) lines.push(count);
  return lines;
}

/** 估算的行数（空串 0 行）。 */
export function estimateBubbleLines(text: string): number {
  return lineCharCounts(text).length;
}

/**
 * `undefined` = 放得下；否则给一行弱提示，N 是末尾会被 `…` 吃掉的字数。
 * 估算是**一字级**的，所以文案里写「约」；这里不承诺精确字数，也不改气泡的绘制规则。
 */
export function bubbleHintOf(text: string): string | undefined {
  const lines = lineCharCounts(text);
  if (lines.length <= CHAT_BUBBLE_MAX_LINES) return undefined;
  const shown = lines.slice(0, CHAT_BUBBLE_MAX_LINES).reduce((sum, count) => sum + count, 0);
  return `气泡里显示到这里，末尾约 ${[...text].length - shown} 字会变成 …`;
}