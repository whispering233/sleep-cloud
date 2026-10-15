import { EMOTE_IDS } from '../shared/protocol';
import type { EmoteId } from '../shared/protocol';

/**
 * 表情判定（见 `docs/api/20-api-ws.md` §4.8）：共享层枚举 `EMOTE_IDS` 是唯一白名单。
 *
 * 非法值**静默丢弃、不回错误码**：给探测者任何反馈都不划算（与「打码不拦截」同一个理由）。
 * 表情不落库，服务端也不记状态——显示多久由客户端按 `EMOTE_MS` 推导。
 */
export type EmoteVerdict = { ok: true; emoteId: EmoteId } | { ok: false };

export function emoteVerdictFor(raw: unknown): EmoteVerdict {
  const emoteId = EMOTE_IDS.find((id) => id === raw);
  return emoteId ? { ok: true, emoteId } : { ok: false };
}
