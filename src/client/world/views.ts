import * as Phaser from 'phaser';

import { ART_SCALE, BED_H, BED_W } from '../../shared/constants';
import { displayBedNoOf, reserveOf, roomOf } from '../../shared/layout';
import type { Person } from '../../shared/protocol';
import tokens from '../styles/tokens.json';
import { personAlpha, personFrame, truncateToLines } from './rules';
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
 * 聊天气泡的**宽度上限**（世界像素）与图集缩放。
 * 缩放到 0.75 而不是 `ART_SCALE`（0.5）：底图 36×30 母图像素 × 0.75 ≈ 27×22.5，
 * 正好装下 12px 的一行字与上下 4px 内边距（床与人才用 `ART_SCALE`）。
 */
const CHAT_BUBBLE_MAX_PX = 200;
const CHAT_BUBBLE_SCALE = 0.75;
/** 底图里最多两行，超出截断加 `…`（见 `fitBubbleText`）。 */
const CHAT_BUBBLE_MAX_LINES = 2;
/** 私聊气泡的前缀：**收发两边都加**（自己那条也加，用来区分它没广播出去）。 */
const WHISPER_PREFIX = '悄悄话 · ';
/**
 * 「睁眼躺姿」叠的两个点：半径与半间距（世界像素）。
 * 锚点来自帧元数据（见 `drawEyes`）；两点间距取 `bedBoy` 上量的 12.5 母图像素（≈6 世界像素）。
 */
const EYE_RADIUS_PX = 2;
const EYE_HALF_SPACING_PX = 6;
/** 走动的缩放摆动：幅度 3%、约 4.5Hz（`docs/ui/DESIGN.md` Shapes：不做逐帧行走动画）。 */
const WALK_SWAY = 0.03;
const WALK_SWAY_HZ = 4.5;

/** 图集 key：`public/sprites/atlas.png` + `atlas.json`（构建期产物，见 `tools/art/build-sprites.mjs`）。 */
export const SPRITES_KEY = 'sprites';

export const COLORS = {
  floor: color('primary'),
  /** 氛围最暗档（全厅都睡下时）：只用于地板底色，不参与任何语义（见 ui/DESIGN.md「明暗的边界」） */
  floorDim: color('primary-dim'),
  /** 厅外那块底（屏空间）：与界面同底，**不跟困倦度缓动**（它不是厅里的地板，见 ui/DESIGN.md 颜色） */
  outside: color('secondary'),
  line: color('line'),
  marker: color('tertiary'),
  /** 房间地面：`room`/`rug` 与床板一样是**材料**，固定色，不参与困倦度缓动（见 ui/DESIGN.md「地面梯次」） */
  room: color('room'),
  /** 预留位（每间房留给装饰物的那块空地）暂时按地毯画 */
  rug: color('rug'),
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

/**
 * 聊天气泡里的文字：底色由气泡底图提供，所以文字只要墨色与内边距（内边距跟着底图拉伸）。
 * 文字不透明底也换掉：`Text` 的 `backgroundColor` 要给个透明色才相当于没有。
 */
const CHAT_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  ...BUBBLE_STYLE,
  backgroundColor: NO_BACKGROUND,
};

/** 一张床在世界里的矩形（左上角锚点，与服务端 `layout.positionOf` 同一个坐标）。 */
export interface BedPlacement {
  bedNo: number;
  x: number;
  y: number;
}

export interface BedView {
  readonly container: Phaser.GameObjects.Container;
  /** 房间地面与预留位两块固定色贴片：容器里最前面的两个子对象（压在床贴图之下） */
  readonly room: Phaser.GameObjects.Rectangle;
  readonly rug: Phaser.GameObjects.Rectangle;
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
  // 尺寸留 0：真实的矩形与相对偏移在 `placeBed` 里按床号现算（池会被复用到别的床号与另一奇偶行）
  const room = scene.add.rectangle(0, 0, 0, 0, COLORS.room).setOrigin(0, 0);
  const rug = scene.add.rectangle(0, 0, 0, 0, COLORS.rug).setOrigin(0, 0);
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
  const container = scene.add.container(0, 0, [room, rug, sprite, eyes, marker, number]).setVisible(false);
  return { container, room, rug, sprite, eyes, number, marker, bedNo: -1, frame: '', eyesOn: false, mine: false };
}

/** 把池里的一个视图绑到某张床：位置、床号、贴图（贴图与两个点按各自的变化守卫，逐帧调用不做多余的事）。 */
export function placeBed(view: BedView, bed: BedPlacement, look: BedLook, mine: boolean): void {
  view.container.setVisible(true).setPosition(bed.x, bed.y);
  if (view.bedNo !== bed.bedNo) {
    view.bedNo = bed.bedNo;
    view.number.setText(String(displayBedNoOf(bed.bedNo)));
    // 位置与错位一律向 layout 要：矩形是绝对坐标，容器的坐标就是 `positionOf(bedNo)`，相减得相对偏移
    const room = roomOf(bed.bedNo);
    const reserve = reserveOf(bed.bedNo);
    if (room && reserve) {
      view.room.setPosition(room.x - bed.x, room.y - bed.y).setSize(room.width, room.height);
      view.rug.setPosition(reserve.x - bed.x, reserve.y - bed.y).setSize(reserve.width, reserve.height);
    }
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
  readonly bubbleTail: Phaser.GameObjects.Image;
  readonly bubbleBody: Phaser.GameObjects.Image;
  readonly bubbleText: Phaser.GameObjects.Text;
  /** 上一次画法签名（外观、显示态、我的标记）：不变就跳过换贴图 */
  paint: string;
  /** 上一次画的气泡（槽位底线 + 种类 + 文字）：不变就跳过整段重排（重排要重新量文字） */
  chat: string;
  /** 气泡槽位的底线（站着 / 躺在床上的两套高度）：由 `paintPerson` 与名字、表情一起换 */
  chatBaseY: number;
}

export function createPersonView(scene: Phaser.Scene): PersonView {
  const sprite = scene.add.image(0, 0, SPRITES_KEY, 'boy_stand').setScale(ART_SCALE).setVisible(false);
  const footMarker = scene.add.graphics();
  footMarker.fillStyle(COLORS.marker, 1);
  footMarker.fillCircle(0, FOOT_MARKER_Y, MARKER_RADIUS);
  footMarker.setVisible(false);
  // 气泡压在人物贴图**之下**（图集锚点是中心，两张图同原点）：尾巴落在头上不会遮住脸
  const bubbleTail = scene.add.image(0, 0, SPRITES_KEY, 'chat_bubble_tail').setScale(CHAT_BUBBLE_SCALE).setVisible(false);
  const bubbleBody = scene.add.image(0, 0, SPRITES_KEY, 'chat_bubble').setScale(CHAT_BUBBLE_SCALE).setVisible(false);
  const bubbleText = scene.add.text(0, 0, '', CHAT_TEXT_STYLE).setOrigin(0.5, 0.5).setVisible(false);
  // 换行宽度要自己给：不给就是一个字都不折（Phaser 的换行是 opt-in）
  bubbleText.setWordWrapWidth(CHAT_BUBBLE_MAX_PX - BUBBLE_PAD * 2, true);
  const name = scene.add
    .text(0, NAME_Y, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: INK_CSS })
    .setOrigin(0.5, 1)
    .setVisible(false);
  const emote = scene.add.text(0, EMOTE_Y, '', BUBBLE_STYLE).setOrigin(0.5, 1).setVisible(false);
  const container = scene.add.container(0, 0, [bubbleTail, bubbleBody, bubbleText, sprite, footMarker, name, emote]);
  return { container, sprite, footMarker, name, emote, bubbleTail, bubbleBody, bubbleText, paint: '', chat: '', chatBaseY: EMOTE_Y };
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
    // 气泡与表情共用同一条槽位底线（站着的小人原点在脚下，躺着的人在床心）
    view.chatBaseY = roaming ? STAND_EMOTE_Y : EMOTE_Y;
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

/** `setPersonChat` 的入参：文字（别人带名字前缀、自己不带）与它是全局消息还是私聊。 */
export interface ChatBubbleInput {
  text: string;
  kind: 'chat' | 'whisper';
}

/**
 * 头顶那一个槽位里的聊天气泡（**槽位优先级 聊天 > 表情 > 名字** 由调用方保证，这一支只管自己画不画）。
 *
 * 画法照上游 `DrawChat`：**底图按文字宽度横向拉伸、尾巴固定尺寸**（水平居中、垂直贴底图下沿）。
 * **必要扩展**：上游只撑 x（它只画一行）；我们允许两行，所以**高度也要按行数撑开**——
 * 底图上下两个方向都用 `setDisplaySize`，而不是只改宽度。
 */
export function setPersonChat(view: PersonView, input: ChatBubbleInput | undefined): void {
  // 槽位底线在签名里：人物从站着变成躺在床上时，同一段文字也要换个高度重排
  const signature = input === undefined ? '' : `${view.chatBaseY}|${input.kind}|${input.text}`;
  if (signature === view.chat) return;
  view.chat = signature;
  const visible = input !== undefined;
  view.bubbleBody.setVisible(visible);
  view.bubbleTail.setVisible(visible);
  view.bubbleText.setVisible(visible);
  if (!input) return;

  fitBubbleText(view.bubbleText, input.kind === 'whisper' ? `${WHISPER_PREFIX}${input.text}` : input.text);
  // 文字自带内边距，所以底图尺寸直接就是文字外框；高度跟着行数长，不是固定的一行高
  const { width, height } = view.bubbleText;
  const baseY = view.chatBaseY;
  view.bubbleBody.setDisplaySize(width, height).setPosition(0, baseY - height / 2);
  view.bubbleText.setPosition(0, baseY - height / 2);
  view.bubbleTail.setPosition(0, baseY);
}

/**
 * 最多两行、超出截断加 `…`。
 * 行数只能问文字对象本身（Phaser 的 `maxLines` 不给省略号，理由与算法见 `rules.truncateToLines`）：
 * 量行器把候选文字写进气泡文字再数它的换行。
 */
function fitBubbleText(bubbleText: Phaser.GameObjects.Text, text: string): void {
  const linesOf = (candidate: string): number => {
    bubbleText.setText(candidate);
    return bubbleText.getWrappedText().length;
  };
  bubbleText.setText(truncateToLines(text, CHAT_BUBBLE_MAX_LINES, linesOf));
}
