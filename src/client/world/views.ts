import * as Phaser from 'phaser';

import { ART_SCALE, BED_H, BED_W } from '../../shared/constants';
import type { Person } from '../../shared/protocol';
import tokens from '../styles/tokens.json';
import { personAlpha, personFrame } from './rules';
import type { BedLook } from './rules';

/**
 * 「一个东西长什么样」：色值、几何常量、床与小人的贴图怎么用。
 * 「该画哪些、画在哪」在 `world.ts`（可视窗口 + 对象池），这样贴图的细节不掺进相机与输入。
 *
 * 床与小人都来自构建期产出的图集（`public/sprites/atlas.json`，生成器见 `tools/art/build-sprites.mjs`）：
 * 帧已经**裁到墨迹 bbox**，锚点写在帧元数据里（床 = 墨迹左上角、小人 = 墨迹底边中心），
 * Phaser 载入时按帧的 `anchor` 设原点，所以摆位只需给「格子左上角」与「站立点」这两个点。
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
/** 线稿等宽：厅的外沿与素材自带的线宽一致（见 `docs/ui/DESIGN.md` Shapes）。 */
export const LINE_WIDTH = 1.5;
/** 床号离床角的距离（世界像素）。 */
const NUMBER_INSET = 3;
/**
 * 暖灯标记的半径：1 世界像素 = 1 CSS 像素，所以 5 就是它在屏幕上的尺寸
 * （`marker-own` 有最小尺寸下限，不得消隐，否则找不到我的床）。
 */
export const MARKER_RADIUS = 5;
/**
 * 名字与表情相对小人原点的位置：**站着的小人原点在脚下**（贴图锚点），躺着的小人原点在床心
 * （位置就是他的床）。两套高度相差一个人高（≈56.5 世界像素），所以标签不能共用一个常量。
 */
const NAME_Y = -BED_H * 0.34;
const EMOTE_Y = -BED_H * 0.56;
const STAND_NAME_Y = -BED_H * 0.62;
const STAND_EMOTE_Y = -BED_H * 0.84;
/** 「自己的小人脚下」那个暖灯标记：原点已经在脚下，所以几乎不需要偏移。 */
const FOOT_MARKER_Y = 3;
/** 气泡内边距。 */
const BUBBLE_PAD = 4;
/**
 * 「睁眼躺姿」叠的两个点：半径与半间距（世界像素）。
 * 锚点来自帧元数据（见 `drawEyes`）；两点间距取 `bedBoy` 上量的 12.5 母图像素（≈6 世界像素）。
 */
const EYE_RADIUS_PX = 2;
const EYE_HALF_SPACING_PX = 6;
/** 走动的缩放摆动：幅度 3%、约 3Hz（`docs/ui/DESIGN.md` Shapes：不做逐帧行走动画）。 */
const WALK_SWAY = 0.03;
const WALK_SWAY_HZ = 3;

/** 图集 key：`public/sprites/atlas.png` + `atlas.json`（构建期产物，见 `tools/art/build-sprites.mjs`）。 */
export const SPRITES_KEY = 'sprites';

export const COLORS = {
  floor: color('primary'),
  line: color('line'),
  marker: color('tertiary'),
} as const;

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
  readonly sprite: Phaser.GameObjects.Image;
  readonly eyes: Phaser.GameObjects.Graphics;
  readonly number: Phaser.GameObjects.Text;
  readonly marker: Phaser.GameObjects.Graphics;
  /** 当前绑定的床号（-1 = 池里闲置）：床号文字只在换绑时重设 */
  bedNo: number;
  /** 当前贴图帧名（空 = 未绑过）：不变就跳过换贴图 */
  frame: string;
  /** 睁眼躺姿的两个点是否已经画上：lying ⇄ asleep 换的是这两个点，不是贴图 */
  eyesOn: boolean;
  /** 我的床标记是否已经打开 */
  mine: boolean;
}

export function createBedView(scene: Phaser.Scene): BedView {
  const sprite = scene.add.image(0, 0, SPRITES_KEY, 'bed_empty_hollow').setScale(ART_SCALE);
  const eyes = scene.add.graphics().setVisible(false);
  const marker = scene.add.graphics();
  marker.fillStyle(COLORS.marker, 1);
  marker.fillCircle(BED_W - MARKER_RADIUS - 2, MARKER_RADIUS + 2, MARKER_RADIUS);
  marker.setVisible(false);
  const number = scene.add
    .text(NUMBER_INSET, BED_H - NUMBER_INSET, '', {
      fontFamily: FONT_FAMILY,
      fontSize: LABEL_PX,
      color: MUTED_CSS,
    })
    .setOrigin(0, 1);
  const container = scene.add.container(0, 0, [sprite, eyes, marker, number]).setVisible(false);
  return { container, sprite, eyes, number, marker, bedNo: -1, frame: '', eyesOn: false, mine: false };
}

/** 把池里的一个视图绑到某张床：位置、床号、贴图（贴图与两个点按各自的变化守卫，逐帧调用不做多余的事）。 */
export function placeBed(view: BedView, bed: BedPlacement, look: BedLook, mine: boolean): void {
  view.container.setVisible(true).setPosition(bed.x, bed.y);
  if (view.bedNo !== bed.bedNo) {
    view.bedNo = bed.bedNo;
    view.number.setText(String(bed.bedNo));
  }
  if (view.frame !== look.frame) {
    view.frame = look.frame;
    // `setTexture` 会按帧的 `anchor` 重设原点（床 = 墨迹左上角，正好落在格子左上角）
    view.sprite.setTexture(SPRITES_KEY, look.frame);
    // 不透明度只随贴图变（只有睡痕两张降不透明度），所以放在这一支里
    view.sprite.setAlpha(look.alpha);
  }
  if (view.eyesOn !== look.eyes) {
    view.eyesOn = look.eyes;
    drawEyes(view, look.eyes);
  }
  if (view.mine !== mine) {
    view.mine = mine;
    view.marker.setVisible(mine);
  }
}

/** 没绑到床的视图藏起来（对象留在池里，下一帧可能又被用上）。 */
export function hideBed(view: BedView): void {
  view.bedNo = -1;
  view.container.setVisible(false);
}

/**
 * 「睁眼躺姿」在脸上叠的两个点：床图只有闭眼的那一张（补画见 `docs/design/backlog.md`）。
 * 位置来自帧元数据里的脸部锚点（构建期从床图头部区域推导，见 `tools/art/build-sprites.mjs`）——
 * 拿不到锚点就不叠点，绝不猜一个位置。
 */
function drawEyes(view: BedView, on: boolean): void {
  const eyes = view.eyes;
  eyes.clear();
  const face = (view.sprite.frame.customData as { face?: { x: number; y: number } }).face;
  if (!on || !face) {
    eyes.setVisible(false);
    return;
  }
  eyes.fillStyle(INK, 1);
  for (const sign of [-1, 1]) {
    eyes.fillCircle((face.x * ART_SCALE) + sign * EYE_HALF_SPACING_PX, face.y * ART_SCALE, EYE_RADIUS_PX);
  }
  eyes.setVisible(true);
}

export interface PersonView {
  readonly container: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Image;
  readonly footMarker: Phaser.GameObjects.Graphics;
  readonly name: Phaser.GameObjects.Text;
  readonly emote: Phaser.GameObjects.Text;
  /** 上一次画法签名（外观、显示态、我的标记）：不变就跳过换贴图 */
  paint: string;
}

export function createPersonView(scene: Phaser.Scene): PersonView {
  const sprite = scene.add.image(0, 0, SPRITES_KEY, 'boy_stand').setScale(ART_SCALE).setVisible(false);
  const footMarker = scene.add.graphics();
  footMarker.fillStyle(COLORS.marker, 1);
  footMarker.fillCircle(0, FOOT_MARKER_Y, MARKER_RADIUS);
  footMarker.setVisible(false);
  const name = scene.add
    .text(0, NAME_Y, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: INK_CSS })
    .setOrigin(0.5, 1)
    .setVisible(false);
  const emote = scene.add.text(0, EMOTE_Y, '', BUBBLE_STYLE).setOrigin(0.5, 1).setVisible(false);
  const container = scene.add.container(0, 0, [sprite, footMarker, name, emote]);
  return { container, sprite, footMarker, name, emote, paint: '' };
}

/**
 * 小人：**站着/走动**才画贴图（躺下、睡着、睡痕都由床位贴图整张画出来，见 `bedLook`）。
 * 睡痕整张降不透明度——不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色。
 * 走动用极轻微的缩放摆动表达（幅度 3%），**不做逐帧行走动画**（`docs/ui/DESIGN.md` Shapes）。
 */
export function paintPerson(
  view: PersonView,
  input: { person: Person; mine: boolean; moving: boolean; nowMs: number },
): void {
  const { person, mine, moving, nowMs } = input;
  const roaming = person.state === 'roaming';
  const signature = `${person.appearance}|${person.state}|${mine}`;
  if (signature !== view.paint) {
    view.paint = signature;
    view.sprite.setVisible(roaming);
    if (roaming) view.sprite.setTexture(SPRITES_KEY, personFrame(person.appearance));
    view.container.setAlpha(personAlpha(person.state));
    view.footMarker.setVisible(mine && roaming);
    view.name.setY(roaming ? STAND_NAME_Y : NAME_Y);
    view.emote.setY(roaming ? STAND_EMOTE_Y : EMOTE_Y);
  }
  const sway = roaming && moving ? 1 + WALK_SWAY * Math.sin((nowMs / 1000) * Math.PI * 2 * WALK_SWAY_HZ) : 1;
  view.sprite.setScale(ART_SCALE * sway);
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