import { mask } from '../shared/content-filter';
import type { ErrorCode } from '../shared/error-code';

/**
 * 聊天文本判定（见 `docs/design/10-hall-runtime.md` §8）：空消息丢弃、超长拒绝，
 * 命中敏感词**打码后照常放行**——硬拦截会让发送者意识到被审查并试探绕过。
 */
export type ChatVerdict = { ok: true; text: string } | { ok: false; code: ErrorCode };

export function chatVerdictFor(raw: unknown, maxLen: number): ChatVerdict {
  if (typeof raw !== 'string') return { ok: false, code: '4003' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, code: '4003' };
  if ([...trimmed].length > maxLen) return { ok: false, code: '4001' };
  return { ok: true, text: mask(trimmed) };
}
