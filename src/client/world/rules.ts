import { PREDICTION_STALE_MS, ZOOM_MIN } from '../../shared/constants';
import type { Appearance, Person, PersonState, SelfPerson } from '../../shared/protocol';
import { interpolationDelay, isInterpolating, positionAt } from '../motion';
import type { Motion } from '../motion';
import { arcLengthAhead } from '../prediction';
import type { Prediction } from '../prediction';
import { petHitAt } from './pet';

/**
 * 世界画布的纯规则：与 Phaser 无关，可单测。坐标一律是**世界像素**（1 世界像素 = 1 CSS 像素）。
 * 这些判断是「床位真值表」的直接翻译（见 `docs/ui/DESIGN.md` Components 节）。
 */

/** 单张贴图的名字（图集帧名，见 `docs/ui/DESIGN.md`「构建期要产出的变体」）。 */
type BedFrame =
  | 'bed_empty_hollow'
  | 'bed_empty_owned'
  | 'bed_boy'
  | 'bed_girl'
  | 'bed_boy_trace'
  | 'bed_girl_trace';

export type PersonFrame = 'boy_stand' | 'girl_stand';

/** 占用一张床的人：画这张床要在图上铺谁，需要显示态与外观两项。 */
export interface Occupant {
  state: Exclude<PersonState, 'roaming'>;
  appearance: Appearance;
}

/**
 * 一张床此刻该用哪张贴图（`docs/ui/DESIGN.md` 的床位真值表）：
 * **占用**走墨色三档（`line` / `trace` / `claimed`）、**归属**走填充（空芯 / `paper`）。
 */
export interface BedLook {
  frame: BedFrame;
  /** 睡痕整张图降不透明度（不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色） */
  alpha: number;
  /** 清醒躺着：床图上只有闭眼的那一张，靠脸上叠两个点表达「睁着眼」（补画见 backlog） */
  eyes: boolean;
  /** 床号是否画：拉远到 `Z < ZOOM_TEXT_MIN` 时退役（见 `docs/ui/DESIGN.md` 的世界相机） */
  number: boolean;
}

/** 睡痕的不透明度：床与小人共用同一个值（`personAlpha`）。 */
export const TRACE_ALPHA = 0.45;

/**
 * 暖灯标记的半径：1 世界像素 = 1 CSS 像素，所以 5 就是它在屏幕上的尺寸
 * （`marker-own` 有最小尺寸下限，不得消隐，否则找不到我的床）。
 */
export const MARKER_RADIUS = 5;

/**
 * 气泡文字最多 `maxLines` 行、超出截断加 `…`（行数由调用方量：Phaser 量真实文字，单测给个假的）。
 * Phaser 4 的 `maxLines` **只会少画多余的行**（`GetTextSize` / `updateText` 按它截断），不自带省略号，
 * 所以省略号自己补：按字符**二分**出「补上 `…` 后仍放得下」的最长前缀（中文没有词可切，只能按字符）。
 * 切点按**字素簇**算：按 UTF-16 码元切会落在 emoji 中间画出半个字符（`\uFFFD`），ZWJ 序列（👨‍👩‍👧‍👦）被拆成几个人。
 */
export function truncateToLines(text: string, maxLines: number, linesOf: (text: string) => number): string {
  if (linesOf(text) <= maxLines) return text;
  const clusters = [...GRAPHEMES.segment(text)].map((part) => part.segment);
  let low = 0;
  let high = clusters.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (linesOf(`${clusters.slice(0, mid).join('')}…`) <= maxLines) low = mid;
    else high = mid - 1;
  }
  return `${clusters.slice(0, low).join('')}…`;
}

/** 字素簇切分（Node 22 与目标浏览器都有，不留回退分支）。 */
const GRAPHEMES = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/** 铺着人的两张床图：睡痕是同一张图换墨色档，清醒躺姿与睡着共用闭眼的那张。 */
const BED_FRAMES: Record<Appearance, { resting: BedFrame; trace: BedFrame }> = {
  boy: { resting: 'bed_boy', trace: 'bed_boy_trace' },
  girl: { resting: 'bed_girl', trace: 'bed_girl_trace' },
};

/** 占用优先于归属；无主空床**不返回空值**——它是「这里可以躺」的唯一提示。 */
export function bedLook(input: { owned: boolean; occupant?: Occupant; detail?: boolean }): BedLook {
  const look = input.detail ?? true;
  const occupant = input.occupant;
  if (!occupant) {
    return { frame: input.owned ? 'bed_empty_owned' : 'bed_empty_hollow', alpha: 1, eyes: false, number: look };
  }
  const trace = occupant.state === 'trace';
  const pair = BED_FRAMES[occupant.appearance];
  return {
    frame: trace ? pair.trace : pair.resting,
    alpha: trace ? TRACE_ALPHA : 1,
    eyes: look && occupant.state === 'lying',
    number: look,
  };
}

/** 床角那颗小点的种类：`own` = 我的床；`selectable` = 换床模式里可搬的无主空床；`none` = 不画。 */
export type BedMarker = 'none' | 'own' | 'selectable';

/**
 * 床角那颗小点该画哪种（`docs/ui/DESIGN.md` 的 `marker-own` / `bed-switch-mode`）：
 * **我的床**（暖灯色）优先；换床模式里只给**无主且无人**的床标「可搬」（`claimed` 色）。
 *
 * 它是一条**可点击性的可视提示**（画的就是「这能不能点」），所以判据留在这里、颜色留在渲染层
 * （`views.ts` 的 `MARKER_COLORS`）——与 `bedLook` 同一分工，也让单测拿得到（渲染模块会拉进 Phaser）。
 */
export function bedMarkerOf(input: {
  bedNo: number;
  /** 我的床号（`me.ownedBedNo`）；还没有床时没有 */
  mine?: number;
  /** 换床模式是否开着 */
  switching: boolean;
  /** 这张床有主吗（归属未过期） */
  owned: boolean;
  /** 这张床此刻有占用者吗（含未过期的睡痕） */
  occupied: boolean;
}): BedMarker {
  if (input.bedNo === input.mine) return 'own';
  return input.switching && !input.owned && !input.occupied ? 'selectable' : 'none';
}

/** 站着的小人：外观（`boy` / `girl`）→ 贴图。**不做逐帧行走动画**，走动靠极轻微的缩放摆动。 */
export function personFrame(appearance: Appearance): PersonFrame {
  return appearance === 'girl' ? 'girl_stand' : 'boy_stand';
}

/**
 * 床头块那一样装饰此刻亮不亮（`docs/design/80-reserve-decor.md` §2.1 / §2.4）：**跟着我的显示态**走——
 * 躺着 / 睡着才亮，漫游 / 睡痕（以及还没有我）都熄。熄是**状态**不是消失：熄了留柴、灰与石圈，
 * 或者一颗不发光的老南瓜，与「床有人 / 没人」靠形态而不是靠消失表达是同一条语言。
 *
 * **篝火与南瓜灯共用这一条**：两样东西同一块单选、意味不一样但亮灭时机一样，各写一条只会有一天对不上。
 */
export function decorLit(me: SelfPerson | undefined): boolean {
  return me !== undefined && (me.state === 'lying' || me.state === 'asleep');
}

/**
 * 「这个人此刻还在走」：漫游中且插值窗口还没走完。渲染的摆动与相机跟随共用这一条判据
 * （两处各写一遍时，只要有处换了滞后口径，镜头与小人就会不同步）。
 */
export function isMoving(person: Person, motion: Motion | undefined, serverNow: number): boolean {
  return (
    person.state === 'roaming' && motion !== undefined && isInterpolating(motion, serverNow - interpolationDelay(motion))
  );
}

/**
 * 「**画面**还在动」：渲染的摆动用这一条，而不用 `isMoving`（那是服务端时间窗）。
 * 相机跟随**仍用 `isMoving`**：窗口晚关的那一阵正好把限速中的追平走完（见 `world.ts` 的 `follow`）。
 *
 * 画面比真值领先一个单向时延，所以 `isMoving` 的窗口比画面晚关 `oneWay + MOTION_SLACK_MS`：
 * 用它，小人站住之后还要再摆 0.35 s（实机 RTT 200）到 1.15 s（RTT 1000），读起来就是「到点之后还在抖」。
 * 自己的判据因此改成「折线上还有路可走」且「外推没过保鲜期」；别人没有折线，仍走 `isMoving`
 * （那条判据本来就按各自的插值滞后算过，与画面同源）。
 */
export function isPictureMoving(input: {
  person: Person;
  motion: Motion | undefined;
  /** 只对自己有值：自己的外推折线 */
  prediction: Prediction | undefined;
  /** 这一帧画出来的那一点（与渲染、猫、跟随共用同一个点）；还没有点时退回 `isMoving` */
  point: { x: number; y: number } | undefined;
  serverNow: number;
}): boolean {
  const { person, motion, prediction, point, serverNow } = input;
  if (prediction === undefined || point === undefined) return isMoving(person, motion, serverNow);
  // 冻在最后一个外推点上（2 s 没有任何回执）：画面就是没在动
  if (serverNow >= prediction.ts + PREDICTION_STALE_MS) return false;
  const end = prediction.path[prediction.path.length - 1];
  return end !== undefined && arcLengthAhead(point, prediction.path, end) > 0;
}

/**
 * 跟随的一步：朝目标**匀速**靠近，帧率无关（`docs/ui/DESIGN.md`「世界相机」的跟随行）。
 *
 * 不用 Phaser 的逐帧固定比例 lerp：那会让首帧步进正比于距离（实测跳 20~33px），且帧率一变速度就变。
 * 步长沿距离向量取而不是逐轴取，否则斜向靠近会比单轴快 √2 倍；`距离 ≤ 一步` 时直接落到目标，不越过。
 */
export function cameraStep(input: {
  scroll: { x: number; y: number };
  target: { x: number; y: number };
  dtMs: number;
  maxPxPerS: number;
}): { x: number; y: number } {
  const { scroll, target, dtMs, maxPxPerS } = input;
  const dx = target.x - scroll.x;
  const dy = target.y - scroll.y;
  const distance = Math.hypot(dx, dy);
  const step = (Math.max(0, maxPxPerS) * Math.max(0, dtMs)) / 1000;
  if (distance === 0 || distance <= step) return { x: target.x, y: target.y };
  return { x: scroll.x + (dx / distance) * step, y: scroll.y + (dy / distance) * step };
}

/**
 * 跟随的一步：朝**超出死区的那一段**靠近，而不是朝死区边缘靠近。
 *
 * 朝死区边缘靠：步长是「半个死区」，远大于小人一帧的位移，于是每拍都冲进死区、之后几帧一动不动——
 * 稳态走动时整幅画面每拍回跳一次（实测 28fps 与 38fps 都是 4 帧一个脉冲，幅值 = 单帧上限 500×dt）。
 * 靠「超出的那一段」正好把死区边缘钉在小人身上：稳态下相机步进 = 小人的步进，没有 0 帧；
 * 离得远（拖拽松手、点自己回中）时仍是 `maxPxPerS` 上限，追平段与修前一致。
 */
export function followStep(input: {
  /** 小人的取位点（渲染用的是**同一个**点，见 `personPoint`） */
  point: { x: number; y: number };
  /** 相机的视野中心（世界像素） */
  center: { x: number; y: number };
  halfWidth: number;
  halfHeight: number;
  dtMs: number;
  maxPxPerS: number;
}): { x: number; y: number } {
  const { point, center, halfWidth, halfHeight, dtMs, maxPxPerS } = input;
  const overshoot = {
    x: point.x - Math.min(Math.max(point.x, center.x - halfWidth), center.x + halfWidth),
    y: point.y - Math.min(Math.max(point.y, center.y - halfHeight), center.y + halfHeight),
  };
  if (overshoot.x === 0 && overshoot.y === 0) return center; // 还在死区里：镜头一动不动
  return cameraStep({
    scroll: center,
    target: { x: center.x + overshoot.x, y: center.y + overshoot.y },
    dtMs,
    maxPxPerS,
  });
}

/** 世界像素矩形（相机取景与夹取都在这个空间里算；1 世界像素 = 1 CSS 像素）。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 界面实占的像素高度（世界像素）：顶部 HUD 与底部聊天面板。 */
export interface ViewInsets {
  top: number;
  bottom: number;
}

/**
 * 元素相对**首屏**的布局顶边（只用 `offsetTop` / `offsetParent` 累加，**不读 `getBoundingClientRect`**）。
 *
 * 为什么要这个而不直接用 `getBoundingClientRect().top`：`.app-shell` 会带一层 `translateY`（iOS 聚焦时
 * 会把视觉视口往下 pan，靠它拉回屏幕，见 `docs/design/60-interaction-shell.md` §1）。而 `getBoundingClientRect()`
 * **吃得到** `transform`，取景、夹取就会跟着跳。`offsetTop` 是布局位置，不吃 `transform`。
 *
 * 签名用结构化类型而不是 `HTMLElement`：这个模块要能在不依赖 DOM 类型的环境里跑（`tsconfig` 的纯逻辑那份）。
 * `offsetParent` 为 `null` 时（`display:none` 或已在根）停止累加。
 */
export function layoutTopOf(element: LayoutOffsetNode): number {
  let top = 0;
  let node: LayoutOffsetNode | null = element;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as LayoutOffsetNode | null;
  }
  return top;
}

/** `layoutTopOf` 的入参形状：只要 `offsetTop` 与 `offsetParent`，不依赖 DOM 类型（同上一段）。 */
export interface LayoutOffsetNode {
  offsetTop: number;
  offsetParent: Element | null;
}

/**
 * 相机比例的夹取：**只缩不放**——上限恒为 1×（放大必然被放大采样而糊，见 `docs/ui/DESIGN.md`），
 * 下限是 `ZOOM_MIN`。非有限值（两指恰好重合时算出的 `Infinity` / `NaN`）退回 1×。
 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(1, Math.max(ZOOM_MIN, zoom));
}

/**
 * 可用视口（世界像素）= 视口 − 顶部 HUD − 底部聊天面板的**实际占位**
 * （`docs/ui/DESIGN.md`「世界相机」；占位指「从视口边缘量到界面内沿」，**含外边距**）。
 * 取景中心、垂直夹取、死区都按它算：按整视口算时最底一行永远压在聊天面板之下，走不到也点不到。
 *
 * 顶 + 底 ≥ 视口高（极端情况）时退回整个视口：宁可让底部被盖住，也不能把相机算崩。
 */
export function usableView(view: Rect, insets: ViewInsets): Rect {
  const height = view.height - insets.top - insets.bottom;
  if (height <= 0) return { ...view };
  return { x: view.x, y: view.y + insets.top, width: view.width, height };
}

/**
 * 相机夹取的范围（交给 Phaser 的 `setBounds`）：让**可用视口**贴着给定的矩形滚动。
 * 调用方传的是**取景范围**（`scrollRegionOf` = 地板区 + 墙带 + 墙外一圈，见 `20-layout.md` §3.2/§4）：
 * 推到边缘时能看见墙外的底与墙带，而不是只有一条贴着屏幕最外圈的细线。
 *
 * Phaser 夹的是整视口那个世界视窗矩形，所以要在 bounds 上把「被界面盖住的那一段」让出来：
 * y 上移 `insets.top`、height 加回顶 + 底（推法：视窗下沿最大 = `y + height − 视口高`，
 * 令它 + `insets.top` + 可用高 = 厅的下边缘）。可见区比厅大时照旧居中。
 */
export function cameraBounds(region: Rect, view: Rect, usable: Rect): Rect {  const width = Math.max(region.width, usable.width);
  const height = Math.max(region.height, usable.height);
  return {
    x: region.x - (width - region.width) / 2,
    y: region.y - (height - region.height) / 2 - (usable.y - view.y),
    width,
    height: height + (view.height - usable.height),
  };
}

/**
 * 可用带中心相对整视口中心的偏移（世界像素）：**回中时要从焦点里减去它**。
 *
 * 单独抽出来是因为**符号很容易写反**——写反的表现就是「点自己」把人物推到聊天面板那一边。
 * 底部界面占位通常大于顶部 → 可用带中心在视口中心**之上** → 偏移为负。
 */
export function usableCenterOffset(view: Rect, insets: ViewInsets): { x: number; y: number } {
  const usable = usableView(view, insets);
  return {
    x: usable.x + usable.width / 2 - (view.x + view.width / 2),
    y: usable.y + usable.height / 2 - (view.y + view.height / 2),
  };
}

/**
 * 软键盘对界面的唯一影响：视觉视口被往下 pan 了多少（`docs/ui/DESIGN.md`「软键盘」）。不碰 DOM。
 *
 * **不再算「键盘吃了多高」**。那一量在部分内核里根本测不出来（布局视口与视觉视口都不缩、或两者一起缩
 * 导致差值归零），而它曾被用来逐帧写 `.app-shell` 的 `inset-block-end`——那正是画布逐帧重建、闪烁的根。
 * 现在进入打字态时整组面板挪到顶部（`docs/design/60-interaction-shell.md` §2、§3），界面不需要知道键盘多高。
 *
 * `pan` 还是要读：iOS 聚焦时会平移视觉视口（`offsetTop > 0`），`.app-shell` 靠 `translateY` 把自己
 * 拉回屏幕。**这条只动 transform、不改尺寸**，因此不会引起画布重建。
 */
export interface KeyboardState {
  /** 视觉视口被往下 pan 的量（`visualViewport.offsetTop`）：iOS 聚焦输入框时会 pan */
  pan: number;
}

/** 纯函数：视觉视口 → pan 量。`viewport` 为 `null`（桌面 / 老浏览器）与 `offsetTop` 为负（取整抖动）都退回 0。 */
export function keyboardOf(viewport: { offsetTop: number } | null): KeyboardState {
  if (!viewport) return { pan: 0 };
  return { pan: Math.max(0, Math.round(viewport.offsetTop)) };
}

/** 画布像素尺寸的三个量：`resizeToHost` 算出来的那一份。 */
export interface Size {
  width: number;
  height: number;
  dpr: number;
}

/**
 * 冻结门（`docs/design/60-interaction-shell.md` §5）：软键盘的指纹是**宽度不变、高度变小**——
 * 打字期间这一种变化跳过 `scale.resize`（每次重建绘制缓冲就是一帧黑闪）。
 * 其余一律重算：宽度变、高度变高、DPR 变（换屏）、旋屏（宽高互换）都不受冻结影响。
 * **退场也不补算**：退场那一帧宿主往往还在键盘收起中途，照它重算就是先缩再涨（`world.ts` 的 `resizeToHost`）。
 */
export function shouldResize(prev: Size, next: Size, typing: boolean): boolean {
  return !(typing && next.width === prev.width && next.height < prev.height && next.dpr === prev.dpr);
}

/** 八个方位（世界像素的罗盘：上 = 北）。动作行的方向字形与 `bedDirection` 的结果是同一个概念。 */export type BedDirection = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 45° 一个扇区，从「东」起按屏幕顺时针排（`atan2` 的正方向在屏幕上朝下 = 南）。 */
const COMPASS: readonly BedDirection[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

/**
 * 我的床在**可用视口**的哪个方位；已经落在视口里时返回 `undefined`（不需要方向字形）。
 *
 * 吃的是 `usableView` 的结果而不是整视口：床压在聊天面板后面时它在屏幕上「看得见」，
 * 却不在**可用**区里——不提示方位用户就找不到它（见 `docs/ui/DESIGN.md`「世界相机」）。
 * 视口外的方位按「视口中心 → 床点」的连线取 45° 扇区；扇区边界归到 +角度那一侧（屏幕顺时针）。
 */
export function bedDirection(view: Rect, point: { x: number; y: number }): BedDirection | undefined {
  if (point.x >= view.x && point.x <= view.x + view.width && point.y >= view.y && point.y <= view.y + view.height) {
    return undefined;
  }
  const angle = Math.atan2(point.y - (view.y + view.height / 2), point.x - (view.x + view.width / 2));
  return COMPASS[Math.round(angle / (Math.PI / 4)) & 7];
}

/**
 * 一个人此刻画在哪（世界像素）：漫游中按插值（滞后取**这个窗口自己的跨度**），其余状态用给定的落位点。
 *
 * **渲染与相机跟随必须共用同一个返回值**：同一个人、同一帧、同一个 `serverNow` 只能取一次位。
 * 两处各取一次时，只要有一处用了上一次的窗口或另一个时刻，相机就会追着画面外的那个点走。
 */
export function personPoint(input: {
  person: Person;
  motion: Motion | undefined;
  /** 非漫游状态的落位点（自己的床 / 别人的床）；取不到就没得画 */
  bedPoint?: { x: number; y: number };
  serverNow: number;
}): { x: number; y: number } | undefined {
  const { person, motion, bedPoint, serverNow } = input;
  if (person.state !== 'roaming') return bedPoint;
  return motion ? positionAt(motion, serverNow - interpolationDelay(motion)) : { x: person.x, y: person.y };
}

/**
 * 进厅 / 重连时相机对准谁（见 `docs/api/20-api-ws.md` §5.1）：**首次进厅**对准我的床
 * （我知道我的床在哪），**重连**对准我的小人——宽限恢复会把我放回原位，可能在厅的另一头。
 * 各自缺一个就退到另一个；两个都没有时返回 `undefined`（调用方退回厅中心）。
 */
export function alignTargetOf(input: {
  reconnected: boolean;
  bedPoint?: { x: number; y: number };
  selfPoint?: { x: number; y: number };
}): { x: number; y: number } | undefined {
  return input.reconnected ? (input.selfPoint ?? input.bedPoint) : (input.bedPoint ?? input.selfPoint);
}

/**
 * 名字是**唯一的身份线索**（「那是谁」只能靠它），所以别人的名字一律常显：床上、站着、走动用同一个样式，
 * 不按状态分档（分档会暗示「床上那个人更真」）；自己一律不画（在地上的自己更不画）。
 */
export function shouldDrawName(person: Person, meId: string | undefined): boolean {
  return person.id !== meId;
}

/** 睡痕的小人整体降不透明度：不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色。 */
export function personAlpha(state: PersonState): number {
  return state === 'trace' ? TRACE_ALPHA : 1;
}

/**
 * 轻点命中（屏幕点已换算成**世界像素**）：人 > 自己 > 猫 > 床 > 地面（见 `docs/ui/DESIGN.md`、`80-reserve-decor.md` §3.6）。
 * 命中判定与渲染器无关，可单测。
 */

/** 人物当前位置（世界像素）。 */
export interface PersonSpot {
  id: string;
  x: number;
  y: number;
}

/** 轻点的命中半径（世界像素）：比一张床（61×100）小得多，点人是有意为之，不是「附近有人就算」。 */
export const PERSON_HIT_PX = 22;

const inReach = (spot: PersonSpot, point: { x: number; y: number }, radiusPx: number): boolean =>
  Math.hypot(spot.x - point.x, spot.y - point.y) <= radiusPx;

/** 半径内的人：命中多个时取 **y 最大**者（画面上更靠下 = 更靠前，与按 y 排序的遮挡一致）。 */
export function personHit(
  spots: readonly PersonSpot[],
  point: { x: number; y: number },
  radiusPx: number,
): PersonSpot | undefined {
  let best: PersonSpot | undefined;
  for (const spot of spots) {
    if (!inReach(spot, point, radiusPx)) continue;
    if (!best || spot.y > best.y) best = spot;
  }
  return best;
}

export type TapTarget =
  | { kind: 'select'; id: string }
  /** 点到自己的猫：演一下摸头 / 蹭手撒娇。**纯本地**，不产生任何上行（见 `80-reserve-decor.md` §3.6） */
  | { kind: 'pat' }
  | { kind: 'lie'; bedNo: number }
  | { kind: 'walk'; x: number; y: number }
  | { kind: 'recenter' }
  /**
   * 三类本地闸门的那一下：**只给提示，不发上行**（文案由世界层出，判据不该带文案）。
   * `occupied` = 这张床有人（`3002`）、`other-owned` = 这是别人的床（`3003`）、
   * `has-bed` = 我已经有一张床（本地闸门，服务端没有对应的拒因）。
   */
  | { kind: 'notice'; reason: 'occupied' | 'other-owned' | 'has-bed' }
  | { kind: 'none' };

export interface TapInput {
  /** 轻点的世界像素 */
  point: { x: number; y: number };
  /** 视野内的人（世界像素） */
  spots: readonly PersonSpot[];
  selfId?: string;
  /** 点到的那张床的占用者 id（含自己）；空床为 `undefined` */
  residentId?: string;
  bedNo?: number;
  /**
   * 这张床**有主**（`state.ownedBeds.has(bedNo)`）。归属是否过期客户端不知道，
   * 所以这里偏保守：过期但还没广播的空床也算「有主」（见 `docs/ui/DESIGN.md`「谁能躺」）。
   */
  owned?: boolean;
  /**
   * 我已经有主的床号（`me.ownedBedNo`）：换床的闸门靠它。它**只可能等于服务端那张床**——
   * 归属过期要 30 天不出现，而在线的人一直在刷 `last_seen_at`（见 `docs/db/schema.md`），
   * 所以不存在「服务端认为我没床、客户端认为我有床」的漂移。
   */
  ownedBedNo?: number;
  /**
   * 换床模式是否开着（`state.switching`）：模式内点无主空床才是换床。
   * 它只是**人的意图**，所以闸门在客户端；老 bundle（缓存未刷新）仍会点空床即换床，
   * 那是可接受的过渡态，见 `docs/api/20-api-ws.md` §4.5。
   */
  switching?: boolean;
  /**
   * 已经**吸附到街网**的目标点（`layout.nearestStreetPoint`）；那一带没有街网时为 `undefined`。
   * 服务端只校验街网、不做吸附，所以吸附必须发生在客户端（见 `docs/api/20-api-ws.md` §7）。
   */
  walkTarget?: { x: number; y: number };
  /**
   * 我的猫此刻的脚点（世界像素；没画出来时为 `undefined`）。它不在 `spots` 里——不是人，也不可选中，
   * 所以命中判定单独给一个圆；优先级：人 > 自己 > **猫** > 床 > 地面。猫站在走道上、
   * 可能压到床的一角，但点它只演一个本地动作，不产生任何上行，抢错也不会造成不可逆后果。
   */
  pet?: { x: number; y: number };
}

/**
 * 轻点该干什么：① 半径内的别人 → 选中；② 点自己 → 相机居中自己（不是「什么都不做」）；
 * ②’ 点到我的猫 → 演一下摸头 / 蹭手撒娇（纯本地，不发上行）；
 * ③ 可躺的床 → 躺下（**我还没床**、**就是我自己那张**、**换床模式里**这三种情形）；
 * ④ 床上有人（含自己）→ 见下面的床位分支；⑨ 可走的街网 → 走过去；⑩ 其余 → 什么都不做。
 * ② 与「点自己躺着的床」都要点到自己：前者是「把镜头拉回自己」，后者是床上那个位置本来就没有动作可做。
 *
 * **床格绝不能落成 `walk`**：服务端会回 `3006`，等于点了个空气。
 *
 * 床位分支的三类本地闸门按**服务端优先级**排（`3002` 有人 > `3003` 别人的床 > 本地「我有床」）：
 * 同一下点击命中多条时，提示要与服务端真收到意图时回的那条一致，否则用户看到两种说法。
 * 只有「我有别的床又不在模式里」是纯本地闸门（服务端会接受换床）。
 *
 * 为什么「我有别的床又不在模式里」要拦：换床会**当场释放旧床归属**（别人可以立刻捡走），而一次轻点的意图强度太低——
 * 用户大多只是点错了。旧床归属的代价不能由一次误点承担（见 `docs/design/00-master-design.md` §4）。
 */
export function tapTargetFor(input: TapInput): TapTarget {
  const { point, spots, selfId, residentId, bedNo, walkTarget, ownedBedNo, switching, owned, pet } = input;

  const other = personHit(
    spots.filter((spot) => spot.id !== selfId),
    point,
    PERSON_HIT_PX,
  );
  if (other) return { kind: 'select', id: other.id };

  // 点自己：相机居中自己——我知道我是谁，但常想找回自己在哪
  if (selfId !== undefined && spots.some((spot) => spot.id === selfId && inReach(spot, point, PERSON_HIT_PX))) {
    return { kind: 'recenter' };
  }

  // 点我的猫：演一下摸头 / 蹭手撒娇。它站在走道上（可能看似压着床角），先于床位判定
  if (pet !== undefined && petHitAt(point, pet)) return { kind: 'pat' };

  if (bedNo !== undefined) {
    // 自己躺着的床：什么都不做（服务端回 3004 静默），也免得本地外推白走一趟
    if (selfId !== undefined && residentId === selfId) return { kind: 'none' };
    if (residentId !== undefined) return { kind: 'notice', reason: 'occupied' };
    if (ownedBedNo === bedNo) return { kind: 'lie', bedNo };
    // 别人的床（有主、没人躺）优先于「我有床」这条本地闸门
    if (owned === true) return { kind: 'notice', reason: 'other-owned' };
    if (ownedBedNo !== undefined && switching !== true) return { kind: 'notice', reason: 'has-bed' };
    // 无主空床：我还没床（首次认领）/ 换床模式里
    return { kind: 'lie', bedNo };
  }
  return walkTarget ? { kind: 'walk', x: walkTarget.x, y: walkTarget.y } : { kind: 'none' };
}