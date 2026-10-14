import { Hono } from 'hono';

import type { Env } from './env';
import { fail, ok } from './respond';
import { readSession, writeSession } from './session';

const app = new Hono<{ Bindings: Env }>();

// 部署冒烟检查用（见 docs/design/build.md §4）
app.get('/api/health', (c) => c.json({ code: '0', msg: 'success', data: { status: 'ok' } }));

/** 读取当前会话（无会话则签发匿名会话），见 `docs/api/10-api-http.md` §3.1。 */
app.get('/api/me', async (c) => {
  const { session, invalid, secret } = await readSession(c);
  await writeSession(c, session, secret);

  const data = {
    userId: session.userId,
    hallId: session.hallId,
    nickname: session.nickname ?? '',
    ageConfirmed: session.ageConfirmed,
    needsNickname: !session.nickname,
    timezone: session.timezone,
  };

  // 验签失败：已静默换成新会话，前端重新拉取即可
  return invalid ? fail(c, '1001', data) : ok(c, data);
});

export default app;
