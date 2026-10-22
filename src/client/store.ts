import type {
  BedMessage,
  ChatMessage,
  HallInfo,
  JoinMessage,
  LeaveMessage,
  Person,
  PersonPlacement,
  PosMessage,
  ResizeMessage,
  SnapshotMessage,
  SelfPerson,
  StateMessage,
  WhisperMessage,
} from '../shared/protocol';
import { CHAT_BUBBLE_MS, PREDICTION_STALE_MS, TYPE_TEXTS_PER_CATEGORY, WALK_SPEED_PX_PER_S } from '../shared/constants';
import { frontPointOf } from '../shared/layout';
import type { Point } from '../shared/layout';
import { decodeOwnedBeds } from '../shared/protocol';
import { shouldShowAbout } from './about';
import { composerReducer } from './composer';
import type { ComposerEvent, ComposerState } from './composer';
import type { Connection, HaltReason } from './conn-state';
import { errorTextFor } from './error-text';
import { nextMotion } from './motion';
import type { Motion } from './motion';
import {
  readAboutSeen,
  readProgress as loadReadProgress,
  readSound,
  readWeather,
  readZoomMode,
  writeProgress as saveReadProgress,
  writeSound,
  writeWeather,
  writeZoomMode,
} from './prefs';
import type { ReadProgress } from './prefs';
import { anchorPrediction, arcLengthAhead, beginPrediction, predictionPointAt } from './prediction';
import type { Prediction } from './prediction';
import { drawNext } from './type-texts';
import type { TypeTextItem } from './type-texts';
import type { BedDirection } from './world/rules';
import { sameZoomMode } from './zoom';
import type { ZoomMode } from './zoom';

/**
 * 头顶那一个气泡：**只记「说了什么、到什么时候」**。
 * 名字、以及「这条是不是自己说的」，都在渲染时从 `people` / `me` 现取——气泡长在人身上，
 * 人走了气泡跟着走（见 `docs/ui/DESIGN.md` 的 `chat-bubble` 行），所以这里不快照人名。
 */
interface ChatBubble {
  text: string;
  kind: 'chat' | 'whisper';
  /** 到期时刻（本地时钟）。过期由渲染侧比较推导，**不挂定时器** */
  expiresAt: number;
}

/** 一条错误提示：文案已按错误码翻译好，提示条只负责显示它。 */
export interface Notice {
  id: number;
  text: string;
}

/**
 * 说明面板为什么打开（`docs/design/90-about-panel.md` §1）：`auto` = 首访 / 新公告自动弹的那一次，
 * `manual` = 自己从齿轮里点开。只有 `auto` 带「以后不再自动显示」的勾选框、也只有它会写已读。
 */
export type AboutSource = 'auto' | 'manual';

/**
 * 世界渲染读的那一份状态。**刻意不放 React**：位置与插值不进框架的渲染循环，
 * 否则几百个小人会把框架拖死（见 `AGENTS.md` 硬纪律）。
 */
export interface ClientState {
  /** 连接态（渲染层的显示态）：由 `ws.ts` 的连接管理器写，见 `docs/api/20-api-ws.md` §5.1 */
  connection: Connection;
  /** 停住的原因（`close` 的语义）：有它就不再有自动重连，恢复只有刷新页面（§5.1.1） */
  halt?: HaltReason;
  /** 封禁到期时刻（`error` `5002` 随附；`null` = 永久）：只给提示文案用，不参与任何判定 */
  blockedUntilAt?: number | null;
  /** 厅的事实：当前床位数与在线人数（都是服务端下发的运行时事实） */
  hall?: HallInfo;
  /** 布局版本号：客户端据此自检几何是否与本机一致 */
  layoutVersion?: string;
  me?: SelfPerson;
  /** 归属集合：所有有主的床（不含名字，也不含「谁拥有」） */
  ownedBeds: Set<number>;
  /** 可见的人（含睡痕条目，不含自己） */
  people: Map<string, Person>;
  /** 每个人的位置插值窗口（服务端时间轴） */
  motion: Map<string, Motion>;
  /**
   * **我自己的**外推（别人一律走插值）：发出 `walk` 的那一次算好折线，之后每帧只沿它推进；
   * 收到关于自己的 `pos` 就重锚，上床 / 离开 / 重连即丢弃（见 `prediction.ts`）。
   */
  prediction?: Prediction;
  /** 本地时钟 + 这个偏移 = 服务端时间 */
  clockOffsetMs: number;
  /**
   * 最近一批 `pos` 的服务端时刻（`pos.ts`）。只给 `?debug=1` 的观测探针量 `posAge` / `tickSpan` 用
   * （见 `move-probe.ts`），不参与任何判定；快照后清空（跨快照算节拍差没有意义）。
   */
  lastPosTs?: number;
  /** 每个人头顶那一个气泡（发送者 id → 气泡）：同人后来的消息**覆盖**前一条，一条也不排队 */
  bubbles: Map<string, ChatBubble>;
  /**
   * 可恢复错误的提示条（静默类错误不写这里）。`id` 自增是为了让提示条重新挂载、
   * CSS 动画从头播——动画结束由 `animationend` 清掉，不挂定时器。
   */
  notice?: Notice;
  /** **全局唯一的选中对象**：同时决定名字气泡与私聊目标（见 `docs/ui/DESIGN.md`） */
  selectedId?: string;
  /**
   * 我的床在**可用视口**里的方位（`undefined` = 在视野内 / 还没有床）：动作行靠它补方向字形。
   * 由**世界层每帧算、只在变化时写**——逐帧写会让位置节拍变成 React 的重渲染。
   */
  bedDirection?: BedDirection;
  /** 最近一次延迟样本（毫秒，HUD 显示用）；还没采到样本时是 `undefined`，那一项不占位 */
  rttMs?: number;
  /**
   * **换床模式**（客户端本地状态，不进协议、不进快照）：模式内点一张无主空床才是换床。
   * 它必须常驻可见（门控行的提示 + 齿轮浮层项），因为模式**跨聊天、跨起身**活着——
   * 忘了自己在模式里的人点一张空床，代价与误点一样（旧床归属当场释放）。
   */
  switching: boolean;
  /**
   * **世界缩放档位**（客户端本地状态，不进协议、不进快照）：`自由缩放` 或锁死在某一档。
   * **显式锁定的档持久化**（键 `sc.zoom.mode`，见 `docs/design/40-client-storage.md`）；`自由缩放`
   * 下的连续比例是当场操作、不是偏好，不持久化（整页加载后回 `1×`）。
   * 它与 `switching` 无关：缩放是视角，不是模式，两个可以同时开。
   */
  zoomMode: ZoomMode;
  /**
   * **天气**（客户端本地偏好，不进协议、不进快照）：`true` = 雨天，**只驱动雨层画面**。
   * 缺键时无雨；之后只由用户切换（见 `docs/design/40-client-storage.md` §3）。
   */
  rain: boolean;
  /**
   * **雨声**（与 `rain` 各自独立的本地偏好，不进协议、不进快照）：`true` = 开。**只看它**决定出不出声，
   * 所以「无雨 + 雨声」「雨天 + 静音」都是合法状态。缺键 = 静音。
   */
  sound: boolean;
  /**
   * **说明面板**（客户端本地状态，不进协议、不进快照）：`null` = 关着，否则是打开的原因。
   * **一个字段**同时表达「开没开、为什么开」：拆成两个布尔就会出现「开着却不知道为什么」的状态，
   * 而勾选框与「关掉时记不记已读」都只由原因决定。
   */
  aboutOpen: AboutSource | null;
  /**
   * **游戏页**（客户端本地状态，不进协议、不进快照）：`true` = 整屏那一页开着。
   * 大厅的连接照旧，人只是暂时不看厅里——所以它不进任何上行（`docs/design/140-games-page.md` §2）。
   */
  gamesOpen: boolean;
  /**
   * **求签页**（客户端本地状态，不进协议、不进快照）：`true` = 开着。
   * 页面自己的三态（未求 / 摇签 / 已求）**不住这里**：它只活在那一次挂载里，重新打开就按本地键重算
   * （`docs/design/110-lot.md` §2），所以 store 不需要第二份可以跟本地键矛盾的状态。
   */
  lotOpen: boolean;
  /**
   * **输入会话**（`docs/design/60-interaction-shell.md` §2）：面板停靠与插槽面板显隐只看它。
   * DOM 焦点只是入口之一，不是状态本体——控件被卸载时会**不发 `blur`**，把焦点当状态就回不到大厅。
   */
  composer: ComposerState;
  /**
   * **类型文本的阅读进度**（客户端本地状态，不进协议、不进快照）：`seen` = 每个分类抽到过的条目 id，
   * `current` = 每个分类的当前条 id。**回 idle 不清**——没读完的那条收起、刷新回来还要在
   * （`docs/design/50-slot-panel.md` §附）。启动读一次本地键，之后只在抽签 / 再看一遍时**一次写落**。
   */
  readProgress: ReadProgress;
  /**
   * 正在举报谁（客户端本地状态，不进协议、不进快照）：点「举报」时记下。
   * `5003` 回执只有码、没有目标 id，本地必须记着这一单打给谁才知该置灰哪颗按钮。
   */
  pendingReportTo?: string;
  /** 已收到回执的举报对象（**本次会话内有效**）：私聊行那颗按钮据此变成「已举报」并置灰 */
  reportedIds: Set<string>;
  /**
   * 面板上那行常驻弱提示（`5003` / `5004` 两个回执来源）：**常驻到下一次操作**。
   * 不挂定时器——与气泡同一理由：内存定时器会让页面无法休眠（硬纪律 6）。
   */
  chatHint?: string;
  /**
   * 反馈表单里的那行可见错误（`4001` / `4003` / `4004`）：**就地显示、保留已写内容**，
   * 不走瞬时提示条（`docs/design/130-feedback.md` §3）。退场即消失。
   */
  feedbackError?: string;
}

const emptyState = (): ClientState => ({
  connection: 'connecting',
  ownedBeds: new Set(),
  people: new Map(),
  motion: new Map(),
  clockOffsetMs: 0,
  bubbles: new Map(),
  switching: false,
  composer: 'idle',
  readProgress: loadReadProgress(),
  reportedIds: new Set(),
  // 启动时读一次本地偏好进初值，之后不再碰 `localStorage`（不进逐帧路径）。
  // 落盘的是 id（`none` / `rain`），store 里仍是两个布尔：多一种天气/声道时只需改 id 表。
  zoomMode: readZoomMode(),
  rain: readWeather() === 'rain',
  sound: readSound() === 'rain',
  aboutOpen: shouldShowAbout(readAboutSeen()) ? 'auto' : null,
  gamesOpen: false,
  lotOpen: false,
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
    connection: 'online',
    layoutVersion: message.layoutVersion,
    hall: message.hall,
    me: message.me,
    // 归属位图 → 床号集合（位图只编码到 bedCount−1，位图之外的位无意义）
    ownedBeds: new Set(decodeOwnedBeds(message.ownedBeds, message.hall.bedCount)),
    people: new Map(message.people.map((person) => [person.id, person])),
    motion: new Map(),
    // 客户端据此换算服务端时间轴：插值一律按服务端时间戳算
    clockOffsetMs: message.serverTs - Date.now(),
    // 重连以新快照为准、不做增量补偿 → 旧的气泡不保留；旧连接上采到的延迟样本同样作废
    bubbles: new Map(),
    selectedId: undefined,
    bedDirection: undefined,
    rttMs: undefined,
    // 重连以新快照为准：新位置可能是宽限恢复的原位、也可能是出生点，旧的外推没有意义
    prediction: undefined,
    // 探针的 `posAge` / `tickSpan` 也跟着重置：跨快照算出来的「节拍差」是两次连接的空档
    lastPosTs: undefined,
  });
}

/**
 * 全局消息：**覆盖**发送者头顶那一条并重置计时（不排队、不堆叠）。
 * 名字与「是不是自己说的」都不写进来：渲染时现取（见 `ChatBubble`）。
 */
export function applyChat(message: ChatMessage): void {
  setBubble(message.id, message.text, 'chat');
}

/**
 * 私聊：发送者与接收者收到同一份 payload（哪一侧收的由渲染时按 `me.id` 判断，
 * 见 `docs/api/20-api-ws.md` §4.8），气泡一律挂在**发送者**头上。
 */
export function applyWhisper(message: WhisperMessage): void {
  setBubble(message.fromId, message.text, 'whisper');
}

/**
 * 写一个气泡：只写「到什么时候为止」，同一个人后来的覆盖前一条。
 * 过期由渲染侧比较 `expiresAt` 推导，**不挂 `setTimeout`/`setInterval`**（内存定时器会让页面无法休眠）。
 */
function setBubble(id: string, text: string, kind: ChatBubble['kind']): void {
  const bubbles = new Map(state.bubbles);
  bubbles.set(id, { text, kind, expiresAt: Date.now() + CHAT_BUBBLE_MS });
  setState({ bubbles });
}

/** 选中某个人：同一时刻只有一个选中对象（所以只有一个名字气泡、一个私聊目标）。 */
export function selectPerson(id: string): void {
  // 选了别人就是「下一次操作」：上一单的举报回执那行话让位
  setState({ selectedId: id, chatHint: undefined });
  // 举报态里改选别人：表单写的是原来那一位，留着就变成「看不见对象在写事由」
  if (state.composer === 'report' && id !== state.pendingReportTo) setComposer({ kind: 'exit' });
}

/** 取消选中：点地面、点 ×、目标离开都走这里。 */
export function clearSelection(): void {
  setState({ selectedId: undefined, chatHint: undefined });
  // 举报对象没了：表单跟着退场（§2 的「取消选中 → idle」）
  if (state.composer === 'report') setComposer({ kind: 'exit' });
}

/**
 * 点「举报」：记下这一单的对象并进 `report` 态（`docs/design/60-interaction-shell.md` §2）。
 * 焦点由事由框的 `autoFocus` 接管，`focus-in` 在 `report` 下**不降级**——表单不会被自己卸掉。
 */
export function startReport(toId: string): void {
  setState({ pendingReportTo: toId });
  setComposer({ kind: 'report' });
}

/**
 * 举报落库回执（`5003`）：这一单的目标进「已举报」集合（本次会话内有效），
 * 那行确认文案常驻到下一次操作。**退场不在这里做**（收焦点归 `exitComposer()`）。
 */
export function applyReportReceipt(): void {
  const toId = state.pendingReportTo;
  if (toId === undefined) return;
  const reportedIds = new Set(state.reportedIds);
  reportedIds.add(toId);
  setState({ pendingReportTo: undefined, reportedIds, chatHint: errorTextFor('5003') });
}

/**
 * 齿轮里的「反馈与建议」：进 `feedback` 态，插槽面板换成反馈表单
 * （`docs/design/50-slot-panel.md` §附）。与 `reading` 一样**不需要选中对象**。
 */
export function openFeedback(): void {
  if (state.feedbackError !== undefined) setState({ feedbackError: undefined });
  setComposer({ kind: 'feedback' });
}

/** 提交中清掉上一轮错误：错误行只在服务端回话之后出现。 */
export function clearFeedbackError(): void {
  if (state.feedbackError === undefined) return;
  setState({ feedbackError: undefined });
}

/** 反馈的可恢复失败（配额 / 超长 / 空）：表单里显示一行，内容原样留着。 */
export function applyFeedbackFailure(code: '4001' | '4003' | '4004'): void {
  setState({ feedbackError: errorTextFor(code) });
}

/**
 * 反馈落库回执（`5004`）：只有那行确认文案，**不置灰任何按钮**——反馈没有对象、也不限这一条。
 * 退场归 `exitComposer()`（与 `5003` 同一出口）。
 */
export function applyFeedbackReceipt(): void {
  setState({ chatHint: errorTextFor('5004') });
}

/**
 * 我的床的方位（世界层每帧算一次）：**同值不写**。位置节拍每 100 ms 来一次，
 * 每次写都会通知所有订阅者——显示条与动作行的「不因位置节拍重渲染」就靠这道守卫。
 */
export function setBedDirection(direction: BedDirection | undefined): void {
  if (state.bedDirection === direction) return;
  setState({ bedDirection: direction });
}

/** 开 / 关换床模式（本地状态，见 `ClientState.switching`）。进出都只改这一个字段。 */
export function setSwitching(on: boolean): void {
  if (state.switching === on) return;
  setState({ switching: on });
}

/** 输入会话的**唯一**写入路径（状态机在 `composer.ts`）。同值不通知：焦点事件会重复来。 */
export function setComposer(event: ComposerEvent): void {
  const next = composerReducer(state.composer, event);
  if (next === state.composer) return;
  // 进新会话 = 「下一次操作」：上一单的举报回执那行话让位；退场（回 idle）时保留它
  setState({
    composer: next,
    ...(next === 'idle' ? {} : { chatHint: undefined }),
    ...(next === 'feedback' ? {} : { feedbackError: undefined }),
  });
}

/**
 * 记一条阅读进度（`seen` 追加 + `current` 覆盖）：**一次写落**，不出现「当前条写了、seen 没写」的中间态
 * （`docs/design/40-client-storage.md` §3）。`seen` 超每类上限时丢最老的——数据换代留下的脏 id
 * 也不会把整条值在下次读时拖到被判废。
 */
function commitRead(categoryId: string, seen: string[], current: string | undefined): void {
  const next: ReadProgress = {
    seen: { ...state.readProgress.seen, [categoryId]: seen.slice(-TYPE_TEXTS_PER_CATEGORY) },
    // `current` 缺席时保留原值：空分类一条抽不出来，不该因此写一个空 id 把整条值弄脏（下次读就判废）
    current: current === undefined ? state.readProgress.current : { ...state.readProgress.current, [categoryId]: current },
  };
  setState({ readProgress: next });
  saveReadProgress(next);
}

/**
 * 抽一条并记下（池空返回 `null`，面板据此换成「再看一遍」）：
 * 池 = 这个分类里**不在 `seen`** 的条目，且池里还有别的时**排除当前条**
 * （否则 1/N 的概率抽回正在看的那条，用户会以为按钮坏了）。
 */
export function drawReadItem(categoryId: string, items: readonly TypeTextItem[]): TypeTextItem | null {
  const seen = state.readProgress.seen[categoryId] ?? [];
  const drawn = drawNext({ items, seen, current: state.readProgress.current[categoryId] });
  if (!drawn) return null;
  commitRead(categoryId, seen.includes(drawn.id) ? seen : [...seen, drawn.id], drawn.id);
  return drawn;
}

/** 「再看一遍」：清空该分类的 `seen` 再抽一条（抽签已排除当前条，所以不会原地不动）。 */
export function replayRead(categoryId: string, items: readonly TypeTextItem[]): TypeTextItem | null {
  commitRead(categoryId, [], state.readProgress.current[categoryId]);
  return drawReadItem(categoryId, items);
}

/**
 * 打开面板时确保有一个当前条：**有效的当前条原样返回**（退出 / 刷新回来还是它），
 * 没有才抽一条——「抽一条」的正常入口是那颗「随机」，隐式抽签只在没有当前条时发生。
 */
export function ensureReadItem(categoryId: string, items: readonly TypeTextItem[]): TypeTextItem | null {
  const id = state.readProgress.current[categoryId];
  const found = id === undefined ? undefined : items.find((item) => item.id === id);
  return found ?? drawReadItem(categoryId, items);
}

/**
 * 写世界缩放档位（见 `ClientState.zoomMode`）：同值不写（档位是低频状态，不需要白重渲染一次）。
 * 改档位（含切回 `自由缩放`）**只走这一条写入路径**，落到本地偏好——整页重载后显式锁定的档还在。
 */
export function setZoomMode(mode: ZoomMode): void {
  if (sameZoomMode(state.zoomMode, mode)) return;
  setState({ zoomMode: mode });
  writeZoomMode(mode);
}

/**
 * 天气开关（见 `ClientState.rain`）：同值不写；写 store + 本地偏好（`false` 也照写，写入路径只一条）。
 * **不联动雨声**：画面归画面、声音归声音（`docs/design/40-client-storage.md` §3）。
 */
export function setRain(on: boolean): void {
  if (state.rain === on) return;
  setState({ rain: on });
  writeWeather(on ? 'rain' : 'none');
}

/**
 * 雨声开关（见 `ClientState.sound`）：同值不写；写 store + 本地偏好（`false` 也照写，写入路径只一条）。
 * **不联动天气**：两颗胶囊各管一半，用户没点的那一个不该被改。
 */
export function setSound(on: boolean): void {
  if (state.sound === on) return;
  setState({ sound: on });
  writeSound(on ? 'rain' : 'none');
}

/** 打开说明面板（见 `ClientState.aboutOpen`）：同值不写。 */
export function openAbout(source: AboutSource): void {
  if (state.aboutOpen === source) return;
  setState({ aboutOpen: source });
}

/**
 * 关闭说明面板：**只改状态、不写本地键**。写已读只发生在组件关闭那一刻——勾选框在组件里，
 * store 看不到它（`docs/design/90-about-panel.md` §2）。
 */
export function closeAbout(): void {
  if (state.aboutOpen === null) return;
  setState({ aboutOpen: null });
}

/** 打开游戏页（见 `ClientState.gamesOpen`）：同值不写。 */
export function openGames(): void {
  if (state.gamesOpen) return;
  setState({ gamesOpen: true });
}

/** 关闭游戏页：「离开」与 `Esc` 走同一个出口，可能重复触发，所以幂等。 */
export function closeGames(): void {
  if (!state.gamesOpen) return;
  setState({ gamesOpen: false });
}

/** 打开求签页（见 `ClientState.lotOpen`）：同值不写。 */
export function openLot(): void {
  if (state.lotOpen) return;
  setState({ lotOpen: true });
}

/** 关闭求签页：**只改状态**，不碰 `sc.lot`（那张签是当天的事实，关页不等于没求过）。 */
export function closeLot(): void {
  if (!state.lotOpen) return;
  setState({ lotOpen: false });
}

/**
 * 厅的床位数变了（升级加外圈 / 降级砍最外圈）：只更这一个数字。
 * 床位是**按布局函数现算**的，归属与占用都不需要变（升级新增的全是无主空床，降级砍掉的全是无人用的床）；
 * 越界的条目顺手丢掉，免得残留一张已经不存在的床——包括 `me.ownedBedNo`：降级砍掉我的床时，
 * 暖灯标记不能还指着一张不存在（或已经不属于我）的床。
 */
export function applyResize(message: ResizeMessage): void {
  const hall = state.hall;
  if (!hall) return;
  const ownedBeds = new Set([...state.ownedBeds].filter((bedNo) => bedNo < message.bedCount));
  const people = new Map([...state.people].filter(([, person]) => person.state === 'roaming' || person.bedNo < message.bedCount));
  const patch: Partial<ClientState> = { hall: { ...hall, bedCount: message.bedCount }, ownedBeds, people };
  const me = state.me;
  if (me?.ownedBedNo !== undefined && me.ownedBedNo >= message.bedCount) patch.me = { ...me, ownedBedNo: undefined };
  setState(patch);
}

/** 一批权威位置（已合并）→ 插值窗口。 */
export function applyPos(message: PosMessage): void {
  const motion = new Map(state.motion);
  const people = new Map(state.people);
  const me = state.me;
  // 自己不在 `people` 里：位置再另存一份到 `me`（走动时渲染自己；自身外推以它为回落锚点）
  let nextMe = me;
  // 自己的外推在这里**重锚**：权威点 + 该批的服务端时刻，沿同一条折线继续（路径不重算）；
  // 权威点跑得离外推位置太远（`hop` 传送 / 服务端换了目标）时重锚返回 `undefined`，外推一并作废
  let prediction = state.prediction;

  for (const [id, x, y] of message.items) {
    if (me !== undefined && id === me.id) {
      if (me.state === 'roaming') nextMe = { ...me, x, y };
      if (prediction) prediction = anchorPrediction(prediction, x, y, message.ts);
    }

    const person = people.get(id);
    // 已经躺在床上的人不需要插值窗口（位置就是那张床）；服务端也不会为他发位置，
    // 这里只是防同一节拍里「状态先到、位置后到」的竞态
    if (person && person.state !== 'roaming') continue;

    motion.set(id, nextMotion(motion.get(id), x, y, message.ts));
    if (person) people.set(id, { ...person, x, y });
  }

  const patch: Partial<ClientState> = { motion, people, lastPosTs: message.ts };
  if (nextMe !== me) patch.me = nextMe;
  if (prediction !== state.prediction) patch.prediction = prediction;
  setState(patch);
}

/**
 * 点地面：**用与服务端同一份寻路**算一次折线并登记自身外推（只在这一次算路径，之后每帧只沿折线推进）。
 * 不在线时不登记：上行会被丢掉（`ws.ts` 的 `sendRaw`），没有服务端在走，外推只会把我画错地方。
 */
export function beginWalk(to: Point): void {
  const me = state.me;
  const bedCount = state.hall?.bedCount;
  if (state.connection !== 'online' || me === undefined || bedCount === undefined) return;
  // 锚点：走动时用权威坐标；**躺在床上时用床脚前那一点**——点地面会先起身再走，而服务端
  // `standUp` 保留的就是那个位置（`frontPointOf`）。不等「起身」那条消息回来，这一步才能也立刻起步。
  const from = me.state === 'roaming' ? { x: me.x, y: me.y } : frontPointOf(me.bedNo);
  if (!from) return;
  // 锚点时刻用服务端时间轴（= 世界层读外推点的同一把尺）
  const serverNow = Date.now() + state.clockOffsetMs;
  const started = beginPrediction(from, to, bedCount, serverNow);
  if (!started) return;
  // 领先量 = 画面上那一点在**新折线上的投影弧长** / v（`30-movement-sync.md` §3.3）。用弧长不用直线
  // 距离：改目标时新旧折线可能**垂直**（画面点偏在新路径的侧方），直线距离会把侧向偏移当成前进量、
  // 把画面凭空前推。站着不动（没有外推）→ 0，于是「点击即起步」；改目标时画面沿新折线不跳。
  // 携带与否只看闸门：真值已静默半个保鲜期以上（取严格，恰好等于也算）→ 画面点是幻影，不携带（§3.7）。
  // **不封顶**：封顶会咬掉合法领先量（RTT 2s 时 lead ≈ 1s 是正常的），而那一咬正发生在用户点击的时刻
  // → 画面后退；收闸门只影响这条链路已经静默半秒以上的降级状态。
  const old = state.prediction;
  const leadMs = old && serverNow - old.ts < PREDICTION_STALE_MS / 2
    ? (arcLengthAhead(from, started.path, predictionPointAt(old, serverNow)) / WALK_SPEED_PX_PER_S) * 1000
    : 0;
  setState({ prediction: { ...started, anchorTs: serverNow - leadMs } });
}

/**
 * 丢弃自身外推（渲染回落到权威值）。三个调用面：`hop`（一步到位，本地那条路当场作废）、
 * 「意图没生效」的错误码（见 `MOVE_INTENT_ERRORS`）、以及上床 / 离开 / 重连。
 */
export function clearPrediction(): void {
  if (state.prediction === undefined) return;
  setState({ prediction: undefined });
}

/**
 * 「这条意图一步也没走」的错误码：服务端拒绝了它，**不会**再为这个目标发任何 `pos`
 * （我不是移动者），所以外推必须就地丢掉——否则小人会朝一个已经被拒的目标走满保鲜期，
 * 然后永久停在错位（见 `docs/api/20-api-ws.md` §6）。
 *
 * 不在这里面的：`4001` / `4003`（聊天长度 / 空消息）——它们与走动无关，
 * 清掉外推等于把一趟正当的走路打断（那是「倒退」的另一种形式）。
 */
const MOVE_INTENT_ERRORS = new Set(['3001', '3002', '3003', '3004', '3005', '3006', '3008', '4002']);

/** 从下行消息里取出「人在哪」的那一半（丢掉 `t`，别让它混进 Person）。 */
function placementOf(source: PersonPlacement): PersonPlacement {
  return source.state === 'roaming'
    ? { state: 'roaming', x: source.x, y: source.y }
    : { state: source.state, bedNo: source.bedNo };
}

/**
 * `state` 报文之后的同一个人：换位置，可能换 `act`。
 *
 * **`act` 只有「整条人」那条报文才声明**：服务端改 `act` 时重发整条人（带 `name`），
 * 显示态那条只带位置（`docs/api/20-api-ws.md` §4.4）。所以「带不带名字」是「这次 `act` 算不算数」
 * 的判据——缺字段不能当成「没在看游戏」，否则一躺下后缀就没了。
 */
function afterState(person: Person, message: StateMessage): Person {
  const declared = message as StateMessage & Partial<Pick<Person, 'name' | 'act'>>;
  const act = declared.name === undefined ? person.act : declared.act;
  const next: Person = {
    id: person.id,
    name: person.name,
    appearance: person.appearance,
    ...placementOf(message),
  };
  if (act === 'game') next.act = 'game';
  return next;
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
  const person: Person = {
    id: message.id,
    name: message.name,
    appearance: message.appearance,
    ...placementOf(message),
  };
  // 在场状态跟着 `join` 一起下发（缺省 = 在看厅），丢掉它后缀就不见了
  if (message.act === 'game') person.act = 'game';
  people.set(message.id, person);
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
    const next: SelfPerson = afterState(state.me, message);
    // 归属与占用是两个维度：在床上时床号就是我的床；起身后归属位继续留着（暖灯标记不能丢）
    const ownedBedNo = placement.state === 'roaming' ? state.me.ownedBedNo : placement.bedNo;
    if (ownedBedNo !== undefined) next.ownedBedNo = ownedBedNo;
    // 上了床（或转睡着 / 变睡痕）：外推作废，位置以权威为准。
    // **起身（回到 `roaming`）不清**：起身不改变位置，而那条外推的锚点就是床脚前那一点——
    // 清掉它，「躺在床上点地面立刻起步」那一支就没了（后续 `pos` 会照常重锚）
    const patch: Partial<ClientState> = { me: next, motion, ...onlinePatch(message.online) };
    if (placement.state !== 'roaming') patch.prediction = undefined;
    setState(patch);
    return;
  }

  const person = state.people.get(message.id);
  if (!person) {
    // 没见过的人：等 join 或下一次快照（TCP 有序，正常不会发生）；人数这一条仍要落下来
    setState(onlinePatch(message.online));
    return;
  }

  const people = new Map(state.people);
  people.set(message.id, afterState(person, message));
  setState({ people, motion, ...onlinePatch(message.online) });
}

/** 有人离开厅（宽限超时且不在床上；或睡痕被清理）。 */
export function applyLeave(message: LeaveMessage): void {
  const people = new Map(state.people);
  people.delete(message.id);
  const motion = new Map(state.motion);
  motion.delete(message.id);
  const patch: Partial<ClientState> = { people, motion, ...onlinePatch(message.online) };
  // 走的是我自己（宽限超时后服务端不认我了）：外推一并丢掉
  if (state.me?.id === message.id) patch.prediction = undefined;
  // 离开的人正好是选中对象：一并取消选中（气泡不能留在空气里）；举报表单也随对象一起退场
  if (state.selectedId === message.id) {
    patch.selectedId = undefined;
    patch.chatHint = undefined;
  }
  // 走了就不该再留着他的气泡：同一个 id 在 CHAT_BUBBLE_MS 内重连会带着旧气泡复现
  if (state.bubbles.has(message.id)) {
    const bubbles = new Map(state.bubbles);
    bubbles.delete(message.id);
    patch.bubbles = bubbles;
  }
  const reportTargetLeft = state.selectedId === message.id && state.composer === 'report';
  setState(patch);
  if (reportTargetLeft) setComposer({ kind: 'exit' });
}

/** 封禁到期时刻（`5002` 随附）：只给提示文案用，不参与任何判定。 */
export function setBlockedUntil(untilAt: number | null): void {
  setState({ blockedUntilAt: untilAt });
}

/** 提示条自增序号：只增不减，保证新提示的 `id` 必然不同（同一条文案也可能连着来两次）。 */
let noticeSeq = 0;

/** 出一张提示条。`id` 换了就重新挂载，CSS 动画从头播——清除靠 `animationend`，不挂定时器。 */
export function showNotice(text: string): void {
  noticeSeq += 1;
  setState({ notice: { id: noticeSeq, text } });
}

/**
 * 可恢复错误的提示：**只有文案层给得出文案的码才写 `notice`**，静默类什么都不做
 * （点墙、重复躺下这类失败用户无法处理，弹提示只会让他更焦虑，见 `docs/api/error-code.md` §3）。
 */
export function applyError(code: string): void {
  // 先丢外推再管文案：静默类错误（`3001` / `3004` / `3006`…）本来就不出提示，
  // 但它们同样意味着「刚那条动起来的意图没生效」
  if (MOVE_INTENT_ERRORS.has(code)) clearPrediction();
  const text = errorTextFor(code);
  if (text === undefined) return;
  showNotice(text);
}

/**
 * 床位归属变化：认领或释放（占用完全由「人」的那一类消息派生，不走这里）。
 * 释放的正好是我那张床（30 天没回来）→ `me.ownedBedNo` 一并清掉。
 */
export function applyBed(message: BedMessage): void {
  const ownedBeds = new Set(state.ownedBeds);
  if (message.owned) ownedBeds.add(message.bedNo);
  else ownedBeds.delete(message.bedNo);

  const me = state.me;
  if (!message.owned && me?.ownedBedNo === message.bedNo) setState({ ownedBeds, me: { ...me, ownedBedNo: undefined } });
  else setState({ ownedBeds });
}
