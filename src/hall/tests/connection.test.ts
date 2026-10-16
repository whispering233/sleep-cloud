import { describe, expect, it } from 'vitest';

import { APPEARANCES } from '../../shared/protocol';
import { HALL_LEVELS, frontPointOf, isWalkable } from '../../shared/layout';
import {
  appearanceFor,
  deriveDisplayState,
  guardIncoming,
  parseUpstream,
  personFromConnection,
  recoverForShrink,
  retarget,
} from '../connection';
import type { ConnectionState } from '../connection';
import type { Point } from '../../shared/layout';

const LAYOUT_VERSION = 'room-1';

function connection(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    userId: 'u_1',
    name: '小明',
    appearance: 'boy',
    x: 130.5,
    y: 128,
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

  it('漫游带世界像素坐标（可以是小数）、躺下带床号', () => {
    expect(personFromConnection(connection())).toMatchObject({ state: 'roaming', x: 130.5, y: 128 });
    expect(personFromConnection(connection({ state: 'asleep', bedNo: 42 }))).toEqual({
      id: 'u_1',
      name: '小明',
      appearance: 'boy',
      state: 'asleep',
      bedNo: 42,
    });
  });
});

describe('新意图覆盖路径', () => {
  const headingToBed = connection({ target: { x: 10, y: 10 }, arrivalAction: 'lie', arrivalBedNo: 7 });

  it('点床后、到达前又点地面：到达后动作被一并清掉，走完不躺下', () => {
    const retargeted = retarget(headingToBed, { x: 20, y: 20 });
    expect(retargeted.target).toEqual({ x: 20, y: 20 });
    // 这就是「走完不躺」：`tick` 的到达分支只在 `arrivalAction === 'lie'` 时躺下
    expect(retargeted.arrivalAction).toBeUndefined();
    expect(retargeted.arrivalBedNo).toBeUndefined();
  });

  it('就地走路（目标就是当前点）同样要清掉到达后动作', () => {
    expect(retarget(headingToBed, undefined).target).toBeUndefined();
    expect(retarget(headingToBed, undefined).arrivalAction).toBeUndefined();
  });

  it('位置与状态本身不动（只换目标与到达后动作）', () => {
    const retargeted = retarget(headingToBed, { x: 20, y: 20 });
    expect(retargeted).toMatchObject({ userId: 'u_1', name: '小明', appearance: 'boy', x: 130.5, y: 128, state: 'roaming' });
  });
});

describe('降级前的位置恢复', () => {
  const levelOne = (HALL_LEVELS[0] as { capacity: number }).capacity;
  const levelTwo = (HALL_LEVELS[1] as { capacity: number }).capacity;

  it('降级后旧外圈的位置被拉回可走的街网（新墙之外 → 街上）', () => {
    // 第 2 级才有的第一张床，它床脚前那条走道在第 1 级就是「新墙之外」
    const stranded = frontPointOf(levelOne) as Point;
    expect(isWalkable(stranded.x, stranded.y, levelTwo)).toBe(true);
    expect(isWalkable(stranded.x, stranded.y, levelOne)).toBe(false);

    const recovered = recoverForShrink(connection({ x: stranded.x, y: stranded.y }), levelOne);
    expect(isWalkable(recovered.x, recovered.y, levelOne)).toBe(true);
    expect(recovered.x).not.toBe(stranded.x);
  });

  it('正在走的那条路径被清掉（`target` 与到达后动作），否则他会沿着旧路径走出墙外', () => {
    const walking = connection({ target: { x: 9999, y: 9999 }, arrivalAction: 'lie', arrivalBedNo: 5 });
    const recovered = recoverForShrink(walking, levelOne);
    expect(recovered.target).toBeUndefined();
    expect(recovered.arrivalAction).toBeUndefined();
    expect(recovered.arrivalBedNo).toBeUndefined();
  });

  it('已经在街网上的人位置不动，但路径同样被清掉（落地状态是「停在街网上」）', () => {
    const standing = connection({ target: { x: 200, y: 128 } });
    const recovered = recoverForShrink(standing, levelOne);
    expect({ x: recovered.x, y: recovered.y }).toEqual({ x: standing.x, y: standing.y });
    expect(recovered.target).toBeUndefined();
  });
});

describe('上行报文解析', () => {
  it('认识合法消息', () => {
    expect(parseUpstream('{"t":"hello","layoutVersion":"room-1"}')).toMatchObject({ t: 'hello' });
    expect(parseUpstream('{"t":"walk","x":3.5,"y":4.25}')).toMatchObject({ t: 'walk' });
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
  it('首条 hello 且布局版本一致 → 放行握手', () => {
    expect(guardIncoming(connection(), `{"t":"hello","layoutVersion":"${LAYOUT_VERSION}"}`, LAYOUT_VERSION)).toEqual({
      kind: 'hello',
    });
  });

  it('布局版本不一致（旧 bundle 连上新几何）→ 2003', () => {
    expect(guardIncoming(connection(), '{"t":"hello","layoutVersion":"dorm-0"}', LAYOUT_VERSION)).toEqual({
      kind: 'reject',
      code: '2003',
    });
  });

  it('未握手就发业务消息 → 2004', () => {
    expect(guardIncoming(connection(), '{"t":"walk","x":1,"y":1}', LAYOUT_VERSION)).toEqual({
      kind: 'reject',
      code: '2004',
    });
    expect(guardIncoming(connection(), '{"t":"chat","text":"hi"}', LAYOUT_VERSION)).toEqual({
      kind: 'reject',
      code: '2004',
    });
  });

  it('握手后业务消息放行，重复 hello 忽略', () => {
    const ready = connection({ ready: true });
    expect(guardIncoming(ready, '{"t":"walk","x":1,"y":1}', LAYOUT_VERSION)).toMatchObject({ kind: 'business' });
    expect(guardIncoming(ready, `{"t":"hello","layoutVersion":"${LAYOUT_VERSION}"}`, LAYOUT_VERSION)).toEqual({
      kind: 'ignore',
    });
    expect(guardIncoming(ready, 'garbage', LAYOUT_VERSION)).toEqual({ kind: 'ignore' });
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
