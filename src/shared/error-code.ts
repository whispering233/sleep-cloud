/**
 * 错误码表。**与 `docs/api/error-code.md` 的错误码表逐条一致**，由单元测试比对文档强制保证。
 *
 * 分段：1xxx 会话与入场 / 2xxx 大厅与房间 / 3xxx 床位 / 4xxx 内容与限流 / 5xxx 风控 / 9xxx 系统。
 * `5xxx` 段中 `5002`（封禁）/ `5003`（举报回执）/ `5004`（反馈回执）已启用；`5001`（禁言）仍为预留。
 */
export const ERROR_MESSAGES = {
  '0': 'success',
  '1001': 'invalid session',
  '1002': 'age confirmation required',
  '1003': 'nickname required',
  '1004': 'nickname too long',
  '1005': 'nickname contains blocked words',
  '2001': 'hall not found',
  '2002': 'hall is full',
  '2003': 'layout mismatch',
  '2004': 'handshake required',
  '2005': 'not in room',
  '3001': 'bed out of range',
  '3002': 'bed occupied',
  '3003': 'bed belongs to someone else',
  '3004': 'already in bed',
  '3005': 'not in bed',
  '3006': 'target not walkable',
  '3008': 'bed switch cooling down',
  '4001': 'message too long',
  '4002': 'rate limited',
  '4003': 'empty message',
  '4004': 'feedback quota exceeded',
  '5001': 'muted',
  '5002': 'blocked',
  '5003': 'reported',
  '5004': 'feedback received',
  '9001': 'internal error',
  '9002': 'hall unavailable',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

/** 成功码。 */
export const OK: ErrorCode = '0';
