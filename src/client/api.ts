import type { ApiResponse, HallsView, SessionView } from '../shared/http-api';

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

export const loadHalls = () => request<HallsView>('/api/halls');

export const confirmAge = () => postJson<SessionView>('/api/age-confirm', { confirmed: true });

/** `timezone` 取自浏览器（服务端无从得知）；非法时服务端返回 `1006` 但昵称仍然保存。 */
export const setNickname = (nickname: string, timezone: string) =>
  postJson<SessionView>('/api/nickname', { nickname, timezone });

export const switchHall = (hallId: string) => postJson<SessionView>('/api/hall', { hallId });
