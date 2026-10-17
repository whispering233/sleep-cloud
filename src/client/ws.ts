import { INTENT_ECHO_TIMEOUT_MS, PROBE_TIMEOUT_MS } from '../shared/constants';
import type { DownstreamMessage, EmoteId, UpstreamMessage } from '../shared/protocol';
import {
  backoffMs,
  connecting,
  initialConnState,
  offline,
  online,
  probeTimedOut,
  probing,
  settled,
  shouldReconnect,
} from './conn-state';
import type { ConnState } from './conn-state';
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
 * 连接管理器（连接态、按需探活、退避重连）。判据全在 `conn-state.ts` 的纯函数里，这里只负责
 * 「什么时候问它们」与「谁来起/清计时器」。
 *
 * 进入大厅：建连后第一条必须是 `hello`（带**布局版本号**），通过后才收得到快照。
 * 重连语义见 `docs/api/20-api-ws.md` §5.1：以新的 `snapshot` 为准，不做增量补偿；
 * `offline` 期间的上级一律**丢弃不排队补发**（那时用户想去的地方已经变了）。
 */
interface Session {
  layoutVersion: string;
  socket: WebSocket | null;
  state: ConnState;
  /** 在飞的计时器：探测超时、无回执超时、退避等待。**一个都不能漏**（见 `clearTimers`）。 */
  probeTimer?: ReturnType<typeof setTimeout>;
  echoTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  /**
   * 当前这条连接开始建连的本地时刻。只给 `retryNow()` 用：`CONNECTING` 长期不落地（TCP 黑洞）时
   * 才知道该不该掐掉它重建；建连结束（`open` / 死亡）后不再读。
   */
  connectingSinceMs?: number;
  disposed: boolean;
}

let session: Session | null = null;

/** 进厅：建第一条连接并挂上三条探活触发点里的两个（另一个由上行自己起）。返回清理函数。 */
export function connectHall(input: { layoutVersion: string }): () => void {
  const s: Session = { layoutVersion: input.layoutVersion, socket: null, state: initialConnState(), disposed: false };
  session = s;
  updateState(s);
  window.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onBrowserOnline);
  openSocket(s);

  return () => {
    window.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onBrowserOnline);
    // StrictMode 下 effect 会「挂载 → 卸载 → 再挂载」：旧会话被顶掉时别去碰新的那一条
    if (session === s) session = null;
    s.disposed = true;
    clearTimers(s);
    dropSocket(s);
  };
}

/** 卡 3 的「尝试连接」按钮：打断退避等待、立即试一次；**不改退避序列**（进度只由失败推进）。 */
export function retryNow(): void {
  const s = live();
  if (!s) return;
  if (s.socket?.readyState === WebSocket.CONNECTING) {
    // 建连超过 PROBE_TIMEOUT_MS 还没落地（TCP 黑洞，`readyState` 会一直停在 CONNECTING）：
    // 掐掉重建，否则这个按钮就是个空操作；没超时就维持现状（不折腾一条正在建的连接）
    const since = s.connectingSinceMs;
    if (since === undefined || Date.now() - since < PROBE_TIMEOUT_MS) return;
  }
  reconnectNow(s);
}

/** 上行只发意图：点地面 = 「我要去这个世界像素点」。**返回是否真的发出去了**。 */
export function sendWalk(x: number, y: number): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'walk', x, y }) : false;
}

/** 一跳：服务端把我一步放到某张床脚前的走道（不寻路）。不带床号 = 我自己那张；没有归属时服务端静默忽略。 */
export function sendHop(bedNo?: number): boolean {
  const s = live();
  if (!s) return false;
  return sendRaw(s, bedNo === undefined ? { t: 'hop' } : { t: 'hop', bedNo });
}

/** 全局消息：空消息与超长都由服务端判定（`4003` / `4001`），客户端不做重复校验。 */
export function sendChat(text: string): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'chat', text }) : false;
}

/** 私聊：文本规则与全局聊天相同，由服务端判定。 */
export function sendWhisper(toId: string, text: string): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'whisper', toId, text }) : false;
}

/** 表情：一次点击即发（不进二级菜单）。 */
export function sendEmote(id: EmoteId): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'emote', id }) : false;
}

/** 躺到某张床上：走过去 + 躺下是服务端的一条复合意图。 */
export function sendLie(bedNo: number): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'lie', bedNo }) : false;
}

/** 起身：从床上回到床边站立（服务端决定站在哪）。 */
export function sendRise(): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'rise' }) : false;
}

/** 手动表示「我睡了」（自动睡着由服务端按时间推导，客户端不需要定时器）。 */
export function sendSleep(): boolean {
  const s = live();
  return s ? sendRaw(s, { t: 'sleep' }) : false;
}

// ————————————————————————— 连接与计时器 —————————————————————————

/** 还没有进厅（没建过连）时上行什么都不做：没有会话就没有意图。 */
function live(): Session | undefined {
  return session && !session.disposed ? session : undefined;
}

/** 连接态写进 store（渲染层的显示态）；管理器自己的那一份是权威。 */
function updateState(s: Session, next: ConnState = s.state): void {
  s.state = next;
  setState({ connection: next.connection });
}

/**
 * 建一条新连接。**每个事件回调先判自己还是不是当前那条连接**：`App.tsx` 的 effect 在 StrictMode 下
 * 会挂载 → 卸载 → 再挂载，旧 socket 的 `close` / `message` 绝不允许改写新连接的状态。
 */
function openSocket(s: Session): void {
  if (s.disposed) return; // 会话已被顶掉（StrictMode 卸载 / 重新进厅）：不许再建连接、更不许写 store
  clearTimers(s);
  const url = new URL('/api/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  s.socket = socket;
  s.connectingSinceMs = Date.now();
  updateState(s, connecting(s.state));

  socket.addEventListener('open', () => {
    if (s.socket !== socket) return;
    socket.send(JSON.stringify({ t: 'hello', layoutVersion: s.layoutVersion }));
  });

  socket.addEventListener('message', (event) => {
    if (s.socket !== socket) return;
    handleMessage(s, event);
  });

  socket.addEventListener('close', () => {
    if (s.socket !== socket) return;
    fail(s);
  });
  // `error` 与 `close` 常成对到达；`fail` 自己在 `offline` 上幂等
  socket.addEventListener('error', () => {
    if (s.socket !== socket) return;
    fail(s);
  });
}

/** 丢掉当前这条连接：**先置空再关**，于是它自己的 `close` 回调会被守卫拦住，不会二次改状态。 */
function dropSocket(s: Session): void {
  const socket = s.socket;
  s.socket = null;
  socket?.close();
}

/**
 * 连接死了（`close` / `error` / 探活超时）：判 `offline`、按退避排下一次重连。
 * 幂等：已经在退避里（`offline`）就直接返回，`error` + `close` 成对到达只算一次失败。
 */
function fail(s: Session): void {
  if (s.disposed || s.state.connection === 'offline') return;
  clearTimers(s);
  dropSocket(s);
  updateState(s, offline(s.state));
  scheduleRetry(s);
}

/** 退避等待 → 再建一条。**hidden 期间不排**：回到前台由探活接手。 */
function scheduleRetry(s: Session): void {
  if (!shouldReconnect(s.state, document.hidden)) return;
  s.retryTimer = setTimeout(() => {
    s.retryTimer = undefined;
    // 等待期间可能已经切到后台、或已经有人建了连接：这一次尝试作废
    if (!shouldReconnect(s.state, document.hidden)) return;
    openSocket(s);
  }, backoffMs(s.state.failures));
}

/** 立刻重连一次：**不动退避进度**（退避只由「一次尝试失败」推进，见 `conn-state.ts` 的 `offline`）。 */
function reconnectNow(s: Session): void {
  clearTimers(s);
  dropSocket(s);
  openSocket(s);
}

/** 上行在 `offline` 里被丢掉时顺手催一次重连（不补发那条消息）。 */
function ensureConnected(): void {
  const s = live();
  if (!s || s.socket) return;
  reconnectNow(s);
}

/** 三条触发点收敛到的**唯一动作**：不是 `OPEN` → 立即重连；是 `OPEN` → 发 `ping`，超时没 `pong` 就判死重连。 */
function probe(): void {
  const s = live();
  if (!s || document.hidden) return; // hidden 里探活等于常驻心跳（会把对象整夜唤醒）
  const socket = s.socket;
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    reconnectNow(s);
    return;
  }
  if (socket.readyState === WebSocket.CONNECTING) return; // 正在建连：等它自己出结果

  socket.send(JSON.stringify({ t: 'ping' }));
  updateState(s, probing(s.state, Date.now()));
  clearTimer(s, 'probeTimer');
  s.probeTimer = setTimeout(() => {
    s.probeTimer = undefined;
    if (!probeTimedOut(s.state, Date.now())) return; // 期间收到了 `pong`
    fail(s);
  }, PROBE_TIMEOUT_MS);
}

/** 页面从后台回到前台：探活接手（hidden 期间不重试，回到前台的第一件事就是探一次）。 */
function onVisibilityChange(): void {
  const s = live();
  if (!s) return;
  if (document.hidden) {
    // 不是「暂停一下定时器」，而是**完整地不再发起新的重连尝试**
    clearTimer(s, 'retryTimer');
    return;
  }
  probe();
}

/** 浏览器恢复联网。 */
function onBrowserOnline(): void {
  probe();
}

/**
 * 发出一条意图后盯着回执：`INTENT_ECHO_TIMEOUT_MS` 内没有一条「关于自己的下行」→ 视为可疑，
 * 触发一次探活（**不直接判死**——手机上切屏的僵尸连接要的正是「探一下」）。
 */
function armEchoWatch(s: Session): void {
  clearTimer(s, 'echoTimer');
  s.echoTimer = setTimeout(() => {
    s.echoTimer = undefined;
    if (s.disposed) return;
    probe();
  }, INTENT_ECHO_TIMEOUT_MS);
}

type TimerField = 'probeTimer' | 'echoTimer' | 'retryTimer';

function clearTimer(s: Session, field: TimerField): void {
  const timer = s[field];
  if (timer !== undefined) clearTimeout(timer);
  s[field] = undefined;
}

/**
 * 清理函数必须清掉**全部**在飞的计时器（探测超时、无回执超时、退避等待），一个都不能漏：
 * 漏一个的后果是组件卸载或重连之后，那个旧计时器又触发一次重连。
 * **内存定时器不清 = 对象无法休眠**（`AGENTS.md` 硬纪律 6）。
 */
function clearTimers(s: Session): void {
  clearTimer(s, 'probeTimer');
  clearTimer(s, 'echoTimer');
  clearTimer(s, 'retryTimer');
}

// ————————————————————————— 收发 —————————————————————————

/**
 * 一条出站上行。空负载的 `rise` / `sleep` 在协议里写作 `Record<string, never>`，与 `{ t: K }` 交叉后
 * 字面量直接被拒，所以这里显式补上这两个成员（其余类型仍走协议那一份，不另立一套）。
 */
type Outgoing = UpstreamMessage | { t: 'rise' } | { t: 'sleep' };

/** 发送出口：不是 `OPEN` 就**丢弃不排队**，并顺手催一次重连。 */
function sendRaw(s: Session, message: Outgoing): boolean {
  if (s.disposed || s.socket?.readyState !== WebSocket.OPEN) {
    // 重连后的位置可能是宽限恢复的原位、也可能是出生点，1 秒前点的那块地已经不代表用户现在想去的地方；
    // 丢弃 + 一条常驻提示条（卡 3）比补发更诚实（见 `docs/api/20-api-ws.md` §5.1）
    ensureConnected();
    return false;
  }
  s.socket.send(JSON.stringify(message));
  armEchoWatch(s);
  return true;
}

function handleMessage(s: Session, event: MessageEvent): void {
  let message: DownstreamMessage;
  try {
    message = JSON.parse(String(event.data)) as DownstreamMessage;
  } catch {
    return; // 服务端不会发坏包；真收到了也不该让前端崩
  }

  if (message.t === 'pong') {
    clearTimer(s, 'probeTimer');
    updateState(s, settled(s.state));
  }
  if (concernsMe(message)) clearTimer(s, 'echoTimer');

  switch (message.t) {
    case 'snapshot':
      updateState(s, online());
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
    case 'pong':
      return;
    default:
      return; // 未知类型直接忽略：服务端可能先上了新消息，前端不该为此崩掉
  }
}

/**
 * 这条下行是不是「关于我自己」的（「意图无回执」的判据）：别人的位置与别人的聊天都**不算**——
 * 它们只说明还能收，不说明我发出去的那条有下文。
 */
function concernsMe(message: DownstreamMessage): boolean {
  const me = getState().me;
  switch (message.t) {
    case 'snapshot':
    case 'pong':
    case 'error':
      return true; // 错误是每条连接自己的
    case 'pos':
      return me !== undefined && message.items.some(([id]) => id === me.id);
    case 'join':
    case 'leave':
    case 'state':
    case 'chat':
    case 'emote':
      return me !== undefined && message.id === me.id;
    case 'whisper':
      return me !== undefined && (message.fromId === me.id || message.toId === me.id);
    case 'bed':
      return me !== undefined && message.bedNo === me.ownedBedNo;
    case 'resize':
      return false;
    default:
      return false;
  }
}
