import { Hono } from 'hono';

import { NICKNAME_MAX_LEN } from '../shared/constants';
import { detect } from '../shared/content-filter';
import { findHall, HALLS } from '../shared/hall-registry';
import type { Env } from './env';
import { fail, ok } from './respond';
import { readSession, writeSession } from './session';
import type { Session } from './session';

const app = new Hono<{ Bindings: Env }>();

// 部署冒烟检查用（见 docs/design/build.md §4）
app.get('/api/health', (c) => c.json({ code: '0', msg: 'success', data: { status: 'ok' } }));

/** 会话内容的对外形态（见 `docs/api/10-api-http.md` §3.1）。 */
function sessionView(session: Session) {
  return {
    userId: session.userId,
    hallId: session.hallId,
    nickname: session.nickname ?? '',
    ageConfirmed: session.ageConfirmed,
    needsNickname: !session.nickname,
    timezone: session.timezone,
  };
}

/** 读取当前会话（无会话则签发匿名会话）。 */
app.get('/api/me', async (c) => {
  const { session, invalid, secret } = await readSession(c);
  await writeSession(c, session, secret);
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

/** 剥离控制字符（见 `docs/design/10-hall-runtime.md` §8）。 */
function stripControl(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** 设置昵称并上报本地时区。昵称**只在建连之前**设置或修改。 */
app.post('/api/nickname', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { nickname?: unknown; timezone?: unknown };
  const nickname = stripControl(typeof body.nickname === 'string' ? body.nickname : '').trim();

  const length = [...nickname].length;
  if (length < 1 || length > NICKNAME_MAX_LEN) return fail(c, '1004'); // 命中即拒绝，不写入会话
  if (detect(nickname)) return fail(c, '1005');

  const { session, invalid, secret } = await readSession(c);
  const timezone = typeof body.timezone === 'string' ? body.timezone : '';
  const timezoneOk = timezone === '' || isValidTimezone(timezone);
  const updated: Session = { ...session, nickname, timezone: timezoneOk && timezone ? timezone : session.timezone };
  await writeSession(c, updated, secret);

  if (invalid) return fail(c, '1001', sessionView(updated));
  // 时区无法识别：昵称仍然保存（回退到会话既有值）
  return timezoneOk ? ok(c, sessionView(updated)) : fail(c, '1006', sessionView(updated));
});

/** 厅列表（大区选择用）。`acceptedBeds` 是**归属数**，不是在线人数。 */
app.get('/api/halls', async (c) => {
  const { session } = await readSession(c);
  const halls = await Promise.all(
    HALLS.map(async (hall) => ({
      id: hall.id,
      name: hall.name,
      timezone: hall.timezone,
      capacity: hall.capacity,
      acceptedBeds: await c.env.HALL.getByName(hall.id).claimedBedCount(),
      current: hall.id === session.hallId,
    })),
  );
  return ok(c, { halls });
});

/** 切换所属大区。原厅的床位仍是你的（归属保留），30 天不出现才会被释放。 */
app.post('/api/hall', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { hallId?: unknown };
  const hall = typeof body.hallId === 'string' ? findHall(body.hallId) : undefined;
  if (!hall) return fail(c, '2001');

  const claimed = await c.env.HALL.getByName(hall.id).claimedBedCount();
  if (claimed >= hall.capacity) return fail(c, '2002');

  const { session, invalid, secret } = await readSession(c);
  const updated: Session = { ...session, hallId: hall.id };
  await writeSession(c, updated, secret);
  return invalid ? fail(c, '1001', sessionView(updated)) : ok(c, sessionView(updated));
});

export default app;
