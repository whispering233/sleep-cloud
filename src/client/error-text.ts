import { NICKNAME_MAX_LEN } from '../shared/constants';
import type { ErrorCode } from '../shared/error-code';

/** 给不出文案时的兜底：用户看到的都是「服务端出了状况」（与 `9001` 同一句话，只写一次）。 */
export const ERROR_FALLBACK_TEXT = '出了点问题，稍后再试';

/**
 * 错误码 → 用户可见文案。
 *
 * **不复用服务端的 `msg`**：`msg` 面向开发者（见 `docs/api/error-code.md` §1），
 * 这里的文案逐条取自该文档错误码表的「用户可见文案方向」列，由单测比对文档强制保证。
 *
 * `undefined` = 静默：用户对这些失败无能为力，而错误反馈本身会变成放大器（见 `AGENTS.md` 硬纪律 11）。
 * 类型写成 `Record<Exclude<ErrorCode, '0'>, …>` 是为了让「漏了一个码」在编译期就报错。
 */
export const ERROR_TEXT: Record<Exclude<ErrorCode, '0'>, string | undefined> = {
  '1001': undefined,
  '1002': '进入前请先确认',
  '1003': '给自己起个名字吧',
  '1004': `名字 1~${NICKNAME_MAX_LEN} 个字`,
  '1005': '这个名字不能用，换一个',
  '2001': '请刷新页面',
  '2002': '这个大厅满了',
  '2003': '资源已更新，请刷新页面',
  '2004': undefined,
  '2005': undefined,
  '3001': undefined,
  '3002': '这张床有人了',
  '3003': '这是别人的床',
  '3004': undefined,
  '3005': undefined,
  '3006': undefined,
  '3007': '你已经有一张床了',
  '4001': '消息太长了',
  '4002': undefined,
  '4003': undefined,
  '5001': '你暂时不能发言',
  '5002': '你暂时无法进入',
  '5003': '已收到你的反馈',
  '9001': ERROR_FALLBACK_TEXT,
  '9002': '大厅暂时进不去，稍后再试',
};

/** 查文案：静默类与未知码都返回 `undefined`，由调用方决定是兜底还是什么都不做。 */
export function errorTextFor(code: string): string | undefined {
  return ERROR_TEXT[code as Exclude<ErrorCode, '0'>];
}