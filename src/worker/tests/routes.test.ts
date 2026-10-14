import { describe, expect, it } from 'vitest';

import { HALLS } from '../../shared/hall-registry';
import app from '../app';
import type { Env } from '../env';

interface ApiBody {
  code: string;
  data?: Record<string, unknown>;
}

/** 假房间服务：只实现本卡片用到的 `claimedBedCount`（真房间服务需要平台的 DO 运行时）。 */
function makeEnv(claimedBeds = 0): Env {
  const stub = { claimedBedCount: () => Promise.resolve(claimedBeds) };
  return {
    SESSION_SECRET: 'test-secret',
    HALL: { getByName: () => stub } as unknown as Env['HALL'],
  };
}

const body = async (res: Response): Promise<ApiBody> => (await res.json()) as ApiBody;

/** 取会话 cookie（`name=value`）。 */
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

const newCookie = async (env: Env): Promise<string> =>
  cookieOf(await app.request('/api/me', {}, env));

const get = (path: string, env: Env, cookie: string) =>
  app.request(path, { headers: { cookie } }, env);

const post = (path: string, env: Env, cookie: string, payload: unknown) =>
  app.request(
    path,
    { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    env,
  );

const currentSession = async (env: Env, cookie: string) => (await body(await get('/api/me', env, cookie))).data;

/** 写会话的接口都会重签 cookie（会话是无状态的），后续请求要用新的那一份。 */
async function postSession(path: string, env: Env, cookie: string, payload: unknown) {
  const res = await post(path, env, cookie, payload);
  return { code: (await body(res)).code, cookie: cookieOf(res) || cookie };
}

describe('匿名会话接口', () => {
  it('连续两次请求得到同一身份；没有 cookie 时得到新身份', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    const first = await body(await get('/api/me', env, cookie));
    const second = await body(await get('/api/me', env, cookie));
    const other = await body(await app.request('/api/me', {}, env));

    expect(first.code).toBe('0');
    expect(first.data?.userId).toBe(second.data?.userId);
    expect(other.data?.userId).not.toBe(first.data?.userId);
  });

  it('篡改 cookie 视为新会话（1001，并换发新 cookie）', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);
    const tampered = cookie.replace(/u_[0-9a-f]/, 'u_f');

    const res = await get('/api/me', env, tampered);
    expect((await body(res)).code).toBe('1001');
    expect(cookieOf(res)).not.toBe(cookie);
  });
});

describe('入场接口', () => {
  it('18 岁自述必须显式为 true', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    expect((await postSession('/api/age-confirm', env, cookie, { confirmed: false })).code).toBe('1002');
    expect((await currentSession(env, cookie))?.ageConfirmed).toBe(false);

    const accepted = await postSession('/api/age-confirm', env, cookie, { confirmed: true });
    expect(accepted.code).toBe('0');
    expect((await currentSession(env, accepted.cookie))?.ageConfirmed).toBe(true);
  });

  it('昵称超长或命中敏感词都被拒绝，且不写入会话', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    expect((await postSession('/api/nickname', env, cookie, { nickname: '名'.repeat(17) })).code).toBe('1004');
    expect((await postSession('/api/nickname', env, cookie, { nickname: '傻·逼' })).code).toBe('1005');
    expect((await postSession('/api/nickname', env, cookie, { nickname: '   ' })).code).toBe('1004');
    expect((await currentSession(env, cookie))?.nickname).toBe('');
  });

  it('合法昵称被接受', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    const saved = await postSession('/api/nickname', env, cookie, { nickname: '小明', timezone: 'Asia/Shanghai' });
    expect(saved.code).toBe('0');
    expect(await currentSession(env, saved.cookie)).toMatchObject({ nickname: '小明', needsNickname: false });
  });

  it('时区非法返回 1006，但昵称仍然保存', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    const saved = await postSession('/api/nickname', env, cookie, { nickname: '阿雅', timezone: 'Mars/Olympus' });
    expect(saved.code).toBe('1006');
    expect((await currentSession(env, saved.cookie))?.nickname).toBe('阿雅');
  });
});

describe('大区接口', () => {
  it('厅列表带归属数与当前大区标记', async () => {
    const env = makeEnv(7);
    const cookie = await newCookie(env);
    const halls = (await body(await get('/api/halls', env, cookie))).data?.halls as Array<Record<string, unknown>>;

    expect(halls.map((hall) => hall.id)).toEqual(HALLS.map((hall) => hall.id));
    expect(halls.every((hall) => hall.acceptedBeds === 7)).toBe(true);
    expect(halls.filter((hall) => hall.current === true)).toHaveLength(1);
  });

  it('切换大区：不存在的厅 2001，满员的厅 2002，正常切换写入会话', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    expect((await postSession('/api/hall', env, cookie, { hallId: 'nope' })).code).toBe('2001');
    const switched = await postSession('/api/hall', env, cookie, { hallId: HALLS[1]?.id });
    expect(switched.code).toBe('0');
    expect((await currentSession(env, switched.cookie))?.hallId).toBe(HALLS[1]?.id);

    const fullEnv = makeEnv(HALLS[2]?.capacity ?? 256);
    const fullCookie = await newCookie(fullEnv);
    expect((await postSession('/api/hall', fullEnv, fullCookie, { hallId: HALLS[2]?.id })).code).toBe('2002');
  });
});
