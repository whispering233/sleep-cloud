import { Application, Container, Graphics, Text } from 'pixi.js';

import type { Person, PersonState } from '../../shared/protocol';
import { EMOTE_LABELS } from '../emotes';
import { getState, subscribe } from '../store';
import type { ClientState } from '../store';
import { positionAt, INTERPOLATION_DELAY_MS, isInterpolating, anyInterpolating } from '../motion';
import { palette } from './palette';
import type { WorldPalette } from './palette';
import {
  bedDashSegments,
  bedOutline,
  bedPaintSignature,
  cameraFor,
  clampCamera,
  defaultScale,
  isDaytime,
  markerRadius,
  outsideCenterBand,
  personAlpha,
  shouldDrawName,
  tapTargetFor,
  wallGeometry,
} from './rules';
import type { BedOutline, PersonSpot } from './rules';
import { loadSceneIndex, TILE } from './scene';
import type { SceneIndex } from './scene';

/**
 * 世界画布（PixiJS）。**渲染层是一个纯函数**：状态快照 → 画出来。
 *
 * 两条边界（见 `AGENTS.md` 硬纪律）：
 * 1. 世界走画布、界面走 DOM——这里不画任何文字界面，名字是贴在床上的小标签，不是 UI；
 * 2. 画布不参与 React 的渲染循环——状态经 store 订阅进来，重画由 Pixi 的 ticker 驱动。
 */

/** 缩放区间：再小就只剩颜色，再大一张床占满屏幕。 */
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
/** 跟随的每帧靠近比例：约 0.5 秒追上（跟得上，又不像镜头被硬拖）。 */
const FOLLOW_EASE = 0.15;
/** 线稿宽度按屏幕像素给：缩放时视觉粗细不变（等宽线稿）。 */
const LINE_PX = 1.5;
/** 名字按屏幕像素给：不随缩放变大变小。 */
const NAME_PX = 12;
/** 虚线按屏幕像素给：与线宽同理，缩放时虚线节奏不变。 */
const DASH_PX = 6;
const DASH_GAP_PX = 4;
/** 床位轮廓相对格子的内缩（世界像素）：留出格线，同时让相邻床不贴在一起。 */
const BED_INSET = 3;
/** 气泡内边距与圆角（屏幕像素；气泡整体按 1/scale 缩放，所以它就是屏幕上看到的尺寸）。 */
const BUBBLE_PAD_X = NAME_PX * 0.6;
const BUBBLE_PAD_Y = NAME_PX * 0.35;
const BUBBLE_RADIUS = NAME_PX * 0.5;
/** 设备像素比上限：兼顾清晰与低端机性能。 */
const MAX_DPR = 2;

export interface WorldHandle {
  destroy(): void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function modeOf(state: ClientState): 'day' | 'night' {
  return isDaytime(state.hall?.timezone ?? 'UTC', Date.now()) ? 'day' : 'night';
}

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

/** 还有没到期的表情：显示期内要持续重画，到期后这个条件自然变假（不会长期占 CPU）。 */
function hasVisibleEmote(state: ClientState): boolean {
  const now = Date.now();
  for (const emote of state.emotes.values()) if (emote.expiresAt > now) return true;
  return false;
}

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

export async function createWorld(host: HTMLElement, handlers: WorldHandlers): Promise<WorldHandle> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: palette(modeOf(getState())).background,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    autoDensity: true,
  });
  app.canvas.classList.add('world-canvas');
  host.appendChild(app.canvas);

  const world = new Container();
  const floor = new Graphics();
  const props = new Graphics();
  const bedTiers: Record<BedOutline['tier'], Graphics> = {
    claimed: new Graphics(),
    trace: new Graphics(),
    line: new Graphics(),
  };
  /** 无主空床单独一层：要画淡填充 + 虚线，画法与实线床位不同 */
  const unownedBeds = new Graphics();
  const people = new Container();
  people.sortableChildren = true;
  world.addChild(floor, props, unownedBeds, bedTiers.claimed, bedTiers.trace, bedTiers.line, people);
  app.stage.addChild(world);

  const fontFamily = cssVar('--font-body', 'ui-sans-serif, system-ui, sans-serif');
  const camera = { x: 0, y: 0, scale: 1 };
  /** 上一次 `resize` 时的视口尺寸：尺寸变化的处理要保持视野中心的相对位置，所以要知道旧的是多大 */
  let screenSize = { width: app.screen.width, height: app.screen.height };
  let scene: SceneIndex | null = null;
  let loadedGuid: string | undefined;
  let dirty = true;
  /** 上一帧重画用的昼夜：空厅里没人走动时也要察觉到 06:00 / 18:00 的翻档（见 ticker） */
  let paintedMode: 'day' | 'night' = modeOf(getState());
  /** 上一次看到的连接状态：断线后重连要重新对准我的床 */
  let wasConnected = false;
  /** 上一帧人物的格坐标（命中判定用；1 帧延迟可接受） */
  let spots: PersonSpot[] = [];
  let background = palette(modeOf(getState())).background;
  /** 上一帧的床位画法签名（见 `drawBeds` 的为什么跳过重建） */
  let bedSignature = '';
  /** 上一帧的场景本体画法签名（见 `drawSceneBody` 的为什么跳过重建） */
  let sceneBodySignature = '';

  const markDirty = (): void => {
    dirty = true;
  };

  function applyCamera(): void {
    // 夹取放在这里：拖动、缩放、跟随、回中、旋屏都经过 `applyCamera`，一处夹住就不会漏掉某条路径
    if (scene) {
      const clamped = clampCamera({
        x: camera.x,
        y: camera.y,
        scale: camera.scale,
        viewport: app.screen,
        scene: { width: scene.widthPx, height: scene.heightPx },
      });
      camera.x = clamped.x;
      camera.y = clamped.y;
    }
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
  }

  /** 默认缩放（见 `docs/ui/DESIGN.md`「世界相机」）：夹在捏合区间内，巨型屏幕上不至于把一格放大到几屏。 */
  function baseScale(index: SceneIndex): number {
    const scale = defaultScale({
      viewport: app.screen,
      scene: { width: index.widthPx, height: index.heightPx },
    });
    return clamp(scale, MIN_SCALE, MAX_SCALE);
  }

  /**
   * 初始视野：默认缩放 + 对准我的床（还没有床时对准自己）。
   * 不再整厅居中：手机上整厅 fit≈0.35，一进厅就看得见整个厅等于谁都看不清。
   */
  function alignCamera(state: ClientState): void {
    if (!scene) return;
    camera.scale = baseScale(scene);
    const focus = focusPoint(state);
    if (focus) {
      const target = cameraFor({
        scale: camera.scale,
        focus,
        viewport: app.screen,
        scene: { width: scene.widthPx, height: scene.heightPx },
      });
      camera.x = target.x;
      camera.y = target.y;
    } else {
      // 连自己都还不知道在哪：退回整厅居中（视野里总得有点东西）
      camera.x = (app.screen.width - scene.widthPx * camera.scale) / 2;
      camera.y = (app.screen.height - scene.heightPx * camera.scale) / 2;
    }
    applyCamera();
    markDirty();
  }

  /** 自己所在的世界像素位置（走动时按插值、躺着时就是那张床）。 */
  function selfPoint(state: ClientState): { x: number; y: number } | undefined {
    const me = state.me;
    if (!me) return undefined;
    const serverNow = Date.now() + state.clockOffsetMs - INTERPOLATION_DELAY_MS;
    const grid = me.state === 'roaming' ? roamGrid(me, state, serverNow) : bedGrid(me.bedNo);
    return grid ? { x: grid.x * TILE, y: grid.y * TILE } : undefined;
  }

  /** 初始对准的目标：我的床优先（我知道我的床在哪），还没有床时才对准自己。 */
  function focusPoint(state: ClientState): { x: number; y: number } | undefined {
    const bedNo = state.me?.ownedBedNo;
    if (bedNo !== undefined) {
      const grid = bedGrid(bedNo);
      if (grid) return { x: grid.x * TILE, y: grid.y * TILE };
    }
    return selfPoint(state);
  }

  /**
   * 温和跟随：自己**正在走动**且已走出屏幕中央区时，每帧往自己靠固定比例。
   * 停下即停、看别人走动镜头不动；用户拖拽 / 捏合期间完全不动——否则手指和相机抢方向盘。
   */
  function followSelf(state: ClientState, serverNow: number): void {
    const me = state.me;
    // 「在动」看插值窗口开没开，不看 `motion` 里有没有条目（走完的残留条目会让人一直被判在动）
    if (!me || me.state !== 'roaming' || !isInterpolating(state.motion.get(me.id), serverNow) || pointers.size > 0 || !scene)
      return;
    const grid = roamGrid(me, state, serverNow);
    if (!grid) return;
    const focus = { x: grid.x * TILE, y: grid.y * TILE };
    const onScreen = { x: focus.x * camera.scale + camera.x, y: focus.y * camera.scale + camera.y };
    if (!outsideCenterBand({ point: onScreen, viewport: app.screen })) return;

    const target = cameraFor({
      scale: camera.scale,
      focus,
      viewport: app.screen,
      scene: { width: scene.widthPx, height: scene.heightPx },
    });
    camera.x += (target.x - camera.x) * FOLLOW_EASE;
    camera.y += (target.y - camera.y) * FOLLOW_EASE;
    applyCamera();
  }

  /** 点自己 = 相机居中自己（`dispatchTap` 的 `recenter`）。 */
  function centerOnSelf(state: ClientState): void {
    if (!scene) return;
    const focus = selfPoint(state);
    if (!focus) return;
    const target = cameraFor({
      scale: camera.scale,
      focus,
      viewport: app.screen,
      scene: { width: scene.widthPx, height: scene.heightPx },
    });
    camera.x = target.x;
    camera.y = target.y;
    applyCamera();
    markDirty();
  }

  function zoomAt(x: number, y: number, factor: number): void {
    const next = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
    const k = next / camera.scale;
    camera.x = x - (x - camera.x) * k;
    camera.y = y - (y - camera.y) * k;
    camera.scale = next;
    applyCamera();
    markDirty();
  }

  /** 场景本体：地板 + 墙 + 零星道具。床的轮廓不走这里（它由归属与占用派生）。 */
  function drawSceneBody(pal: WorldPalette, mode: 'day' | 'night'): void {
    if (!scene) return;
    // 墙内沿的线宽与灯的光晕半径都按 `camera.scale` 给，所以缩放也必须进重建条件：
    // 否则捏合之后线宽一直沿用旧缩放，看起来偏粗（昼夜同理，它决定取哪套色）。
    const signature = `${mode}|${camera.scale}`;
    if (signature === sceneBodySignature) return;
    sceneBodySignature = signature;

    floor.clear();
    // 地板铺满整个场景作底；墙环带 = 整块铺 `band` 再把 `inner` 盖回地板色（两次矩形填充，不用孔洞 API）。
    floor.rect(0, 0, scene.widthPx, scene.heightPx).fill(pal.background);

    const wall = wallGeometry({
      width: scene.scene.width,
      height: scene.scene.height,
      blocked: scene.scene.blocked,
    });
    if (wall.band.width > 0 && wall.band.height > 0) {
      floor.rect(wall.band.x, wall.band.y, wall.band.width, wall.band.height).fill(pal.surface);
      floor.rect(wall.inner.x, wall.inner.y, wall.inner.width, wall.inner.height).fill(pal.background);
      floor
        .rect(wall.inner.x, wall.inner.y, wall.inner.width, wall.inner.height)
        .stroke({ width: LINE_PX / camera.scale, color: pal.structure });
    }

    props.clear();
    const dot = markerRadius(camera.scale, TILE);
    for (const sprite of scene.scene.decorates) {
      const x = sprite.x * TILE + TILE / 2;
      const y = sprite.y * TILE + TILE / 2;
      if (sprite.sprite === 'lamp') {
        // 床头灯的暖黄光晕：全系统唯一允许出现的暖色
        props.circle(x, y, dot * 0.6).fill({ color: pal.marker, alpha: 0.5 });
        props.circle(x, y, TILE * 0.3).stroke({ width: LINE_PX / camera.scale, color: pal.marker, alpha: 0.6 });
      } else {
        props.rect(x - TILE * 0.3, y - TILE * 0.3, TILE * 0.6, TILE * 0.6).stroke({
          width: LINE_PX / camera.scale,
          color: pal.structure,
        });
      }
    }
  }

  /**
   * 床位轮廓：占用走颜色、归属走线型（真值表见 `docs/ui/DESIGN.md`）。
   * 无主空床画 `claimed` 虚线 + 淡填充；**命中与画法无关**——无主床照样可点、可躺。
   */
  function drawBeds(state: ClientState, pal: WorldPalette, mode: 'day' | 'night'): void {
    if (!scene) return;

    const occupants = occupantsOf(state);
    const beds = scene.scene.beds.map((bed) => ({
      bed,
      outline: bedOutline({ owned: state.ownedBeds.has(bed.bedNo), occupant: occupants.get(bed.bedNo) }),
    }));
    const signature = bedPaintSignature({ mode, scale: camera.scale, outlines: beds.map(({ outline }) => outline) });
    // 「有人在走动」时每帧都会重画，而一帧要重建 256 个床位图形（含虚线分段到边）；签名不变就整段跳过。
    // 线宽与虚线长度按屏幕像素给，所以缩放与昼夜（描边色）都必须进签名。
    if (signature === bedSignature) return;
    bedSignature = signature;

    unownedBeds.clear();
    for (const graphics of Object.values(bedTiers)) graphics.clear();

    const width = LINE_PX / camera.scale;
    const size = TILE - BED_INSET * 2;
    for (const { bed, outline } of beds) {
      const x = bed.x * TILE + BED_INSET;
      const y = bed.y * TILE + BED_INSET;
      if (!outline.dashed) {
        bedTiers[outline.tier].rect(x, y, size, size).stroke({ width, color: pal.bed[outline.tier] });
        continue;
      }
      unownedBeds.rect(x, y, size, size).fill({ color: pal.surface });
      for (const segment of bedDashSegments({ x, y, size, dash: DASH_PX / camera.scale, gap: DASH_GAP_PX / camera.scale })) {
        unownedBeds.moveTo(segment.x1, segment.y1).lineTo(segment.x2, segment.y2);
      }
      unownedBeds.stroke({ width, color: pal.bed.claimed });
    }
  }

  /** 暖灯标记：自己的小人脚下 + 自己的床位角落共用同一个概念。 */
  function drawMarker(graphics: Graphics, x: number, y: number, pal: WorldPalette): void {
    graphics.circle(x, y, markerRadius(camera.scale, TILE)).fill({ color: pal.marker });
  }

  function drawPeople(state: ClientState, pal: WorldPalette, serverNow: number): void {
    people.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!scene) return;

    const width = LINE_PX / camera.scale;
    const head = TILE * 0.26;
    const persons: Person[] = [...state.people.values()];
    if (state.me) persons.push(state.me);
    const now = Date.now();
    const nextSpots: PersonSpot[] = [];

    for (const person of persons) {
      const grid = person.state === 'roaming' ? roamGrid(person, state, serverNow) : bedGrid(person.bedNo);
      if (!grid) continue;

      // 命中判定用的格坐标（**含自己**：点自己 = 相机居中，服务端不参与）
      nextSpots.push({ id: person.id, x: grid.x, y: grid.y });

      const node = new Container();
      node.position.set(grid.x * TILE, grid.y * TILE);
      node.zIndex = grid.y * TILE; // 按 y 排序解决遮挡
      node.alpha = personAlpha(person.state); // 睡痕整体更暗（不能只改轮廓与名字）
      people.addChild(node);

      const body = new Graphics();
      if (person.state === 'roaming') {
        // 圆头 + 点眼
        body.circle(0, 0, head).stroke({ width, color: pal.ink });
        body.circle(-head * 0.35, -head * 0.15, width).fill({ color: pal.ink });
        body.circle(head * 0.35, -head * 0.15, width).fill({ color: pal.ink });
      } else {
        // 躺下：被子盖住身体，只露脸（睡着时眼睛是两条线）
        body
          .roundRect(-TILE * 0.34, -TILE * 0.3, TILE * 0.68, TILE * 0.62, TILE * 0.12)
          .stroke({ width, color: pal.ink });
        body.circle(0, -TILE * 0.3, head * 0.8).stroke({ width, color: pal.ink });
        if (person.state === 'asleep') {
          body
            .moveTo(-head * 0.5, -TILE * 0.3)
            .lineTo(-head * 0.15, -TILE * 0.3)
            .moveTo(head * 0.15, -TILE * 0.3)
            .lineTo(head * 0.5, -TILE * 0.3)
            .stroke({ width, color: pal.ink });
        } else {
          body.circle(-head * 0.3, -TILE * 0.32, width).fill({ color: pal.ink });
          body.circle(head * 0.3, -TILE * 0.32, width).fill({ color: pal.ink });
        }
      }
      node.addChild(body);

      const selected = person.id === state.selectedId;
      // 名字只出现在有人的床上，且自己不画（我知道我是谁）；
      // 选中时把那个名字**改成气泡样式**（不叠第二个），漫游者则只在自己被选中时才有
      if (shouldDrawName(person, state.me?.id)) {
        if (selected) drawBubble(node, person.name, -TILE * 0.62, pal);
        else {
          const label = new Text({
            text: person.name,
            style: {
              fontFamily,
              fontSize: NAME_PX,
              fill: person.state === 'trace' ? pal.bed.trace : pal.ink,
            },
          });
          label.anchor.set(0.5, 1);
          label.position.set(0, -TILE * 0.62);
          label.scale.set(1 / camera.scale); // 名字不随缩放变大变小
          node.addChild(label);
        }
      } else if (selected) {
        drawBubble(node, person.name, -TILE * 0.62, pal);
      }

      // 表情气泡：比名字再高一点；过期靠渲染时比较 `expiresAt`，不挂定时器
      const emote = state.emotes.get(person.id);
      if (emote && emote.expiresAt > now) {
        drawBubble(node, EMOTE_LABELS[emote.emoteId], -TILE * 0.98, pal);
      }

      if (state.me && person.id === state.me.id && person.state === 'roaming') {
        drawMarker(body, 0, head * 1.6, pal); // 自己的小人脚下
      }
    }

    spots = nextSpots;

    // 我的床位角落（我在厅里走动时也要找得到它）
    const myBed = state.me?.ownedBedNo;
    if (myBed !== undefined) {
      const grid = bedGrid(myBed);
      if (grid) {
        const marker = new Graphics();
        marker.zIndex = grid.y * TILE + 1;
        drawMarker(marker, grid.x * TILE + TILE * 0.32, grid.y * TILE + TILE * 0.32, pal);
        people.addChild(marker);
      }
    }
  }

  /** 名字 / 表情气泡底和无主床淡填充是同一个浮出色（令牌 `secondary` / `day-surface`）。
   * 压在同款文字下面；**整体按 1/scale 缩放**，所以不随镜头缩放变大变小。
   */
  function drawBubble(node: Container, text: string, y: number, pal: WorldPalette): void {
    const label = new Text({
      text,
      style: { fontFamily, fontSize: NAME_PX, fill: pal.ink },
    });
    label.anchor.set(0.5, 1);

    const bubble = new Graphics();
    bubble
      .roundRect(
        -label.width / 2 - BUBBLE_PAD_X,
        -label.height - BUBBLE_PAD_Y,
        label.width + BUBBLE_PAD_X * 2,
        label.height + BUBBLE_PAD_Y * 2,
        BUBBLE_RADIUS,
      )
      .fill({ color: pal.surface });

    const group = new Container();
    group.position.set(0, y);
    group.scale.set(1 / camera.scale);
    group.addChild(bubble, label);
    node.addChild(group);
  }

  /** 床号的格坐标（取格中心：+0.5）。 */
  function bedGrid(bedNo: number): { x: number; y: number } | undefined {
    const tile = scene?.bedAt(bedNo);
    return tile ? { x: tile.x + 0.5, y: tile.y + 0.5 } : undefined;
  }

  /** 漫游者的格坐标（有插值窗口就按服务端时间插值，否则用权威坐标）。 */
  function roamGrid(person: Person, state: ClientState, serverNow: number): { x: number; y: number } | undefined {
    if (person.state !== 'roaming') return undefined;
    const motion = state.motion.get(person.id);
    const tile = motion ? positionAt(motion, serverNow) : { x: person.x, y: person.y };
    return { x: tile.x + 0.5, y: tile.y + 0.5 };
  }

  /** 屏幕坐标 → 格坐标（**浮点值**，轻点的命中判定用）。 */
  function gridAt(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - camera.x) / camera.scale / TILE,
      y: (screenY - camera.y) / camera.scale / TILE,
    };
  }

  /** 轻点：命中优先级是纯函数给的（人 > 空床 > 地面），这里只负责查表和分派。 */
  function dispatchTap(screenX: number, screenY: number): void {
    if (!scene) return;
    const point = gridAt(screenX, screenY);
    const tile = { x: Math.floor(point.x), y: Math.floor(point.y) };
    const bedNo = scene.bedNoAt(tile.x, tile.y);
    const state = getState();

    const target = tapTargetFor({
      point,
      spots,
      selfId: state.me?.id,
      residentId: bedNo !== undefined ? residentOf(state, bedNo) : undefined,
      bedNo,
      walkable: scene.isWalkable(tile.x, tile.y),
    });

    switch (target.kind) {
      case 'select':
        handlers.onSelect(target.id);
        return;
      case 'lie':
        handlers.onLie(target.bedNo);
        return;
      case 'walk':
        // 点地面 = 取消选中 + 走过去（选中态与走动的分工由纯函数给定）
        handlers.onClearSelection();
        handlers.onWalk({ x: target.x, y: target.y });
        return;
      case 'recenter':
        centerOnSelf(state);
        return;
      default:
        return;
    }
  }

  function renderFrame(state: ClientState): void {
    const serverNow = Date.now() + state.clockOffsetMs - INTERPOLATION_DELAY_MS;
    if (state.sceneGuid && state.sceneGuid !== loadedGuid) {
      loadedGuid = state.sceneGuid;
      void loadSceneIndex(state.sceneGuid)
        .then((index) => {
          scene = index;
          bedSignature = ''; // 换了场景，上一帧的签名不再可比
          sceneBodySignature = '';
          const mode = modeOf(getState());
          const pal = palette(mode);
          background = pal.background;
          app.renderer.background.color = background;
          drawSceneBody(pal, mode);
          alignCamera(getState());
          markDirty();
        })
        .catch(() => {
          loadedGuid = undefined; // 下次有状态变化再试
        });
    }

    // 断线后重连：与进厅同一套规则，重新对准我的床（`wasConnected` 只在真实翻转时才为真）
    if (state.connected && !wasConnected && scene) alignCamera(state);
    wasConnected = state.connected;

    const mode = modeOf(state);
    paintedMode = mode;
    const pal = palette(mode);
    if (pal.background !== background) {
      background = pal.background;
      app.renderer.background.color = background;
    }
    // 先把相机推到这一帧该在的位置，再画：否则跟随的镜头与人在同一帧里错开一帧
    followSelf(state, serverNow);
    // 每帧都调（内部按签名守卫跳过）：缩放变了而底色没变时，墙内沿线宽与灯的光晕也要跟着重画
    drawSceneBody(pal, mode);
    drawBeds(state, pal, mode);
    drawPeople(state, pal, serverNow);
  }

  /**
   * 表情要在显示期内持续重画，而且**消失的那一帧也得重画一次**——
   * 否则「最后画过气泡的那帧」会留在画布上（没人走动时 ticker 就不再渲染了）。
   */
  let emoteShown = false;
  /** 上一次问过昼夜的整秒；-1 表示还没问过。
   * `modeOf` 每次要造一个 `Intl` 格式化器（约几十微秒），所以按秒缓存：翻档晚 ≤1 秒看不出来。 */
  let modeSecond = -1;
  app.ticker.add(() => {
    const current = getState();
    const emoteVisible = hasVisibleEmote(current);
    // 昼夜翻档也是结构性变化（整套配色），但空厅里没人走动时这里就不再重画了，跨 06:00 / 18:00 会停在旧配色。
    // 每帧只做一次整数比较，重算频率封在每秒一次。
    const second = Math.floor(Date.now() / 1000);
    if (second !== modeSecond) {
      modeSecond = second;
      if (modeOf(current) !== paintedMode) dirty = true;
    }
    // 有人在动就每帧重画（插值走 ticker，不进 React 的渲染循环）；
    // 走完的人还留着条目，按窗口判定才不会一直重画
    const serverNow = Date.now() + current.clockOffsetMs - INTERPOLATION_DELAY_MS;
    if (anyInterpolating(current.motion.values(), serverNow) || emoteVisible || emoteShown) dirty = true;
    emoteShown = emoteVisible;
    if (!dirty) return;
    dirty = false;
    renderFrame(current);
  });

  const unsubscribe = subscribe(markDirty);

  // ——— 相机输入：滚轮缩放、双指捏合缩放、拖动平移（手机上点地面是走动意图，见后续卡片） ———
  // 指针状态放在 ticker 之前：跟随要据此判断「用户正在操作相机」，此时相机必须完全不动
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let tapStart: { x: number; y: number; at: number } | null = null;

  const localPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = app.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = { x: event.offsetX, y: event.offsetY };
    zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.0015));
  };

  const onPointerDown = (event: PointerEvent): void => {
    const point = localPoint(event);
    if (pointers.size === 0) tapStart = { x: point.x, y: point.y, at: Date.now() };
    pointers.set(event.pointerId, point);
    app.canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / pinchDistance);
      }
      pinchDistance = distance;
      return;
    }

    camera.x += point.x - previous.x;
    camera.y += point.y - previous.y;
    applyCamera();
  };

  const onPointerUp = (event: PointerEvent): void => {
    const point = localPoint(event);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (app.canvas.hasPointerCapture(event.pointerId)) app.canvas.releasePointerCapture(event.pointerId);

    // 轻点（未拖动、时间短）才是一次意图；拖拽是平移镜头
    if (tapStart && pointers.size === 0) {
      const moved = Math.hypot(point.x - tapStart.x, point.y - tapStart.y);
      if (moved < 8 && Date.now() - tapStart.at < 350) dispatchTap(point.x, point.y);
    }
    tapStart = null;
  };

  /**
   * 尺寸变化（旋屏 / 地址栏收放）：按默认缩放重算，并保持视野中心的相对位置。
   * shortcut: 重算会把用户手动缩放重置为默认值。等「手动缩放要跨旋屏保留」出现真实需求方时，
   * 改成只换视口、保留 `camera.scale`（那时也得重算能拖的范围）。
   */
  const onResize = (): void => {
    const previous = screenSize;
    screenSize = { width: app.screen.width, height: app.screen.height };
    if (!scene || previous.width === 0 || previous.height === 0) return;

    // 旧视野中心在场景里的相对位置（0–1）：尺寸变了也钉在同一个地方，旋转屏幕不会错位
    const centerX = (previous.width / 2 - camera.x) / (camera.scale * scene.widthPx);
    const centerY = (previous.height / 2 - camera.y) / (camera.scale * scene.heightPx);
    camera.scale = baseScale(scene);
    camera.x = app.screen.width / 2 - centerX * camera.scale * scene.widthPx;
    camera.y = app.screen.height / 2 - centerY * camera.scale * scene.heightPx;
    applyCamera();
    markDirty();
  };

  app.renderer.on('resize', onResize);
  app.canvas.addEventListener('wheel', onWheel, { passive: false });
  app.canvas.addEventListener('pointerdown', onPointerDown);
  app.canvas.addEventListener('pointermove', onPointerMove);
  app.canvas.addEventListener('pointerup', onPointerUp);
  app.canvas.addEventListener('pointercancel', onPointerUp);

  return {
    destroy(): void {
      unsubscribe();
      app.renderer.off('resize', onResize);
      app.canvas.removeEventListener('wheel', onWheel);
      app.canvas.removeEventListener('pointerdown', onPointerDown);
      app.canvas.removeEventListener('pointermove', onPointerMove);
      app.canvas.removeEventListener('pointerup', onPointerUp);
      app.canvas.removeEventListener('pointercancel', onPointerUp);
      app.destroy(true, { children: true });
    },
  };
}
