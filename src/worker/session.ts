import { getSignedCookie, setSignedCookie } from 'hono/cookie';

import type { Context } from 'hono';

import { HALLS } from '../shared/hall-registry';
import type { HallConfig } from '../shared/hall-registry';
import type { Env } from './env';

/**
 * 匿名会话（见 `docs/api/api-public.md` §2）：服务端签发的 **HMAC 签名 cookie**（HttpOnly）。
 * 不放床位号——床位归属的权威在厅的数据库里，多一个真相源只会带来不一致。
 */

const COOKIE_NAME = 'sc_session';

/** 平台允许的上限是 400 天；每次响应重签，等于「持续刷新」。 */
const COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

const DEV_SECRET = 'sleep-cloud-local-dev-secret';

export interface Session {
  userId: string;
  /** 所属厅：不放在会话里，服务端就不知道该把请求交给哪个厅 */
  hallId: string;
  /** 入场层自己输入的名字；未设置时为空 */
  nickname?: string;
  /** 用户本地时区（仅用于与个人有关的时间） */
  timezone: string;
  ageConfirmed: boolean;
}

export interface SessionRead {
  session: Session;
  /** cookie 存在但验签失败（或内容不可解析）：已静默换成新会话，返回 `1001` */
  invalid: boolean;
  secret: string;
}

function sessionSecret(c: Context<{ Bindings: Env }>): string {
  const secret = c.env.SESSION_SECRET;
  if (secret) return secret;
  const host = new URL(c.req.url).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return DEV_SECRET;
  throw new Error('SESSION_SECRET 未配置');
}

/** 由平台提供的时区挑选最接近的大区（本地开发可能没有该字段，回落到第一个大区）。 */
/** 由平台提供的时区挑选最接近的大区（本地开发可能没有该字段，回落到第一个大区）。 */
function pickHall(timezone: string | undefined): HallConfig {
  if (timezone) {
    const exact = HALLS.find((hall) => hall.timezone === timezone);
    if (exact) return exact;
    const region = timezone.split('/')[0];
    const sameRegion = HALLS.find((hall) => hall.timezone.startsWith(`${region}/`));
    if (sameRegion) return sameRegion;
  }
  return HALLS[0];
}

function createSession(c: Context<{ Bindings: Env }>): Session {
  // 平台在请求对象上提供的时区（本地开发可能没有）；只用到 timezone 一个字段，所以按结构取
  const cfTimezone = (c.req.raw as { cf?: { timezone?: string } }).cf?.timezone;
  const hall = pickHall(cfTimezone);
  return {
    userId: `u_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`,
    hallId: hall.id,
    timezone: cfTimezone ?? hall.timezone,
    ageConfirmed: false,
  };
}

function parseSession(raw: string): Session | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.userId !== 'string' || typeof parsed.hallId !== 'string') return null;
    return {
      userId: parsed.userId,
      hallId: parsed.hallId,
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : undefined,
      timezone: typeof parsed.timezone === 'string' ? parsed.timezone : 'UTC',
      ageConfirmed: parsed.ageConfirmed === true,
    };
  } catch {
    return null;
  }
}

/** 读取会话；缺失或验签失败则签发新的匿名会话（全程没有注册步骤）。 */
export async function readSession(c: Context<{ Bindings: Env }>): Promise<SessionRead> {
  const secret = sessionSecret(c);
  const raw = await getSignedCookie(c, secret, COOKIE_NAME);
  if (typeof raw === 'string') {
    const session = parseSession(raw);
    if (session) return { session, invalid: false, secret };
  }
  // 带了我们这个 cookie 却没用上：签名不合规、验签失败或内容不可解析，一律当「会话失效」处理
  const sentCookie = (c.req.raw.headers.get('cookie') ?? '').includes(`${COOKIE_NAME}=`);
  return { session: createSession(c), invalid: sentCookie, secret };
}

/** 重签并回写 cookie（每次响应都刷新有效期）。 */
export async function writeSession(
  c: Context<{ Bindings: Env }>,
  session: Session,
  secret: string,
): Promise<void> {
  await setSignedCookie(c, COOKIE_NAME, JSON.stringify(session), secret, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    // 本地开发跑在 http 上，加了 Secure 浏览器就不回传了
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: COOKIE_MAX_AGE_SEC,
  });
}
