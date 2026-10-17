/**
 * 延迟采样（**纯计算**：不碰 DOM / WebSocket / 定时器，可单测）。
 *
 * 协议**不定义应用层心跳**（`docs/api/20-api-ws.md` §1），所以客户端唯一的真实往返来源是
 * `chat` 的回投：发出去时登记一个待配对样本，收到**自己那条**回投时用它算 RTT。
 * 不做推测、不发额外消息——没发言就没有样本（HUD 那一项不占位）。
 *
 * 样本按**意图类别**分开存，同一类别只留**最新**一次（后发的覆盖前一次，旧样本不产生 RTT）。
 */
export type LatencyKind = 'chat';

/** 待配对样本：类别 → 发出时刻（`Date.now()`）。结算一次就把它用掉。 */
export type PendingSamples = Partial<Record<LatencyKind, number>>;

/** 发出一个意图：登记（或覆盖同类的）待配对样本。 */
export function beginSample(pending: PendingSamples, kind: LatencyKind, now: number): PendingSamples {
  return { ...pending, [kind]: now };
}

/**
 * 收到「自己那条回投」：结算成 RTT 并把样本用掉。
 * 没有对应类别的样本时**什么都不产生**，也不碰别的类别。
 * 时钟被系统校准时 `Date.now()` 可能往回走，夹在 0 以上：宁可显示 0ms，也不显示负数。
 */
export function settleSample(
  pending: PendingSamples,
  kind: LatencyKind,
  now: number,
): { pending: PendingSamples; rttMs?: number } {
  const sentAt = pending[kind];
  if (sentAt === undefined) return { pending, rttMs: undefined };
  const rest: PendingSamples = { ...pending };
  delete rest[kind];
  return { pending: rest, rttMs: Math.max(0, now - sentAt) };
}

/**
 * 清空所有待配对样本：拿到新快照（重连以快照为准，旧连接上的回投不会再来）或 socket 关闭时。
 * 留着只会在下一次回投时结算出一个「跨断线」的假 RTT。
 */
export function clearSamples(): PendingSamples {
  return {};
}
