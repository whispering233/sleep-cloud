import * as Phaser from 'phaser';

import type { Person, PersonState } from '../../shared/protocol';
import { EMOTE_LABELS } from '../emotes';
import { interpolationDelay, isInterpolating } from '../motion';
import { getState } from '../store';
import type { ClientState } from '../store';
import { bedOutline, followStep, personPoint, shouldDrawName, tapTargetFor, wallGeometry } from './rules';
import type { PersonSpot } from './rules';
import { TILE, loadSceneIndex } from './scene-index';
import type { SceneIndex } from './scene-index';
import {
  COLORS,
  LINE_WIDTH,
  MAX_DPR,
  createBedView,
  createPersonView,
  hideBed,
  paintPerson,
  placeBed,
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
 */

export interface WorldHandlers {
  /** 点地面 = 「我要去这一格」（客户端只发意图，怎么走由服务端定） */
  onWalk(tile: { x: number; y: number }): void;
  /** 点小人 = 选中（唯一选中对象：名字气泡 + 私聊目标） */
  onSelect(id: string): void;
  /** 点地面 = 取消选中 */
  onClearSelection(): void;
  /** 点空床 = 躺下 */
  onLie(bedNo: number): void;
}

export interface WorldHandle {
  destroy(): void;
}

/** 轻点判据（见 `docs/ui/DESIGN.md`「世界相机」）：位移 < 8px 且时长 < 350ms，否则那是一次拖拽。 */
const TAP_SLOP_PX = 8;
const TAP_MS = 350;
/** 跟随的匀速速度：约 0.5 秒追上 250px（跟得上，又不像镜头被硬拖）。 */
const CAMERA_FOLLOW_PX_PER_S = 500;
/** 屏幕中央区（占屏幕的比例）：自己在这一块里走动不值得动镜头，正好是相机的死区。 */
const CENTER_BAND = 0.4;
/** 裁剪缓冲：可视窗口外各留一行/一列，拖拽到整数格边界时边缘不闪。 */
const CULL_MARGIN_TILES = 1;
/** 绘制层次：地板 < 场景本体 < 床位 < 小人（床位与小人之间再按 y 排序解决遮挡）。 */
const DEPTH = { floor: -10, scene: -5, bed: 0, person: 100 } as const;
const FLOOR_TEXTURE = 'floor-tile';

/** 床号 → 占用态（人）。归属与占用是两个正交维度，这里只处理占用这一侧。 */
function occupantsOf(state: ClientState): Map<number, PersonState> {
  const occupants = new Map<number, PersonState>();
  for (const person of state.people.values()) {
    if (person.state !== 'roaming') occupants.set(person.bedNo, person.state);
  }
  if (state.me && state.me.state !== 'roaming') occupants.set(state.me.bedNo, state.me.state);
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

/** 一格地板贴图：底色 + 极弱格线（一格 = 旧几何里的一个格子，`TILE` 世界像素）。 */
function ensureFloorTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(FLOOR_TEXTURE)) return;
  const tile = scene.add.graphics();
  tile.fillStyle(COLORS.floor, 1);
  tile.fillRect(0, 0, TILE, TILE);
  tile.lineStyle(1, COLORS.line, 0.06);
  tile.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  tile.generateTexture(FLOOR_TEXTURE, TILE, TILE);
  tile.destroy();
}

/** 按行分桶的床位（行内按 x 升序）：每帧只走可视窗口里的那几行，同屏对象数与厅规模无关。 */
interface BedRow {
  y: number;
  beds: { bedNo: number; x: number; y: number }[];
}

class WorldScene extends Phaser.Scene {
  private readonly host: HTMLElement;
  private readonly handlers: WorldHandlers;
  private index: SceneIndex | null = null;
  private loadedGuid: string | undefined;
  /** 上一帧人物的格坐标（命中判定用；1 帧延迟可接受） */
  private spots: PersonSpot[] = [];
  private readonly bedRows: BedRow[] = [];
  /** 对象池：只装得下同屏的那几十张床，与总床数无关 */
  private readonly beds: BedView[] = [];
  private readonly people = new Map<string, PersonView>();
  /** 手指状态：单指拖拽平移；多指一律忽略（**没有缩放这条路**） */
  private readonly pointers = new Map<number, { x: number; y: number; moved: number }>();
  /** 换场景时要换掉的那些对象（地板与场景本体）：床与小人的对象属于各自的池子，不在这里 */
  private readonly scenery: Phaser.GameObjects.GameObject[] = [];
  /** 上一次看到的连接状态：断线后重连要重新对准我的床 */
  private wasConnected = false;
  private observer: ResizeObserver | null = null;

  constructor(host: HTMLElement, handlers: WorldHandlers) {
    super('world');
    this.host = host;
    this.handlers = handlers;
  }

  create(): void {
    this.resizeToHost();
    this.observer = new ResizeObserver(() => this.resizeToHost());
    this.observer.observe(this.host);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.observer?.disconnect();
      this.observer = null;
    });
    this.bindInput();
  }

  update(_time: number, delta: number): void {
    const state = getState();
    // 滞后是**每个插值窗口各自的**（见 `interpolationDelay`），所以这里取的是未滞后的服务端现在
    const serverNow = Date.now() + state.clockOffsetMs;

    if (state.sceneGuid && state.sceneGuid !== this.loadedGuid) {
      this.loadedGuid = state.sceneGuid;
      void loadSceneIndex(state.sceneGuid)
        .then((index) => {
          if (!this.scene.isActive()) return;
          this.buildScene(index);
          this.alignCamera(getState());
        })
        .catch(() => {
          this.loadedGuid = undefined; // 下次状态变化再试
        });
    }

    // 断线后重连：与进厅同一套规则，重新对准我的床（`wasConnected` 只在真实翻转时才为真）
    if (state.connected && !this.wasConnected) this.alignCamera(state);
    this.wasConnected = state.connected;

    this.syncBeds(state);
    // **一帧只取一次位**：渲染与跟随共用这个点（各取一次就会出现「相机追着上一帧的点」的稳态锯齿）
    const selfPoint = this.selfPoint(state, serverNow);
    this.syncPeople(state, serverNow, selfPoint);
    this.follow(state, serverNow, delta, selfPoint);
  }

  // ——— 场景本体：地板、墙、家具、床位索引 ———

  private buildScene(index: SceneIndex): void {
    this.index = index;
    const { scene } = index;

    for (const object of this.scenery) object.destroy();
    this.scenery.length = 0;
    for (let i = 0; i < this.beds.length; i += 1) hideBed(this.beds[i]);

    ensureFloorTexture(this);
    const floor = this.add
      .tileSprite(0, 0, index.widthPx, index.heightPx, FLOOR_TEXTURE)
      .setOrigin(0, 0)
      .setDepth(DEPTH.floor);

    const body = this.add.graphics().setDepth(DEPTH.scene);
    const wall = wallGeometry({ width: scene.width, height: scene.height, blocked: scene.blocked });
    if (wall.band.width > 0 && wall.band.height > 0) {
      // 环带画成四条边：地板是贴图，「整块铺 + 用地面盖回」会把格线抹掉
      const band = wall.band;
      const inner = wall.inner;
      body.fillStyle(COLORS.surface, 1);
      body.fillRect(band.x, band.y, band.width, inner.y - band.y);
      body.fillRect(band.x, inner.y + inner.height, band.width, band.y + band.height - (inner.y + inner.height));
      body.fillRect(band.x, inner.y, inner.x - band.x, inner.height);
      body.fillRect(inner.x + inner.width, inner.y, band.x + band.width - (inner.x + inner.width), inner.height);
      body.lineStyle(LINE_WIDTH, COLORS.line, 1);
      body.strokeRect(inner.x, inner.y, inner.width, inner.height);
    }

    for (const sprite of scene.decorates) {
      const x = sprite.x * TILE + TILE / 2;
      const y = sprite.y * TILE + TILE / 2;
      if (sprite.sprite === 'lamp') {
        // 床头灯的暖黄光晕：全系统唯一允许出现的暖色
        body.fillStyle(COLORS.marker, 0.5);
        body.fillCircle(x, y, TILE * 0.18);
        body.lineStyle(LINE_WIDTH, COLORS.marker, 0.6);
        body.strokeCircle(x, y, TILE * 0.3);
      } else {
        body.lineStyle(LINE_WIDTH, COLORS.line, 1);
        body.strokeRect(x - TILE * 0.3, y - TILE * 0.3, TILE * 0.6, TILE * 0.6);
      }
    }

    // 按行分桶：可视窗口只要行号，行内按 x 升序就能提前收工
    this.bedRows.length = 0;
    const rows = new Map<number, BedRow>();
    for (const bed of scene.beds) {
      let row = rows.get(bed.y);
      if (!row) {
        row = { y: bed.y, beds: [] };
        rows.set(bed.y, row);
      }
      row.beds.push(bed);
    }
    for (const row of [...rows.values()].sort((a, b) => a.y - b.y)) {
      row.beds.sort((a, b) => a.x - b.x);
      this.bedRows.push(row);
    }
    this.scenery.push(floor, body);

    // 夹取要等厅的尺寸知道了才能算，而场景是异步加载的（`create` 时还没有）
    this.applyCameraBounds();
  }

  // ——— 床位与小人：可视窗口 + 对象池 ———

  private syncBeds(state: ClientState): void {
    if (!this.index) return;
    const view = this.viewRect();
    const rowFrom = Math.floor(view.y / TILE) - CULL_MARGIN_TILES;
    const rowTo = Math.floor((view.y + view.height) / TILE) + CULL_MARGIN_TILES;
    const colFrom = Math.floor(view.x / TILE) - CULL_MARGIN_TILES;
    const colTo = Math.floor((view.x + view.width) / TILE) + CULL_MARGIN_TILES;

    const occupants = occupantsOf(state);
    const mine = state.me?.ownedBedNo;
    let used = 0;
    for (const row of this.bedRows) {
      if (row.y < rowFrom || row.y > rowTo) continue;
      for (const bed of row.beds) {
        if (bed.x < colFrom) continue;
        if (bed.x > colTo) break;
        let bedView = this.beds[used];
        if (!bedView) {
          bedView = createBedView(this);
          this.beds[used] = bedView;
        }
        used += 1;
        placeBed(
          bedView,
          bed,
          bedOutline({ owned: state.ownedBeds.has(bed.bedNo), occupant: occupants.get(bed.bedNo) }),
          bed.bedNo === mine,
        );
      }
    }
    for (let i = used; i < this.beds.length; i += 1) hideBed(this.beds[i]);
  }

  private syncPeople(state: ClientState, serverNow: number, selfPoint: { x: number; y: number } | undefined): void {
    const view = this.viewRect();
    const margin = CULL_MARGIN_TILES * TILE;
    const x0 = view.x - margin;
    const x1 = view.x + view.width + margin;
    const y0 = view.y - margin;
    const y1 = view.y + view.height + margin;
    const now = Date.now();
    const spots: PersonSpot[] = [];
    const onScreen = new Set<string>();

    const persons: Person[] = [...state.people.values()];
    if (state.me) persons.push(state.me);

    for (const person of persons) {
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

      // 命中判定用的格坐标（**含自己**：点自己 = 相机回中，服务端不参与）
      spots.push({ id: person.id, x: point.x / TILE, y: point.y / TILE });
      onScreen.add(person.id);

      let personView = this.people.get(person.id);
      if (!personView) {
        personView = createPersonView(this);
        this.people.set(person.id, personView);
      }
      const mine = person.id === state.me?.id;
      // 按 y 排序解决遮挡：画面上更靠下 = 更靠前
      personView.container.setPosition(x, y).setDepth(DEPTH.person + y);
      paintPerson(personView, person.state, mine);

      const selected = person.id === state.selectedId;
      const named = shouldDrawName(person, state.me?.id) || selected;
      setPersonName(personView, named ? person.name : '', person.state === 'trace', selected);

      const emote = state.emotes.get(person.id);
      setPersonEmote(personView, emote && emote.expiresAt > now ? EMOTE_LABELS[emote.emoteId] : '');
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
   * 温和跟随：自己**正在走动**且走出屏幕中央区（死区）时才跟随，**按 dt 匀速靠近**（见 `followStep`）。
   * 停下即停、看别人走动镜头不动、拖拽期间完全不跟随。
   *
   * 取位点由 `update` 取一次后传进来（与那一帧渲染用的小人位置是同一个点）。
   */
  private follow(state: ClientState, serverNow: number, dtMs: number, point: { x: number; y: number } | undefined): void {
    const me = state.me;
    const motion = me ? state.motion.get(me.id) : undefined;
    // 「还在走」与取位必须用**同一个**滞后，否则跟随会在窗口的最后一帧上顿一下
    const moving =
      me?.state === 'roaming' &&
      motion !== undefined &&
      isInterpolating(motion, serverNow - interpolationDelay(motion)) &&
      this.pointers.size === 0;
    if (!moving || !point) return;

    const view = this.viewRect();
    const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    // 死区 = 视野中心 ± CENTER_BAND/2（与 Phaser 的 `setDeadzone` 同一条规则，只是自己算）
    const next = followStep({
      point,
      center,
      halfWidth: (view.width * CENTER_BAND) / 2,
      halfHeight: (view.height * CENTER_BAND) / 2,
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
    if (focus) this.cameras.main.centerOn(focus.x, focus.y);
    else if (this.index) this.cameras.main.centerOn(this.index.widthPx / 2, this.index.heightPx / 2);
  }

  /** 点自己 = 相机对准自己（`docs/ui/DESIGN.md`「世界相机」）。 */
  private centerOnSelf(state: ClientState): void {
    const focus = this.selfPoint(state, Date.now() + state.clockOffsetMs);
    if (!focus) return;
    this.cameras.main.centerOn(focus.x, focus.y);
  }

  /** 夹取：不越出厅的矩形；可见区比厅大时（宽档 / 横屏）把边界扩成视野大小，让厅居中。 */
  private applyCameraBounds(): void {
    if (!this.index) return;
    const camera = this.cameras.main;
    const width = Math.max(this.index.widthPx, camera.width / camera.zoomX);
    const height = Math.max(this.index.heightPx, camera.height / camera.zoomY);
    camera.setBounds(
      -(width - this.index.widthPx) / 2,
      -(height - this.index.heightPx) / 2,
      width,
      height,
    );
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

  /** 轻点：命中优先级是纯函数给的（人 > 空床 > 地面），这里只负责查表和分派。 */
  private dispatchTap(pointer: Phaser.Input.Pointer): void {
    if (!this.index) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const point = { x: world.x / TILE, y: world.y / TILE };
    const tile = { x: Math.floor(point.x), y: Math.floor(point.y) };
    const bedNo = this.index.bedNoAt(tile.x, tile.y);
    const state = getState();

    const target = tapTargetFor({
      point,
      spots: this.spots,
      selfId: state.me?.id,
      residentId: bedNo !== undefined ? residentOf(state, bedNo) : undefined,
      bedNo,
      walkable: this.index.isWalkable(tile.x, tile.y),
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

  /** 床号的世界像素位置（取格心：+半格）。 */
  private bedPoint(bedNo: number): { x: number; y: number } | undefined {
    const tile = this.index?.bedAt(bedNo);
    return tile ? { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE } : undefined;
  }

  /** 自己所在的世界像素位置（走动时按插值、躺着时就是那张床）。**调用方一帧只取一次**（见 `update`）。 */
  private selfPoint(state: ClientState, serverNow: number): { x: number; y: number } | undefined {
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
  private focusPoint(state: ClientState): { x: number; y: number } | undefined {
    const bedNo = state.me?.ownedBedNo;
    if (bedNo !== undefined) {
      const point = this.bedPoint(bedNo);
      if (point) return point;
    }
    return this.selfPoint(state, Date.now() + state.clockOffsetMs);
  }
}

export function createWorld(host: HTMLElement, handlers: WorldHandlers): WorldHandle {
  const rect = host.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: COLORS.floor,
    // DPR 上限 2：画布像素 = CSS 像素 × DPR，`zoom` 再把 CSS 尺寸抵消回去（见 `resizeToHost`）
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1 / dpr,
      width: Math.round(Math.max(rect.width, 1) * dpr),
      height: Math.round(Math.max(rect.height, 1) * dpr),
    },
    // 手势交给相机（单指拖拽平移），不让浏览器把页面拽走
    canvasStyle: 'display: block; touch-action: none;',
    scene: [new WorldScene(host, handlers)],
  });

  return {
    destroy(): void {
      game.destroy(true);
    },
  };
}