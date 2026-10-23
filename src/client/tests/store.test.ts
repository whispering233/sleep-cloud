import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LAYOUT_VERSION } from '../../shared/layout';
import { encodeOwnedBeds } from '../../shared/protocol';
import type { SnapshotMessage } from '../../shared/protocol';
import { CHAT_BUBBLE_MS } from '../../shared/constants';
import {
  applyBed,
  applyChat,
  applyError,
  applyFeedbackFailure,
  applyFeedbackReceipt,
  applyJoin,
  applyLeave,
  applyPos,
  applyReportReceipt,
  applyResize,
  applySnapshot,
  applyState,
  applyWhisper,
  clearFeedbackError,
  clearSelection,
  closeAbout,
  getState,
  openAbout,
  openFeedback,
  selectPerson,
  setBedDirection,
  setDecor,
  drawReadItem,
  ensureReadItem,
  replayRead,
  setComposer,
  setState,
  startReport,
  subscribe,
} from '../store';
import type { TypeTextItem } from '../type-texts';

const BED_COUNT = 114;

const snapshot = (overrides: Partial<SnapshotMessage> = {}): SnapshotMessage => ({
  t: 'snapshot',
  layoutVersion: LAYOUT_VERSION,
  serverTs: 1_000_000,
  hall: { bedCount: BED_COUNT, online: 2 },
  me: { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: 812.5, y: 430 },
  ownedBeds: encodeOwnedBeds([42], BED_COUNT),
  people: [{ id: 'u_other', name: '阿夜', appearance: 'girl', state: 'roaming', x: 300, y: 280 }],
  ...overrides,
});

/** 我自己的条目（默认在厅里走动）；用途只有一个：带上 `ownedBedNo` 试归属位清理。 */
const meWith = (overrides: { ownedBedNo?: number } = {}): SnapshotMessage['me'] => ({
  id: 'u_me',
  name: '我',
  appearance: 'boy',
  state: 'roaming',
  x: 812.5,
  y: 430,
  ...overrides,
});

beforeEach(() => {
  applySnapshot(snapshot({ ownedBeds: encodeOwnedBeds([], BED_COUNT), people: [] }));
});

describe('客户端状态归约', () => {
  it('快照整体覆盖，并记下与服务端的时钟偏差', () => {
    applySnapshot(snapshot());
    const state = getState();

    expect(state.connection).toBe('online');
    expect(state.layoutVersion).toBe(LAYOUT_VERSION);
    expect(state.people.get('u_other')).toMatchObject({ name: '阿夜', x: 300, y: 280 });
    expect([...state.ownedBeds]).toEqual([42]);
    expect(state.motion.size).toBe(0);
    expect(Math.abs(state.clockOffsetMs - (1_000_000 - Date.now()))).toBeLessThan(1000);
  });

  it('join：插入条目，重复到达就覆盖（幂等），并清掉旧的插值窗口', () => {
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_new', 260, 300]] });
    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'boy', state: 'roaming', x: 460, y: 430, online: 3 });
    expect(getState().people.get('u_new')).toMatchObject({ name: '新来的', x: 460, y: 430 });
    expect(getState().motion.has('u_new')).toBe(false);

    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'boy', state: 'roaming', x: 520, y: 560, online: 3 });
    expect(getState().people.size).toBe(1);
    expect(getState().people.get('u_new')).toMatchObject({ x: 520, y: 560 });
  });

  it('state：更新显示态、保留名字与外观，上床后不再插值', () => {
    applySnapshot(snapshot());
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 380, 340]] });
    expect(getState().motion.has('u_other')).toBe(true);

    applyState({ t: 'state', id: 'u_other', state: 'asleep', bedNo: 7, online: 2 });
    expect(getState().people.get('u_other')).toMatchObject({ name: '阿夜', appearance: 'girl', state: 'asleep', bedNo: 7 });
    expect(getState().motion.has('u_other')).toBe(false);
  });

  it('state：自己的状态变化也走这条消息，并补上归属位', () => {
    applySnapshot(snapshot());
    applyState({ t: 'state', id: 'u_me', state: 'lying', bedNo: 42, online: 2 });

    expect(getState().me).toMatchObject({ id: 'u_me', state: 'lying', bedNo: 42, ownedBedNo: 42 });
    expect(getState().people.has('u_me')).toBe(false); // 自己不进 people

    applyState({ t: 'state', id: 'u_me', state: 'roaming', x: 3, y: 4, online: 2 });
    expect(getState().me).toMatchObject({ state: 'roaming', x: 3, y: 4, ownedBedNo: 42 }); // 归属保留
  });

  it('state：没见过的人直接忽略（等 join 或下一次快照）', () => {
    applyState({ t: 'state', id: 'u_ghost', state: 'asleep', bedNo: 9, online: 2 });
    expect(getState().people.has('u_ghost')).toBe(false);
  });

  it('leave：人与插值窗口一起移除', () => {
    applySnapshot(snapshot());
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 380, 340]] });
    applyLeave({ t: 'leave', id: 'u_other', online: 2 });
    expect(getState().people.has('u_other')).toBe(false);
    expect(getState().motion.has('u_other')).toBe(false);
  });

  it('online：join / leave / state 三条消息都把 hall.online 刷成消息里的值', () => {
    applySnapshot(snapshot()); // 快照里是 2
    expect(getState().hall?.online).toBe(2);

    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'boy', state: 'roaming', x: 7, y: 8, online: 3 });
    expect(getState().hall?.online).toBe(3);

    applyState({ t: 'state', id: 'u_other', state: 'asleep', bedNo: 7, online: 2 });
    expect(getState().hall?.online).toBe(2);

    applyLeave({ t: 'leave', id: 'u_other', online: 1 });
    expect(getState().hall?.online).toBe(1);
  });

  it('online：快照还没到（没有 hall）时什么都不动，不凭空造一个厅', () => {
    setState({ hall: undefined });
    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'boy', state: 'roaming', x: 7, y: 8, online: 1 });
    applyState({ t: 'state', id: 'u_new', state: 'roaming', x: 8, y: 8, online: 1 });
    applyLeave({ t: 'leave', id: 'u_new', online: 0 });
    expect(getState().hall).toBeUndefined();
  });

  it('online：刷新人数不动我已存的厅信息（只换 online 一个字段）', () => {
    applySnapshot(snapshot());
    applyJoin({ t: 'join', id: 'u_new', name: '新来的', appearance: 'boy', state: 'roaming', x: 7, y: 8, online: 3 });
    expect(getState().hall).toEqual({ bedCount: BED_COUNT, online: 3 });
  });

  it('bed：归属集合增删（占用不走这条消息）', () => {
    applyBed({ t: 'bed', bedNo: 42, owned: true });
    expect([...getState().ownedBeds]).toEqual([42]);
    applyBed({ t: 'bed', bedNo: 42, owned: false });
    expect([...getState().ownedBeds]).toEqual([]);
    applyBed({ t: 'bed', bedNo: 42, owned: false }); // 再删一次也不炸
    expect([...getState().ownedBeds]).toEqual([]);
  });

  it('resize：床位数变化只更这一个数字，越界的条目顺手丢掉', () => {
    applySnapshot(snapshot({ hall: { bedCount: 161, online: 2 } }));
    applyBed({ t: 'bed', bedNo: 120, owned: true });
    applyResize({ t: 'resize', bedCount: 114 });

    expect(getState().hall?.bedCount).toBe(114);
    expect(getState().ownedBeds.has(120)).toBe(false); // 降级砍掉的正是最大那些编号
    expect(getState().ownedBeds.has(42)).toBe(true);
  });

  it('resize：升级（新增外圈）不动归属与占用，只是多了床位', () => {
    applySnapshot(snapshot());
    applyResize({ t: 'resize', bedCount: 161 });

    expect(getState().hall?.bedCount).toBe(161);
    expect([...getState().ownedBeds]).toEqual([42]);
    expect(getState().people.size).toBe(1);
  });

  it('resize：降级砍掉的正好是我的床 → me.ownedBedNo 一并清掉（暖灯不能指着不存在的床）', () => {
    applySnapshot(snapshot({ hall: { bedCount: 161, online: 2 }, me: meWith({ ownedBedNo: 120 }) }));
    expect(getState().me?.ownedBedNo).toBe(120);

    applyResize({ t: 'resize', bedCount: 114 });
    expect(getState().me?.ownedBedNo).toBeUndefined();
  });

  it('resize：我的床还在 → 归属位不动', () => {
    applySnapshot(snapshot({ me: meWith({ ownedBedNo: 42 }) }));
    applyResize({ t: 'resize', bedCount: 161 });
    expect(getState().me?.ownedBedNo).toBe(42);
  });

  it('bed{owned:false}：被释放的正好是我的床（30 天没回来）→ me.ownedBedNo 一并清掉', () => {
    applySnapshot(snapshot({ me: meWith({ ownedBedNo: 42 }) }));

    applyBed({ t: 'bed', bedNo: 42, owned: false });
    expect(getState().me?.ownedBedNo).toBeUndefined();
  });

  it('bed{owned:false}：释放的是别人的床 → 我的归属位不动', () => {
    applySnapshot(snapshot({ me: meWith({ ownedBedNo: 42 }) }));

    applyBed({ t: 'bed', bedNo: 7, owned: false });
    expect(getState().me?.ownedBedNo).toBe(42);
  });

  it('睡痕条目落进 people（服务端不给到期时刻：睡痕不自己消失）', () => {
    applySnapshot(
      snapshot({
        people: [
          { id: 'u_trace', name: '夜猫', appearance: 'boy', state: 'trace', bedNo: 8 },
        ],
      }),
    );

    expect(getState().people.get('u_trace')).toMatchObject({ state: 'trace', bedNo: 8 });
  });

  it('pos：没有上一个窗口时直接落位，并把权威坐标记进 people', () => {
    applySnapshot(snapshot());
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 420.5, 342.25]] });
    const state = getState();
    expect(state.motion.get('u_other')).toMatchObject({ fromX: 420.5, fromY: 342.25, toX: 420.5, toY: 342.25 });
    expect(state.people.get('u_other')).toMatchObject({ x: 420.5, y: 342.25 });
  });

  it('pos：批次里含我自己 → me.x/y 一并补写成权威坐标', () => {
    applySnapshot(snapshot());
    expect(getState().me).toMatchObject({ x: 812.5, y: 430 });

    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_me', 900, 500], ['u_other', 420, 340]] });
    expect(getState().me).toMatchObject({ id: 'u_me', x: 900, y: 500 });
    expect(getState().people.get('u_other')).toMatchObject({ x: 420, y: 340 });
  });

  it('pos：批次里没有我 → me 原样不动（同一个对象）', () => {
    applySnapshot(snapshot());
    const before = getState().me;
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_other', 420, 340]] });
    expect(getState().me).toBe(before);
  });

  it('pos：我已经在床上（不是 roaming）→ 不写 me 的坐标', () => {
    applySnapshot(
      snapshot({ me: { id: 'u_me', name: '我', appearance: 'boy', state: 'lying', bedNo: 42 } }),
    );
    applyPos({ t: 'pos', ts: 1_000_100, items: [['u_me', 900, 500]] });
    expect(getState().me).toMatchObject({ state: 'lying', bedNo: 42 });
    expect(getState().me).not.toHaveProperty('x');
  });

  it('连接态的起点是 connecting（还没有收到快照）', async () => {
    vi.resetModules();
    const fresh = await import('../store');
    expect(fresh.getState().connection).toBe('connecting');
  });
});

describe('客户端聊天气泡', () => {
  it('写入显示到期的时刻：约等于现在 + CHAT_BUBBLE_MS', () => {
    const before = Date.now();
    applyChat({ t: 'chat', id: 'u_other', text: '我也睡不着', ts: 1_000_200 });
    const bubble = getState().bubbles.get('u_other');
    expect(bubble).toMatchObject({ text: '我也睡不着', kind: 'chat' });
    expect(Math.abs((bubble?.expiresAt ?? 0) - (before + CHAT_BUBBLE_MS))).toBeLessThanOrEqual(100);
  });

  it('store 里只有「谁说了什么、到什么时候」：名字与是否自己都留给渲染时现取', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_me', text: '有人吗', ts: 1_000_200 });
    expect(Object.keys(getState().bubbles.get('u_me') ?? {}).sort()).toEqual(['expiresAt', 'kind', 'text']);
  });

  it('同一个人后来的消息覆盖前一条并重置计时（不排队、不堆叠）', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_other', text: '第一条', ts: 1_000_200 });
    const first = getState().bubbles.get('u_other')?.expiresAt ?? 0;
    applyChat({ t: 'chat', id: 'u_other', text: '第二条', ts: 1_000_300 });

    expect(getState().bubbles.size).toBe(1);
    expect(getState().bubbles.get('u_other')?.text).toBe('第二条');
    expect(getState().bubbles.get('u_other')?.expiresAt).toBeGreaterThanOrEqual(first);
  });

  it('人离开大厅 → 他的气泡立刻消失（气泡长在人身上）', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_other', text: '我也睡不着', ts: 1_000_200 });

    applyLeave({ t: 'leave', id: 'u_other', online: 2 });
    expect(getState().bubbles.has('u_other')).toBe(false);
  });

  it('快照重来清空气泡（重连以新快照为准）', () => {
    applyChat({ t: 'chat', id: 'u_other', text: '我也睡不着', ts: 1_000_200 });
    applySnapshot(snapshot());
    expect(getState().bubbles.size).toBe(0);
  });
});

describe('选中态', () => {
  it('全局唯一：选了 A 再选 B 只剩 B', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    expect(getState().selectedId).toBe('u_other');

    selectPerson('u_me');
    expect(getState().selectedId).toBe('u_me');
  });

  it('点 × 取消选中', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    clearSelection();
    expect(getState().selectedId).toBeUndefined();
  });

  it('选中对象离开大厅 → 一并取消选中（气泡不能留在空气里）', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    applyLeave({ t: 'leave', id: 'u_other', online: 2 });
    expect(getState().selectedId).toBeUndefined();
  });

  it('别人离开不影响我的选中态', () => {
    applySnapshot(snapshot());
    applyJoin({ t: 'join', id: 'u_third', name: '第三人', appearance: 'boy', state: 'roaming', x: 2, y: 2, online: 2 });
    selectPerson('u_other');
    applyLeave({ t: 'leave', id: 'u_third', online: 2 });
    expect(getState().selectedId).toBe('u_other');
  });

  it('快照重来以新快照为准：选中态被清掉', () => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    applySnapshot(snapshot());
    expect(getState().selectedId).toBeUndefined();
  });
});

describe('我的床的方位（动作行的方向字形）', () => {
  it('同值不写：世界层每帧都算一次方位，守卫挡住位置节拍变成每帧一次渲染', () => {
    let notices = 0;
    const unsubscribe = subscribe(() => {
      notices += 1;
    });

    setBedDirection('nw');
    expect(getState().bedDirection).toBe('nw');
    setBedDirection('nw');
    expect(notices).toBe(1);

    setBedDirection(undefined); // 床回到视野内
    expect(notices).toBe(2);
    unsubscribe();
  });

  it('快照重来以新快照为准：方位清掉，下一帧世界层按新镜头重算', () => {
    setBedDirection('s');
    applySnapshot(snapshot());
    expect(getState().bedDirection).toBeUndefined();
  });
});

describe('预留位装饰（本地偏好，`docs/design/80-reserve-decor.md` §4）', () => {
  it('setDecor 只动这一块：另一块原样保留，并且换掉对象引用（世界层 / 浮层据此重画）', () => {
    const original = getState().decor;
    try {
      setDecor('head', 'none');
      expect(getState().decor).toEqual({ head: 'none', foot: original.foot });
      expect(getState().decor).not.toBe(original);
    } finally {
      setState({ decor: original });
    }
  });

  it('同值不写：不通知订阅者也**不换对象**（连点同一项不该逐次重渲染）', () => {
    const original = getState().decor;
    let notices = 0;
    const unsubscribe = subscribe(() => {
      notices += 1;
    });
    try {
      setDecor('foot', 'none');
      expect(notices).toBe(1);
      const after = getState().decor;

      setDecor('foot', 'none');
      expect(notices).toBe(1);
      expect(getState().decor).toBe(after);
    } finally {
      unsubscribe();
      setState({ decor: original });
    }
  });
});

describe('客户端错误提示', () => {
  it('可恢复错误写 notice，id 自增（提示条靠新 id 重播动画）', () => {
    setState({ notice: undefined });
    applyError('3002');
    expect(getState().notice).toMatchObject({ text: '这张床有人了' });
    const first = getState().notice?.id ?? 0;

    expect(first).toBeGreaterThan(0);
    applyError('3002'); // 同一条文案连着来两次：id 也要换
    expect(getState().notice?.id).toBeGreaterThan(first);
  });

  it('静默类什么都不做：点墙 3006 不弹提示，也不清掉已有的提示', () => {
    setState({ notice: undefined });
    applyError('3006');
    expect(getState().notice).toBeUndefined();

    applyError('4001');
    applyError('3006');
    expect(getState().notice?.text).toBe('消息太长了');
  });

  it('未知码不写 notice（前端不认识的东西不该凭空冒出一句提示）', () => {
    setState({ notice: undefined });
    applyError('1234');
    expect(getState().notice).toBeUndefined();
  });
});

describe('客户端私聊气泡', () => {
  it('气泡挂在发送者头上，kind 为 whisper', () => {
    applySnapshot(snapshot());
    applyWhisper({ t: 'whisper', fromId: 'u_other', toId: 'u_me', text: '睡了吗', ts: 1_000_300 });
    expect(getState().bubbles.get('u_other')).toMatchObject({ text: '睡了吗', kind: 'whisper' });
  });

  it('自己发出的私聊也挂在自己头上（同一份 payload 收发双方各收一条）', () => {
    applySnapshot(snapshot());
    applyWhisper({ t: 'whisper', fromId: 'u_me', toId: 'u_other', text: '我睡不着', ts: 1_000_300 });
    expect(getState().bubbles.get('u_me')).toMatchObject({ text: '我睡不着', kind: 'whisper' });
  });

  it('私聊覆盖这个人前一条全局消息：头顶只有一个气泡', () => {
    applySnapshot(snapshot());
    applyChat({ t: 'chat', id: 'u_other', text: '大家好', ts: 1_000_200 });
    applyWhisper({ t: 'whisper', fromId: 'u_other', toId: 'u_me', text: '只给你', ts: 1_000_300 });

    expect(getState().bubbles.size).toBe(1);
    expect(getState().bubbles.get('u_other')).toMatchObject({ text: '只给你', kind: 'whisper' });
  });
});

describe('输入会话', () => {
  it('初值是 idle；focus-in 进 typing，同值不通知', () => {
    expect(getState().composer).toBe('idle');
    let notified = 0;
    const off = subscribe(() => {
      notified += 1;
    });
    setComposer({ kind: 'focus-in' });
    setComposer({ kind: 'focus-in' });
    expect(getState().composer).toBe('typing');
    expect(notified).toBe(1);

    setComposer({ kind: 'lost-focus' });
    expect(getState().composer).toBe('idle');
    expect(notified).toBe(2);
    off();
  });

  it('断线也退场：offline 事件从 typing 回到 idle', () => {
    setComposer({ kind: 'focus-in' });
    setComposer({ kind: 'offline' });
    expect(getState().composer).toBe('idle');
  });
});

describe('说明面板', () => {
  it('初值按已读判定给自动弹（测试机没有 storage = 缺键）；打开记原因，关闭只清状态', () => {
    expect(getState().aboutOpen).toBe('auto');

    let notified = 0;
    const off = subscribe(() => {
      notified += 1;
    });

    openAbout('manual');
    openAbout('manual');
    expect(getState().aboutOpen).toBe('manual');
    expect(notified).toBe(1);

    closeAbout();
    closeAbout();
    expect(getState().aboutOpen).toBeNull();
    expect(notified).toBe(2);
    off();
  });
});

describe('反馈与建议', () => {
  beforeEach(() => {
    applySnapshot(snapshot());
    setComposer({ kind: 'exit' });
    setState({ chatHint: undefined, feedbackError: undefined });
  });

  it('齿轮入口进 feedback 会话，不要求选中任何人', () => {
    openFeedback();
    expect(getState().composer).toBe('feedback');
    expect(getState().selectedId).toBeUndefined();
  });

  it('5004 回执：那行话常驻、不置灰任何人', () => {
    openFeedback();
    applyFeedbackReceipt();
    expect(getState().chatHint).toBe('已收到你的反馈');
    expect(getState().reportedIds.size).toBe(0);
  });

  it('可恢复失败就地显示，清错误与退场各清一次', () => {
    openFeedback();
    applyFeedbackFailure('4004');
    expect(getState().feedbackError).toBe('今天已经提过很多次了，明天再来');
    clearFeedbackError();
    expect(getState().feedbackError).toBeUndefined();

    applyFeedbackFailure('4001');
    setComposer({ kind: 'exit' });
    expect(getState().composer).toBe('idle');
    expect(getState().feedbackError).toBeUndefined();
  });
});

describe('举报回执', () => {
  beforeEach(() => {
    applySnapshot(snapshot());
    selectPerson('u_other');
    setComposer({ kind: 'exit' });
    setState({ pendingReportTo: undefined, reportedIds: new Set(), chatHint: undefined });
  });

  it('点举报：进 report 态并记下这一单打给谁', () => {
    startReport('u_other');
    expect(getState().composer).toBe('report');
    expect(getState().pendingReportTo).toBe('u_other');
    expect(getState().reportedIds.has('u_other')).toBe(false);
  });

  it('5003 回执：对象进「已举报」、待办单清空、那行话常驻', () => {
    startReport('u_other');
    applyReportReceipt();
    expect(getState().reportedIds.has('u_other')).toBe(true);
    expect(getState().pendingReportTo).toBeUndefined();
    expect(getState().chatHint).toBe('已收到你的反馈');
  });

  it('没有待办单时的回执是空操作（重复的 5003 不置灰别人）', () => {
    applyReportReceipt();
    expect(getState().reportedIds.size).toBe(0);
    expect(getState().chatHint).toBeUndefined();
  });

  it('回执话常驻到下一次操作：退场不演它，开新会话 / 改选 / 取消选中才让位', () => {
    startReport('u_other');
    applyReportReceipt();
    setComposer({ kind: 'exit' });
    expect(getState().composer).toBe('idle');
    expect(getState().chatHint).toBe('已收到你的反馈');

    setComposer({ kind: 'focus-in' });
    expect(getState().chatHint).toBeUndefined();
    setComposer({ kind: 'exit' });
    setState({ chatHint: '已收到你的反馈' });
    selectPerson('u_other');
    expect(getState().chatHint).toBeUndefined();
  });

  it('举报对象走了：表单跟着退场', () => {
    startReport('u_other');
    applyLeave({ t: 'leave', id: 'u_other', online: 1 });
    expect(getState().composer).toBe('idle');
    expect(getState().selectedId).toBeUndefined();
  });

  it('举报中取消选中：表单跟着退场', () => {
    startReport('u_other');
    clearSelection();
    expect(getState().composer).toBe('idle');
    expect(getState().pendingReportTo).toBe('u_other');
  });

  it('举报中改选别人：表单也跟着退场（否则看不见对象在写事由）', () => {
    startReport('u_other');
    selectPerson('u_third');
    expect(getState().composer).toBe('idle');
  });
});

describe('类型文本的阅读进度', () => {
  const ITEMS: TypeTextItem[] = [
    { id: 'j1', text: '一' },
    { id: 'j2', text: '二' },
    { id: 'j3', text: '三' },
  ];
  const reset = (): void => setState({ readProgress: { seen: {}, current: {} } });

  beforeEach(reset);

  it('首次打开抽一条：见它、也记成当前条', () => {
    const item = ensureReadItem('joke', ITEMS);
    expect(item).not.toBeNull();
    expect(getState().readProgress.current.joke).toBe(item?.id);
    expect(getState().readProgress.seen.joke).toEqual([item?.id]);
  });

  it('再打开还是那条（不抽新的），直到显式抽签', () => {
    const first = ensureReadItem('joke', ITEMS);
    expect(ensureReadItem('joke', ITEMS)).toEqual(first);
  });

  it('当前条数据里已不存在 → 当作没有，重新抽一条', () => {
    setState({ readProgress: { seen: { joke: ['gone'] }, current: { joke: 'gone' } } });
    const item = ensureReadItem('joke', ITEMS);
    expect(item).not.toBeNull();
    expect(ITEMS.some((each) => each.id === item?.id)).toBe(true);
  });

  it('抽签不重复：抽三条正好把三条各抽一遍，第四条抽不出来', () => {
    const drawn = [drawReadItem('joke', ITEMS), drawReadItem('joke', ITEMS), drawReadItem('joke', ITEMS)];
    expect(new Set(drawn.map((each) => each?.id)).size).toBe(3);
    expect(drawReadItem('joke', ITEMS)).toBeNull();
  });

  it('池里只剩当前条时不排除它（否则永远抽不出来）', () => {
    setState({ readProgress: { seen: { joke: ['j1', 'j2'] }, current: { joke: 'j3' } } });
    expect(replayRead('joke', ITEMS)).not.toBeNull();
    expect(getState().readProgress.seen.joke).toHaveLength(1);
  });

  it('再看一遍：清空 seen 再抽，且不会原地不动（池长 ≥2 时排除当前条）', () => {
    setState({ readProgress: { seen: { joke: ['j1', 'j2'] }, current: { joke: 'j2' } } });
    const next = replayRead('joke', ITEMS);
    expect(next?.id).not.toBe('j2');
    expect(getState().readProgress.current.joke).toBe(next?.id);
    expect(getState().readProgress.seen.joke).toEqual([next?.id]);
  });

  it('单个分类的进度不互相覆盖', () => {
    drawReadItem('joke', ITEMS);
    setState({ readProgress: { ...getState().readProgress, current: { ...getState().readProgress.current, cat2: 'x1' } } });
    drawReadItem('joke', ITEMS);
    expect(getState().readProgress.current.cat2).toBe('x1');
  });
});
