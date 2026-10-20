import { ZOOM_TIERS } from '../shared/constants';
import { defaultRainAt } from './weather';
import type { ZoomMode } from './zoom';

/**
 * 客户端本地偏好（见 `docs/design/40-client-storage.md`）。
 * **`localStorage` 只出现在这一个模块**：调用点不手写键名，也不散落 feature detect。
 */

/** 值形状版本号，写在值里（放键名里会让旧键残留）。改形状递增它，旧值自动判废、不写迁移代码。 */
const PREFS_VERSION = 1;

/** 键的唯一真源（镜像 `docs/design/40-client-storage.md` §3 的登记表）。 */
export const PREFS = {
  zoomMode: 'sc.zoom.mode',
  weatherRain: 'sc.weather.rain',
  aboutSeen: 'sc.about.seen',
} as const;

export type PrefKey = (typeof PREFS)[keyof typeof PREFS];

/** `localStorage` 的最小门面：单测塞假 storage，也不依赖 DOM 的 `Storage` 类型（测试编译图无 DOM lib）。 */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 取要用的 storage：**有没有 `localStorage` 的判定只写在这一处**（Node 单测没有它；浏览器禁用持久化
 * 时它可能抛）。没有就返回 `undefined` → 读一律默认、写一律丢弃。
 *
 * 这里的 `try` 不是多余：策略禁止持久化时（用户禁掉站点数据 / 不透明源），**连读这个属性都会抛
 * `SecurityError`**，不裹就会在模块加载那一刻把整个页面拖崩。
 */
function resolveStorage(injected?: PrefStorage): PrefStorage | undefined {
  if (injected) return injected;
  try {
    return (globalThis as { localStorage?: PrefStorage }).localStorage;
  } catch {
    return undefined;
  }
}

/** 读到坏值 / 版本不符时顺手删该键（删也可能抛，静默）。不删就永久循环判废。 */
function removeQuietly(storage: PrefStorage, key: PrefKey): void {
  try {
    storage.removeItem(key);
  } catch {
    // 隐私模式 / 配额满：删不掉就下次启动再判废一次，用户照常玩
  }
}

/** 值形状的版本门：版本不符的旧值一律判废（与键名里的版本不同，这里不需要清理遍历）。 */
function isCurrentVersion(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { v?: unknown }).v === PREFS_VERSION;
}

/**
 * 读一个偏好（`docs/design/40-client-storage.md` §2）：`getItem` → `JSON.parse` → 查 `v` → 跑 `isValid`
 * （**白名单**，不允许「任意 JSON 都收」）→ 任一环失败返回 `fallback` 并删该键。**读的是不可信输入。**
 */
export function readPref<T>(
  key: PrefKey,
  isValid: (value: unknown) => value is T,
  fallback: T,
  storage?: PrefStorage,
): T {
  const store = resolveStorage(storage);
  if (!store) return fallback;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!isCurrentVersion(parsed) || !isValid(parsed)) {
    removeQuietly(store, key);
    return fallback;
  }
  return parsed;
}

/**
 * 写一个偏好：写不进去（隐私模式 / 配额满）**只丢这一次写入**——不弹提示、不重试、不降级到
 * `sessionStorage`（静默类错误不弹提示，用户照常玩，只是下次不记得）。
 */
export function writePref(key: PrefKey, value: unknown, storage?: PrefStorage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // 静默丢弃
  }
}

/** `sc.zoom.mode` 的值形状：`mode` 是 `"free"` 或恰好等于 `ZOOM_TIERS` 里的某一档。 */
type StoredZoomMode = { v: number; mode: 'free' | (typeof ZOOM_TIERS)[number] };

const DEFAULT_ZOOM_PREF: StoredZoomMode = { v: PREFS_VERSION, mode: 'free' };

/** 白名单：`mode` 等于 `"free"`，或**恰好等于 `ZOOM_TIERS` 里的某个比例**（`0.6` 这种连续值不收）。 */
function isStoredZoomMode(value: unknown): value is StoredZoomMode {
  if (typeof value !== 'object' || value === null) return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === 'free' || (ZOOM_TIERS as readonly unknown[]).includes(mode);
}

/** 读 `sc.zoom.mode`：缺键 / 坏 JSON / 版本不符 / 非法 `mode` 一律回 `自由缩放`（缺键即默认）。 */
export function readZoomMode(storage?: PrefStorage): ZoomMode {
  const { mode } = readPref(PREFS.zoomMode, isStoredZoomMode, DEFAULT_ZOOM_PREF, storage);
  return mode === 'free' ? { kind: 'free' } : { kind: 'fixed', z: mode };
}

/** 写 `sc.zoom.mode`：切回 `自由缩放` 也照写一条（**写入路径只一条**，不做「free 就删键」的第二条分支）。 */
export function writeZoomMode(mode: ZoomMode, storage?: PrefStorage): void {
  writePref(PREFS.zoomMode, { v: PREFS_VERSION, mode: mode.kind === 'free' ? 'free' : mode.z }, storage);
}

/** `sc.weather.rain` 的值形状：`rain` 必须是布尔。 */
type StoredWeatherRain = { v: number; rain: boolean };

function isStoredWeatherRain(value: unknown): value is StoredWeatherRain {
  return typeof value === 'object' && value !== null && typeof (value as { rain?: unknown }).rain === 'boolean';
}

/**
 * 读 `sc.weather.rain`：缺键时按**启动那一刻**的本地日历日奇偶初始化（全表唯一的非常量默认）。
 * `now` 只在缺键时被读一次、跨零点也不重算——半夜让眼前天气无声翻转是没人要的动画。
 */
export function readWeatherRain(now: Date = new Date(), storage?: PrefStorage): boolean {
  const fallback: StoredWeatherRain = { v: PREFS_VERSION, rain: defaultRainAt(now) };
  return readPref(PREFS.weatherRain, isStoredWeatherRain, fallback, storage).rain;
}

/** 写 `sc.weather.rain`：切到「无雨」也照写（**写入路径只一条**，`false` 不是「删键」）。 */
export function writeWeatherRain(rain: boolean, storage?: PrefStorage): void {
  writePref(PREFS.weatherRain, { v: PREFS_VERSION, rain }, storage);
}

/** `sc.about.seen` 的值形状：`seen` 是**公告版本**（与 `ANNOUNCE.version` 逐字比较，不是发布版本）。 */
type StoredAboutSeen = { v: number; seen: string };

/**
 * 白名单：`seen` 是非空字符串且 ≤ 32 字符（`docs/design/40-client-storage.md` §3）。
 * **不校验版本号格式**：坏值唯一的后果是再弹一次面板（无副作用）。
 */
function isStoredAboutSeen(value: unknown): value is StoredAboutSeen {
  if (typeof value !== 'object' || value === null) return false;
  const seen = (value as { seen?: unknown }).seen;
  return typeof seen === 'string' && seen.length > 0 && seen.length <= 32;
}

/** 读 `sc.about.seen`：缺键 = 从未确认过任何公告（首访），回 `undefined`。 */
export function readAboutSeen(storage?: PrefStorage): string | undefined {
  return readPref<StoredAboutSeen | undefined>(PREFS.aboutSeen, isStoredAboutSeen, undefined, storage)?.seen;
}

/** 写 `sc.about.seen`：值就是那一刻的公告版本（只有自动路径且勾选着关才写）。 */
export function writeAboutSeen(version: string, storage?: PrefStorage): void {
  writePref(PREFS.aboutSeen, { v: PREFS_VERSION, seen: version }, storage);
}
