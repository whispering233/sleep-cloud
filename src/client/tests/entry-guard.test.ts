import { describe, expect, it } from 'vitest';

import type { ApiResponse, SessionView } from '../../shared/http-api';
import { entryVerdictOf } from '../entry-guard';

/** 一个「昵称已写好、自述已确认」的会话：正常进厅时复核拿到的就是这个形状。 */
const session = (patch: Partial<SessionView> = {}): SessionView => ({
  userId: 'u_1',
  nickname: '小明',
  ageConfirmed: true,
  appearance: 'boy',
  needsNickname: false,
  layoutVersion: 'room-1',
  ...patch,
});

const response = (code: ApiResponse<SessionView>['code'], data?: SessionView): ApiResponse<SessionView> =>
  data === undefined ? { code, msg: code } : { code, msg: code, data };

describe('进厅前的会话复核（`docs/api/10-api-http.md` §2.1 第 6 步）', () => {
  it('复核没有数据（网络 / 9001）不拦：抖动不是身份问题，沿用上一次的会话进厅', () => {
    const previous = session({ nickname: '小红' });
    expect(entryVerdictOf(previous, response('9001'))).toEqual({ session: previous });
    // 请求本身 reject（断网）也走同一支
    expect(entryVerdictOf(previous, undefined)).toEqual({ session: previous });
  });

  // 下面两条的 fixture 故意带 `needsNickname: true`：**把判据顺序钉住**——
  // 若有人把 `needsNickname` 提到 `5002` / `2002` 前面，这两条会当场红
  it('封禁（5002）拦下，会话与到期时间都用这一次复核的', () => {
    const data = session({ untilAt: 1_700_000_000_000, needsNickname: true });
    expect(entryVerdictOf(session(), response('5002', data))).toEqual({
      block: { code: '5002', untilAt: 1_700_000_000_000 },
      session: data,
    });
  });

  it('封禁没有 `untilAt` 时落 `null`（永久）', () => {
    const data = session({ needsNickname: true });
    expect(entryVerdictOf(session(), response('5002', data))).toEqual({
      block: { code: '5002', untilAt: null },
      session: data,
    });
  });

  it('厅满（2002）拦下', () => {
    const data = session({ needsNickname: true });
    expect(entryVerdictOf(session(), response('2002', data))).toEqual({
      block: { code: '2002' },
      session: data,
    });
  });

  it('`needsNickname` 仍为真 = 昵称没留住：拦下（否则就是无声的无限重连）', () => {
    // 复核对 `1001`（cookie 验签失败 / 没落地）时 `data` 里就是那个新会话，昵称为空
    const data = session({ nickname: '', needsNickname: true });
    expect(entryVerdictOf(session(), response('1001', data))).toEqual({
      block: { code: 'no-session' },
      session: data,
    });
  });

  it('会话留住时照旧进厅（不带 block）', () => {
    const data = session({ nickname: '小红' });
    expect(entryVerdictOf(session(), response('0', data))).toEqual({ session: data });
  });
});
