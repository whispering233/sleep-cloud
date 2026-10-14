import type {
  BedMessage,
  ChatMessage,
  HallInfo,
  JoinMessage,
  LeaveMessage,
  Person,
  PersonPlacement,
  PosMessage,
  SnapshotMessage,
  SelfPerson,
  StateMessage,
} from '../shared/protocol';
import { CHAT_LOG_MAX } from '../shared/constants';
import { nextMotion } from './motion';
import type { Motion } from './motion';

/** 一行聊天消息：**名字与是否自己都在追加那一刻定下来**，渲染时不再回查 `people`。 */
export interface ChatLine {
  id: string;
  name: string;
  text: string;
  ts: number;
  own: boolean;
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
  /** 最近收到的全局消息（只用于显示；服务端不存历史） */
  messages: ChatLine[];
}

const emptyState = (): ClientState => ({
  connected: false,
  ownedBeds: new Set(),
  people: new Map(),
  motion: new Map(),
  clockOffsetMs: 0,
  messages: [],
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
  });
}

/**
 * 全局消息：**追加那一刻就把发送者名字固化到这一行**。
 * 渲染时不能回头查 `people`——对方离开后那行名字会变空（见 `docs/ui/DESIGN.md`）。
 */
export function applyChat(message: ChatMessage): void {
  const own = state.me?.id === message.id;
  const name = (own ? state.me?.name : state.people.get(message.id)?.name) ?? '某人';
  const line: ChatLine = { id: message.id, name, text: message.text, ts: message.ts, own };
  setState({ messages: [...state.messages, line].slice(-CHAT_LOG_MAX) });
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
  setState({ people, motion });
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
    setState({ me: next, motion });
    return;
  }

  const person = state.people.get(message.id);
  if (!person) return; // 没见过的人：等 join 或下一次快照（TCP 有序，正常不会发生）

  const people = new Map(state.people);
  people.set(message.id, withPlacement(person, placement));
  setState({ people, motion });
}

/** 有人离开厅（宽限超时且不在床上；或睡痕被清理）。 */
export function applyLeave(message: LeaveMessage): void {
  const people = new Map(state.people);
  people.delete(message.id);
  const motion = new Map(state.motion);
  motion.delete(message.id);
  setState({ people, motion });
}

/** 床位归属变化：认领或释放（占用完全由「人」的那一类消息派生，不走这里）。 */
export function applyBed(message: BedMessage): void {
  const ownedBeds = new Set(state.ownedBeds);
  if (message.owned) ownedBeds.add(message.bedNo);
  else ownedBeds.delete(message.bedNo);
  setState({ ownedBeds });
}
