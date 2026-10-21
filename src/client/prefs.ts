import { TYPE_TEXTS_PER_CATEGORY, ZOOM_TIERS } from '../shared/constants';
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
  weather: 'sc.weather',
  sound: 'sc.sound',
  aboutSeen: 'sc.about.seen',
  readSeen: 'sc.read.seen',
} as const;

export type PrefKey = (typeof PREFS)[keyof typeof PREFS];

/**
 * v0.0.6 及更早的键：类型写进了键名、值是布尔。**读到就删**：形状与现行 id 无法互转，
 * 而不迁移的代价只是「偏好丢了回默认、功能完好」（`40-client-storage.md` §3）。
 */
const LEGACY_KEYS = ['sc.weather.rain', 'sc.audio.rain'] as const;

/** 读偏好前顺手清掉旧键（删也可能抛，静默）；两种读取共用，所以放在读取入口里而不是调用点。 */
function dropLegacyPrefs(storage?: PrefStorage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  for (const key of LEGACY_KEYS) {
    try {
      store.removeItem(key);
    } catch {
      // 隐私模式 / 配额满：删不掉就下次启动再试，用户照常玩
    }
  }
}

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

/** 天气 id（`sc.weather` 的 `kind`）：**加一种天气就是往这张表里加一行**，不开新键。 */
export type WeatherKind = 'none' | 'rain';

/** 声道 id（`sc.sound` 的 `kind`）：加一种白噪音同理。 */
export type SoundKind = 'none' | 'rain';

const WEATHER_KINDS: readonly WeatherKind[] = ['none', 'rain'];
const SOUND_KINDS: readonly SoundKind[] = ['none', 'rain'];

/** 白名单：`kind` 必须在这张 id 表里（**不接受表外字符串**，也不接受旧的布尔形状）。 */
function isStoredKind<K extends string>(kinds: readonly K[]) {
  return (value: unknown): value is { v: number; kind: K } =>
    typeof value === 'object' &&
    value !== null &&
    (kinds as readonly unknown[]).includes((value as { kind?: unknown }).kind);
}

/**
 * 读 `sc.weather`：缺键（或读到的值判废）→ `none`（无雨）。默认值是常量，不读日期也不读时钟
 * （`40-client-storage.md` §3：全表默认值都是常量）。
 */
export function readWeather(storage?: PrefStorage): WeatherKind {
  dropLegacyPrefs(storage);
  const fallback = { v: PREFS_VERSION, kind: 'none' } as const;
  return readPref(PREFS.weather, isStoredKind(WEATHER_KINDS), fallback, storage).kind;
}

/** 写 `sc.weather`：切回「无雨」也照写（**写入路径只一条**，`none` 不是「删键」）。 */
export function writeWeather(kind: WeatherKind, storage?: PrefStorage): void {
  writePref(PREFS.weather, { v: PREFS_VERSION, kind }, storage);
}

/**
 * 读 `sc.sound`：缺键（或读到的值判废）→ `none`（静音）。与天气各自独立（`40-client-storage.md` §3）：
 * 第一次打开不出声，外放场景的代价不该由默认值替用户承担。
 */
export function readSound(storage?: PrefStorage): SoundKind {
  dropLegacyPrefs(storage);
  const fallback = { v: PREFS_VERSION, kind: 'none' } as const;
  return readPref(PREFS.sound, isStoredKind(SOUND_KINDS), fallback, storage).kind;
}

/** 写 `sc.sound`：切到「静音」也照写（同天气，`none` 不是「删键」）。 */
export function writeSound(kind: SoundKind, storage?: PrefStorage): void {
  writePref(PREFS.sound, { v: PREFS_VERSION, kind }, storage);
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

/** 分类 id / 条目 id 的长度上限（与数据包校验、`40-client-storage.md` §3 白名单同一量）。 */
const READ_ID_MAX_LEN = 32;

/** `sc.read.seen` 的值：`seen` = 每个分类抽到过的条目 id，`current` = 每个分类的当前条。 */
export type ReadProgress = {
  seen: Record<string, string[]>;
  current: Record<string, string>;
};

type StoredReadProgress = ReadProgress & { v: number };

function isReadId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= READ_ID_MAX_LEN;
}

function isReadMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.entries(value).every(([key, id]) => isReadId(key) && isReadId(id));
}

function isSeenMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, ids]) =>
      isReadId(key) &&
      Array.isArray(ids) &&
      ids.length <= TYPE_TEXTS_PER_CATEGORY &&
      ids.every((id) => isReadId(id)),
  );
}

/** 白名单只收形状（`40-client-storage.md` §3）：多出来的字段不是错误，只是不读。 */
function isStoredReadProgress(value: unknown): value is StoredReadProgress {
  if (typeof value !== 'object' || value === null) return false;
  const { seen, current } = value as { seen?: unknown; current?: unknown };
  return isSeenMap(seen) && isReadMap(current);
}

/** 读 `sc.read.seen`：缺键 / 坏值 / 版本不符一律回「一条都没读过、没有当前条」。 */
export function readProgress(storage?: PrefStorage): ReadProgress {
  const fallback: ReadProgress = { seen: {}, current: {} };
  const { seen, current } = readPref(PREFS.readSeen, isStoredReadProgress, { v: PREFS_VERSION, ...fallback }, storage);
  return { seen, current };
}

/** 写 `sc.read.seen`：`seen` 与 `current` **一次写落**，不出现「当前条写了、seen 没写」的中间态。 */
export function writeProgress(progress: ReadProgress, storage?: PrefStorage): void {
  writePref(PREFS.readSeen, { v: PREFS_VERSION, ...progress }, storage);
}
