import { Hono } from 'hono';

import { HALL_ID, NICKNAME_MAX_LEN } from '../shared/constants';
import { detect } from '../shared/content-filter';
import { LAYOUT_VERSION } from '../shared/layout';
import { APPEARANCES } from '../shared/protocol';
import { appearanceFor, IDENTITY_HEADERS } from '../hall/connection';
import type { Env } from './env';
import { fail, ok } from './respond';
import { readExistingSession, readSession, writeSession } from './session';
import type { Session } from './session';

const app = new Hono<{ Bindings: Env }>();

/**
 * 未捕获的异常一律变成 JSON 错误码。
 *
 * 平台的默认 500 是 `text/plain` 的 "Internal Server Error"——前端 `res.json()` 会直接抛 SyntaxError，
 * 界面上什么提示都出不来（控制台只留一句「Unexpected token 'I'」）。真实原因进日志（`wrangler tail` / 平台日志）。
 */
app.onError((error, c) => {
  console.error('请求处理失败：', error);
  return fail(c, '9001');
});

// 部署冒烟检查用（见 docs/design/build.md §4）
app.get('/api/health', (c) => c.json({ code: '0', msg: 'success', data: { status: 'ok' } }));

/**
 * 会话内容的对外形态（见 `docs/api/10-api-http.md` §3.1）：**不含厅、不含时区**（单厅 + 无时区概念），
 * 多一个布局版本号供客户端在 `hello` 里带上。
 */
function sessionView(session: Session) {
  return {
    userId: session.userId,
    nickname: session.nickname ?? '',
    // 没选过时下发派生的那个值：入场层一进来就有预览高亮，且与服务端将要用的形象一致
    appearance: session.appearance ?? appearanceFor(session.userId),
    ageConfirmed: session.ageConfirmed,
    needsNickname: !session.nickname,
    layoutVersion: LAYOUT_VERSION,
  };
}

/** 剥离控制字符（见 `docs/design/10-hall-runtime.md` §10）。 */
function stripControl(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

/**
 * 读取当前会话（无会话则签发匿名会话）。
 *
 * 顺手做**入场前的厅满判定**（见 `docs/api/error-code.md` §3）：级表触顶且床全部有主或有占用时
 * 返回 `2002`，不让人建连再被踢。会话仍然照常返回，前端据此显示「厅满了」。
 */
app.get('/api/me', async (c) => {
  const { session, invalid, secret } = await readSession(c);
  await writeSession(c, session, secret);
  const status = await c.env.HALL.getByName(HALL_ID).entryStatus();
  if (status.full) return fail(c, '2002', sessionView(session));
  // 验签失败：已静默换成新会话，前端重新拉取即可
  return invalid ? fail(c, '1001', sessionView(session)) : ok(c, sessionView(session));
});

/** 18 岁自述确认（是自述，不是核验：只记录布尔值）。 */
app.post('/api/age-confirm', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { confirmed?: unknown };
  if (body.confirmed !== true) return fail(c, '1002');

  const { session, invalid, secret } = await readSession(c);
  const updated: Session = { ...session, ageConfirmed: true };
  await writeSession(c, updated, secret);
  return invalid ? fail(c, '1001', sessionView(updated)) : ok(c, sessionView(updated));
});

/** 设置昵称。昵称**只在建连之前**设置或修改（协议里因此不需要「改名」消息）。 */
app.post('/api/nickname', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { nickname?: unknown };
  const nickname = stripControl(typeof body.nickname === 'string' ? body.nickname : '').trim();

  const length = [...nickname].length;
  if (length < 1 || length > NICKNAME_MAX_LEN) return fail(c, '1004'); // 命中即拒绝，不写入会话
  if (detect(nickname)) return fail(c, '1005');

  const { session, invalid, secret } = await readSession(c);
  const updated: Session = { ...session, nickname };
  await writeSession(c, updated, secret);
  return invalid ? fail(c, '1001', sessionView(updated)) : ok(c, sessionView(updated));
});

/** 选择入场形象（协议里同样不需要「改形象」消息：与改名一样只发生在建连之前）。 */
app.post('/api/appearance', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { appearance?: unknown };
  // 非法值**直接忽略**（回当前会话）：只有被篡改的客户端会走到这条路，不值得为它加错误码
  const appearance = APPEARANCES.find((value) => value === body.appearance);

  const { session, invalid, secret } = await readSession(c);
  const updated: Session = appearance ? { ...session, appearance } : session;
  await writeSession(c, updated, secret);
  return invalid ? fail(c, '1001', sessionView(updated)) : ok(c, sessionView(updated));
});

/**
 * WebSocket 升级：验签 cookie → 前置校验（未自述 `1002` / 未设昵称 `1003`），
 * 通过后转发给那个唯一的厅（见 `docs/api/20-api-ws.md` §1）。
 * 验签失败**不升级**，也不顺手签发新会话——否则会出现「连接用的是 A 身份、cookie 是 B 身份」。
 */
app.get('/api/ws', async (c) => {
  const session = await readExistingSession(c);
  if (!session) return fail(c, '1001');
  if (!session.ageConfirmed) return fail(c, '1002');
  if (!session.nickname) return fail(c, '1003');

  // 身份由 Worker 依据验签后的会话写入；客户端伪造的同名头会被这里覆盖
  const forwarded = new Request(c.req.raw);
  forwarded.headers.set(IDENTITY_HEADERS.userId, session.userId);
  forwarded.headers.set(IDENTITY_HEADERS.name, encodeURIComponent(session.nickname));
  // 没选过形象时不带这个头：厅那边按 `user_id` 派生（唯一真源在 `appearanceFromHeader`）
  if (session.appearance) forwarded.headers.set(IDENTITY_HEADERS.appearance, session.appearance);

  return c.env.HALL.getByName(HALL_ID).fetch(forwarded);
});

export default app;