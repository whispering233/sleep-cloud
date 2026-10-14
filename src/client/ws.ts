import type { DownstreamMessage } from '../shared/protocol';
import { applyPos, applySnapshot, setState } from './store';

/**
 * 进入大厅：建连后第一条必须是 `hello`（带场景标识），通过后才收得到快照。
 *
 * 增量事件里 `pos` 在卡 10 接上；`join` / `leave` / `state` / `bed` 在后续卡片接上。
 * 重连语义见 `docs/api/20-api-ws.md` §5（重连后以新的快照为准，不做增量补偿）。
 */
let active: WebSocket | null = null;

export function connectHall(input: { hallId: string; sceneGuid: string }): () => void {
  const url = new URL(`/api/halls/${encodeURIComponent(input.hallId)}/ws`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  active = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ t: 'hello', sceneGuid: input.sceneGuid }));
  });

  socket.addEventListener('message', (event) => {
    let message: DownstreamMessage;
    try {
      message = JSON.parse(String(event.data)) as DownstreamMessage;
    } catch {
      return; // 服务端不会发坏包；真收到了也不该让前端崩
    }
    if (message.t === 'snapshot') applySnapshot(message);
    if (message.t === 'pos') applyPos(message);
  });

  socket.addEventListener('close', () => setState({ connected: false }));
  socket.addEventListener('error', () => setState({ connected: false }));

  return () => {
    if (active === socket) active = null;
    socket.close();
  };
}

/** 上行只发意图：点地面 = 「我要去这一格」。 */
export function sendWalk(x: number, y: number): void {
  if (active?.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify({ t: 'walk', x, y }));
}
