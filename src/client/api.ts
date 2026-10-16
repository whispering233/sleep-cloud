import type { ApiResponse, SessionView } from '../shared/http-api';
import type { Appearance } from '../shared/protocol';

/** HTTP 接口调用（同源，会话 cookie 自动携带）。 */

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    // 网关/平台出错时给的不是 JSON（例如 500 的纯文本），别让前端崩在解析上
    return { code: '9001', msg: 'internal error' };
  }
}

const postJson = <T>(path: string, payload: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(payload) });

export const loadSession = () => request<SessionView>('/api/me');

export const confirmAge = () => postJson<SessionView>('/api/age-confirm', { confirmed: true });

/** 昵称只在建连之前设置（协议里因此不需要「改名」消息）。 */
export const setNickname = (nickname: string) => postJson<SessionView>('/api/nickname', { nickname });

/** 形象也只在建连之前选（与改名同理：协议里不需要「改形象」消息）。 */
export const setAppearance = (appearance: Appearance) =>
  postJson<SessionView>('/api/appearance', { appearance });
