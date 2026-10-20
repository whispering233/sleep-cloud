import { getSignedCookie, setSignedCookie } from 'hono/cookie';

import type { Context } from 'hono';

import { APPEARANCES } from '../shared/protocol';
import type { Appearance } from '../shared/protocol';
import type { Env } from './env';

/**
 * 匿名会话（见 `docs/api/api-public.md` §2）：服务端签发的 **HMAC 签名 cookie**（HttpOnly）。
 *
 * 会话里只有四样东西：用户标识、昵称、形象、18 岁自述位。**不放床位号**（归属的权威在厅的数据库）、
 * **不放所属厅**（只有一个厅，路由用常量）、**不放时区**（时区概念已删除）。
 */

const COOKIE_NAME = 'sc_session';

/** 平台允许的上限是 400 天；每次响应重签，等于「持续刷新」。 */
const COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

export interface Session {
  userId: string;
  /** 入场层自己输入的名字；未设置时为空 */
  nickname?: string;
  /** 入场层选的形象；未设置时为空——厅按 `user_id` 派生（见 `connection.ts` 的 `appearanceFor`） */
  appearance?: Appearance;
  ageConfirmed: boolean;
}

export interface SessionRead {
  session: Session;
  /** cookie 存在但验签失败（或内容不可解析）：已静默换成新会话，返回 `1001` */
  invalid: boolean;
  secret: string;
}

/**
 * 密钥只有一处来源：注入（生产 `wrangler secret put SESSION_SECRET`，本机 `.dev.vars`）。
 *
 * **不做任何「按域名猜是不是本机」的回落**：生产与本机可能用同一个域名
 * （配了自定义域名路由后，本地 dev 的 request.url 就是生产域名），一旦按域名判本机，
 * 生产就会静默用上一个可猜的密钥——那等于没有会话安全。
 */
export function sessionSecret(c: Context<{ Bindings: Env }>): string {
  const secret = c.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET 未配置');
  return secret;
}

/** 本地开发跑在 http 上，加 Secure 浏览器就不回传了。解析失败时按 HTTPS 处理（保守）。 */
export function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

function createSession(): Session {
  return {
    // 64 bit 随机：**不是安全参数**（冒充要签名密钥，与 id 长度无关），位数只决定两人被签成同一身份的
    // 撞号概率（见 `docs/design/70-privacy-risk.md` §2.2）。
    // **不要写成 `randomUUID().slice(0, 16)`**：UUIDv4 的第 13 个 hex 字符是版本位（恒 `4`），那样只有 60 bit。
    userId: `u_${randomHex(16)}`,
    ageConfirmed: false,
  };
}

/** `length` 个十六进制字符（`length` 必须是偶数）：每个字节出两个字符。 */
function randomHex(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length / 2))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseSession(raw: string): Session | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.userId !== 'string') return null;
    return {
      userId: parsed.userId,
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : undefined,
      // 枚举是唯一白名单：非法或缺失一律当未设置
      appearance: APPEARANCES.find((value) => value === parsed.appearance),
      ageConfirmed: parsed.ageConfirmed === true,
    };
  } catch {
    return null;
  }
}

/** 只读取验签通过的会话，不签发新的（WebSocket 升级用：不给身份就不升级）。 */
export async function readExistingSession(c: Context<{ Bindings: Env }>): Promise<Session | null> {
  return (await readCookieSession(c)).session;
}

async function readCookieSession(
  c: Context<{ Bindings: Env }>,
): Promise<{ session: Session | null; secret: string }> {
  const secret = sessionSecret(c);
  const prev = c.env.SESSION_SECRET_PREV;
  // 密钥环（见 `docs/design/config.md` §4）：验签先试当前密钥，失败再试上一把
  for (const candidate of prev && prev !== secret ? [secret, prev] : [secret]) {
    const raw = await getSignedCookie(c, candidate, COOKIE_NAME);
    if (typeof raw === 'string') {
      const session = parseSession(raw);
      // 回写恒用当前密钥（重签发生在验签通过之后，轮换期里才收敛到新密钥）
      if (session) return { session, secret };
    }
  }
  return { session: null, secret };
}

/** 读取会话；缺失或验签失败则签发新的匿名会话（全程没有注册步骤）。 */
export async function readSession(c: Context<{ Bindings: Env }>): Promise<SessionRead> {
  const { session, secret } = await readCookieSession(c);
  if (session) return { session, invalid: false, secret };
  // 带了我们这个 cookie 却没用上：签名不合规、验签失败或内容不可解析，一律当「会话失效」处理
  const sentCookie = (c.req.raw.headers.get('cookie') ?? '').includes(`${COOKIE_NAME}=`);
  return { session: createSession(), invalid: sentCookie, secret };
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
    secure: isSecureRequest(c.req.raw),
    maxAge: COOKIE_MAX_AGE_SEC,
  });
}