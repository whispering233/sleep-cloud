import type {
  BedMessage,
  ChatMessage,
  EmoteId,
  EmoteMessage,
  HallInfo,
  JoinMessage,
  LeaveMessage,
  Person,
  PersonPlacement,
  PosMessage,
  SnapshotMessage,
  SelfPerson,
  StateMessage,
  WhisperMessage,
} from '../shared/protocol';
import { CHAT_LOG_MAX, EMOTE_MS } from '../shared/constants';
import { errorTextFor } from './error-text';
import { nextMotion } from './motion';
import type { Motion } from './motion';

/** 一行消息：**名字与是否自己都在追加那一刻定下来**，渲染时不再回查 `people`。 */
export interface ChatLine {
  id: string;
  name: string;
  text: string;
  ts: number;
  own: boolean;
  /** 全局消息还是私聊（只影响显示：私聊行加前缀与类名） */
  kind: 'chat' | 'whisper';
}

/** 一条错误提示：文案已按错误码翻译好，提示条只负责显示它。 */
export interface Notice {
  id: number;
  text: string;
}

/**
 * 世界渲染读的那一份状态。**刻意不放 React**：位置与插值不进框架的渲染循环，
 * 否则几百个小人会把框架拖死（见 `AGENTS.md` 硬纪律）。
 */
export interface ClientState {
  connected: boolean;
  hall?: HallInfo;
  sceneGuid?: string;
  me?: SelfPerson;
  /** 归属集合：所有有主的床（不含名字，也不含「谁拥有」） */
  ownedBeds: Set<number>;
  /** 可见的人（含睡痕条目，不含自己） */
  people: Map<string, Person>;
  /** 每个人的位置插值窗口（服务端时间轴） */
  motion: Map<string, Motion>;
  /** 本地时钟 + 这个偏移 = 服务端时间 */
  clockOffsetMs: number;
  /** 最近收到的消息（只用于显示；服务端不存历史） */
  messages: ChatLine[];
  /**
   * 可恢复错误的提示条（静默类错误不写这里）。`id` 自增是为了让提示条重新挂载、
   * CSS 动画从头播——动画结束由 `animationend` 清掉，不挂定时器。
   */
  notice?: Notice;
  /** **全局唯一的选中对象**：同时决定名字气泡与私聊目标（见 `docs/ui/DESIGN.md`） */
  selectedId?: string;
  /** 人物 id → 表情。过期只靠渲染时比较 `expiresAt`，**不挂定时器** */
  emotes: Map<string, { emoteId: EmoteId; expiresAt: number }>;
}

const emptyState = (): ClientState => ({
  connected: false,
  ownedBeds: new Set(),
  people: new Map(),
  motion: new Map(),
  clockOffsetMs: 0,
  messages: [],
  emotes: new Map(),
});

let state: ClientState = emptyState();
const listeners = new Set<(state: ClientState) => void>();

export const getState = (): ClientState => state;

export function subscribe(listener: (state: ClientState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setState(patch: Partial<ClientState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function applySnapshot(message: SnapshotMessage): void {
  setState({
    connected: true,
    sceneGuid: message.sceneGuid,
    hall: message.hall,
    me: message.me,
    ownedBeds: new Set(message.ownedBeds),
    people: new Map(message.people.map((person) => [person.id, person])),
    motion: new Map(),
    // 客户端据此换算服务端时间轴：插值一律按服务端时间戳算
    clockOffsetMs: message.serverTs - Date.now(),
    // 重连以新快照为准、不做增量补偿 → 旧的消息流不保留
    messages: [],
    selectedId: undefined,
    emotes: new Map(),
  });
}

/**
 * 全局消息：**追加那一刻就把发送者名字固化到这一行**。
 * 渲染时不能回头查 `people`——对方离开后那行名字会变空（见 `docs/ui/DESIGN.md`）。
 */
export function applyChat(message: ChatMessage): void {
  const own = state.me?.id === message.id;
  const name = (own ? state.me?.name : state.people.get(message.id)?.name) ?? '某人';
  const line: ChatLine = { id: message.id, name, text: message.text, ts: message.ts, own, kind: 'chat' };
  setState({ messages: [...state.messages, line].slice(-CHAT_LOG_MAX) });
}

/**
 * 私聊：发送者与接收者收到同一份 payload，收件人靠「发送者是不是我」区分（见 `docs/api/20-api-ws.md` §4.7）。
 * 名字同样在追加那一刻固化：`own` 时我必然就是发送者（`me.id === fromId`），所以行内 id 一律是发送者。
 */
export function applyWhisper(message: WhisperMessage): void {
  const own = state.me?.id === message.fromId;
  const name = (own ? state.me?.name : state.people.get(message.fromId)?.name) ?? '某人';
  const line: ChatLine = {
    id: message.fromId,
    name,
    text: message.text,
    ts: message.ts,
    own,
    kind: 'whisper',
  };
  setState({ messages: [...state.messages, line].slice(-CHAT_LOG_MAX) });
}

/**
 * 表情：只写「到什么时候为止」，同一个人后来的表情覆盖前一条。
 * 过期由渲染侧比较 `expiresAt` 推导——**不挂 `setTimeout`/`setInterval`**，内存定时器会让页面无法休眠。
 */
export function applyEmote(message: EmoteMessage): void {
  const emotes = new Map(state.emotes);
  emotes.set(message.id, { emoteId: message.emoteId, expiresAt: Date.now() + EMOTE_MS });
  setState({ emotes });
}

/** 选中某个人：同一时刻只有一个选中对象（所以只有一个名字气泡、一个私聊目标）。 */
export function selectPerson(id: string): void {
  setState({ selectedId: id });
}

/** 取消选中：点地面、点 ×、目标离开都走这里。 */
export function clearSelection(): void {
  setState({ selectedId: undefined });
}

/** 一批权威位置（已合并）→ 插值窗口。 */
export function applyPos(message: PosMessage): void {
  const motion = new Map(state.motion);
  const people = new Map(state.people);

  for (const [id, x, y] of message.items) {
    const person = people.get(id);
    // 已经躺在床上的人不需要插值窗口（位置就是那张床）；服务端也不会为他发位置，
    // 这里只是防同一节拍里「状态先到、位置后到」的竞态
    if (person && person.state !== 'roaming') continue;

    motion.set(id, nextMotion(motion.get(id), x, y, message.ts));
    if (person) people.set(id, { ...person, x, y });
  }

  setState({ motion, people });
}

/** 从下行消息里取出「人在哪」的那一半（丢掉 `t`，别让它混进 Person）。 */
function placementOf(source: PersonPlacement): PersonPlacement {
  return source.state === 'roaming'
    ? { state: 'roaming', x: source.x, y: source.y }
    : { state: source.state, bedNo: source.bedNo };
}

function withPlacement(person: Person, placement: PersonPlacement): Person {
  return { id: person.id, name: person.name, appearance: person.appearance, ...placement };
}

/**
 * 在线人数是**服务端的事实**（`people` 里既有睡痕、也有还在宽限期的床上离线者，客户端分辨不出来），
 * 所以 `join` / `leave` / `state` 每条都带着它。快照之前 `hall` 还没到，那就先不动（不凭空造一个厅）。
 */
function onlinePatch(online: number): Partial<ClientState> {
  const hall = state.hall;
  return hall ? { hall: { ...hall, online } } : {};
}

/** 有人进厅：插入条目（同 id 重复到达就覆盖，天然幂等）。 */
export function applyJoin(message: JoinMessage): void {
  const people = new Map(state.people);
  people.set(message.id, {
    id: message.id,
    name: message.name,
    appearance: message.appearance,
    ...placementOf(message),
  });
  const motion = new Map(state.motion);
  motion.delete(message.id); // 新出现的人先落位，插值从下一批 pos 开始
  setState({ people, motion, ...onlinePatch(message.online) });
}

/** 某人显示态变化（躺下 / 睡着 / 变睡痕 / 起身）。名字与外观不变。 */
export function applyState(message: StateMessage): void {
  const placement = placementOf(message);
  const motion = new Map(state.motion);
  if (placement.state !== 'roaming') motion.delete(message.id); // 上了床就不再插值：位置就是那张床

  // 自己的状态变化也走这条消息（服务端会发给自己）：自己的 `me` 必须跟着变
  if (state.me && state.me.id === message.id) {
    const next: SelfPerson = { ...withPlacement(state.me, placement) };
    // 归属与占用是两个维度：在床上时床号就是我的床；起身后归属位继续留着（暖灯标记不能丢）
    const ownedBedNo = placement.state === 'roaming' ? state.me.ownedBedNo : placement.bedNo;
    if (ownedBedNo !== undefined) next.ownedBedNo = ownedBedNo;
    setState({ me: next, motion, ...onlinePatch(message.online) });
    return;
  }

  const person = state.people.get(message.id);
  if (!person) {
    // 没见过的人：等 join 或下一次快照（TCP 有序，正常不会发生）；人数这一条仍要落下来
    setState(onlinePatch(message.online));
    return;
  }

  const people = new Map(state.people);
  people.set(message.id, withPlacement(person, placement));
  setState({ people, motion, ...onlinePatch(message.online) });
}

/** 有人离开厅（宽限超时且不在床上；或睡痕被清理）。 */
export function applyLeave(message: LeaveMessage): void {
  const people = new Map(state.people);
  people.delete(message.id);
  const motion = new Map(state.motion);
  motion.delete(message.id);
  const patch: Partial<ClientState> = { people, motion, ...onlinePatch(message.online) };
  // 离开的人正好是选中对象：一并取消选中（气泡不能留在空气里）
  if (state.selectedId === message.id) patch.selectedId = undefined;
  // 走了就不该再留着他的表情：同一个 id 在 EMOTE_MS 内重连会带着旧气泡复现
  if (state.emotes.has(message.id)) {
    const emotes = new Map(state.emotes);
    emotes.delete(message.id);
    patch.emotes = emotes;
  }
  setState(patch);
}

/** 提示条自增序号：只增不减，保证新提示的 `id` 必然不同（同一条文案也可能连着来两次）。 */
let noticeSeq = 0;

/**
 * 可恢复错误的提示：**只有文案层给得出文案的码才写 `notice`**，静默类什么都不做
 * （点墙、重复躺下这类失败用户无法处理，弹提示只会让他更焦虑，见 `docs/api/error-code.md` §3）。
 */
export function applyError(code: string): void {
  const text = errorTextFor(code);
  if (text === undefined) return;
  noticeSeq += 1;
  setState({ notice: { id: noticeSeq, text } });
}

/** 床位归属变化：认领或释放（占用完全由「人」的那一类消息派生，不走这里）。 */
export function applyBed(message: BedMessage): void {
  const ownedBeds = new Set(state.ownedBeds);
  if (message.owned) ownedBeds.add(message.bedNo);
  else ownedBeds.delete(message.bedNo);
  setState({ ownedBeds });
}
