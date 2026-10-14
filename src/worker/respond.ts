import { ERROR_MESSAGES, OK } from '../shared/error-code';
import type { Context } from 'hono';
import type { ErrorCode } from '../shared/error-code';

/** 公共响应体（见 `docs/api/api-public.md` §4）：业务错误统一 HTTP 200，错误语义由 `code` 承载。 */
export function ok(c: Context, data: object) {
  return c.json({ code: OK, msg: ERROR_MESSAGES[OK], data });
}

export function fail(c: Context, code: Exclude<ErrorCode, '0'>, data?: object) {
  return c.json({ code, msg: ERROR_MESSAGES[code], ...(data ? { data } : {}) });
}
