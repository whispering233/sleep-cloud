import { Application, Container, Graphics, Text } from 'pixi.js';

import type { Person, PersonState } from '../../shared/protocol';
import { getState, subscribe } from '../store';
import type { ClientState } from '../store';
import { palette } from './palette';
import type { WorldPalette } from './palette';
import { bedOutline, isDaytime, markerRadius, personAlpha, shouldDrawName } from './rules';
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
/** 线稿宽度按屏幕像素给：缩放时视觉粗细不变（等宽线稿）。 */
const LINE_PX = 1.5;
/** 名字按屏幕像素给：不随缩放变大变小。 */
const NAME_PX = 12;
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

export async function createWorld(host: HTMLElement): Promise<WorldHandle> {
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
  const bedTiers: Record<'claimed' | 'trace' | 'line', Graphics> = {
    claimed: new Graphics(),
    trace: new Graphics(),
    line: new Graphics(),
  };
  const people = new Container();
  people.sortableChildren = true;
  world.addChild(floor, props, bedTiers.claimed, bedTiers.trace, bedTiers.line, people);
  app.stage.addChild(world);

  const fontFamily = cssVar('--font-body', 'ui-sans-serif, system-ui, sans-serif');
  const camera = { x: 0, y: 0, scale: 1 };
  let scene: SceneIndex | null = null;
  let loadedGuid: string | undefined;
  let dirty = true;
  let background = palette(modeOf(getState())).background;

  const markDirty = (): void => {
    dirty = true;
  };

  function applyCamera(): void {
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
  }

  /** 初始视野：整间厅刚好放得下。 */
  function fitCamera(): void {
    if (!scene) return;
    const { width, height } = app.screen;
    const scale = clamp(Math.min(width / scene.widthPx, height / scene.heightPx), MIN_SCALE, 1.2);
    camera.scale = scale;
    camera.x = (width - scene.widthPx * scale) / 2;
    camera.y = (height - scene.heightPx * scale) / 2;
    applyCamera();
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
  function drawSceneBody(pal: WorldPalette): void {
    if (!scene) return;
    floor.clear();
    floor
      .rect(0, 0, scene.widthPx, scene.heightPx)
      .fill(pal.background)
      .rect(0, 0, scene.widthPx, scene.heightPx)
      .stroke({ width: 3, color: pal.structure });

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

  /** 轮廓梯次：床上有人 > 睡痕 > 有主空床 > 不画。无主的床**不画**，但照样可点（命中区域与轮廓无关）。 */
  function drawBeds(state: ClientState, pal: WorldPalette): void {
    for (const graphics of Object.values(bedTiers)) graphics.clear();
    if (!scene) return;

    const width = LINE_PX / camera.scale;
    const occupants = occupantsOf(state);
    for (const bed of scene.scene.beds) {
      const tier = bedOutline({ owned: state.ownedBeds.has(bed.bedNo), occupant: occupants.get(bed.bedNo) });
      if (!tier) continue;
      bedTiers[tier]
        .roundRect(bed.x * TILE + 3, bed.y * TILE + 3, TILE - 6, TILE - 6, TILE * 0.15)
        .stroke({ width, color: pal.bed[tier] });
    }
  }

  /** 暖灯标记：自己的小人脚下 + 自己的床位角落共用同一个概念。 */
  function drawMarker(graphics: Graphics, x: number, y: number, pal: WorldPalette): void {
    graphics.circle(x, y, markerRadius(camera.scale, TILE)).fill({ color: pal.marker });
  }

  function drawPeople(state: ClientState, pal: WorldPalette): void {
    people.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!scene) return;

    const width = LINE_PX / camera.scale;
    const head = TILE * 0.26;
    const persons: Person[] = [...state.people.values()];
    if (state.me) persons.push(state.me);

    for (const person of persons) {
      const spot =
        person.state === 'roaming'
          ? { x: (person.x + 0.5) * TILE, y: (person.y + 0.5) * TILE }
          : bedSpot(person.bedNo);
      if (!spot) continue;

      const node = new Container();
      node.position.set(spot.x, spot.y);
      node.zIndex = spot.y; // 按 y 排序解决遮挡
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

      // 名字只出现在有人的床上，且自己不画（我知道我是谁）
      if (shouldDrawName(person, state.me?.id)) {
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

      if (state.me && person.id === state.me.id && person.state === 'roaming') {
        drawMarker(body, 0, head * 1.6, pal); // 自己的小人脚下
      }
    }

    // 我的床位角落（我在厅里走动时也要找得到它）
    const myBed = state.me?.ownedBedNo;
    if (myBed !== undefined) {
      const spot = bedSpot(myBed);
      if (spot) {
        const marker = new Graphics();
        marker.zIndex = spot.y + 1;
        drawMarker(marker, spot.x + TILE * 0.32, spot.y + TILE * 0.32, pal);
        people.addChild(marker);
      }
    }
  }

  function bedSpot(bedNo: number): { x: number; y: number } | undefined {
    const tile = scene?.bedAt(bedNo);
    return tile ? { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE } : undefined;
  }

  function renderFrame(state: ClientState): void {
    if (state.sceneGuid && state.sceneGuid !== loadedGuid) {
      loadedGuid = state.sceneGuid;
      void loadSceneIndex(state.sceneGuid)
        .then((index) => {
          scene = index;
          const pal = palette(modeOf(getState()));
          background = pal.background;
          app.renderer.background.color = background;
          drawSceneBody(pal);
          fitCamera();
          markDirty();
        })
        .catch(() => {
          loadedGuid = undefined; // 下次有状态变化再试
        });
    }

    const pal = palette(modeOf(state));
    if (pal.background !== background) {
      background = pal.background;
      app.renderer.background.color = background;
      drawSceneBody(pal);
    }
    drawBeds(state, pal);
    drawPeople(state, pal);
  }

  app.ticker.add(() => {
    if (!dirty) return;
    dirty = false;
    renderFrame(getState());
  });

  const unsubscribe = subscribe(markDirty);

  // ——— 相机输入：滚轮缩放、双指捏合缩放、拖动平移（手机上点地面是走动意图，见后续卡片） ———
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

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
    pointers.set(event.pointerId, localPoint(event));
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
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (app.canvas.hasPointerCapture(event.pointerId)) app.canvas.releasePointerCapture(event.pointerId);
  };

  app.canvas.addEventListener('wheel', onWheel, { passive: false });
  app.canvas.addEventListener('pointerdown', onPointerDown);
  app.canvas.addEventListener('pointermove', onPointerMove);
  app.canvas.addEventListener('pointerup', onPointerUp);
  app.canvas.addEventListener('pointercancel', onPointerUp);

  return {
    destroy(): void {
      unsubscribe();
      app.canvas.removeEventListener('wheel', onWheel);
      app.canvas.removeEventListener('pointerdown', onPointerDown);
      app.canvas.removeEventListener('pointermove', onPointerMove);
      app.canvas.removeEventListener('pointerup', onPointerUp);
      app.canvas.removeEventListener('pointercancel', onPointerUp);
      app.destroy(true, { children: true });
    },
  };
}
