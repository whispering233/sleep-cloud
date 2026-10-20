import { generateSignedCookie } from 'hono/cookie';
import { describe, expect, it } from 'vitest';

import { HALL_ID } from '../../shared/constants';
import app from '../app';
import type { Env } from '../env';

/**
 * 密钥环（见 `docs/design/config.md` §4）：签名恒用 `SESSION_SECRET`，验签先试它、再试 `SESSION_SECRET_PREV`。
 *
 * 全程走 `/api/me`：它读会话、验签、**每次响应重签回写 cookie**——正是真实路径。
 */

/** 假房间服务：只实现 `/api/me` 用到的 `entryStatus`（真房间服务需要平台的 DO 运行时）。 */
function makeEnv(secrets: { current?: string; prev?: string }): Env {
  const env = { SESSION_SECRET: secrets.current, SESSION_SECRET_PREV: secrets.prev } as Env;
  env.HALL = {
    getByName: () => ({
      name: HALL_ID,
      entryStatus: () => Promise.resolve({ bedCount: 114, full: false, blocked: null }),
    }),
  } as unknown as Env['HALL'];
  return env;
}

interface ApiBody {
  code: string;
  data?: Record<string, unknown>;
}

/** 一枚在 `secret` 下签好的会话 cookie 头（格式与 `writeSession` 出的完全一致）。 */
const signedCookie = (secret: string, userId: string): Promise<string> =>
  generateSignedCookie('sc_session', JSON.stringify({ userId, ageConfirmed: false }), secret);

const me = async (env: Env, cookie?: string): Promise<{ body: ApiBody; cookie: string }> => {
  const res = await app.request('/api/me', cookie ? { headers: { cookie } } : {}, env);
  return {
    body: (await res.json()) as ApiBody,
    // 回写给客户端的会话 cookie（`name=value`）；错误响应也可能带
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
  };
};

const userIdOf = (body: ApiBody): string => String(body.data?.userId);

describe('会话密钥环', () => {
  it('只有当前密钥：签发与验签都正常（回同一身份）', async () => {
    const env = makeEnv({ current: 'new-secret' });
    const first = await me(env);
    expect(first.body.code).toBe('0');

    const second = await me(env, first.cookie);
    expect(second.body.code).toBe('0');
    expect(userIdOf(second.body)).toBe(userIdOf(first.body));
  });

  it('旧密钥签的 cookie + `_PREV` 是旧密钥 → 验签通过，并重签成当前密钥', async () => {
    const env = makeEnv({ current: 'new-secret', prev: 'old-secret' });
    const legacy = await signedCookie('old-secret', 'u_0123456789abcdef');

    const res = await me(env, legacy);
    expect(res.body.code).toBe('0');
    expect(userIdOf(res.body)).toBe('u_0123456789abcdef');

    // 新 cookie 用**当前**密钥能验……
    const withNew = await me(makeEnv({ current: 'new-secret' }), res.cookie);
    expect(withNew.body.code).toBe('0');
    expect(userIdOf(withNew.body)).toBe('u_0123456789abcdef');

    // ……用旧密钥验不了（否则轮换永远不会收敛）
    const withOld = await me(makeEnv({ current: 'old-secret' }), res.cookie);
    expect(withOld.body.code).toBe('1001');
  });

  it('两把都不匹配 → 1001（会话失效）并签发新会话', async () => {
    const env = makeEnv({ current: 'new-secret', prev: 'old-secret' });
    const foreign = await signedCookie('someone-else-secret', 'u_0123456789abcdef');

    const res = await me(env, foreign);
    expect(res.body.code).toBe('1001');
    expect(userIdOf(res.body)).not.toBe('u_0123456789abcdef');
    expect(res.cookie).not.toBe(foreign);
  });

  it('`SESSION_SECRET` 缺失 → 直接失败（9001），绝不回落到可猜的密钥', async () => {
    const env = makeEnv({ prev: 'old-secret' });

    const res = await me(env);
    expect(res.body.code).toBe('9001');
    expect(res.cookie).toBe('');
  });

  it('`_PREV` 与当前密钥相同 → 不炸，按正常路径走', async () => {
    const env = makeEnv({ current: 'same-secret', prev: 'same-secret' });
    const first = await me(env);
    expect(first.body.code).toBe('0');

    const second = await me(env, first.cookie);
    expect(second.body.code).toBe('0');
    expect(userIdOf(second.body)).toBe(userIdOf(first.body));
  });
});
