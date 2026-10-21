import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Context } from 'hono';

import { ADMIN_LOGIN_MAX_PER_MIN, ADMIN_SESSION_MS, HALL_ID } from '../shared/constants';
import { ADMIN_HEADER } from '../hall/admin';
import type { Env } from './env';
import { isSecureRequest, sessionSecret } from './session';

/**
 * 后台运维面（见 `docs/api/30-api-admin.md`）：页面壳是 `public/admin.html` 这份静态文件，
 * 这里只挂 `/api/admin/*` 的数据接口。
 *
 * 与其他接口有两处刻意的不同（本项目**唯一**的契约例外，只限本子路由）：
 * - 未授权用 **HTTP 401**、成功直接回数据对象——**不套** `{code,msg,data}`，也不新增用户面错误码；
 * - 鉴权是平台密钥 `ADMIN_TOKEN` 换来的一枚独立签名 cookie `sc_admin`，与 `sc_session` 的名字、
 *   用途、值域全部不共享。
 */

const COOKIE_NAME = 'sc_admin';

/** 不需要 `sc_admin` 的唯一入口：它本身就是换这枚 cookie 的地方（`endsWith` 而非全路径，免得耦合挂载点）。 */
const LOGIN_PATH = '/login';

const admin = new Hono<{ Bindings: Env }>();

/** 长度先比、再逐字节异或累加：早退会按时长泄露「猜对了几位」。 */
function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (const [index, byte] of a.entries()) diff |= byte ^ (b[index] ?? 0);
  return diff === 0;
}

/** `fp` = `SHA-256(ADMIN_TOKEN)` 的前 8 个十六进制字符（4 字节）：换令牌后旧 cookie 立刻失效。 */
async function fingerprintOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest).slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface AdminSession {
  /** `ADMIN_TOKEN` 的指纹。**token 本身不进客户端** */
  fp: string;
  /** 签发时刻（epoch 毫秒） */
  iat: number;
}

function parseAdminSession(raw: string): AdminSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (typeof parsed.fp !== 'string' || typeof parsed.iat !== 'number') return null;
    return { fp: parsed.fp, iat: parsed.iat };
  } catch {
    return null;
  }
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/**
 * 登录限速：同一 IP 每分钟超过 `ADMIN_LOGIN_MAX_PER_MIN` 次 → 429。计数放内存——Worker 是无状态的
 * 多实例，这个计数只防在线爆破，不追求精确（`docs/api/30-api-admin.md` §2.1）。
 */
function rateLimited(ip: string, now: number): boolean {
  // 过期的键只在表变大时顺手清一次：长活的 isolate 里不扫会随不同 IP 一直涨
  if (attempts.size > 512) for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);

  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > ADMIN_LOGIN_MAX_PER_MIN;
}

/** 验签 + `fp` 与当前 `ADMIN_TOKEN` 一致 + 未过期。任一不满足就是不授权（缺令牌时**一律**不授权）。 */
async function authorized(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return false;

  const raw = await getSignedCookie(c, sessionSecret(c), COOKIE_NAME);
  if (typeof raw !== 'string') return false;

  const session = parseAdminSession(raw);
  if (!session) return false;
  // cookie 的 `maxAge` 只管浏览器，服务端仍要自己核一遍过期
  if (session.iat + ADMIN_SESSION_MS <= Date.now()) return false;
  return constantTimeEqual(session.fp, await fingerprintOf(token));
}

admin.use('*', async (c, next) => {
  if (c.req.path.endsWith(LOGIN_PATH)) return next();
  if (!(await authorized(c))) return c.body(null, 401);
  return next();
});

/**
 * 最小的受保护路由：只回一个常量。它验的是中间件，也是页面壳「刷新后还登着吗」的唯一依据。
 */
admin.get('/me', (c) => c.json({ ok: true }));

admin.post('/login', async (c) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return c.body(null, 401);

  // 取不到 IP 时不限速：本地开发没有 `CF-Connecting-IP`，硬拦会让本机无法登录
  const ip = c.req.header('cf-connecting-ip');
  if (ip && rateLimited(ip, Date.now())) return c.body(null, 429);

  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
  const attempt = typeof body.token === 'string' ? body.token : '';
  if (!constantTimeEqual(attempt, token)) return c.body(null, 401);

  const session: AdminSession = { fp: await fingerprintOf(token), iat: Date.now() };
  await setSignedCookie(c, COOKIE_NAME, JSON.stringify(session), sessionSecret(c), {
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
    secure: isSecureRequest(c.req.raw),
    maxAge: ADMIN_SESSION_MS / 1000,
  });
  return c.json({ ok: true });
});

/**
 * 清掉 `sc_admin`（HttpOnly，前端删不掉，所以需要接口）。
 * 签名 cookie 无状态：清 cookie 是浏览器侧的事，重放旧值仍能验签——与 `sc_session` 同一性质。
 */
admin.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

/**
 * 转发给厅对象（同 `/api/ws` 的范式）：连接集合与唯一权威库都在它那里，踢连接也只能由它做
 * （见 `docs/design/70-privacy-risk.md` §5.3）。内部头只在这里写，客户端伪造无效。
 */
async function forward(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Worker 路径 `/api/admin/*` → 厅的 `/admin/*`
  const url = new URL(c.req.raw.url);
  url.pathname = url.pathname.slice('/api'.length);
  const forwarded = new Request(url, c.req.raw);
  forwarded.headers.set(ADMIN_HEADER, '1');
  return c.env.HALL.getByName(HALL_ID).fetch(forwarded);
}

// 这一组全部在 `admin.use('*')` 之后注册：**401 中间件必须排在转发之前**。
// 厅回的状态码（400 / 404）原样透传（401 不会出现：中间件已经挡了）。
admin.get('/identities', forward);
admin.get('/identities/:userId', forward);
admin.get('/blocks', forward);
admin.post('/blocks', forward);
admin.delete('/blocks/:kind/:value', forward);
admin.get('/audit', forward);
admin.get('/stats', forward);
admin.get('/reports', forward);
admin.get('/reports/targets', forward);

export default admin;
