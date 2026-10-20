import { describe, expect, it } from 'vitest';

import { ADMIN_LOGIN_MAX_PER_MIN } from '../../shared/constants';
import app from '../app';
import type { Env } from '../env';

const TOKEN = 'test-admin-token';

/** 后台只用到 `SESSION_SECRET` 与 `ADMIN_TOKEN`：厅对象一条路由都不经过（那是台账/封禁的事）。 */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return { SESSION_SECRET: 'test-secret', ADMIN_TOKEN: TOKEN, ...overrides } as Env;
}

const login = (env: Env, token: unknown, headers: Record<string, string> = {}) =>
  app.request(
    '/api/admin/login',
    { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ token }) },
    env,
  );

/**
 * 本卡唯一的受保护路由（登录之外的 `/api/admin/*` 全部在中间件后面）：
 * 200 即中间件放行，401 即被挡下。
 */
const protectedPath = (env: Env, cookie?: string) =>
  app.request('/api/admin/me', { headers: cookie ? { cookie } : {} }, env);

const logout = (env: Env, cookie: string) =>
  app.request('/api/admin/logout', { method: 'POST', headers: { cookie } }, env);

/** 取 cookie 的 `name=value` 那一段（不含属性）。 */
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

const newAdminCookie = async (env: Env): Promise<string> => cookieOf(await login(env, TOKEN));

describe('后台登录与 sc_admin 会话', () => {
  it('没有 cookie 打受保护路径 → 401', async () => {
    expect((await protectedPath(makeEnv())).status).toBe(401);
  });

  it('错 token → 401，且不下发 cookie', async () => {
    for (const token of ['wrong', '', undefined, 123]) {
      const res = await login(makeEnv(), token);
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('对 token → 200 且下发 HttpOnly / SameSite=Strict 的 sc_admin（24 小时）', async () => {
    const res = await login(makeEnv(), TOKEN);
    const cookie = res.headers.get('set-cookie') ?? '';

    expect(res.status).toBe(200);
    expect(cookie).toContain('sc_admin=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Max-Age=${24 * 60 * 60}`);
  });

  it('带着登录拿到的 cookie 打受保护路径 → 放行（回数据对象，不套 {code,msg,data}）', async () => {
    const env = makeEnv();
    const res = await protectedPath(env, await newAdminCookie(env));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('换掉 ADMIN_TOKEN 后旧 cookie → 401（fp 不匹配，撤权不用等 24 小时）', async () => {
    const oldCookie = await newAdminCookie(makeEnv());
    const rotated = makeEnv({ ADMIN_TOKEN: 'rotated-admin-token' });

    expect((await protectedPath(rotated, oldCookie)).status).toBe(401);
  });

  it('登出清掉 cookie（Max-Age=0），之后同一枚 cookie → 401', async () => {
    const env = makeEnv();
    const cookie = await newAdminCookie(env);

    const res = await logout(env, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    // 浏览器按这份 set-cookie 把值清成空：再发就是「没有有效 cookie」
    expect((await protectedPath(env, cookieOf(res))).status).toBe(401);
  });

  it(`同一 IP 一分钟内第 ${ADMIN_LOGIN_MAX_PER_MIN + 1} 次登录 → 429（前 ${ADMIN_LOGIN_MAX_PER_MIN} 次只判对错）`, async () => {
    const env = makeEnv();
    // 独立的来源 IP：限速计数按 IP 放内存，与其它用例互不干扰
    const headers = { 'cf-connecting-ip': '203.0.113.7' };

    for (let attempt = 1; attempt <= ADMIN_LOGIN_MAX_PER_MIN; attempt += 1) {
      expect((await login(env, 'wrong', headers)).status).toBe(401);
    }
    expect((await login(env, TOKEN, headers)).status).toBe(429);
  });

  it('ADMIN_TOKEN 未配置 → 受保护路径 401（不是 500），登录也是 401', async () => {
    const env = makeEnv({ ADMIN_TOKEN: undefined });

    expect((await protectedPath(env, 'sc_admin=whatever')).status).toBe(401);
    expect((await login(env, '')).status).toBe(401);
  });
});
