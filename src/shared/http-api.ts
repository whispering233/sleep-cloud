import type { Appearance } from './protocol';
import type { ErrorCode } from './error-code';

/**
 * HTTP 接口的数据形状（见 `docs/api/10-api-http.md`）。服务端与前端引用同一份，避免两边各写一遍而漂移。
 */

export interface ApiResponse<T> {
  code: ErrorCode;
  msg: string;
  data?: T;
}

/**
 * 会话内容的对外形态（`GET /api/me`）。**不含床位号、不含厅、不含时区**：
 * 床位归属的权威在厅的数据库；只有一个厅，路由用常量；时区概念整体删除
 * （见 `docs/api/api-public.md` §2.2）。
 */
export interface SessionView {
  userId: string;
  /** 未设置时为空串 */
  nickname: string;
  ageConfirmed: boolean;
  /** 入场层选的形象；**没选过时下发按 `user_id` 派生的那个**（与服务端将要用的值一致） */
  appearance: Appearance;
  /** 为真表示必须先设昵称才能进厅 */
  needsNickname: boolean;
  /** 布局版本号：客户端建连时首条 `hello` 必须带上它（见 `docs/design/config.md` §1） */
  layoutVersion: string;
  /** **仅在 `/api/me` 命中封禁（`5002`）时出现**：封禁到期时刻（epoch 毫秒），`null` = 永久 */
  untilAt?: number | null;
}
