import * as Phaser from 'phaser';

import { BED_H, BED_W } from '../../shared/constants';
import type { PersonState } from '../../shared/protocol';
import tokens from '../styles/tokens.json';
import { bedDashSegments, bedPaintSignature, personAlpha } from './rules';
import type { BedOutline } from './rules';

/**
 * 「一个东西长什么样」：色值、几何常量、床与小人的画法。
 * 「该画哪些、画在哪」在 `world.ts`（可视窗口 + 对象池），这样占位图形的细节不掺进相机与输入。
 *
 * 色值来自 `npm run tokens` 从 `docs/ui/DESIGN.md` 导出的 JSON：**JS 里不写死色值**。
 * 几何来自 `src/shared/constants.ts`（与厅服务同一份）：床是 61×100 世界像素。
 */
const theme = tokens.theme.extend;
const colors = theme.colors as Record<string, string>;

function token(name: string): string {
  const value = colors[name];
  if (!value) throw new Error(`设计令牌里没有 ${name}（先跑 npm run tokens）`);
  return value;
}

/** `Graphics` 吃数字色值，`Text` 吃 CSS 串：同一个令牌取两种形式，不写两份色号。 */
function color(name: string): number {
  return Number.parseInt(token(name).slice(1), 16);
}

const FONT_FAMILY = (theme.fontFamily.body as string[])[0];
/** 床号与名字都是 `caption` 档，且**不随镜头变化**（没有缩放，所以世界像素就是 CSS 像素）。 */
const LABEL_PX = 12;
/** 线稿等宽：小人、床、墙用同一线宽（见 `docs/ui/DESIGN.md` Shapes）。 */
export const LINE_WIDTH = 1.5;
/** 床位轮廓相对床的内缩（世界像素）：留出缝隙，同时让相邻床不贴在一起。 */
const BED_INSET = 2;
const DASH_PX = 6;
const DASH_GAP_PX = 4;
/**
 * 暖灯标记的半径：1 世界像素 = 1 CSS 像素，所以 5 就是它在屏幕上的尺寸
 * （`marker-own` 有最小尺寸下限，不得消隐，否则找不到我的床）。
 */
export const MARKER_RADIUS = 5;
/** 气泡内边距与「自己的小人脚下」标记、名字与表情的位置（相对小人原点）。 */
const BUBBLE_PAD = 4;
const NAME_Y = -BED_H * 0.34;
const EMOTE_Y = -BED_H * 0.56;
const FOOT_MARKER_Y = BED_H * 0.24;

export const COLORS = {
  floor: color('primary'),
  surface: color('secondary'),
  line: color('line'),
  marker: color('tertiary'),
} as const;

const BED_PAINT: Record<BedOutline['tier'], number> = {
  line: color('line'),
  trace: color('trace'),
  claimed: color('claimed'),
};
const INK = color('neutral');
const INK_CSS = token('neutral');
const MUTED_CSS = token('neutral-muted');
const TRACE_CSS = token('trace');
const SURFACE_CSS = token('secondary');
/** 名字平时没有底板；`Text` 清掉底色只能给一个透明的填充色。 */
const NO_BACKGROUND = 'rgba(0, 0, 0, 0)';

const BUBBLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_FAMILY,
  fontSize: LABEL_PX,
  color: INK_CSS,
  backgroundColor: SURFACE_CSS,
  padding: { x: BUBBLE_PAD, y: BUBBLE_PAD },
};

/** 一张床在世界里的矩形（左上角锚点，与服务端 `layout.positionOf` 同一个坐标）。 */
export interface BedPlacement {
  bedNo: number;
  x: number;
  y: number;
}

export interface BedView {
  readonly container: Phaser.GameObjects.Container;
  readonly shape: Phaser.GameObjects.Graphics;
  readonly number: Phaser.GameObjects.Text;
  readonly marker: Phaser.GameObjects.Graphics;
  /** 当前绑定的床号（-1 = 池里闲置）：床号文字只在换绑时重设 */
  bedNo: number;
  /** 上一次画法签名（见 `rules.bedPaintSignature`）：不变就跳过重建图形 */
  paint: string;
}

export function createBedView(scene: Phaser.Scene): BedView {
  const shape = scene.add.graphics();
  const marker = scene.add.graphics();
  marker.fillStyle(COLORS.marker, 1);
  marker.fillCircle(BED_W - MARKER_RADIUS - 2, MARKER_RADIUS + 2, MARKER_RADIUS);
  marker.setVisible(false);
  const number = scene.add
    .text(BED_INSET + 1, BED_H - BED_INSET - 1, '', {
      fontFamily: FONT_FAMILY,
      fontSize: LABEL_PX,
      color: MUTED_CSS,
    })
    .setOrigin(0, 1);
  const container = scene.add.container(0, 0, [shape, marker, number]).setVisible(false);
  return { container, shape, number, marker, bedNo: -1, paint: '' };
}

/** 把池里的一个视图绑到某张床：位置、床号、画法（画法按签名守卫，逐帧调用不重建图形）。 */
export function placeBed(view: BedView, bed: BedPlacement, outline: BedOutline, mine: boolean): void {
  view.container.setVisible(true).setPosition(bed.x, bed.y);
  if (view.bedNo !== bed.bedNo) {
    view.bedNo = bed.bedNo;
    view.number.setText(String(bed.bedNo));
  }
  const signature = bedPaintSignature({ outline, mine });
  if (signature === view.paint) return;
  view.paint = signature;
  paintBed(view, outline);
  view.marker.setVisible(mine);
}

/** 没绑到床的视图藏起来（对象留在池里，下一帧可能又被用上）。 */
export function hideBed(view: BedView): void {
  view.bedNo = -1;
  view.container.setVisible(false);
}

/**
 * 床位轮廓：占用走梯次颜色、归属走线型（真值表见 `docs/ui/DESIGN.md` Components 节）。
 * 无主空床画 `claimed` 虚线 + 淡填充；**命中与画法无关**——无主床照样可点、可躺。
 */
function paintBed(view: BedView, outline: BedOutline): void {
  const shape = view.shape;
  const width = BED_W - BED_INSET * 2;
  const height = BED_H - BED_INSET * 2;
  shape.clear();
  if (!outline.dashed) {
    shape.lineStyle(LINE_WIDTH, BED_PAINT[outline.tier], 1);
    shape.strokeRect(BED_INSET, BED_INSET, width, height);
    return;
  }
  shape.fillStyle(COLORS.surface, 1);
  shape.fillRect(BED_INSET, BED_INSET, width, height);
  shape.lineStyle(LINE_WIDTH, BED_PAINT.claimed, 1);
  for (const segment of bedDashSegments({
    x: BED_INSET,
    y: BED_INSET,
    width,
    height,
    dash: DASH_PX,
    gap: DASH_GAP_PX,
  })) {
    shape.beginPath();
    shape.moveTo(segment.x1, segment.y1);
    shape.lineTo(segment.x2, segment.y2);
    shape.strokePath();
  }
}

export interface PersonView {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly footMarker: Phaser.GameObjects.Graphics;
  readonly name: Phaser.GameObjects.Text;
  readonly emote: Phaser.GameObjects.Text;
  /** 上一次的身体画法签名（状态或归属变了才重画） */
  paint: string;
}

export function createPersonView(scene: Phaser.Scene): PersonView {
  const body = scene.add.graphics();
  const footMarker = scene.add.graphics();
  footMarker.fillStyle(COLORS.marker, 1);
  footMarker.fillCircle(0, FOOT_MARKER_Y, MARKER_RADIUS);
  footMarker.setVisible(false);
  const name = scene.add
    .text(0, NAME_Y, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: INK_CSS })
    .setOrigin(0.5, 1)
    .setVisible(false);
  const emote = scene.add.text(0, EMOTE_Y, '', BUBBLE_STYLE).setOrigin(0.5, 1).setVisible(false);
  const container = scene.add.container(0, 0, [body, footMarker, name, emote]);
  return { container, body, footMarker, name, emote, paint: '' };
}

/**
 * 小人：走动 / 躺下 / 睡着 / 睡痕靠**形状**区分（占位图形，贴图是后续卡片的事）。
 * 睡痕整张降不透明度——不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色。
 */
export function paintPerson(view: PersonView, state: PersonState, mine: boolean): void {
  const signature = `${state}|${mine}`;
  if (signature === view.paint) return;
  view.paint = signature;

  view.container.setAlpha(personAlpha(state));
  view.footMarker.setVisible(mine && state === 'roaming');

  const body = view.body;
  const head = BED_W * 0.23;
  const dot = LINE_WIDTH / 2;
  body.clear();
  body.lineStyle(LINE_WIDTH, INK, 1);
  body.fillStyle(INK, 1);

  if (state === 'roaming') {
    // 圆头 + 点眼
    body.strokeCircle(0, 0, head);
    body.fillCircle(-head * 0.35, -head * 0.15, dot);
    body.fillCircle(head * 0.35, -head * 0.15, dot);
    return;
  }

  // 躺下：被子盖住身体，只露脸（睡着时眼睛是两条线）
  body.strokeRoundedRect(-BED_W * 0.36, -BED_H * 0.2, BED_W * 0.72, BED_H * 0.42, BED_W * 0.12);
  body.strokeCircle(0, -BED_H * 0.2, head * 0.8);
  if (state === 'asleep') {
    body.beginPath();
    body.moveTo(-head * 0.5, -BED_H * 0.2);
    body.lineTo(-head * 0.15, -BED_H * 0.2);
    body.moveTo(head * 0.15, -BED_H * 0.2);
    body.lineTo(head * 0.5, -BED_H * 0.2);
    body.strokePath();
    return;
  }
  body.fillCircle(-head * 0.3, -BED_H * 0.22, dot);
  body.fillCircle(head * 0.3, -BED_H * 0.22, dot);
}

/** 名字：只在有人的床上、自己一律不画；选中时整条换成气泡样式（不叠第二个）。 */
export function setPersonName(view: PersonView, text: string, dim: boolean, bubble: boolean): void {
  view.name
    .setText(text)
    .setColor(dim ? TRACE_CSS : INK_CSS)
    .setBackgroundColor(bubble ? SURFACE_CSS : NO_BACKGROUND)
    .setPadding(bubble ? BUBBLE_PAD : 0)
    .setVisible(text !== '');
}

/** 表情气泡：比名字再高一点；过期由调用方比较 `expiresAt` 后传空串（**不挂定时器**）。 */
export function setPersonEmote(view: PersonView, text: string): void {
  view.emote.setText(text).setVisible(text !== '');
}