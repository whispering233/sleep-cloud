import type { DownstreamMessage, EmoteId } from '../shared/protocol';
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
  setState,
} from './store';

/**
 * 进入大厅：建连后第一条必须是 `hello`（带**布局版本号**），通过后才收得到快照。
 *
 * 下行消息全部已接上（`error` 交给文案层：静默类错误什么都不做，可恢复类才出提示条）。
 * 重连语义见 `docs/api/20-api-ws.md` §5（重连后以新的快照为准，不做增量补偿）。
 */
let active: WebSocket | null = null;

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
        return;
      case 'whisper':
        applyWhisper(message);
        return;
      case 'emote':
        applyEmote(message);
        return;
      case 'error':
        applyError(message.code);
        return;
      default:
        return; // 未知类型直接忽略：服务端可能先上了新消息，前端不该为此崩掉
    }
  });

  socket.addEventListener('close', () => setState({ connected: false }));
  socket.addEventListener('error', () => setState({ connected: false }));

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
