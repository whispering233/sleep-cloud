import type { HallInfo, Person, SnapshotMessage, SelfPerson } from '../shared/protocol';

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
}

let state: ClientState = { connected: false, ownedBeds: new Set(), people: new Map() };
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
  });
}
