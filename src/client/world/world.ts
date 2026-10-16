import * as Phaser from 'phaser';

import { BED_H, BED_W, CELL_H, CELL_W, MAX_DPR, POOL_SIZE, WALL_WIDTH } from '../../shared/constants';
import { bedNoAt, levelIndexOfBedCount, nearestStreetPoint, positionOf, scrollRegionOf, wallRegionOf } from '../../shared/layout';
import type { Point, Rect } from '../../shared/layout';
import type { Person } from '../../shared/protocol';
import { EMOTE_LABELS } from '../emotes';
import { ambienceColor, approachColor } from '../ambience';
import { getState, setBedDirection } from '../store';
import type { ClientState } from '../store';
import {
  bedDirection,
  bedLook,
  cameraBounds,
  followStep,
  isFaded,
  isMoving,
  personPoint,
  shouldDrawName,
  tapTargetFor,
  usableView,
  usableCenterOffset,
} from './rules';
import type { Occupant, PersonSpot, ViewInsets } from './rules';
import {
  COLORS,
  SPRITES_KEY,
  createBedView,
  createPersonView,
  hideBed,
  paintPerson,
  placeBed,
  setPersonChat,
  setPersonEmote,
  setPersonName,
} from './views';
import type { BedView, PersonView } from './views';

/**
 * 世界画布（Phaser 4）。**渲染层是一个纯函数**：状态快照 → 画出来（见 `docs/design/architecture.md` §2.3）。
 *
 * 三条边界：
 * 1. 世界走画布、界面走 DOM——这里不画任何文字界面，名字是贴在床上的小标签，不是 UI；
 * 2. 画布不参与 React 的渲染循环——状态直接读 store，重画由 Phaser 的 game loop 驱动；
 * 3. **没有缩放**——世界与屏幕是一个固定比例（1 世界像素 = 1 CSS 像素，画布按 DPR ≤2 放大）。
 *
 * 几何全部来自 `src/shared/layout.ts`（与厅服务同一份纯函数）：床位坐标、区域尺寸、命中判定。
 * 床位数（`hall.bedCount`）是运行时事实，**每个 `bedNoAt` / `isWalkable` 调用点都显式带上它**。
 */

export interface WorldHandlers {
  /** 点地面 = 「我要去这个世界像素点」（客户端已把目标吸附到街网；服务端只校验） */
  onWalk(point: Point): void;
  /** 点小人 = 选中（唯一选中对象：名字气泡 + 私聊目标） */
  onSelect(id: string): void;
  /** 点地面 = 取消选中 */
  onClearSelection(): void;
  /** 点空床 = 躺下 */
  onLie(bedNo: number): void;
}

export interface WorldHandle {
  destroy(): void;
  /** 相机跳到我的床（HUD 的床号条）；还没有床时按进厅对准的退路（`focusPoint`）。 */
  focusMyBed(): void;
}

/**
 * 界面实占的两块（顶部 HUD、底部聊天面板）由 UI 层交进来：世界层只**读**它们的
 * `getBoundingClientRect`，不写样式也不写结构（`docs/ui/DESIGN.md`「世界相机」）。
 * 进厅前（入场层期间）这两个元素还不存在，所以传的是取值函数而不是元素。
 */
export interface UiInsets {
  top: HTMLElement | null;
  bottom: HTMLElement | null;
}

/** 轻点判据（见 `docs/ui/DESIGN.md`「世界相机」）：位移 < 8px 且时长 < 350ms，否则那是一次拖拽。 */
const TAP_SLOP_PX = 8;
const TAP_MS = 350;
/** 跟随的匀速速度：约 0.5 秒追上 250px（跟得上，又不像镜头被硬拖）。 */
const CAMERA_FOLLOW_PX_PER_S = 500;
/** 屏幕中央区（占屏幕的比例）：自己在这一块里走动不值得动镜头，正好是相机的死区。 */
const CENTER_BAND = 0.4;
/** 裁剪缓冲：可视窗口外各留一列/一行，拖拽到边界时边缘不闪。 */
const CULL_MARGIN_PX = Math.max(CELL_W, CELL_H);
/** 绘制层次：地板 < 床位 < 小人（床位与小人之间再按 y 排序解决遮挡）。 */
const DEPTH = { floor: -10, bound: -5, bed: 0, person: 100 } as const;

/** 床号 → 占用者（人）。归属与占用是两个正交维度，这里只处理占用这一侧。 */
function occupantsOf(state: ClientState): Map<number, Occupant> {
  const occupants = new Map<number, Occupant>();
  for (const person of state.people.values()) {
    if (person.state !== 'roaming') occupants.set(person.bedNo, person);
  }
  if (state.me && state.me.state !== 'roaming') occupants.set(state.me.bedNo, state.me);
  return occupants;
}

/** 床号 → 占用者 id（含自己）：命中判定要区分「空床可躺」与「床上有人」。 */
function residentOf(state: ClientState, bedNo: number): string | undefined {
  for (const person of state.people.values()) {
    if (person.state !== 'roaming' && person.bedNo === bedNo) return person.id;
  }
  if (state.me && state.me.state !== 'roaming' && state.me.bedNo === bedNo) return state.me.id;
  return undefined;
}

/** 按行分桶的床位（行内按 x 升序）：每帧只走可视窗口里的那几行，同屏对象数与厅规模无关。 */
interface BedRow {
  y: number;
  beds: { bedNo: number; x: number; y: number }[];
}

class WorldScene extends Phaser.Scene {
  private readonly host: HTMLElement;
  private readonly handlers: WorldHandlers;
  private readonly insetsOf: () => UiInsets;
  /** 已建索引的床位数：`resize` 之后要重建（床号区间变了） */
  private loadedBedCount: number | undefined;
  /** 上一帧人物的世界坐标（命中判定用；1 帧延迟可接受） */
  private spots: PersonSpot[] = [];
  private readonly bedRows: BedRow[] = [];
  /** 对象池：只装得下同屏的那几十张床，与总床数无关 */
  private readonly beds: BedView[] = [];
  private readonly people = new Map<string, PersonView>();
  /** 手指状态：单指拖拽平移；多指一律忽略（**没有缩放这条路**） */
  private readonly pointers = new Map<number, { x: number; y: number; moved: number }>();
  /** 厅的区域（地板与夹取用）：随 `bedCount` 变化重建 */
  private readonly scenery: Phaser.GameObjects.GameObject[] = [];
  /** 上一次看到的连接状态：断线后重连要重新对准我的床 */
  private wasConnected = false;
  /** 地板与墙的矩形（氛围明暗要重画地板、相机夹取也用它） */
  private floorGfx?: Phaser.GameObjects.Graphics;
  private region: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** 当前地板底色（困倦度的缓动值）：与目标色一致时整段跳过重画 */
  private ambience = COLORS.floor;
  private observer: ResizeObserver | null = null;
  /** 界面实占的那两个元素，以及它们当前的实占高度（可用视口的 insets） */
  private insetElements: UiInsets = { top: null, bottom: null };
  private insets: ViewInsets = { top: 0, bottom: 0 };
  private insetsObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement, handlers: WorldHandlers, insetsOf: () => UiInsets) {
    super('world');
    this.host = host;
    this.handlers = handlers;
    this.insetsOf = insetsOf;
  }

  /** 图集是一个文件、一次载入：`preload` 之后 `create` 才被调用，池子建出来时帧一定在 */
  preload(): void {
    this.load.atlas(SPRITES_KEY, '/sprites/atlas.png', '/sprites/atlas.json');
  }

  create(): void {
    // 厅外那块底 = **相机背景色**：它按相机视口在屏幕空间铺满（不受 zoom 与滚屏影响），
    // 所以不需要 Graphics 去盖那片区域（`setScrollFactor(0)` 的 Graphics 会按相机变换绘制，
    // 在 DPR ≥ 2 时只能铺到屏幕的一部分，剩下的露出画布清屏色）。
    this.cameras.main.setBackgroundColor(COLORS.outside);
    this.resizeToHost();
    this.ensurePool();
    this.observer = new ResizeObserver(() => this.resizeToHost());
    this.observer.observe(this.host);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.observer?.disconnect();
      this.observer = null;
      this.insetsObserver?.disconnect();
      this.insetsObserver = null;
    });
    this.bindInput();
  }

  update(_time: number, delta: number): void {
    const state = getState();
    // 滞后是**每个插值窗口各自的**（见 `interpolationDelay`），所以这里取的是未滞后的服务端现在
    const serverNow = Date.now() + state.clockOffsetMs;

    const bedCount = state.hall?.bedCount;
    if (bedCount !== undefined && bedCount !== this.loadedBedCount) {
      this.loadedBedCount = bedCount;
      this.buildBedIndex(bedCount);
      this.rebuildRegion();
    }
    // 可用视口的 insets 要在回中之前拿到（回中按可用视口的中心对准）
    this.syncInsets();

    // 断线后重连：与进厅同一套规则，重新对准我的床（`wasConnected` 只在真实翻转时才为真）
    if (state.connected && !this.wasConnected) this.alignCamera(state);
    this.wasConnected = state.connected;

    this.syncBeds(state);
    // **一帧只取一次位**：渲染与跟随共用这个点（各取一次就会出现「相机追着上一帧的点」的稳态锯齿）
    const selfPoint = this.selfPoint(state, serverNow);
    this.syncPeople(state, serverNow, selfPoint);
    this.follow(state, serverNow, delta, selfPoint);
    // 方位在相机这一帧动完之后算：拖拽/回中当帧就把字形换成对的
    this.syncBedDirection(state);
    this.applyAmbience(state.drowsiness, delta);
  }

  /**
   * 氛围明暗：全厅困倦度 → **地板**底色（`primary` ⇄ `primary-dim`），按时间常数缓动；
   * 床与小人的墨色不动（线稿可读性恒定）；颜色没变就跳过重画。
   * 厅外那块底是相机背景色（固定 `secondary`），**不跟困倦度缓动**（它不是厅里的地板）。
   */
  private applyAmbience(drowsiness: number, dtMs: number): void {
    const next = approachColor(this.ambience, ambienceColor(COLORS.floor, COLORS.floorDim, drowsiness), dtMs);
    if (next === this.ambience) return;
    this.ambience = next;
    if (!this.floorGfx) return;
    this.floorGfx.clear();
    this.floorGfx.fillStyle(next, 1);
    this.floorGfx.fillRect(this.region.x, this.region.y, this.region.width, this.region.height);
  }

  // ——— 几何：床位索引与区域（几何来自共享纯函数，不落任何数据） ———

  /** 床号 → 位置只在床位数变化时重算一次（最高档 9558 张，一次几毫秒；不逐帧算）。 */
  private buildBedIndex(bedCount: number): void {
    const rows = new Map<number, BedRow>();
    for (let bedNo = 0; bedNo < bedCount; bedNo += 1) {
      const position = positionOf(bedNo);
      if (!position) continue;
      let row = rows.get(position.y);
      if (!row) {
        row = { y: position.y, beds: [] };
        rows.set(position.y, row);
      }
      row.beds.push({ bedNo, x: position.x, y: position.y });
    }

    this.bedRows.length = 0;
    for (const row of [...rows.values()].sort((a, b) => a.y - b.y)) {
      row.beds.sort((a, b) => a.x - b.x);
      this.bedRows.push(row);
    }
  }

  /** 厅的地板与墙（边界按 `wallRegionOf`：左/上那一条余量落在负坐标一侧）：尺寸变了这里跟着重建。 */
  private rebuildRegion(): void {
    for (const object of this.scenery) object.destroy();
    this.scenery.length = 0;
    if (this.loadedBedCount === undefined) return;

    const region = wallRegionOf(levelIndexOfBedCount(this.loadedBedCount));
    this.region = region;
    const floor = this.add.graphics().setDepth(DEPTH.floor);
    this.floorGfx = floor;
    floor.fillStyle(this.ambience, 1);
    floor.fillRect(region.x, region.y, region.width, region.height);
    const bound = this.add.graphics().setDepth(DEPTH.bound);
    // 墙是墙带、画在墙矩形**之外**（不侵入地板）：描边路径外扩半个墙宽，带就跨 [x0−W, x0]
    const half = WALL_WIDTH / 2;
    bound.lineStyle(WALL_WIDTH, COLORS.line, 1);
    bound.strokeRect(region.x - half, region.y - half, region.width + WALL_WIDTH, region.height + WALL_WIDTH);
    this.scenery.push(floor, bound);

    this.applyCameraBounds();
  }

  // ——— 床位与小人：可视窗口 + 对象池 ———

  /** 池子先按 `POOL_SIZE` 备好；视野比它还大时（桌面宽屏看得到整级）按需增长。 */
  private ensurePool(): void {
    while (this.beds.length < POOL_SIZE) this.beds.push(createBedView(this));
  }

  private syncBeds(state: ClientState): void {
    if (this.loadedBedCount === undefined) return;
    const view = this.viewRect();

    const occupants = occupantsOf(state);
    const mine = state.me?.ownedBedNo;
    let used = 0;
    for (const row of this.bedRows) {
      if (row.y + BED_H < view.y - CULL_MARGIN_PX) continue;
      if (row.y > view.y + view.height + CULL_MARGIN_PX) break;
      for (const bed of row.beds) {
        if (bed.x + BED_W < view.x - CULL_MARGIN_PX) continue;
        if (bed.x > view.x + view.width + CULL_MARGIN_PX) break;
        let bedView = this.beds[used];
        if (!bedView) {
          bedView = createBedView(this);
          this.beds[used] = bedView;
        }
        used += 1;
        placeBed(
          bedView,
          bed,
          bedLook({ owned: state.ownedBeds.has(bed.bedNo), occupant: occupants.get(bed.bedNo) }),
          bed.bedNo === mine,
        );
      }
    }
    for (let i = used; i < this.beds.length; i += 1) hideBed(this.beds[i] as BedView);
  }

  private syncPeople(state: ClientState, serverNow: number, selfPoint: Point | undefined): void {
    const view = this.viewRect();
    const x0 = view.x - CULL_MARGIN_PX;
    const x1 = view.x + view.width + CULL_MARGIN_PX;
    const y0 = view.y - CULL_MARGIN_PX;
    const y1 = view.y + view.height + CULL_MARGIN_PX;
    const now = Date.now();
    const spots: PersonSpot[] = [];
    const onScreen = new Set<string>();

    const persons: Person[] = [...state.people.values()];
    if (state.me) persons.push(state.me);

    for (const person of persons) {
      // 睡痕到期由本地推导（不挂定时器、服务端也不广播）：到点就不再画
      if (isFaded(person, serverNow)) continue;

      // 自己那一份由 `update` 取一次后传进来：跟随追的就是这个点
      const point =
        person.id === state.me?.id
          ? selfPoint
          : personPoint({
              person,
              motion: state.motion.get(person.id),
              bedPoint: person.state === 'roaming' ? undefined : this.bedPoint(person.bedNo),
              serverNow,
            });
      if (!point) continue;
      const x = point.x;
      const y = point.y;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;

      // 命中判定用的世界坐标（**含自己**：点自己 = 相机回中，服务端不参与）
      spots.push({ id: person.id, x, y });
      onScreen.add(person.id);

      let personView = this.people.get(person.id);
      if (!personView) {
        personView = createPersonView(this);
        this.people.set(person.id, personView);
      }
      const mine = person.id === state.me?.id;
      // 按 y 排序解决遮挡：画面上更靠下 = 更靠前
      personView.container.setPosition(x, y).setDepth(DEPTH.person + y);
      const motion = state.motion.get(person.id);
      paintPerson(personView, { person, mine, moving: isMoving(person, motion, serverNow), nowMs: now });

      const selected = person.id === state.selectedId;
      const named = shouldDrawName(person, state.me?.id) || selected;
      const emote = state.emotes.get(person.id);
      // 气泡的过期在这里比较（**不挂定时器**）：到点就不再画，人不在视野里则整个视图被销毁
      const bubble = state.bubbles.get(person.id);
      const chat = bubble && bubble.expiresAt > now ? bubble : undefined;
      // 头顶只有一个槽位：**聊天 > 表情 > 选中名字**。床上那条常显的裸标签在床下方，不跟着让位。
      // 名字在渲染时从 `people` 现取，**别人的消息带名字前缀，自己的不带**（自己知道是自己）。
      setPersonChat(
        personView,
        chat === undefined ? undefined : { text: mine ? chat.text : `${person.name}：${chat.text}`, kind: chat.kind },
      );
      setPersonName(
        personView,
        named && !(chat !== undefined && selected) ? person.name : '',
        person.state === 'trace',
        selected,
      );
      setPersonEmote(
        personView,
        chat === undefined && emote && emote.expiresAt > now ? EMOTE_LABELS[emote.emoteId] : '',
      );
    }

    // 离开视野 / 离开厅的对象立刻销毁：视野外的对象不留在内存里
    for (const [id, personView] of this.people) {
      if (onScreen.has(id)) continue;
      personView.container.destroy(true);
      this.people.delete(id);
    }

    this.spots = spots;
  }

  // ——— 相机 ———

  /**
   * 可用视口的 insets：面板高度随消息条数与选中行变化，所以观察这两个元素的**实际高度**，
   * 变了就重算夹取。元素换了（进厅前还没有这两个元素）就重挂观察者。
   */
  private syncInsets(): void {
    // 两个元素一旦挂上就一直在：只查一次，之后全靠 ResizeObserver（不为每帧多查一遍 DOM）
    if (this.insetElements.top?.isConnected && this.insetElements.bottom?.isConnected) return;
    const next = this.insetsOf();
    if (next.top === this.insetElements.top && next.bottom === this.insetElements.bottom) return;
    this.insetElements = next;
    this.insetsObserver ??= new ResizeObserver(() => this.applyCameraBounds());
    this.insetsObserver.disconnect();
    for (const element of [next.top, next.bottom]) if (element) this.insetsObserver.observe(element);
    this.applyCameraBounds();
  }

  /**
   * 我的床在**可用视口**里的方位 → store（`undefined` = 在视野内）。
   * 算在这里而不是 React 里：这是逐帧的活，进框架的渲染循环会把几百个小人拖死（`AGENTS.md` 硬纪律）。
   * 写 store 前先比一次**当前值**（`state` 是这一帧开头的快照，这个字段只有世界层写）：同值不通知，
   * HUD 才不会因为位置节拍重渲染。
   */
  private syncBedDirection(state: ClientState): void {
    const bedNo = state.me?.ownedBedNo;
    const point = bedNo === undefined ? undefined : this.bedPoint(bedNo);
    const direction = point ? bedDirection(usableView(this.viewRect(), this.insets), point) : undefined;
    if (direction === state.bedDirection) return;
    setBedDirection(direction);
  }

  /**
   * 温和跟随：自己**正在走动**且走出屏幕中央区（死区）时才跟随，**按 dt 匀速靠近**（见 `followStep`）。
   * 停下即停、看别人走动镜头不动、拖拽期间完全不跟随。
   *
   * 死区按**可用视口**算（不是整视口）：否则自己会在面板后面走出死区而镜头不动。
   * 取位点由 `update` 取一次后传进来（与那一帧渲染用的小人位置是同一个点）。
   */
  private follow(state: ClientState, serverNow: number, dtMs: number, point: Point | undefined): void {
    const me = state.me;
    const motion = me ? state.motion.get(me.id) : undefined;
    // 「还在走」的判据与渲染摆动用同一个（`isMoving`），否则跟随会在窗口的最后一帧上顿一下
    const moving = me !== undefined && isMoving(me, motion, serverNow) && this.pointers.size === 0;
    if (!moving || !point) return;

    const usable = usableView(this.viewRect(), this.insets);
    const center = { x: usable.x + usable.width / 2, y: usable.y + usable.height / 2 };
    // 死区 = 可用视口中心 ± CENTER_BAND/2（与 Phaser 的 `setDeadzone` 同一条规则，只是自己算）
    const next = followStep({
      point,
      center,
      halfWidth: (usable.width * CENTER_BAND) / 2,
      halfHeight: (usable.height * CENTER_BAND) / 2,
      dtMs,
      maxPxPerS: CAMERA_FOLLOW_PX_PER_S,
    });
    const camera = this.cameras.main;
    camera.scrollX += next.x - center.x;
    camera.scrollY += next.y - center.y;
  }

  /**
   * 当前视野（世界坐标）。自己算而不用 `camera.worldView`：那个值要等下一次 `preRender` 才更新，
   * 而相机可能刚被 `centerOn` / 拖动改过——裁剪要跟得上同一帧里的镜头。
   */
  private viewRect(): { x: number; y: number; width: number; height: number } {
    const camera = this.cameras.main;
    const width = camera.width / camera.zoomX;
    const height = camera.height / camera.zoomY;
    return {
      x: camera.scrollX + (camera.width - width) / 2,
      y: camera.scrollY + (camera.height - height) / 2,
      width,
      height,
    };
  }

  /** 初始视野：对准我的床（还没有床时对准自己）；连自己都还不知道在哪时退回厅中心。 */
  private alignCamera(state: ClientState): void {
    const focus = this.focusPoint(state);
    if (focus) this.centerOnUsable(focus);
    else if (this.loadedBedCount !== undefined) {
      const region = wallRegionOf(levelIndexOfBedCount(this.loadedBedCount));
      this.centerOnUsable({ x: region.x + region.width / 2, y: region.y + region.height / 2 });
    }
  }

  /** 点自己 = 相机对准自己（`docs/ui/DESIGN.md`「世界相机」）。 */
  private centerOnSelf(state: ClientState): void {
    const focus = this.selfPoint(state, Date.now() + state.clockOffsetMs);
    if (focus) this.centerOnUsable(focus);
  }

  /**
   * 回中：把世界点放到**可用视口**的中心，而不是整视口的中心
   * ——按整视口居中时，人物正好落在聊天面板后面。
   */
  private centerOnUsable(point: Point): void {
    const view = this.viewRect();
    // **减**偏移：可用带中心在视口中心**之上**（底部界面占位通常更大），所以焦点要跟着往上挑
    const offset = usableCenterOffset(view, this.insets);
    this.cameras.main.centerOn(point.x - offset.x, point.y - offset.y);
  }

  /**
   * 夹取：不越出**取景范围**（`scrollRegionOf` = 地板区 + 墙带 + 墙外一圈）；可见区比它大时
   * （宽档 / 横屏）把边界扩成视野大小，让厅居中。
   * **垂直按「可用视口」夹**：这样地板区的最下边缘能滚到聊天面板之上。
   *
   * 推到边缘时看见「**墙外的一圈底 + 墙带 + 地板**」：只夹到地板区，墙带整条落在屏幕外；
   * 只夹到墙带外沿，墙又永远贴着屏幕最外圈、只像一条细线。
   */
  private applyCameraBounds(): void {
    if (this.loadedBedCount === undefined) return;
    const outer = scrollRegionOf(levelIndexOfBedCount(this.loadedBedCount));
    const view = this.viewRect();
    const bounds = cameraBounds(outer, view, usableView(view, this.measureInsets()));
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  /**
   * 界面实占的区域只从 DOM 的**实际**值读：面板随消息条数变高变矮、横屏面板底部还留 12px 外边距，
   * 都不硬编码。所以量的是「**从视口边缘到界面内沿**」的距离，而不是元素自身高度。
   */
  private measureInsets(): ViewInsets {
    const host = this.host.getBoundingClientRect();
    const top = this.insetElements.top?.getBoundingClientRect();
    const bottom = this.insetElements.bottom?.getBoundingClientRect();
    this.insets = {
      top: top ? Math.max(0, top.bottom - host.top) : 0,
      bottom: bottom ? Math.max(0, host.bottom - bottom.top) : 0,
    };
    return this.insets;
  }

  /**
   * 尺寸变化（旋屏 / 地址栏收放）：只重算视口与夹取，**不重算比例**——比例是常量。
   * `Scale.NONE` 下画布不会自己跟着宿主变，所以尺寸自己算；DPR 用 `zoom` 抵消，
   * 画布像素 = CSS 像素 × DPR，而相机 `zoom = DPR` 把世界像素换回 CSS 像素（1 世界像素 = 1 CSS 像素）。
   */
  private resizeToHost(): void {
    const rect = this.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.scale.zoom = 1 / dpr;
    this.scale.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr));
    this.cameras.main.setZoom(dpr);
    this.applyCameraBounds();
  }

  // ——— 输入：单指拖拽平移 + 轻点 ———

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    this.pruneReleasedPointers();
    // 多指只管第一根：多出来的手指不改变什么（**没有缩放**），但也不会把平移带成两倍速
    if (this.pointers.size > 0) return;
    this.pointers.set(pointer.id, { x: pointer.x, y: pointer.y, moved: 0 });
  }

  /**
   * 浏览器偶尔不发 `pointerup`（切后台、系统手势驳回）：按「此刻真按着的指针」清一次，
   * 否则会卡在「一直在拖」——镜头跟着手指跑，而且跟随再也不会开。
   */
  private pruneReleasedPointers(): void {
    const down = new Set(this.input.manager.pointers.filter((entry) => entry.isDown).map((entry) => entry.id));
    for (const id of [...this.pointers.keys()]) {
      if (!down.has(id)) this.pointers.delete(id);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const tracked = this.pointers.get(pointer.id);
    if (!tracked || !pointer.isDown) return;
    const dx = pointer.x - tracked.x;
    const dy = pointer.y - tracked.y;
    tracked.moved += Math.hypot(dx, dy);
    tracked.x = pointer.x;
    tracked.y = pointer.y;
    // 画布像素 → CSS 像素：相机 zoom 就是 DPR（见 `resizeToHost`）
    const camera = this.cameras.main;
    camera.scrollX -= dx / camera.zoomX;
    camera.scrollY -= dy / camera.zoomY;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const tracked = this.pointers.get(pointer.id);
    if (!tracked) return;
    this.pointers.delete(pointer.id);
    // 轻点（未拖动、时间短）才是一次意图；拖拽是平移镜头
    if (tracked.moved < TAP_SLOP_PX && pointer.upTime - pointer.downTime < TAP_MS) this.dispatchTap(pointer);
  }

  /**
   * 轻点：命中优先级是纯函数给的（人 > 空床 > 地面），这里只负责查表和分派。
   *
   * 点地面时由**客户端**把目标吸附到最近的街网点（服务端只校验、不吸附，见 `docs/api/20-api-ws.md` §7）：
   * 用户点的是画布上的一个像素，而服务端只接受街网上的点。
   */
  private dispatchTap(pointer: Phaser.Input.Pointer): void {
    if (this.loadedBedCount === undefined) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const point = { x: world.x, y: world.y };
    const bedCount = this.loadedBedCount;
    const bedNo = bedNoAt(point.x, point.y, bedCount);
    const state = getState();

    const target = tapTargetFor({
      point,
      spots: this.spots,
      selfId: state.me?.id,
      residentId: bedNo !== undefined ? residentOf(state, bedNo) : undefined,
      bedNo,
      walkTarget: nearestStreetPoint(point, bedCount),
    });

    switch (target.kind) {
      case 'select':
        this.handlers.onSelect(target.id);
        return;
      case 'lie':
        this.handlers.onLie(target.bedNo);
        return;
      case 'walk':
        // 点地面 = 取消选中 + 走过去（选中态与走动的分工由纯函数给定）
        this.handlers.onClearSelection();
        this.handlers.onWalk({ x: target.x, y: target.y });
        return;
      case 'recenter':
        this.centerOnSelf(state);
        return;
      default:
        return;
    }
  }

  // ——— 坐标换算 ———

  /** 床号的世界像素位置（取床心：左上角 + 半张床）。 */
  private bedPoint(bedNo: number): Point | undefined {
    const position = positionOf(bedNo);
    return position ? { x: position.x + BED_W / 2, y: position.y + BED_H / 2 } : undefined;
  }

  /** 自己所在的世界像素位置（走动时按插值、躺着时就是那张床）。**调用方一帧只取一次**（见 `update`）。 */
  private selfPoint(state: ClientState, serverNow: number): Point | undefined {
    const me = state.me;
    if (!me) return undefined;
    return personPoint({
      person: me,
      motion: state.motion.get(me.id),
      bedPoint: me.state === 'roaming' ? undefined : this.bedPoint(me.bedNo),
      serverNow,
    });
  }

  /** 初始对准的目标：我的床优先（我知道我的床在哪），还没有床时才对准自己。 */
  private focusPoint(state: ClientState): Point | undefined {
    const bedNo = state.me?.ownedBedNo;
    if (bedNo !== undefined) {
      const point = this.bedPoint(bedNo);
      if (point) return point;
    }
    return this.selfPoint(state, Date.now() + state.clockOffsetMs);
  }

  /** HUD 的床号条：一次性的相机跳转，对准我的床（还没有床时的退路与进厅对准同一条，见 `focusPoint`）。 */
  focusMyBed(): void {
    // 几何还没建好（场景还在 boot / 快照没到）：相机与夹取都还没准备好，这一跳没有意义
    if (this.loadedBedCount === undefined) return;
    const focus = this.focusPoint(getState());
    if (focus) this.centerOnUsable(focus);
  }
}

export function createWorld(host: HTMLElement, handlers: WorldHandlers, insetsOf: () => UiInsets): WorldHandle {
  const rect = host.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const scene = new WorldScene(host, handlers, insetsOf);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: COLORS.outside,
    // DPR 上限 2：画布像素 = CSS 像素 × DPR，`zoom` 再把 CSS 尺寸抵消回去（见 `resizeToHost`）
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1 / dpr,
      width: Math.round(Math.max(rect.width, 1) * dpr),
      height: Math.round(Math.max(rect.height, 1) * dpr),
    },
    // 手势交给相机（单指拖拽平移），不让浏览器把页面拽走
    canvasStyle: 'display: block; touch-action: none;',
    scene: [scene],
  });

  return {
    destroy(): void {
      game.destroy(true);
    },
    focusMyBed(): void {
      scene.focusMyBed();
    },
  };
}