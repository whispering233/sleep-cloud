import type { HallInfo, Person, PosMessage, SnapshotMessage, SelfPerson } from '../shared/protocol';
import { nextMotion } from './motion';
import type { Motion } from './motion';

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
}

const emptyState = (): ClientState => ({
  connected: false,
  ownedBeds: new Set(),
  people: new Map(),
  motion: new Map(),
  clockOffsetMs: 0,
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
  });
}

/** 一批权威位置（已合并）→ 插值窗口。 */
export function applyPos(message: PosMessage): void {
  const motion = new Map(state.motion);
  const people = new Map(state.people);

  for (const [id, x, y] of message.items) {
    motion.set(id, nextMotion(motion.get(id), x, y, message.ts));
    const person = people.get(id);
    if (person && person.state === 'roaming') people.set(id, { ...person, x, y });
  }

  setState({ motion, people });
}
