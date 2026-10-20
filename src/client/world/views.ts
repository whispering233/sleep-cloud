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
import type { PetAnim } from './pet';
import { PET_GREET_TEXT } from './pet';
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
 * 名字与标签相对小人原点的位置：**站着的小人原点在脚下**（贴图锚点），躺着的小人原点在床心
 * （位置就是他的床）。两套高度相差一个人高（≈56.5 世界像素），所以标签不能共用一个常量。
 * `CHAT_Y` 同时是**气泡槽位的底线**（气泡底与尾巴都贴在它上面）。
 */
const NAME_Y = -BED_H * 0.34;
const CHAT_Y = -BED_H * 0.56;
const STAND_NAME_Y = -BED_H * 0.62;
const STAND_CHAT_Y = -BED_H * 0.84;
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

/**
 * 篝火的两支状态（`docs/design/80-reserve-decor.md` §2.2）：燃烧 = 6 帧循环，熄灭 = 单帧（柴 + 灰 + 石圈）。
 * 动画 key 不带 `world-` 前缀：它是全局 `AnimationManager` 里的一支，与「组件名」不是同一类东西。
 */
export const FIRE_BURNING_ANIM = 'fire-burning';
export const FIRE_OUT_FRAME = 'fire-out';

export const COLORS = {
  floor: color('primary'),
  /** 厅外那块台面（相机背景色）：**不是第四档地**，比地板暗一档（见 ui/DESIGN.md 颜色） */
  outside: color('outside'),
  line: color('line'),
  /** 我的床标记（暖灯色）：只用在 `marker-own` 这一档 */
  marker: color('tertiary'),
  /** 换床模式里「这张空床可以搬」的标记：与「有主」同一个色号（无主通道的既有颜色） */
  selectable: color('claimed'),
  /** 房间地面：`room`/`rug` 与床板一样是**材料**，固定色，不参与明暗之外的缓动（见 ui/DESIGN.md「地面梯次」） */
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
  /** 床号文字当前是否显示（拉远到 `Z < ZOOM_TEXT_MIN` 时退役）：只在翻转时改可见性 */
  numberOn: boolean;
  /** 当前画在床角上的标记种类（`none` = 没画）：只在种类翻转时重绘 */
  marker: BedMarker;
}

export function createBedView(scene: Phaser.Scene): BedView {
  // 尺寸留 0：真实的矩形与相对偏移在 `placeBed` 里按床号现算（池会被复用到别的床号与另一奇偶行）
  const room = scene.add.rectangle(0, 0, 0, 0, COLORS.room).setOrigin(0, 0);
  const rug = scene.add.rectangle(0, 0, 0, 0, COLORS.rug).setOrigin(0, 0);
  const sprite = scene.add.image(0, 0, SPRITES_KEY, 'bed_empty_hollow').setScale(ART_SCALE);
  const eyes = scene.add.graphics().setVisible(false);
  // 颜色随种类变（我的床 = 暖灯色 / 可搬的空床 = `claimed`），所以不在这里配色，由 `drawMarker` 画。
  // 小点画在**自己的原点**、由 `setPosition` 摆位：这样拉远时 `setScale(1/Z)` 只把它放大，不会把它挪位
  const markerGfx = scene.add.graphics().setPosition(MARKER_X, MARKER_Y).setVisible(false);
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
    numberOn: false,
    marker: 'none',
  };
}

/** 把池里的一个视图绑到某张床：位置、床号、贴图、床角标记（各自的变化守卫，逐帧调用不做多余的事）。 */
export function placeBed(view: BedView, bed: BedPlacement, look: BedLook, marker: BedMarker): void {
  view.container.setVisible(true).setPosition(bed.x, bed.y);
  if (view.bedNo !== bed.bedNo) {
    view.bedNo = bed.bedNo;
    // 文字只在它确实要显示时写：拉远档把文字退掉后，每张床那个 12px 的离屏 canvas 也跟着变成 1×1
    view.number.setText(look.number ? String(displayBedNoOf(bed.bedNo)) : '');
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
  if (view.numberOn !== look.number) {
    view.numberOn = look.number;
    view.number.setVisible(look.number);
    // 从退役档回到可用档（跨过 `ZOOM_TEXT_MIN`）：文字得从当前绑定的床号重写（退役期间它被清空了）
    view.number.setText(look.number ? String(displayBedNoOf(view.bedNo)) : '');
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
  graphics.fillCircle(0, 0, MARKER_RADIUS);
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

/**
 * 一条气泡的外观件：底（圆角矩形）+ 尾巴（三角）+ 文字，**程序化绘制、不走素材**
 * （理由见 `docs/ui/DESIGN.md`「气泡不走素材」）。聊天气泡与猫的问候共用这一份——外观同一份、通道两条。
 */
export interface BubbleView {
  readonly body: Phaser.GameObjects.Rectangle;
  readonly tail: Phaser.GameObjects.Triangle;
  readonly text: Phaser.GameObjects.Text;
  /** 上一次画的内容（种类 + 文字）：不变就跳过重排——重排要重新量文字（`getWrappedText`） */
  content: string;
  /** 上一次摆的槽位（取整后的 x 与底线）：不变就跳过挪位置 */
  slot: string;
  /** 上一次算出的气泡高度（世界像素，0 = 没画）：名字行靠它排在气泡上方 */
  height: number;
}

/** 气泡画在哪：**底边中心**贴在 `(x, baseY)` 上，尾巴从那里往下伸（`baseY` 就是尾巴尖）。 */
export interface BubbleSlot {
  x: number;
  baseY: number;
}

/** 气泡里的内容：文字与它是不是私聊（私聊加一个前缀，收发两边都加）。 */
export interface BubbleInput {
  text: string;
  kind: 'chat' | 'whisper';
}

export function createBubbleView(scene: Phaser.Scene): BubbleView {
  // 底锚在**下沿**（原点 0.5, 1），尾巴锚在**上沿**（0.5, 0）：两个都贴在槽位底线上就对上了
  const body = scene.add
    .rectangle(0, 0, 0, 0, COLORS.bubbleFill)
    .setOrigin(0.5, 1)
    .setRounded(BUBBLE_RADIUS)
    .setStrokeStyle(1, COLORS.bubbleLine)
    .setVisible(false);
  // 尾巴画在底**之后**：底的 1px 下边框被三角的填充盖掉，接缝处不会多出一条横线
  const tail = scene.add
    .triangle(0, 0, 0, 0, TAIL_W, 0, TAIL_W / 2, TAIL_H, COLORS.bubbleFill)
    .setOrigin(0.5, 0)
    .setStrokeStyle(1, COLORS.bubbleLine)
    .setVisible(false);
  const text = scene.add.text(0, 0, '', CHAT_TEXT_STYLE).setOrigin(0.5, 0.5).setVisible(false);
  // 换行宽度要自己给：不给就是一个字都不折（Phaser 的换行是 opt-in）
  text.setWordWrapWidth(BUBBLE_TEXT_PX, true);
  return { body, tail, text, content: '', slot: '', height: 0 };
}

/**
 * 把气泡摆在槽位上（**尺寸与位置一律取整**：半像素的描边照样会糊），`undefined` = 不画。
 * 返回气泡高度（世界像素，0 = 没画）：名字行靠它排在气泡上方。
 *
 * 高度跟着行数撑开、宽度跟文字走；内容与槽位各有一支变化守卫，逐帧调用不做多余的事
 * （猫的问候随猫移动，位置每帧都可能变，而文字只在内容变了时才重新量）。
 */
export function setBubble(view: BubbleView, input: BubbleInput | undefined, slot: BubbleSlot): number {
  if (input === undefined) {
    hideBubble(view);
    return 0;
  }
  const content = `${input.kind}|${input.text}`;
  if (content !== view.content) {
    view.content = content;
    view.body.setVisible(true);
    view.tail.setVisible(true);
    view.text.setVisible(true);
    fitBubbleText(view.text, input.kind === 'whisper' ? `${WHISPER_PREFIX}${input.text}` : input.text);
    // 文字自带内边距，所以气泡尺寸直接就是文字外框；高度跟着行数长，不是固定的一行高。
    // 宽度取偶：底的水平锚点在正中，奇宽会让左右两条竖边落在半像素上（还是糊）
    view.height = Math.round(view.text.height);
    view.body.setSize(Math.round(view.text.width / 2) * 2, view.height);
    // 高度可能变了：位置即使看起来一样也要重排一次
    view.slot = '';
  }
  const x = Math.round(slot.x);
  const baseY = Math.round(slot.baseY);
  const signature = `${x}|${baseY}`;
  if (signature !== view.slot) {
    view.slot = signature;
    view.body.setPosition(x, baseY);
    view.tail.setPosition(x, baseY);
    view.text.setPosition(x, baseY - Math.round(view.height / 2));
  }
  return view.height;
}

/** 不画（三件一起藏、内容清空）：下次出现时重新量文字。已经在不画的状态就不做任何事。 */
export function hideBubble(view: BubbleView): void {
  if (view.content === '') return;
  view.content = '';
  view.slot = '';
  view.height = 0;
  view.body.setVisible(false);
  view.tail.setVisible(false);
  view.text.setVisible(false);
}

export interface PersonView {
  readonly container: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Image;
  readonly footMarker: Phaser.GameObjects.Graphics;
  readonly name: Phaser.GameObjects.Text;
  /** 头顶那一条气泡（底 / 尾巴 / 文字）：与猫的问候共用同一个件（`createBubbleView`） */
  readonly bubble: BubbleView;
  /** 气泡上方的名字行（只在别人的消息上画）。与床下那条裸标签 `name` 是两个对象 */
  readonly bubbleName: Phaser.GameObjects.Text;
  /** 上一次画法签名（外观、显示态、我的标记）：不变就跳过换贴图 */
  paint: string;
  /** 上一次画的名字行（槽位 + 名字）：不变就跳过重排 */
  namePaint: string;
  /** 气泡槽位的底线（站着 / 躺在床上的两套高度）：由 `paintPerson` 与名字一起换 */
  chatBaseY: number;
}

export function createPersonView(scene: Phaser.Scene): PersonView {
  const sprite = scene.add.image(0, 0, SPRITES_KEY, 'boy_stand').setScale(ART_SCALE).setVisible(false);
  const footMarker = scene.add.graphics().setPosition(0, FOOT_MARKER_Y);
  footMarker.fillStyle(COLORS.marker, 1);
  // 同床角那颗点：画在原点、由 `setPosition` 摆位，拉远时 `setScale(1/Z)` 只放大不改位
  footMarker.fillCircle(0, 0, MARKER_RADIUS);
  footMarker.setVisible(false);
  // 气泡压在人物贴图**之下**：尾巴落在头上不会遮住脸
  const bubble = createBubbleView(scene);
  const bubbleName = scene.add
    .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: MUTED_CSS, resolution: TEXT_RESOLUTION })
    .setOrigin(0.5, 1)
    .setVisible(false);
  bubbleName.setWordWrapWidth(NAME_MAX_PX, true);
  const name = scene.add
    .text(0, NAME_Y, '', { fontFamily: FONT_FAMILY, fontSize: LABEL_PX, color: INK_CSS, resolution: TEXT_RESOLUTION })
    .setOrigin(0.5, 1)
    .setVisible(false);
  const container = scene.add.container(0, 0, [
    bubble.body,
    bubble.tail,
    bubble.text,
    sprite,
    footMarker,
    name,
    bubbleName,
  ]);
  return {
    container,
    sprite,
    footMarker,
    name,
    bubble,
    bubbleName,
    paint: '',
    namePaint: '',
    chatBaseY: CHAT_Y,
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
    // 气泡槽位的底线：站着的小人原点在脚下，躺着的人在床心
    view.chatBaseY = roaming ? STAND_CHAT_Y : CHAT_Y;
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
 * 头顶那一个槽位里的聊天气泡（**槽位优先级 聊天 > 选中名字** 由调用方保证，这一支只管自己画不画）。
 *
 * 底 / 尾巴 / 文字与量文字都由可复用件 `setBubble` 负责（猫的问候用的是同一份外观）。
 * 名字行单独一行画在气泡上方，内容在**渲染时**从 `people` 现取（改名不用重挂气泡）。
 */
export function setPersonChat(view: PersonView, input: ChatBubbleInput | undefined): void {
  // 槽位底线跟着人物走：站着的小人原点在脚下、躺着的人在床心，同一段文字也要换个高度重排
  const height = setBubble(
    view.bubble,
    input === undefined ? undefined : { text: input.text, kind: input.kind },
    { x: 0, baseY: view.chatBaseY },
  );
  const name = input?.name ?? '';
  const paint = input === undefined || name === '' ? '' : `${view.chatBaseY}|${height}|${name}`;
  if (paint === view.namePaint) return;
  view.namePaint = paint;
  view.bubbleName.setVisible(paint !== '');
  if (paint === '') return;
  fitBubbleName(view.bubbleName, name);
  view.bubbleName.setPosition(0, Math.round(view.chatBaseY) - height - NAME_GAP_PX);
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

/**
 * 我床头的那堆火（`docs/design/80-reserve-decor.md` §2）：**只有我自己看得见**——不进 `people`、
 * 不广播，服务端不知道它存在。全场只有这一摊（我的那张床），所以不进对象池。
 *
 * 位置与深度由调用方给（世界坐标就是它自己的坐标，不套容器）：遮挡与小人同一条
 * ——画面上更靠下 = 更靠前（`DEPTH.person + y`，见 `world.ts`）。
 */
export interface CampfireView {
  /** 必须是 `Sprite`：燃烧是 6 帧循环动画，`Image` 播不了（`anims` 只在 Sprite 上） */
  readonly sprite: Phaser.GameObjects.Sprite;
  /** 上一次的亮灭（`undefined` = 还没画过）：不变就跳过换贴图与起停动画 */
  lit: boolean | undefined;
}

/** 燃烧循环：`fire-1…6`、8fps、无限重复。**全局 `AnimationManager` 只注册一次**（重复 create 会告警并原样返回）。 */
export function createCampfireAnims(scene: Phaser.Scene): void {
  if (scene.anims.exists(FIRE_BURNING_ANIM)) return;
  scene.anims.create({
    key: FIRE_BURNING_ANIM,
    frames: scene.anims.generateFrameNames(SPRITES_KEY, { prefix: 'fire-', start: 1, end: 6 }),
    frameRate: 8,
    repeat: -1,
  });
}

export function createCampfireView(scene: Phaser.Scene): CampfireView {
  // 初始贴图给熄灭帧：还没有我的时候它本来就是一堆柴；火燃起来才换帧
  const sprite = scene.add.sprite(0, 0, SPRITES_KEY, FIRE_OUT_FRAME).setScale(ART_SCALE).setVisible(false);
  return { sprite, lit: undefined };
}

/** 一帧的摆放：**底边中心**的世界坐标（素材锚点也是墨迹底边中心，火堆就压在那条线上）、深度、亮灭。 */
export interface CampfirePaint {
  x: number;
  y: number;
  depth: number;
  lit: boolean;
}

/** 摆一帧（逐帧调用）：位置与深度每帧写，亮灭只在翻转时换贴图 / 起停动画。 */
export function placeCampfire(view: CampfireView, paint: CampfirePaint): void {
  view.sprite.setVisible(true).setPosition(paint.x, paint.y).setDepth(paint.depth);
  if (view.lit === paint.lit) return;
  view.lit = paint.lit;
  if (paint.lit) {
    view.sprite.play(FIRE_BURNING_ANIM);
    return;
  }
  // 熄灭 = 停动画 + 换成单帧，**不隐藏**：留下柴、灰与石圈（「熄灭」是状态，不是消失）
  view.sprite.anims.stop();
  view.sprite.setTexture(SPRITES_KEY, FIRE_OUT_FRAME);
}

/** 不画（没有我 / 没有床 / 那张床不在视野里）：藏起来并停掉动画，亮灭签名清空——下次出现时重新落位。 */
export function hideCampfire(view: CampfireView): void {
  if (!view.sprite.visible) return;
  view.sprite.setVisible(false);
  view.sprite.anims.stop();
  view.lit = undefined;
}

/**
 * 我床尾那只猫（`docs/design/80-reserve-decor.md` §3）：与篝火同一套边界——**只有我自己看得见**、
 * 全场只有一只（绑「我」不绑床），所以不进对象池。位置与深度由调用方给（世界坐标就是它自己的坐标，
 * 不套容器）：遮挡与小人同一条——画面上更靠下 = 更靠前（`DEPTH.person + y`，见 `world.ts`）。
 */
export interface PetView {
  /** 必须是 `Sprite`：走 / 跑 / 睡都是帧循环，`Image` 播不了（`anims` 只在 Sprite 上） */
  readonly sprite: Phaser.GameObjects.Sprite;
  /** 头上的问候气泡（§3.4）：外观与聊天气泡同一个件，但它**不是聊天**——不进 `state.bubbles` */
  readonly bubble: BubbleView;
  /** 上一次播的动画（`undefined` = 还没播过）：不变就跳过 `play`——每帧重播会把循环钉在第一帧 */
  anim: PetAnim | undefined;
}

/** 六个动画：idle 8 帧 / 8fps，走、跑、睡各 4 帧 / 6fps（循环）；摸猫的两组各 6 帧 / 4fps（不循环，§3.6）。**全局只注册一次**。 */
export function createPetAnims(scene: Phaser.Scene): void {
  const groups: Array<{ key: PetAnim; prefix: string; end: number; frameRate: number; repeat: number }> = [
    { key: 'cat-idle', prefix: 'cat-idle-', end: 8, frameRate: 8, repeat: -1 },
    { key: 'cat-walk', prefix: 'cat-walk-', end: 4, frameRate: 6, repeat: -1 },
    { key: 'cat-run', prefix: 'cat-run-', end: 4, frameRate: 6, repeat: -1 },
    { key: 'cat-sleep', prefix: 'cat-sleep-', end: 4, frameRate: 6, repeat: -1 },
    { key: 'cat-pat', prefix: 'cat-pat-', end: 6, frameRate: 4, repeat: 0 },
    { key: 'cat-nuzzle', prefix: 'cat-nuzzle-', end: 6, frameRate: 4, repeat: 0 },
  ];
  for (const group of groups) {
    if (scene.anims.exists(group.key)) continue;
    scene.anims.create({
      key: group.key,
      frames: scene.anims.generateFrameNames(SPRITES_KEY, { prefix: group.prefix, start: 1, end: group.end }),
      frameRate: group.frameRate,
      repeat: group.repeat,
    });
  }
}

export function createPetView(scene: Phaser.Scene): PetView {
  // 初始贴图给 idle 的第一帧：动画由 `placePet` 按目标形态切，建出来时先不播
  const sprite = scene.add.sprite(0, 0, SPRITES_KEY, 'cat-idle-1').setScale(ART_SCALE).setVisible(false);
  return { sprite, bubble: createBubbleView(scene), anim: undefined };
}

/**
 * 问候气泡的底边（尾巴根）在猫**脚点之上**多高（世界像素）：站立帧的墨迹高 117 × `ART_SCALE` ≈ 58.5，
 * 尾巴再往下 6px，尾巴尖落在头顶之上、不压脸（§3.4）。
 */
const PET_GREET_ABOVE_PX = 66;

/** 一帧的摆放：**底边中心**的世界坐标（与小人、篝火同一个锚点）、深度、动画 key、头上的问候气泡。 */
export interface PetPaint {
  x: number;
  y: number;
  depth: number;
  anim: PetAnim;
  /** 这一刻画不画问候气泡（§3.4）：文案与挂载位置都由这一支负责，世界层只算「还该不该画」 */
  greet: boolean;
}

/** 摆一帧（逐帧调用）：位置与深度每帧写，动画只在翻转时 `play`，问候气泡随猫走。 */
export function placePet(view: PetView, paint: PetPaint): void {
  view.sprite.setVisible(true).setPosition(paint.x, paint.y).setDepth(paint.depth);
  // 气泡挂在猫的**脚点上方**、随猫移动；深度压在猫身上一点，尾巴不会被猫自己的头盖掉。
  // 拉远到文字阈值以下时它就是 `undefined`（与其它世界文字一起退役，猫本体照画）
  setBubble(view.bubble, paint.greet ? { text: PET_GREET_TEXT, kind: 'chat' } : undefined, {
    x: paint.x,
    baseY: paint.y - PET_GREET_ABOVE_PX,
  });
  if (paint.greet) {
    const depth = paint.depth + 1;
    for (const object of [view.bubble.body, view.bubble.tail, view.bubble.text]) object.setDepth(depth);
  }
  if (view.anim === paint.anim) return;
  view.anim = paint.anim;
  view.sprite.play(paint.anim);
}

/** 不画（没有我 / 睡痕 / 不在视野）：本体与问候气泡一起收掉，动画签名清空——下次出现时重新播。 */
export function hidePet(view: PetView): void {
  hideBubble(view.bubble);
  if (!view.sprite.visible) return;
  view.sprite.setVisible(false);
  view.sprite.anims.stop();
  view.anim = undefined;
}
