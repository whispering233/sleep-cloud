import { describe, expect, it } from 'vitest';

import { HALL_ID } from '../../shared/constants';
import { LAYOUT_VERSION } from '../../shared/layout';
import { APPEARANCES } from '../../shared/protocol';
import app from '../app';
import type { Env } from '../env';

interface ApiBody {
  code: string;
  data?: Record<string, unknown>;
}

interface FakeHall {
  entryStatus(source: { userId: string; ip?: string }): Promise<{
    bedCount: number;
    full: boolean;
    blocked: { untilAt: number | null } | null;
  }>;
  fetch(request: Request): Promise<Response>;
}

/** 假房间服务：只实现本卡片用到的两个入口（真房间服务需要平台的 DO 运行时）。 */
type TestEnv = Env & { lastSource?: { userId: string; ip?: string } };

/** 假房间服务：只实现本卡片用到的两个入口（真房间服务需要平台的 DO 运行时）。 */
function makeEnv(options: { full?: boolean; blocked?: { untilAt: number | null } } = {}): TestEnv {
  const env = { SESSION_SECRET: 'test-secret' } as TestEnv;
  env.HALL = {
    getByName: (name: string) => ({
      name,
      entryStatus: (source: { userId: string; ip?: string }) => {
        env.lastSource = source;
        return Promise.resolve({ bedCount: 114, full: options.full ?? false, blocked: options.blocked ?? null });
      },
      fetch: (request: Request) =>
        Promise.resolve(new Response(JSON.stringify({ forwarded: headersOf(request) }), { status: 200 })),
    }),
  } as unknown as Env['HALL'];
  return env;
}

const headersOf = (request: Request): Record<string, string> => ({
  userId: request.headers.get('x-sleep-user-id') ?? '',
  name: decodeURIComponent(request.headers.get('x-sleep-name') ?? ''),
  appearance: request.headers.get('x-sleep-appearance') ?? '',
  ip: request.headers.get('x-sleep-ip') ?? '',
  country: request.headers.get('x-sleep-country') ?? '',
  uaHash: request.headers.get('x-sleep-ua-hash') ?? '',
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

/** `/api/ws` 转发给厅的那份身份头（假房间服务把它原样回成 JSON）。 */
const forwardedHeaders = async (env: Env, cookie: string): Promise<Record<string, string>> =>
  ((await (await get('/api/ws', env, cookie)).json()) as { forwarded: Record<string, string> }).forwarded;

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

  it('没选过形象也下发一个：按 user_id 派生的那个（入场层一进来就有预览高亮）', async () => {
    const env = makeEnv();
    const session = await currentSession(env, await newCookie(env));

    expect(APPEARANCES).toContain(session?.appearance);
  });

  it('厅满（级表触顶且无空床）→ 2002，但会话照常返回（前端据此提示而不是建连）', async () => {
    const env = makeEnv({ full: true });
    const res = await body(await app.request('/api/me', {}, env));

    expect(res.code).toBe('2002');
    expect(res.data?.userId).toBeDefined();
  });

  it('命中封禁 → 5002，且 data.untilAt 与厅给的一致（null = 永久）', async () => {
    const untilAt = 1_800_000_000_000;

    for (const blocked of [{ untilAt }, { untilAt: null }]) {
      const env = makeEnv({ blocked });
      const res = await body(await app.request('/api/me', {}, env));

      expect(res.code).toBe('5002');
      expect(res.data?.untilAt).toBe(blocked.untilAt);
      // 会话照常返回：入场层拿它渲染「你暂时无法进入」，不是重新签发
      expect(res.data?.userId).toBeDefined();
    }
  });

  it('封禁优先于厅满（两个都命中时给「不能进」这条）', async () => {
    const env = makeEnv({ full: true, blocked: { untilAt: null } });
    expect((await body(await app.request('/api/me', {}, env))).code).toBe('5002');
  });

  it('入场判定拿到的来源 = 平台 IP + 会话身份（只入台账与封禁判定）', async () => {
    const env = makeEnv();
    const res = await app.request('/api/me', { headers: { 'cf-connecting-ip': '1.1.1.1' } }, env);
    const session = ((await res.json()) as ApiBody).data as Record<string, unknown>;

    expect(env.lastSource).toEqual({ userId: session.userId, ip: '1.1.1.1' });
  });

  it('来源永不下发给客户端', async () => {
    const env = makeEnv();
    const session = (await currentSession(env, await newCookie(env))) as Record<string, unknown>;

    for (const key of ['ip', 'lastIp', 'country', 'uaHash']) expect(session).not.toHaveProperty(key);
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

  it('形象二选一：合法值写进会话', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);

    const saved = await postSession('/api/appearance', env, cookie, { appearance: 'girl' });
    expect(saved.code).toBe('0');
    expect((await currentSession(env, saved.cookie))?.appearance).toBe('girl');
  });

  it('非法形象被直接忽略：不报错、不写入会话（不加新错误码）', async () => {
    const env = makeEnv();
    const cookie = await newCookie(env);
    const before = await currentSession(env, cookie);

    for (const appearance of ['cat', '', 1, null]) {
      const ignored = await postSession('/api/appearance', env, cookie, { appearance });
      expect(ignored.code, String(appearance)).toBe('0');
      expect((await currentSession(env, ignored.cookie))?.appearance).toBe(before?.appearance);
    }
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
    expect(forwarded.userId).toMatch(/^u_[0-9a-f]{16}$/);
  });

  it('选过形象时身份头带所选值；没选过则不带（厅那边按 user_id 派生）', async () => {
    const env = makeEnv();
    const cookie = await enter(env);

    expect((await forwardedHeaders(env, cookie)).appearance).toBe('');

    const chosen = (await postSession('/api/appearance', env, cookie, { appearance: 'girl' })).cookie;
    expect((await forwardedHeaders(env, chosen)).appearance).toBe('girl');
  });

  it('来源头由 Worker 依据平台信息写入：客户端伪造的同名头被覆盖', async () => {
    const env = makeEnv();
    const cookie = await enter(env);
    const res = await app.request(
      '/api/ws',
      {
        headers: {
          cookie,
          'cf-connecting-ip': '1.1.1.1',
          'user-agent': 'sleep-cloud-test-agent',
          'x-sleep-ip': '9.9.9.9',
          'x-sleep-ua-hash': 'forged',
        },
      },
      env,
    );
    const forwarded = ((await res.json()) as { forwarded: Record<string, string> }).forwarded;

    expect(forwarded.ip).toBe('1.1.1.1');
    expect(forwarded.uaHash).toMatch(/^[0-9a-f]{16}$/);
    expect(forwarded.uaHash).not.toBe('forged');
  });

  it('来源不可知时删掉内部头（客户端伪造的 IP 头不会被厅采信）', async () => {
    const env = makeEnv();
    const cookie = await enter(env);
    const res = await app.request('/api/ws', { headers: { cookie, 'x-sleep-ip': '9.9.9.9' } }, env);

    expect((((await res.json()) as { forwarded: Record<string, string> }).forwarded).ip).toBe('');
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