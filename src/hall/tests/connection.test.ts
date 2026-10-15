import { describe, expect, it } from 'vitest';

import { APPEARANCES } from '../../shared/protocol';
import { appearanceFor, deriveDisplayState, guardIncoming, parseUpstream, personFromConnection } from '../connection';
import type { ConnectionState } from '../connection';

const SCENE = 'dorm-asia-01';

function connection(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    userId: 'u_1',
    name: '小明',
    appearance: 'a1',
    timezone: 'Asia/Shanghai',
    x: 1,
    y: 1,
    state: 'roaming',
    lastInputAt: 0,
    ready: false,
    ...overrides,
  };
}

describe('连接附加数据', () => {
  it('外观由用户标识推导：稳定且在枚举内', () => {
    for (const userId of ['u_1', 'u_abcdef', 'u_9f8e7d6c5b']) {
      expect(APPEARANCES).toContain(appearanceFor(userId));
      expect(appearanceFor(userId)).toBe(appearanceFor(userId));
    }
  });

  it('漫游带坐标（世界像素：格心）、躺下带床号', () => {
    expect(personFromConnection(connection())).toMatchObject({ state: 'roaming', x: 48, y: 48 });
    expect(personFromConnection(connection({ state: 'asleep', bedNo: 42 }))).toEqual({
      id: 'u_1',
      name: '小明',
      appearance: 'a1',
      state: 'asleep',
      bedNo: 42,
    });
  });
});

describe('上行报文解析', () => {
  it('认识合法消息', () => {
    expect(parseUpstream('{"t":"hello","sceneGuid":"dorm-asia-01"}')).toMatchObject({ t: 'hello' });
    expect(parseUpstream('{"t":"walk","x":3,"y":4}')).toMatchObject({ t: 'walk' });
  });

  it('非法输入一律丢弃（不报错、不断开）', () => {
    expect(parseUpstream('not json')).toBeNull();
    expect(parseUpstream('[]')).toBeNull();
    expect(parseUpstream('"hello"')).toBeNull();
    expect(parseUpstream('{}')).toBeNull();
    expect(parseUpstream('{"t":"nope"}')).toBeNull();
    expect(parseUpstream('{"t":"hello"}')).toMatchObject({ t: 'hello' });
  });
});

describe('握手门槛', () => {
  it('首条 hello 且场景一致 → 放行握手', () => {
    expect(guardIncoming(connection(), `{"t":"hello","sceneGuid":"${SCENE}"}`, SCENE)).toEqual({
      kind: 'hello',
    });
  });

  it('场景不一致 → 2003', () => {
    expect(guardIncoming(connection(), '{"t":"hello","sceneGuid":"other"}', SCENE)).toEqual({
      kind: 'reject',
      code: '2003',
    });
  });

  it('未握手就发业务消息 → 2004', () => {
    expect(guardIncoming(connection(), '{"t":"walk","x":1,"y":1}', SCENE)).toEqual({
      kind: 'reject',
      code: '2004',
    });
    expect(guardIncoming(connection(), '{"t":"chat","text":"hi"}', SCENE)).toEqual({
      kind: 'reject',
      code: '2004',
    });
  });

  it('握手后业务消息放行，重复 hello 忽略', () => {
    const ready = connection({ ready: true });
    expect(guardIncoming(ready, '{"t":"walk","x":1,"y":1}', SCENE)).toMatchObject({ kind: 'business' });
    expect(guardIncoming(ready, `{"t":"hello","sceneGuid":"${SCENE}"}`, SCENE)).toEqual({ kind: 'ignore' });
    expect(guardIncoming(ready, 'garbage', SCENE)).toEqual({ kind: 'ignore' });
  });
});

describe('自动睡着是推导出来的（读取时推导，不挂定时器）', () => {
  const AUTO_SLEEP_MS = 300_000;

  it('在床上清醒且无输入满阈值 → 睡着（边界算「到点」，与到期事件一致）', () => {
    const lying = connection({ state: 'lying', bedNo: 3, lastInputAt: 1000 });
    expect(deriveDisplayState(lying, 1000 + AUTO_SLEEP_MS - 1, AUTO_SLEEP_MS)).toBe('lying');
    expect(deriveDisplayState(lying, 1000 + AUTO_SLEEP_MS, AUTO_SLEEP_MS)).toBe('asleep');
    expect(deriveDisplayState(lying, 1000 + AUTO_SLEEP_MS + 1, AUTO_SLEEP_MS)).toBe('asleep');
  });

  it('刚有过输入就是清醒的；已经睡着的不受影响', () => {
    const lying = connection({ state: 'lying', bedNo: 3, lastInputAt: 1000 });
    expect(deriveDisplayState(lying, 2000, AUTO_SLEEP_MS)).toBe('lying');
    expect(deriveDisplayState(connection({ state: 'asleep', bedNo: 3, lastInputAt: 0 }), 10_000_000, AUTO_SLEEP_MS)).toBe('asleep');
  });

  it('不在床上的人不会被推导成睡着（清醒度只在床上才有意义）', () => {
    expect(deriveDisplayState(connection({ lastInputAt: 0 }), 10_000_000, AUTO_SLEEP_MS)).toBe('roaming');
  });
});
