import { describe, expect, it } from 'vitest';

import { HALL_ID } from '../../shared/constants';
import { LAYOUT_VERSION } from '../../shared/layout';
import app from '../app';
import type { Env } from '../env';

interface ApiBody {
  code: string;
  data?: Record<string, unknown>;
}

interface FakeHall {
  entryStatus(): Promise<{ bedCount: number; full: boolean }>;
  fetch(request: Request): Promise<Response>;
}

/** 假房间服务：只实现本卡片用到的两个入口（真房间服务需要平台的 DO 运行时）。 */
function makeEnv(options: { ownedBeds?: number; full?: boolean } = {}): Env {
  const stub: FakeHall = {
    entryStatus: () => Promise.resolve({ bedCount: 114, full: options.full ?? false }),
    fetch: (request: Request) =>
      Promise.resolve(new Response(JSON.stringify({ forwarded: headersOf(request) }), { status: 200 })),
  };
  return {
    SESSION_SECRET: 'test-secret',
    HALL: { getByName: (name: string) => ({ ...stub, name }) } as unknown as Env['HALL'],
  };
}

const headersOf = (request: Request): Record<string, string> => ({
  userId: request.headers.get('x-sleep-user-id') ?? '',
  name: decodeURIComponent(request.headers.get('x-sleep-name') ?? ''),
});

const body = async (res: Response): Promise<ApiBody> => (await res.json()) as ApiBody;

/** 取会话 cookie（`name=value`）。 */
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

const newCookie = async (env: Env): Promise<string> => cookieOf(await app.request('/api/me', {}, env));

const get = (path: string, env: Env, cookie: string) => app.request(path, { headers: { cookie } }, env);

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

  it('会话里没有厅、没有时区，带布局版本号（单厅 + 无时区概念）', async () => {
    const env = makeEnv();
    const session = (await currentSession(env, await newCookie(env))) as Record<string, unknown>;

    expect(session.layoutVersion).toBe(LAYOUT_VERSION);
    expect(session).not.toHaveProperty('hallId');
    expect(session).not.toHaveProperty('timezone');
  });

  it('厅满（级表触顶且无空床）→ 2002，但会话照常返回（前端据此提示而不是建连）', async () => {
    const env = makeEnv({ full: true });
    const res = await body(await app.request('/api/me', {}, env));

    expect(res.code).toBe('2002');
    expect(res.data?.userId).toBeDefined();
  });

  it('篡改 cookie 视为新会话（1001，并换发新 cookie）', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);
    const tampered = cookie.replace(/u_[0-9a-f]/, (match) => (match === 'u_f' ? 'u_e' : 'u_f'));

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

  it('合法昵称被接受（不再上报时区，也没有 1006）', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    const saved = await postSession('/api/nickname', env, cookie, { nickname: '小明' });
    expect(saved.code).toBe('0');
    expect(await currentSession(env, saved.cookie)).toMatchObject({ nickname: '小明', needsNickname: false });
  });
});

describe('WebSocket 升级', () => {
  const enter = async (env: Env, nickname = '小明') => {
    let cookie = await newCookie(env);
    cookie = (await postSession('/api/age-confirm', env, cookie, { confirmed: true })).cookie;
    cookie = (await postSession('/api/nickname', env, cookie, { nickname })).cookie;
    return cookie;
  };

  it('唯一入口是 /api/ws（路径里不带厅标识）', async () => {
    const env = makeEnv();
    const cookie = await enter(env);
    const res = await get('/api/ws', env, cookie);
    const forwarded = (await res.json()) as { forwarded: Record<string, string> };

    expect(res.status).toBe(200);
    expect(forwarded.forwarded.name).toBe('小明');
    expect((await get('/api/halls/asia-1/ws', env, cookie)).status).toBe(404); // 旧路由不存在
  });

  it('身份由 Worker 依据验签后的会话写入（客户端伪造的同名头被覆盖）', async () => {
    const env = makeEnv();
    const cookie = await enter(env, '阿雅');
    const res = await app.request(
      '/api/ws',
      { headers: { cookie, 'x-sleep-user-id': 'u_forged', 'x-sleep-name': 'forged' } },
      env,
    );
    const forwarded = ((await res.json()) as { forwarded: Record<string, string> }).forwarded;

    expect(forwarded.name).toBe('阿雅');
    expect(forwarded.userId).toMatch(/^u_[0-9a-f]{10}$/);
  });

  it('未自述 → 1002；未设昵称 → 1003（都不升级连接）', async () => {
    const env = makeEnv();
    const raw = await newCookie(env);
    expect((await body(await get('/api/ws', env, raw))).code).toBe('1002');

    const aged = (await postSession('/api/age-confirm', env, raw, { confirmed: true })).cookie;
    expect((await body(await get('/api/ws', env, aged))).code).toBe('1003');
  });

  it('已删的厅接口不再存在（单厅）', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    for (const path of ['/api/halls', '/api/hall']) {
      const res = await get(path, env, cookie);
      expect(res.status, path).toBe(404);
    }
  });

  it('房间服务实例名是那个唯一的厅标识', async () => {
    const env = makeEnv();
    const cookie = await enter(env);
    await get('/api/ws', env, cookie);
    // `getByName` 只接受这一个常量；换个名字在真实现里就是「不认识的厅标识」
    expect(HALL_ID).toBe('main-1');
  });
});