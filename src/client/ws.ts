import type { DownstreamMessage, EmoteId } from '../shared/protocol';
import { beginSample, clearSamples, settleSample } from './latency';
import type { LatencyKind, PendingSamples } from './latency';
import {
  applyBed,
  applyChat,
  applyEmote,
  applyError,
  applyJoin,
  applyLeave,
  applyPos,
  applyResize,
  applySnapshot,
  applyState,
  applyWhisper,
  getState,
  setState,
} from './store';

/**
 * 进入大厅：建连后第一条必须是 `hello`（带**布局版本号**），通过后才收得到快照。
 *
 * 下行消息全部已接上（`error` 交给文案层：静默类错误什么都不做，可恢复类才出提示条）。
 * 重连语义见 `docs/api/20-api-ws.md` §5（重连后以新的快照为准，不做增量补偿）。
 */
let active: WebSocket | null = null;

/**
 * 待配对的延迟样本：协议不定义心跳（`docs/api/20-api-ws.md` §1），只有 `chat` / `emote` 的回投
 * 能给出真实往返。纯客户端临时量，丢了就丢了——下一次发言再采一个。
 */
let pendingSamples: PendingSamples = {};

/**
 * 命中「自己那条回投」才算 RTT：别人的消息与我发出的意图无关，既不算样本、也不清样本。
 */
function settleLatency(kind: LatencyKind, id: string): void {
  if (id !== getState().me?.id) return;
  const settled = settleSample(pendingSamples, kind, Date.now());
  pendingSamples = settled.pending;
  if (settled.rttMs !== undefined) setState({ rttMs: settled.rttMs });
}

export function connectHall(input: { layoutVersion: string }): () => void {
  const url = new URL('/api/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  active = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ t: 'hello', layoutVersion: input.layoutVersion }));
  });

  socket.addEventListener('message', (event) => {
    let message: DownstreamMessage;
    try {
      message = JSON.parse(String(event.data)) as DownstreamMessage;
    } catch {
      return; // 服务端不会发坏包；真收到了也不该让前端崩
    }
    switch (message.t) {
      case 'snapshot':
        // 重连后以新快照为准：旧连接上的回投不会再来，样本留着只会结算出假 RTT
        pendingSamples = clearSamples();
        applySnapshot(message);
        return;
      case 'pos':
        applyPos(message);
        return;
      case 'join':
        applyJoin(message);
        return;
      case 'state':
        applyState(message);
        return;
      case 'leave':
        applyLeave(message);
        return;
      case 'bed':
        applyBed(message);
        return;
      case 'resize':
        applyResize(message);
        return;
      case 'chat':
        applyChat(message);
        settleLatency('chat', message.id);
        return;
      case 'whisper':
        applyWhisper(message);
        return;
      case 'emote':
        applyEmote(message);
        settleLatency('emote', message.id);
        return;
      case 'error':
        applyError(message.code);
        return;
      default:
        return; // 未知类型直接忽略：服务端可能先上了新消息，前端不该为此崩掉
    }
  });

  // 连接断了就没有回投可等：close / error 两条都要清（`error` 之后不一定还有 close）
  socket.addEventListener('close', () => {
    pendingSamples = clearSamples();
    setState({ connected: false });
  });
  socket.addEventListener('error', () => {
    pendingSamples = clearSamples();
    setState({ connected: false });
  });

  return () => {
    if (active === socket) active = null;
    socket.close();
  };
}

/** 上行只发意图：点地面 = 「我要去这个世界像素点」。 */
export function sendWalk(x: number, y: number): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'walk', x, y }));
}

/** 一跳：服务端把我一步放到某张床脚前的走道（不寻路）。不带床号 = 我自己那张；没有归属时服务端静默忽略。 */
export function sendHop(bedNo?: number): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify(bedNo === undefined ? { t: 'hop' } : { t: 'hop', bedNo }));
}

/** 全局消息：空消息与超长都由服务端判定（`4003` / `4001`），客户端不做重复校验。 */
export function sendChat(text: string): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'chat', text }));
  // 只有**真的发出去**才有回投可等：上面提前 return 的那些不登记样本
  pendingSamples = beginSample(pendingSamples, 'chat', Date.now());
}

/** 私聊：文本规则与全局聊天相同，由服务端判定。 */
export function sendWhisper(toId: string, text: string): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'whisper', toId, text }));
}

/** 表情：一次点击即发（不进二级菜单）。 */
export function sendEmote(id: EmoteId): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'emote', id }));
  pendingSamples = beginSample(pendingSamples, 'emote', Date.now());
}

/** 躺到某张床上：走过去 + 躺下是服务端的一条复合意图。 */
export function sendLie(bedNo: number): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'lie', bedNo }));
}

/** 起身：从床上回到床边站立（服务端决定站在哪）。 */
export function sendRise(): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'rise' }));
}

/** 手动表示「我睡了」（自动睡着由服务端按时间推导，客户端不需要定时器）。 */
export function sendSleep(): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'sleep' }));
}
