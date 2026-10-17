import * as Phaser from 'phaser';

import { ART_SCALE, BED_H, BED_W, MAX_DPR } from '../../shared/constants';
import { displayBedNoOf, reserveOf, roomOf } from '../../shared/layout';
import type { Person } from '../../shared/protocol';
// 气泡几何与提示共用一份（那个模块是 Phaser-free 的，界面层与单测都能拿，见 `../bubble-fit.ts`）
import {
  BUBBLE_PAD,
  BUBBLE_TEXT_PX,
  CHAT_BUBBLE_MAX_LINES,
  FONT_FAMILY,
  LABEL_PX,
} from '../bubble-fit';
import tokens from '../styles/tokens.json';
import { MARKER_RADIUS, personAlpha, personFrame, truncateToLines } from './rules';
import type { BedLook, BedMarker } from './rules';

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

/**
 * 文字贴图的栅格密度，与相机 zoom（= 画布 DPR）对齐：停在 1× 时高密度屏上会被放大采样而发虚。
 * shortcut: dpr 在运行中变化（跨显示器拖窗）不重设，刷新即可；移动端 dpr 恒定
 */
const TEXT_RESOLUTION = Math.min(window.devicePixelRatio || 1, MAX_DPR);

/** 床号离床角的距离（世界像素）。 */
const NUMBER_INSET = 3;
/** 床号的字号 = `caption` 档，刻意比名字与气泡（`label` 档）小一档。 */
const BED_NUMBER_PX = 12;
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
/**
 * 气泡的宽度上限与内边距来自 `../bubble-fit`：气泡底与尾巴都是程序化绘制（圆角矩形 + 三角），
 * 不走素材——上游那张 36×30 的底图只有 1–2px 竖描边，横向拉伸到文字宽度就糊了
 * （理由见 `docs/ui/DESIGN.md`「气泡不走素材」）。
 * 气泡底圆角半径与尾巴（朝下的小三角）的宽高，世界像素。
 */
const BUBBLE_RADIUS = 4;
const TAIL_W = 9;
const TAIL_H = 6;
/** 名字行的宽度上限（约 8 个中文字）与它离气泡上沿的间距，世界像素。 */
const NAME_MAX_PX = 96;
const NAME_GAP_PX = 2;
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
  /** 我的床标记（暖灯色）：只用在 `marker-own` 这一档 */
  marker: color('tertiary'),
  /** 换床模式里「这张空床可以搬」的标记：与「有主」同一个色号（无主通道的既有颜色） */
  selectable: color('claimed'),
  /** 房间地面：`room`/`rug` 与床板一样是**材料**，固定色，不参与困倦度缓动（见 ui/DESIGN.md「地面梯次」） */
  room: color('room'),
  /** 预留位（每间房留给装饰物的那块空地）暂时按地毯画 */
  rug: color('rug'),
  /** 气泡底（与界面同底）与它那 1px 的描边 */
  bubbleFill: color('secondary'),
  bubbleLine: color('neutral-muted'),
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
  resolution: TEXT_RESOLUTION,
};

/**
 * 聊天气泡里的文字：底色由气泡底图提供，所以文字只要墨色与内边距（内边距跟着底图拉伸）。
 * 文字不透明底也换掉：`Text` 的 `backgroundColor` 要给个透明色才相当于没有。
 */
const CHAT_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  ...BUBBLE_STYLE,
  backgroundColor: NO_BACKGROUND,
};

/**
 * 床角那颗小点（`marker-own` / 换床模式里可搬的空床）的几何：**两种标记共用同一个通道**，
 * 只有颜色不同。半径 5 是屏幕尺寸（1 世界像素 = 1 CSS 像素）。
 */
const MARKER_X = BED_W - MARKER_RADIUS - 2;
const MARKER_Y = MARKER_RADIUS + 2;
/** 两种标记（我的床 / 换床模式里可搬的空床）的颜色：**判据在 `rules.ts`，颜色只在这里** */
const MARKER_COLORS: Record<Exclude<BedMarker, 'none'>, number> = {
  own: COLORS.marker,
  selectable: COLORS.selectable,
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
  readonly markerGfx: Phaser.GameObjects.Graphics;
  /** 当前绑定的床号（-1 = 池里闲置）：床号文字只在换绑时重设 */
  bedNo: number;
  /** 当前贴图帧名（空 = 未绑过）：不变就跳过换贴图 */
  frame: string;
  /** 睁眼躺姿的两个点是否已经画上：lying ⇄ asleep 换的是这两个点，不是贴图 */
  eyesOn: boolean;
  /** 当前画在床角上的标记种类（`none` = 没画）：只在种类翻转时重绘 */
  marker: BedMarker;
}

export function createBedView(scene: Phaser.Scene): BedView {
  // 尺寸留 0：真实的矩形与相对偏移在 `placeBed` 里按床号现算（池会被复用到别的床号与另一奇偶行）
  const room = scene.add.rectangle(0, 0, 0, 0, COLORS.room).setOrigin(0, 0);
  const rug = scene.add.rectangle(0, 0, 0, 0, COLORS.rug).setOrigin(0, 0);
  const sprite = scene.add.image(0, 0, SPRITES_KEY, 'bed_empty_hollow').setScale(ART_SCALE);
  const eyes = scene.add.graphics().setVisible(false);
  // 颜色随种类变（我的床 = 暖灯色 / 可搬的空床 = `claimed`），所以不在这里配色，由 `drawMarker` 画
  const markerGfx = scene.add.graphics().setVisible(false);
  const number = scene.add
    .text(NUMBER_INSET, BED_H - NUMBER_INSET, '', {
      fontFamily: FONT_FAMILY,
      fontSize: BED_NUMBER_PX,
      color: MUTED_CSS,
      resolution: TEXT_RESOLUTION,
    })
    .setOrigin(0, 1);
  const container = scene.add.container(0, 0, [room, rug, sprite, eyes, markerGfx, number]).setVisible(false);
  return {
    container,
    room,
    rug,
    sprite,
    eyes,
    number,
    markerGfx,
    bedNo: -1,
    frame: '',
    eyesOn: false,
    marker: 'none',
  };
}

/** 把池里的一个视图绑到某张床：位置、床号、贴图、床角标记（各自的变化守卫，逐帧调用不做多余的事）。 */
export function placeBed(view: BedView, bed: BedPlacement, look: BedLook, marker: BedMarker): void {
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
  if (view.marker !== marker) {
    view.marker = marker;
    drawMarker(view, marker);
  }
}

/** 床角那颗小点：**我的床**（暖灯色）与**换床模式里可搬的空床**（`claimed`）共用这个几何通道。 */
function drawMarker(view: BedView, marker: BedMarker): void {
  const graphics = view.markerGfx;
  graphics.clear();
  if (marker === 'none') {
    graphics.setVisible(false);
    return;
  }
  graphics.fillStyle(MARKER_COLORS[marker], 1);
  graphics.fillCircle(MARKER_X, MARKER_Y, MARKER_RADIUS);
  graphics.setVisible(true);
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
  readonly bubbleTail: Phaser.GameObjects.Triangle;
  readonly bubbleBody: Phaser.GameObjects.Rectangle;
  readonly bubbleText: Phaser.GameObjects.Text;
  /** 气泡上方的名字行（只在别人的消息上画）。与床下那条裸标签 `name` 是两个对象 */
  readonly bubbleName: Phaser.GameObjects.Text;
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
  // 气泡压在人物贴图**之下**：尾巴落在头上不会遮住脸
  // 底锚在**下沿**（原点 0.5, 1），尾巴锚在**上沿**（0.5, 0）：两个都贴在 `chatBaseY` 上就对上了
  const bubbleBody = scene.add
    .rectangle(0, 0, 0, 0, COLORS.bubbleFill)
    .setOrigin(0.5, 1)
    .setRounded(BUBBLE_RADIUS)
    .setStrokeStyle(1, COLORS.bubbleLine)
    .setVisible(false);
  // 尾巴画在底**之后**：底的 1px 下边框被三角的填充盖掉，接缝处不会多出一条横线
  const bubbleTail = scene.add
    .triangle(0, 0, 0, 0, TAIL_W, 0, TAIL_W / 2, TAIL_H, COLORS.bubbleFill)
    .setOrigin(0.5, 0)
    .setStrokeStyle(1, COLORS.bubbleLine)
    .setVisible(false);
  const bubbleText = scene.add.text(0, 0, '', CHAT_TEXT_STYLE).setOrigin(0.5, 0.5).setVisible(false);
  // 换行宽度要自己给：不给就是一个字都不折（Phaser 的换行是 opt-in）
  bubbleText.setWordWrapWidth(BUBBLE_TEXT_PX, true);
  const bubbleName = scene.add
    .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: MUTED_CSS, resolution: TEXT_RESOLUTION })
    .setOrigin(0.5, 1)
    .setVisible(false);
  bubbleName.setWordWrapWidth(NAME_MAX_PX, true);
  const name = scene.add
    .text(0, NAME_Y, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: INK_CSS, resolution: TEXT_RESOLUTION })
    .setOrigin(0.5, 1)
    .setVisible(false);
  const emote = scene.add.text(0, EMOTE_Y, '', BUBBLE_STYLE).setOrigin(0.5, 1).setVisible(false);
  const container = scene.add.container(0, 0, [bubbleBody, bubbleTail, bubbleText, sprite, footMarker, name, emote, bubbleName]);
  return {
    container,
    sprite,
    footMarker,
    name,
    emote,
    bubbleTail,
    bubbleBody,
    bubbleText,
    bubbleName,
    paint: '',
    chat: '',
    chatBaseY: EMOTE_Y,
  };
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

/**
 * `setPersonChat` 的入参：文字、它是全局消息还是私聊，以及气泡上方的名字行。
 * 名字**别人的消息才传**（自己知道是自己，见 `docs/ui/DESIGN.md` 的 `chat-bubble` 行）。
 */
export interface ChatBubbleInput {
  text: string;
  kind: 'chat' | 'whisper';
  name?: string;
}

/**
 * 头顶那一个槽位里的聊天气泡（**槽位优先级 聊天 > 表情 > 选中名字** 由调用方保证，这一支只管自己画不画）。
 *
 * 底是圆角矩形、尾巴是三角，都程序化画（不走素材，理由见 `docs/ui/DESIGN.md`「气泡不走素材」）：
 * 高度跟着行数撑开，宽度跟文字走，所以**尺寸与位置一律取整**——半像素的描边照样会糊。
 * 名字行单独一行画在气泡上方，内容在**渲染时**从 `people` 现取（改名不用重挂气泡）。
 */
export function setPersonChat(view: PersonView, input: ChatBubbleInput | undefined): void {
  // 槽位底线在签名里：人物从站着变成躺在床上时，同一段文字也要换个高度重排
  const name = input?.name ?? '';
  const signature = input === undefined ? '' : `${view.chatBaseY}|${input.kind}|${input.text}|${name}`;
  if (signature === view.chat) return;
  view.chat = signature;
  const visible = input !== undefined;
  view.bubbleBody.setVisible(visible);
  view.bubbleTail.setVisible(visible);
  view.bubbleText.setVisible(visible);
  view.bubbleName.setVisible(visible && name !== '');
  if (!input) return;

  fitBubbleText(view.bubbleText, input.kind === 'whisper' ? `${WHISPER_PREFIX}${input.text}` : input.text);
  fitBubbleName(view.bubbleName, name);
  // 文字自带内边距，所以气泡尺寸直接就是文字外框；高度跟着行数长，不是固定的一行高。
  // 宽度取偶：底的水平锚点在正中，奇宽会让左右两条竖边落在半像素上（还是糊）
  const width = Math.round(view.bubbleText.width / 2) * 2;
  const height = Math.round(view.bubbleText.height);
  const baseY = Math.round(view.chatBaseY);
  view.bubbleBody.setSize(width, height).setPosition(0, baseY);
  view.bubbleTail.setPosition(0, baseY);
  view.bubbleText.setPosition(0, baseY - Math.round(height / 2));
  view.bubbleName.setPosition(0, baseY - height - NAME_GAP_PX);
}

/**
 * 最多两行、超出截断加 `…`。**提示用估算、绘制用实测**（分工见 `../bubble-fit.ts`）：
 * 这里量的是文字对象的真实换行，那才是气泡里真正画出多少。
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

/** 名字行：**只有一行**，放不下就截断加 `…`（和气泡同一套二分，见 `rules.truncateToLines`）。 */
function fitBubbleName(nameText: Phaser.GameObjects.Text, name: string): void {
  const linesOf = (candidate: string): number => {
    nameText.setText(candidate);
    return nameText.getWrappedText().length;
  };
  nameText.setText(truncateToLines(name, 1, linesOf));
}
