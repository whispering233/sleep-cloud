import * as Phaser from 'phaser';

import {
  BED_H,
  BED_W,
  CELL_H,
  CELL_W,
  MAX_DPR,
  POOL_SIZE,
  WALL_WIDTH,
  ZOOM_TEXT_MIN,
} from '../../shared/constants';
import { bedNoAt, frontPointOf, levelIndexOfBedCount, nearestStreetPoint, positionOf, reserveBlockOf, scrollRegionOf, wallRegionOf } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import { advanceMover } from '../../shared/movement';
import type { MoverState } from '../../shared/movement';
import type { Person } from '../../shared/protocol';
import { errorTextFor } from '../error-text';
import { predictionPointAt } from '../prediction';
import { beginWalk, getState, setBedDirection, setSwitching, showNotice, setZoomMode as writeZoomMode } from '../store';
import type { ClientState } from '../store';
import type { ZoomMode } from '../zoom';
import {
  alignTargetOf,
  bedDirection,
  bedLook,
  bedMarkerOf,
  cameraBounds,
  campfireLit,
  clampZoom,
  followStep,
  isFaded,
  isMoving,
  layoutTopOf,
  personPoint,
  shouldDrawName,
  shouldResize,
  tapTargetFor,
  usableView,
  usableCenterOffset,
} from './rules';
import type { Occupant, PersonSpot, Size, ViewInsets } from './rules';
import { PET_ARRIVE_PX, PET_GREET_MS, PET_REPATH_PX, petAnimFor, petGreetVisible, petHomeOf, petPathFor, petRemainingOf, petShouldSleep, petSpawnPoint, petSpeedFor, petTargetFor } from './pet';
import type { PetTrail } from './pet';
import {
  COLORS,
  SPRITES_KEY,
  createBedView,
  createCampfireAnims,
  createCampfireView,
  createPersonView,
  createPetAnims,
  createPetView,
  hideBed,
  hideCampfire,
  hidePet,
  paintPerson,
  placeBed,
  placeCampfire,
  placePet,
  setPersonChat,
  setPersonName,
} from './views';
import type { BedView, CampfireView, PersonView, PetView } from './views';

/**
 * 世界画布（Phaser 4）。**渲染层是一个纯函数**：状态快照 → 画出来（见 `docs/design/architecture.md` §2.3）。
 *
 * 三条边界：
 * 1. 世界走画布、界面走 DOM——这里不画任何文字界面，名字是贴在床上的小标签，不是 UI；
 * 2. 画布不参与 React 的渲染循环——状态直接读 store，重画由 Phaser 的 game loop 驱动；
 * 3. **世界只缩不放**（`docs/ui/DESIGN.md` 的世界相机）：1× 下 1 世界像素 = 1 CSS 像素，相机可以拉远到
 *    `ZOOM_MIN`（相机 zoom = 画布 DPR × 拉远比例），也**只有**拉远这一档——没有放大。
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
  /** 相机跳到我的床（动作行的床号条）；还没有床时按进厅对准的退路（`focusPoint`）。 */
  focusMyBed(): void;
  /** 相机跳到指定床（动作行的 `GO`）。 */
  focusBed(bedNo: number): void;
  /** 设世界缩放档位（动作行那颗胶囊；也是 捏合之外的**单指入口**，WCAG 2.5.1）。 */
  setZoomMode(mode: ZoomMode): void;
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

/** 床号 → 占用者 id（含自己）：命中判定要区分「空床可躺」与「床上有人」。 */function residentOf(state: ClientState, bedNo: number): string | undefined {
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
  /** 我床头那堆火：全场只有一张（我的那张床），不进对象池 */
  private campfire: CampfireView | undefined;
  /** 我床尾那只猫的视图：全场只有一只（绑「我」不绑床），不进对象池 */
  private pet: PetView | undefined;
  /**
   * 猫的位置与剩余折线（`{ x, y, path }`）：**本地装饰量**，不是权威状态——不进 store、不进 `spots`、
   * 不广播。`anim` 的签名住在视图上（同篝火的 `lit`）：位置每帧写，动画只在翻转时换。
   */
  private petMove: MoverState | undefined;
  /** 上一次折线的目标点与当时的床位数：目标移动 > 24px 或床位数变了才重算（`70-reserve-decor.md` §3.3） */
  private petTargetPoint: Point | undefined;
  private petBedCount: number | undefined;
  /**
   * 猫现在跟在哪一侧（沿哪个轴、哪个方向拉开 60px）：由我的**移动方向**推得，停下来就保持不变。
   * 不存这个的话，两条轴都可行时它会每帧挑一次，看起来像来回横跳。
   */
  private petTrail: PetTrail | undefined;
  /** 上一帧我自己的位置：只用来推「我从哪边来」（世界层已有同一个点，不另外取样） */
  private petSelf: Point | undefined;
  /**
   * 首次进厅那一次举起的「要不要问候」旗子：猫第一次跑到我旁边时用掉（`70-reserve-decor.md` §3.4）。
   * 只在 `everOnline` 还是 `false` 的那一帧置上，所以重连不会重举（§3.5），本次会话最多问候一次。
   */
  private petGreetPending = false;
  /** 问候的到期时刻（`undefined` = 没问候过）：到点是否还画由渲染时比较，不挂定时器（§3.4） */
  private petGreetUntil: number | undefined;
  /** 手指状态：单指拖拽平移；两根手指 = 缩放（见「输入」一节） */
  private readonly pointers = new Map<number, { x: number; y: number; moved: number }>();
  /** 本次手势里出现过第二根手指：出现过就不算轻点（否则捏合收尾会误发一次走路） */
  private gesturePinched = false;
  /** 两指缩放的手势起点（两指距离、当时的比例、起点下的世界点）：`undefined` = 没在缩放 */
  private pinch: { dist: number; zoom: number; worldX: number; worldY: number } | undefined;
  /** 厅的区域（地板与夹取用）：随 `bedCount` 变化重建 */
  private readonly scenery: Phaser.GameObjects.GameObject[] = [];
  /** 上一次看到的连接态（上一帧是否 `online`）：用来抓「离线 → 在线」这一次翻转 */
  private wasOnline = false;
  /**
   * 是否**曾经**进过厅：用它区分「首次进厅」与「重连」。
   * 不能用 `wasOnline` 代替：进去的那一帧它必然是 `false`（为 `true` 就不会进那个分支），
   * 传下去永远是「首次进厅」，重连对准我的小人那条分支会变成死代码。
   */
  private everOnline = false;
  /** 拉远比例（**只缩不放**，`[ZOOM_MIN, 1]`）：相机 zoom = 画布 DPR × 它（见 `applyZoom`） */
  private zoom = 1;
  /** 画布 DPR（`resizeToHost` 里算）：相机 zoom 的另一半，也是 insets 换算的基准 */
  private dpr = 1;
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
    // 篝火只有一摊（我的床头）：动画注册一次、Sprite 建一次，画不画 / 亮不亮由 `syncCampfire` 逐帧决定
    createCampfireAnims(this);
    this.campfire = createCampfireView(this);
    // 猫同理：全场只有一只，四组循环动画注册一次，目标与动画由 `syncPet` 逐帧决定
    createPetAnims(this);
    this.pet = createPetView(this);
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
    // 断线后重连：首次进厅对准我的床，重连则对准我的小人（宽限恢复会把我放回原位，可能在厅的另一头）
    const online = state.connection === 'online';
    if (online && !this.wasOnline) this.alignCamera(state, this.everOnline);
    // 首次进厅 = `everOnline` 还没被置 true 的那一次：猫的问候只发这一次（重连不发，§3.4）
    if (online && !this.everOnline) this.petGreetPending = true;
    this.everOnline = this.everOnline || online;
    this.wasOnline = online;

    this.syncBeds(state);
    // **一帧只取一次位**：渲染、猫、跟随共用这个点（各取一次就会出现「相机追着上一帧的点」的稳态锯齿）
    const selfPoint = this.selfPoint(state, serverNow);
    this.syncCampfire(state);
    this.syncPet(state, selfPoint);
    this.syncPeople(state, serverNow, selfPoint);
    this.follow(state, serverNow, delta, selfPoint);
    // 方位在相机这一帧动完之后算：拖拽/回中当帧就把字形换成对的
    this.syncBedDirection(state);
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
    // 地板只画一次：它是一块固定色（明暗不在这里做，整屏减光那一层不在画布上）
    const floor = this.add.graphics().setDepth(DEPTH.floor);
    floor.fillStyle(COLORS.floor, 1);
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
    // 拉远到文字阈值以下：床号退役（同屏 Text 对象数也一起压回 0），但房间地面与预留位照画——它们是「厅的大致样式」
    const detail = this.zoom >= ZOOM_TEXT_MIN;
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
        const owned = state.ownedBeds.has(bed.bedNo);
        const occupant = occupants.get(bed.bedNo);
        placeBed(
          bedView,
          bed,
          bedLook({ owned, occupant, detail }),
          bedMarkerOf({ bedNo: bed.bedNo, mine, switching: state.switching, owned, occupied: occupant !== undefined }),
        );
        // 床角那颗点的**屏幕尺寸恒定**：拉远时只放大它，不把它缩小到看不见（见 `docs/ui/DESIGN.md`）
        bedView.markerGfx.setScale(1 / this.zoom);
      }
    }
    for (let i = used; i < this.beds.length; i += 1) hideBed(this.beds[i] as BedView);
  }

  /**
   * 我床头那摊篝火（`docs/design/70-reserve-decor.md` §2）：**只有我自己看得见**——不进 `people`、
   * 不广播，服务端不知道它存在。不画的情形：没有我、没有床、那张床不在视野里（与床位同一套裁剪口径）。
   *
   * 「我躺的那张床」：在床上就是那张（`bedNo`），在厅里走时是我拥有的那张（`ownedBedNo`）——
   * 换床必然先起身，所以搬过去的那一刻它本来就是熄灭的，不存在「火苗搬家」（§2.1）。
   *
   * 逐帧状态只住在这一层（场景字段 + 视图签名）：不写 store、不触发 React 重渲染（`AGENTS.md` 硬纪律 17）。
   */
  private syncCampfire(state: ClientState): void {
    const fire = this.campfire;
    if (!fire) return;
    const me = state.me;
    const bedNo = me === undefined ? undefined : me.state === 'roaming' ? me.ownedBedNo : me.bedNo;
    // 锚点 = 床头块的**底边中心**（素材锚点也是墨迹底边中心，火堆就压在那条线上）；
    // 余量沿用床位那一级的 `CULL_MARGIN_PX`，所以「床画不画」与「火画不画」不会在边界上打架
    const head = bedNo === undefined ? undefined : reserveBlockOf(bedNo, 'head');
    const view = this.viewRect();
    if (
      head === undefined ||
      head.x + head.width < view.x - CULL_MARGIN_PX ||
      head.x > view.x + view.width + CULL_MARGIN_PX ||
      head.y + head.height < view.y - CULL_MARGIN_PX ||
      head.y > view.y + view.height + CULL_MARGIN_PX
    ) {
      hideCampfire(fire);
      return;
    }
    const y = head.y + head.height;
    placeCampfire(fire, { x: head.x + head.width / 2, y, depth: DEPTH.person + y, lit: campfireLit(me) });
  }

  /**
   * 我床尾那只猫（`docs/design/70-reserve-decor.md` §3）：**只有我自己看得见**——绑「我」不绑床
   * （没有床时也跟），不进 `people` / `state.bubbles` / `spots`（不可点），服务端不知道它存在。
   *
   * 目标每帧由**我的显示态**现算（`petTargetFor`）：躺下 / 睡着 → 窝，其余（含还没有床）→ 我脚前。
   * 位置与剩余折线只住在场景字段里，**不写 store、不触发 React 重渲染**（`AGENTS.md` 硬纪律 17）。
   */
  private syncPet(state: ClientState, self: Point | undefined): void {
    const pet = this.pet;
    if (!pet) return;
    const me = state.me;
    const bedCount = this.loadedBedCount;
    if (me === undefined || self === undefined || bedCount === undefined) {
      hidePet(pet);
      return;
    }
    // 「我从哪边来」→ 猫跟在哪一侧：移动时取主方向的**反侧**，停下来保持上一次
    // （两条轴都可行时不定下来，它就会逐帧在两侧之间横跳，`70-reserve-decor.md` §3.3）
    const preferred = this.petPreferredTrail(self);
    const target = petTargetFor({ me, self, bedCount, trail: preferred ?? this.petTrail });
    // 没有目标 / 睡痕：不画（睡痕是「人已经走了」，猫不该留在那儿）
    if (target === undefined || me.state === 'trace') {
      hidePet(pet);
      return;
    }
    if (target.trail !== undefined) this.petTrail = target.trail;

    // 首次落位：有窝从窝里开始（我躺下时它本来就在那儿），没有窝从沿街网 120px 的起跑点开始（§3.5）；
    // 之后一律由目标 + 折线推进——**起点不因为目标没变就被当成终点**（无床时这就是「从旁边跑来」）
    let move = this.petMove;
    if (!move) {
      const start = petSpawnPoint({ self, bedCount, home: petHomeOf(me) });
      move = { x: start.x, y: start.y, path: [] };
      this.petMove = move;
    }

    // 重算折线只有三种情形：目标点移动超过 24px、厅的床位数变了（街网几何变了）、还没算过折线（§3.3）
    const targetMoved =
      this.petTargetPoint === undefined
        ? Infinity
        : Math.hypot(target.point.x - this.petTargetPoint.x, target.point.y - this.petTargetPoint.y);
    if (targetMoved > PET_REPATH_PX || this.petBedCount !== bedCount) {
      move.path = petPathFor(move, target, bedCount);
      this.petTargetPoint = target.point;
      this.petBedCount = bedCount;
    }

    // 推进按**实际经过的时间**（与小人同一条纪律）：速度由**剩余折线长度**给（绕拐角时才是真要走的路），
    // 远处飞奔、近处收步。视野外照常推进、只是不画：我 `hop` 到厅的另一头后它从原位置跑过去，一进视野就已经在跑
    const remaining = petRemainingOf(move);
    const speed = petSpeedFor(remaining);
    const { arrived } = advanceMover(move, this.game.loop.delta, speed);

    const view = this.viewRect();
    if (
      move.x < view.x - CULL_MARGIN_PX ||
      move.x > view.x + view.width + CULL_MARGIN_PX ||
      move.y < view.y - CULL_MARGIN_PX ||
      move.y > view.y + view.height + CULL_MARGIN_PX
    ) {
      hidePet(pet);
      return;
    }

    // 到位：窝里睡（§3.2），旁边站着；没到位按速度切走与跑。
    // **到位容差**吃掉最后几像素的碎步：否则每帧在 walk / idle 之间翻一次，静止时就像在抽动
    const atRest = arrived || remaining <= PET_ARRIVE_PX;
    const anim = atRest ? (petShouldSleep(target) ? 'cat-sleep' : 'cat-idle') : petAnimFor(speed);
    // 问候（§3.4）：首次进厅那一次里、猫**第一次**跑到我旁边（折线走空 + 目标是「我」）时开始计时；
    // 到期由渲染比较时间戳（不挂定时器），`pending` 用掉就没了，所以之后不再问候
    const now = Date.now();
    if (this.petGreetPending && arrived && target.kind === 'user') {
      this.petGreetPending = false;
      this.petGreetUntil = now + PET_GREET_MS;
    }
    // 拉远到文字阈值以下：问候气泡与其它世界文字一起退役（猫本体照画，§3.4）
    const greet = this.zoom >= ZOOM_TEXT_MIN && petGreetVisible(this.petGreetUntil, now);
    placePet(pet, { x: move.x, y: move.y, depth: DEPTH.person + move.y, anim, greet });
  }

  /**
   * 把「我刚才往哪走」换成猫该待的那一侧：往 +y 走 → 猫在 −y（身后），依此类推；
   * 位移小于半像素（站着不动 / 插值抖动）就返回 `undefined`，让调用方继续用上一次的方向。
   */
  private petPreferredTrail(self: Point): PetTrail | undefined {
    const last = this.petSelf;
    this.petSelf = { x: self.x, y: self.y };
    if (!last) return undefined;
    const dx = self.x - last.x;
    const dy = self.y - last.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return undefined;
    return Math.abs(dy) >= Math.abs(dx)
      ? { axis: 'y', sign: dy > 0 ? -1 : 1 }
      : { axis: 'x', sign: dx > 0 ? -1 : 1 };
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
      // 「我在哪」那颗暖点同样按屏幕尺寸恒定：拉远时它是唯一还能指出「我在哪」的东西
      personView.footMarker.setScale(1 / this.zoom);

      // 拉远到文字阈值以下：名字与气泡一起退役（这时它们已被缩到 6px 上下，既读不出又白画）
      const detail = this.zoom >= ZOOM_TEXT_MIN;

      const selected = person.id === state.selectedId;
      const named = shouldDrawName(person, state.me?.id) || selected;
      // 气泡的过期在这里比较（**不挂定时器**）：到点就不再画，人不在视野里则整个视图被销毁
      const bubble = state.bubbles.get(person.id);
      const chat = bubble && bubble.expiresAt > now ? bubble : undefined;
      // 头顶只有一个槽位：**聊天 > 选中名字**。床上那条常显的裸标签在床下方，不跟着让位。
      // 名字在渲染时从 `people` 现取，**别人的消息单独占一行名字，自己的不画**（自己知道是自己）。
      setPersonChat(
        personView,
        !detail || chat === undefined
          ? undefined
          : { text: chat.text, kind: chat.kind, name: mine ? undefined : person.name },
      );
      setPersonName(
        personView,
        detail && named && !(chat !== undefined && selected) ? person.name : '',
        person.state === 'trace',
        selected,
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
   * 可用视口的 insets：面板高度随私聊目标行 / 床上动作行的有无变化，所以观察这两个元素的**实际高度**，
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
   * 顶部显示条与动作行才不会因为位置节拍重渲染。
   */
  private syncBedDirection(state: ClientState): void {
    const bedNo = state.me?.ownedBedNo;
    const point = bedNo === undefined ? undefined : this.bedPoint(bedNo);
    const direction = point ? bedDirection(usableView(this.viewRect(), this.insetsWorld()), point) : undefined;
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
    // 「还在走」的判据与渲染摆动用同一个（`isMoving`），否则跟随会在窗口的最后一帧上顿一下。
    // 换床模式里不跟随：模式就是「拖着看全厅挑一张床」，镜头不该被拽回自己身上（见 `docs/ui/DESIGN.md`）
    const moving =
      me !== undefined && isMoving(me, motion, serverNow) && this.pointers.size === 0 && !state.switching;
    if (!moving || !point) return;

    const usable = usableView(this.viewRect(), this.insetsWorld());
    const center = { x: usable.x + usable.width / 2, y: usable.y + usable.height / 2 };
    // 死区 = 可用视口中心 ± CENTER_BAND/2（与 Phaser 的 `setDeadzone` 同一条规则，只是自己算）
    const next = followStep({
      point,
      center,
      halfWidth: (usable.width * CENTER_BAND) / 2,
      halfHeight: (usable.height * CENTER_BAND) / 2,
      dtMs,
      // 按 `1 / zoom` 换算：拉远后世界像素走得快，屏幕观感才不会变成慢拖
      maxPxPerS: CAMERA_FOLLOW_PX_PER_S / this.zoom,
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

  private alignCamera(state: ClientState, reconnected: boolean): void {
    // 首次进厅按本地偏好取比例：显式锁定的档整页重载后还在（读自 `sc.zoom.mode`），
    // 而 `自由缩放` 下的连续比例不跨会话（这时的初值就是 `1×`）。重连保留用户当时的视角
    if (!reconnected) this.setZoom(state.zoomMode.kind === 'fixed' ? state.zoomMode.z : 1);
    const focus = alignTargetOf({
      reconnected,
      bedPoint: this.ownBedPoint(state),
      selfPoint: this.selfPoint(state, Date.now() + state.clockOffsetMs),
    });
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
    const offset = usableCenterOffset(view, this.insetsWorld());
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
    // 夹取前先按 DOM 的最新实占刷新 insets，再换成世界像素（拉远后视角里「屏幕 1px」不再是「世界 1px」）
    this.measureInsets();
    const bounds = cameraBounds(outer, view, usableView(view, this.insetsWorld()));
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  /**
   * 界面实占的区域只从 DOM 的**实际**值读：面板随控件行的增减变高变矮、横屏面板底边还留一圈外边距，
   * 都不硬编码。
   *
   * 量的是**布局**值（`offsetTop` / `offsetHeight`），不是渲染值：`.app-shell` 可能带着 `translateY`
   * （iOS 把视觉视口往下 pan，见 `docs/design/60-interaction-shell.md` §1），渲染位置与布局位置差一截，
   * `getBoundingClientRect` 的差就白算了。
   *
   * 底部占位取面板**自身高度**而不是「屏底 − 面板顶边」：两态网格下打字态面板在**第 2 行**
   * （插槽面板铺满到屏底），后者会把整块屏幕都算成界面，于是面板在打字态里一旦变高（床上动作行出现）
   * 取景就会换成「整屏居中」而且退出后没人重算。取高度则两态同值（窄屏面板贴屏底，两者本来就相等；
   * 宽档面板浮在屏底之上，底下那一圈本来就看得见）。
   */
  private measureInsets(): ViewInsets {
    const top = this.insetElements.top;
    const bottom = this.insetElements.bottom;
    this.insets = {
      top: top ? Math.max(0, layoutTopOf(top) + top.offsetHeight) : 0,
      bottom: bottom ? Math.max(0, bottom.offsetHeight) : 0,
    };
    return this.insets;
  }

  /**
   * 同一份 insets 换成**世界像素**：DOM 量到的是屏幕像素，而取景 / 夹取 / 死区 / 方位全是世界像素。
   * 1× 时两者相等（相机 zoom = DPR 正好抵消），拉远后世界像素 = 屏幕像素 / zoom——少了这一步，
   * 拉远时底部面板在世界坐标里就「变矮」了，最底一行会重新藏到面板后面。
   */
  private insetsWorld(): ViewInsets {
    const z = this.zoom;
    return { top: this.insets.top / z, bottom: this.insets.bottom / z };
  }

  /**
   * 尺寸变化（旋屏 / 地址栏收放）：重算视口与夹取，**保持用户当前的拉远比例**。
   * `Scale.NONE` 下画布不会自己跟着宿主变，所以尺寸自己算（DPR 用 `scale.zoom` 抵消）；
   * 画布像素 = CSS 像素 × DPR，而相机 `zoom = DPR × 拉远比例` 把世界像素换回 CSS 像素（1× 下 1 世界像素 = 1 CSS 像素）。
   */
  private resizeToHost(): void {
    const rect = this.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const next: Size = { width: Math.round(rect.width * dpr), height: Math.round(rect.height * dpr), dpr };
    // 尺寸与 DPR 都没变就别碰 `scale.resize`：那会重建整块绘制缓冲（纯位移不该付这个代价）
    if (next.width === this.scale.width && next.height === this.scale.height && dpr === this.dpr) return;
    // 高度变小 = 软键盘：挡住，**退场后也不补做**。退场那一刻宿主往往还在键盘收起的中途
    // （模拟器实测：量到 748，真值 772），照那个数重算就是先缩再涨 —— 两次重建绘制缓冲 = 两帧黑闪。
    // 画布留在进打字态前的尺寸；宿主回到原值时 `ResizeObserver` 会来，尺寸相同就早退（无重建）。
    if (!shouldResize({ width: this.scale.width, height: this.scale.height, dpr: this.dpr }, next, getState().composer === 'typing')) return;
    this.applySize(next);
  }

  /** 唯一的 `scale.resize` 出口。 */
  private applySize(size: Size): void {
    this.dpr = size.dpr;
    this.scale.zoom = 1 / size.dpr;
    this.scale.resize(size.width, size.height);
    this.applyZoom();
  }

  /** 把拉远比例推给相机（相机 zoom = 画布 DPR × 拉远比例）：比例变了可见范围也变，夹取跟着重算。 */
  private applyZoom(): void {
    this.cameras.main.setZoom(this.dpr * this.zoom);
    this.applyCameraBounds();
  }

  /**
   * 设拉远比例（捏合与动作行那条都走这里）：**只缩不放**，越界由 `clampZoom` 夹住；
   * 不动相机焦点——锚点由调用方负责（捏合锚在两指中点，按钮锚在当前中心）。
   */
  private setZoom(next: number): void {
    const clamped = clampZoom(next);
    if (clamped !== this.zoom) {
      this.zoom = clamped;
      this.applyZoom();
    }
  }

  // ——— 输入：单指拖拽平移 + 轻点；两根手指 = 拉远／放回（固定档下只平移） ———

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    this.pruneReleasedPointers();
    // 两根手指同时按着 = 缩放；第三根起直接忽略（多出来的手指不改变什么，也不会把平移带成两倍速）
    if (this.pointers.size >= 2) return;
    this.pointers.set(pointer.id, { x: pointer.x, y: pointer.y, moved: 0 });
    if (this.pointers.size === 2) this.beginPinch();
  }

  /** 两指缩放的起点：记下两指距离、当时的比例，以及**起点中点下的世界点**（锚点）。 */
  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    // 第二根手指一出场就算「捏过」：哪怕只是按着不动，收尾也不该被读成一次轻点
    this.gesturePinched = true;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const world = this.cameras.main.getWorldPoint(mid.x, mid.y);
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, worldX: world.x, worldY: world.y };
  }

  /**
   * 两指缩放：距离比 → 比例（夹在 `[ZOOM_MIN, 1]`），**锚在起点那个世界点上**——
   * 每帧改完比例再用同一支 `getWorldPoint` 校正一次滚屏，让那个点仍落在当前两指中点下方。
   * 不自己推相机矩阵：Phaser 的换算不必在这里重写一遍（写错的表现就是拉远时世界在漂）。
   * 固定档下**不改比例**，但下面那段锚点补偿照旧——两指拖动因此就是平移。
   */
  private updatePinch(): void {
    const pinch = this.pinch;
    const [a, b] = [...this.pointers.values()];
    if (!pinch || !a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    // 两指几乎重合时距离比会变成 ÷0：先重新取一次基线，别让相机废掉
    if (pinch.dist < 1 || dist < 1) {
      pinch.dist = dist;
      return;
    }
    if (getState().zoomMode.kind === 'free') this.setZoom(pinch.zoom * (dist / pinch.dist));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const now = this.cameras.main.getWorldPoint(mid.x, mid.y);
    // 锚点的世界坐标必须仍落在当前中点上：差多少补多少（两指一起平移时，补的就是平移量）
    const camera = this.cameras.main;
    camera.scrollX += pinch.worldX - now.x;
    camera.scrollY += pinch.worldY - now.y;
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
    // 缩放要求两根手指同时在册：被清掉一根就不能再按起点算距离比
    if (this.pointers.size < 2) this.pinch = undefined;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const tracked = this.pointers.get(pointer.id);
    if (!tracked || !pointer.isDown) return;
    const dx = pointer.x - tracked.x;
    const dy = pointer.y - tracked.y;
    tracked.moved += Math.hypot(dx, dy);
    tracked.x = pointer.x;
    tracked.y = pointer.y;
    // 两根手指按着：这一帧只缩放（锚点会顺手吃掉中点的位移），不再按单指平移走一遍
    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }
    // 画布像素 → CSS 像素：相机 zoom = DPR × 拉远比例（见 `applyZoom`）
    const camera = this.cameras.main;
    camera.scrollX -= dx / camera.zoomX;
    camera.scrollY -= dy / camera.zoomY;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const tracked = this.pointers.get(pointer.id);
    if (!tracked) return;
    const pinched = this.gesturePinched;
    this.pointers.delete(pointer.id);
    if (this.pointers.size === 0) {
      this.gesturePinched = false;
      this.pinch = undefined;
    } else if (this.pointers.size === 1) {
      // 两指降回一指：退掉缩放态，并把剩下那根手指的位移归零（它是继续拖拽的新起点，不是一次轻点）
      this.pinch = undefined;
      const only = [...this.pointers.values()][0];
      if (only) only.moved = 0;
    }
    // 轻点（未拖动、时间短、且这整次手势只有一根手指）才是一次意图
    if (!pinched && tracked.moved < TAP_SLOP_PX && pointer.upTime - pointer.downTime < TAP_MS) {
      this.dispatchTap(pointer);
    }
  }

  /**
   * 轻点：命中优先级是纯函数给的（人 > 空床 > 地面），这里只负责查表和分派。
   *
   * 点地面时由**客户端**把目标吸附到最近的街网点（服务端只校验、不吸附，见 `docs/api/20-api-ws.md` §7）：
   * 用户点的是画布上的一个像素，而服务端只接受街网上的点。
   */
  private dispatchTap(pointer: Phaser.Input.Pointer): void {
    // **只接受从画布起手的那一下**：不管 DOM 叠层以后怎么变（面板、浮层、减光层），
    // 从它们上面起手的点击都不该让小人动（`docs/design/60-interaction-shell.md` §4 的 I8）。
    // Phaser 只在 `downElement === canvas` 时发 `POINTER_DOWN`，这条是把那个判定抄成自己的兜底
    if (pointer.downElement !== this.sys.game.canvas) return;
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
      owned: bedNo !== undefined ? state.ownedBeds.has(bedNo) : undefined,
      ownedBedNo: state.me?.ownedBedNo,
      switching: state.switching,
      walkTarget: nearestStreetPoint(point, bedCount),
    });

    switch (target.kind) {
      case 'select':
        this.handlers.onSelect(target.id);
        return;
      case 'lie': {
        // 模式里那一下就是决定：发出躺下意图后立刻收起模式，下一次点击不再有换床含义
        if (state.switching) setSwitching(false);
        // 「点床 = 走过去 + 躺下」也要立刻起步：服务端会先把我走到**床脚前那一点**再躺下，
        // 客户端用同一个 `frontPointOf` 当锚点，于是这一趟也不等插值滞后（同 `walk` 那条）
        const front = frontPointOf(target.bedNo);
        if (front) beginWalk(front);
        this.handlers.onLie(target.bedNo);
        return;
      }
      case 'notice': {
        // 三类本地闸门都只给提示、**不发上行**：文案与错误码同源（`src/client/error-text.ts`），
        // 同一件事在本地拦下与服务端拒绝时说同一句话（见 `docs/ui/DESIGN.md`「谁能躺」）。
        const text =
          target.reason === 'has-bed'
            ? '已经有一张床 · 换床在设置里'
            : errorTextFor(target.reason === 'occupied' ? '3002' : '3003');
        // 查不到文案 = 静默（与其它静默类错误一致，见 `AGENTS.md` 硬纪律 13）
        if (text !== undefined) showNotice(text);
        return;
      }
      case 'walk':
        // 点地面 = 取消选中 + 走过去（选中态与走动的分工由纯函数给定）
        // 它也是换床模式最自然的「不搬了」：退出模式再走
        this.handlers.onClearSelection();
        if (state.switching) setSwitching(false);
        // 外推**在发出意图的这一刻**登记：`findPath` 只算这一次，之后每帧只沿这条折线推进
        beginWalk({ x: target.x, y: target.y });
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

  /**
   * 自己所在的世界像素位置：**外推优先**（点地面后立刻起步、不等插值滞后），否则按插值 / 那张床。
   * 外推点在这里、也就是 `update` 里每帧现算（**不进 React 的逐帧状态**）；**调用方一帧只取一次**。
   */
  private selfPoint(state: ClientState, serverNow: number): Point | undefined {
    const me = state.me;
    if (!me) return undefined;
    const prediction = state.prediction;
    if (prediction) return predictionPointAt(prediction, serverNow);
    return personPoint({
      person: me,
      motion: state.motion.get(me.id),
      bedPoint: me.state === 'roaming' ? undefined : this.bedPoint(me.bedNo),
      serverNow,
    });
  }

  /** 我的床的中心点（还没有床、或几何还没建好时为 `undefined`）。 */
  private ownBedPoint(state: ClientState): Point | undefined {
    const bedNo = state.me?.ownedBedNo;
    return bedNo === undefined ? undefined : this.bedPoint(bedNo);
  }

  /** 初始对准的目标：我的床优先（我知道我的床在哪），还没有床时才对准自己。 */
  private focusPoint(state: ClientState): Point | undefined {
    return this.ownBedPoint(state) ?? this.selfPoint(state, Date.now() + state.clockOffsetMs);
  }

  /** 动作行的床号条：一次性的相机跳转，对准我的床（还没有床时的退路与进厅对准同一条，见 `focusPoint`）。 */
  focusMyBed(): void {
    // 几何还没建好（场景还在 boot / 快照没到）：相机与夹取都还没准备好，这一跳没有意义
    if (this.loadedBedCount === undefined) return;
    const focus = this.focusPoint(getState());
    if (focus) this.centerOnUsable(focus);
  }

  /** 动作行的「GO」：一次性的相机跳转，对准指定床（与那一条 `hop` 配成一对，不依赖 500px/s 的跟随）。 */
  focusBed(bedNo: number): void {
    if (this.loadedBedCount === undefined) return;
    const point = this.bedPoint(bedNo);
    if (point) this.centerOnUsable(point);
  }

  /**
   * 动作行的缩放档位：写 store（胶囊文案吃它）并**立即应用**——固定档把比例设上去，
   * `free` 只解锁（比例保持当前值：「自由缩放」是不锁定，不是回到某个数）。
   * **不动相机焦点**（只改比例）。
   */
  setZoomMode(mode: ZoomMode): void {
    writeZoomMode(mode);
    if (mode.kind === 'fixed') this.setZoom(mode.z);
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
    // DPR 上限见 `MAX_DPR`：画布像素 = CSS 像素 × DPR，`zoom` 再把 CSS 尺寸抵消回去（见 `resizeToHost`）
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1 / dpr,
      width: Math.round(Math.max(rect.width, 1) * dpr),
      height: Math.round(Math.max(rect.height, 1) * dpr),
    },
    // 手势交给相机（单指拖拽平移、双指捏合拉远），不让浏览器把页面拽走
    canvasStyle: 'display: block; touch-action: none;',
    // **必须显式申请 2 个触摸指针**：Phaser 默认 `input.activePointers = 1`（`core/Config.js`），而
    // `InputManager.onTouchStart` 只在 `pointers[1..]` 里找空闲槽位、`pointers[0]` 归鼠标——默认配置下
    // 第二根手指找不到槽位就被直接丢掉，双指捏合永远进不了缩放分支（首指还会被当成单指拖拽把相机平移）。
    input: { activePointers: 2 },
    scene: [scene],
  });

  return {
    destroy(): void {
      game.destroy(true);
    },
    focusMyBed(): void {
      scene.focusMyBed();
    },
    focusBed(bedNo: number): void {
      scene.focusBed(bedNo);
    },
    setZoomMode(mode: ZoomMode): void {
      scene.setZoomMode(mode);
    },
  };
}
