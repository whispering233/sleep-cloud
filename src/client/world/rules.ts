import { ZOOM_MIN } from '../../shared/constants';
import type { Appearance, Person, PersonState } from '../../shared/protocol';
import { interpolationDelay, isInterpolating, positionAt } from '../motion';
import type { Motion } from '../motion';

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
 * 「这个人此刻还在走」：漫游中且插值窗口还没走完。渲染的摆动与相机跟随共用这一条判据
 * （两处各写一遍时，只要有处换了滞后口径，镜头与小人就会不同步）。
 */
export function isMoving(person: Person, motion: Motion | undefined, serverNow: number): boolean {
  return (
    person.state === 'roaming' && motion !== undefined && isInterpolating(motion, serverNow - interpolationDelay(motion))
  );
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
 * 软键盘吃掉的视口（`docs/ui/DESIGN.md`「软键盘」）：只算两个数，不碰 DOM。
 * 键盘是否打开 = 底部被吃掉的高度超过一个门槛：**地址栏收放时** `innerHeight` 与
 * `visualViewport.height` 同步变化（差 ≈ 0），所以这个判据不会被地址栏骗到；
 * 真键盘（iOS / Android）的差都在两百像素以上。
 *
 * **页面被捏合放大时必须直接判「没开」**：不禁用户缩放（`AGENTS.md` 硬纪律 18），而放大后
 * `visualViewport.height ≈ innerHeight / scale`，`scale` 只要超过 1.1 差额就破门槛——不拦的话，
 * 用户在面板上捏一下页面就会把整屏 UI 塌成上半截、还顺手涞把相机冻住。缩小（`scale < 1`，部分浏览器
 * 允许）不在此列：它让视觉视口比布局视口还高，`shrink` 本来就是 0。
 *
 * shortcut: 键盘滑入时跨过门槛之前的几帧仍走「尺寸变化」那条路（基线晚一点才记下），
 * 那几帧的偏差小于真键盘高度的一小截，等真机实测说它看得见再收紧口径。
 */
export const KEYBOARD_OPEN_PX = 80;

export interface KeyboardState {
  /** 键盘是否打开 */
  open: boolean;
  /** 底边被吃掉的高度（CSS px）= `innerHeight − visualViewport.height` */
  shrink: number;
  /** 视觉视口被往下 pan 的量（`visualViewport.offsetTop`）：iOS 聚焦输入框时会 pan */
  pan: number;
}

/** 纯函数：两个视口高度 → 键盘状态。`viewport` 为 `null`（桌面 / 老浏览器）与「视觉视口比布局视口还高」（取整抖动）都退回「没开、没缩」。 */
export function keyboardOf(
  innerHeight: number,
  viewport: { height: number; offsetTop: number; scale: number } | null,
): KeyboardState {
  if (!viewport) return { open: false, shrink: 0, pan: 0 };
  const shrink = Math.max(0, Math.round(innerHeight - viewport.height));
  // 放大过的页面不是键盘（见上面那段）：宁可退回「尺寸变化」那条路，也不能把 UI 塌成半屏
  const zoomed = viewport.scale > 1.01;
  return {
    open: !zoomed && shrink > KEYBOARD_OPEN_PX,
    shrink,
    pan: Math.max(0, Math.round(viewport.offsetTop)),
  };
}

/**
 * 软键盘的相机锚点补偿（`docs/ui/DESIGN.md`「软键盘」的相机锚点行）：
 * **键盘前视口左上角那一个世界点不动**——滚屏只按「旧视口顶 − 新视口顶」平移一遍。
 * 不重算取景中心：重算中心的表现就是人被推上去，收起时再弹回来。
 * 横向不变（键盘只吃掉底部）。
 *
 * 两个「视口顶」是同一个滚屏值之下量出来的 `viewRect().y`（变尺寸前后各量一次）。
 */
export function anchorScroll(input: {
  oldTop: number;
  newTop: number;
  scrollX: number;
  scrollY: number;
}): { x: number; y: number } {
  return { x: input.scrollX, y: input.scrollY + (input.oldTop - input.newTop) };
}

/**
 * 自己被键盘 / 面板吃掉时的**最小位移**（世界像素）：`0` = 一点不动；正数 = 镜头往下推（人往上露出来）；
 * 负数 = 往上拉回。推到「刚好露出」为止，不多推一像素——多推就是在重新取景。
 */
export function revealShift(input: { self: { x: number; y: number }; usable: Rect }): number {
  const bottom = input.usable.y + input.usable.height;
  if (input.self.y > bottom) return input.self.y - bottom;
  if (input.self.y < input.usable.y) return input.self.y - input.usable.y;
  return 0;
}

/** 八个方位（世界像素的罗盘：上 = 北）。HUD 的方向字形与 `bedDirection` 的结果是同一个概念。 */export type BedDirection = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

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

/** 名字只出现在**有人的床上**，且自己一律不画（地上的自己更不画）。 */
export function shouldDrawName(person: Person, meId: string | undefined): boolean {
  return person.state !== 'roaming' && person.id !== meId;
}

/** 睡痕的小人整体降不透明度：不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色。 */
export function personAlpha(state: PersonState): number {
  return state === 'trace' ? TRACE_ALPHA : 1;
}

/**
 * 睡痕到期由**客户端**按快照里的 `traceUntil` 自行淡出：服务端不写库、不广播、不起定时器
 * （见 `docs/api/20-api-ws.md` §4.2）。到点之后这条条目就不该再画出来。
 */
export function isFaded(person: Person, serverNow: number): boolean {
  return person.traceUntil !== undefined && person.traceUntil <= serverNow;
}

/**
 * 轻点命中（屏幕点已换算成**世界像素**）：人 > 空床 > 地面（见 `docs/ui/DESIGN.md`）。
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
  | { kind: 'lie'; bedNo: number }
  | { kind: 'walk'; x: number; y: number }
  | { kind: 'recenter' }
  /** 「已经有床了」的那一下：**只给提示，不发上行**（文案由世界层出，判据不该带文案） */
  | { kind: 'notice' }
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
}

/**
 * 轻点该干什么：① 半径内的别人 → 选中；② 点自己 → 相机居中自己（不是「什么都不做」）；
 * ③ 可躺的床 → 躺下（**我还没床**、**就是我自己那张**、**换床模式里**这三种情形）；
 * ④ 床上有人（含自己）→ 什么都不做；⑧ 我有别的床又不在模式里 → 只给提示（换床走显式模式）；
 * ⑨ 可走的街网 → 走过去；⑩ 其余 → 什么都不做。
 * ② 与 ④ 都要点到自己：前者是「把镜头拉回自己」，后者是床上那个位置本来就没有动作可做，别把两者合成一个 `none`。
 *
 * **床格绝不能落成 `walk`**：服务端会回 `3006`，等于点了个空气。
 *
 * 为什么「我有别的床又不在模式里」要拦：换床会**当场释放旧床归属**（别人可以立刻捡走），而一次轻点的意图强度太低——
 * 用户大多只是点错了。旧床归属的代价不能由一次误点承担（见 `docs/design/00-master-design.md` §4）。
 */
export function tapTargetFor(input: TapInput): TapTarget {
  const { point, spots, selfId, residentId, bedNo, walkTarget, ownedBedNo, switching } = input;

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

  if (bedNo !== undefined) {
    if (residentId !== undefined) return { kind: 'none' };
    // 无主空床：我还没床（首次认领）/ 目标就是我那张（躺着在床上点它会被服务端回 3004 静默）/ 模式内
    if (ownedBedNo === undefined || ownedBedNo === bedNo || switching === true) return { kind: 'lie', bedNo };
    return { kind: 'notice' };
  }
  return walkTarget ? { kind: 'walk', x: walkTarget.x, y: walkTarget.y } : { kind: 'none' };
}