import type { ErrorCode } from './error-code';

/**
 * HTTP 接口的数据形状（见 `docs/api/10-api-http.md`）。服务端与前端引用同一份，避免两边各写一遍而漂移。
 */

export interface ApiResponse<T> {
  code: ErrorCode;
  msg: string;
  data?: T;
}

/** 会话内容的对外形态（`GET /api/me` 等）。**不含床位号**：归属的权威在厅的数据库。 */
export interface SessionView {
  userId: string;
  hallId: string;
  /** 未设置时为空串 */
  nickname: string;
  ageConfirmed: boolean;
  /** 为真表示必须先设昵称才能进厅 */
  needsNickname: boolean;
  timezone: string;
}

export interface HallSummary {
  id: string;
  name: string;
  timezone: string;
  capacity: number;
  /** **归属数**（已被认领的床位数），不是在线人数 */
  acceptedBeds: number;
  current: boolean;
}

export interface HallsView {
  halls: HallSummary[];
}
