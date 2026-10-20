import { describe, expect, it } from 'vitest';

import { readDoc, tableRows } from '../../shared/tests/doc';
import { PREFS, readWeatherRain, readZoomMode, writeWeatherRain } from '../prefs';
import type { PrefStorage } from '../prefs';
import { getState, setRain, setZoomMode } from '../store';

/** 假 storage：单测跑在 Node（没有 `localStorage`），读写都走这张表。 */
const fakeStorage = (): PrefStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

describe('缩放档位偏好（sc.zoom.mode）', () => {
  it('缺键 → 默认值（自由缩放）', () => {
    expect(readZoomMode(fakeStorage())).toEqual({ kind: 'free' });
  });

  it('坏 JSON → 默认值，且该键已被删（不删就永久循环判废）', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.zoomMode, '{不是 JSON');
    expect(readZoomMode(storage)).toEqual({ kind: 'free' });
    expect(storage.data.has(PREFS.zoomMode)).toBe(false);
  });

  it('版本不符 → 默认值，且该键已被删（旧值不写迁移代码，自动判废）', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.zoomMode, JSON.stringify({ v: 2, mode: 0.75 }));
    expect(readZoomMode(storage)).toEqual({ kind: 'free' });
    expect(storage.data.has(PREFS.zoomMode)).toBe(false);
  });

  it('非法 mode → 默认值，且该键已被删（白名单：free 或恰好等于 ZOOM_TIERS 里某一档）', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.zoomMode, JSON.stringify({ v: 1, mode: '9x' }));
    expect(readZoomMode(storage)).toEqual({ kind: 'free' });
    expect(storage.data.has(PREFS.zoomMode)).toBe(false);

    // 连续比例（0.6 不在档位表里）同样不是合法偏好
    storage.data.set(PREFS.zoomMode, JSON.stringify({ v: 1, mode: 0.6 }));
    expect(readZoomMode(storage)).toEqual({ kind: 'free' });
    expect(storage.data.has(PREFS.zoomMode)).toBe(false);

    // 合法档照常读回来
    storage.data.set(PREFS.zoomMode, JSON.stringify({ v: 1, mode: 0.75 }));
    expect(readZoomMode(storage)).toEqual({ kind: 'fixed', z: 0.75 });
  });

  it('setItem 抛错（配额满 / 隐私模式）不抛出去，内存里的档位照常生效', () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    (globalThis as { localStorage?: PrefStorage }).localStorage = storage;
    try {
      expect(() => setZoomMode({ kind: 'fixed', z: 0.75 })).not.toThrow();
      expect(getState().zoomMode).toEqual({ kind: 'fixed', z: 0.75 });
      // 切回 `自由缩放` 走的是同一条写入路径（不做「free 就删键」的第二条分支）
      expect(() => setZoomMode({ kind: 'free' })).not.toThrow();
      expect(getState().zoomMode).toEqual({ kind: 'free' });
    } finally {
      delete (globalThis as { localStorage?: PrefStorage }).localStorage;
    }
  });

  it('连读 localStorage 属性都抛（策略禁止持久化）时不崩：读回默认、写静默丢弃', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: 站点数据被禁止');
      },
    });
    try {
      expect(readZoomMode()).toEqual({ kind: 'free' });
      expect(() => setZoomMode({ kind: 'fixed', z: 0.75 })).not.toThrow();
      expect(getState().zoomMode).toEqual({ kind: 'fixed', z: 0.75 });
    } finally {
      delete (globalThis as { localStorage?: PrefStorage }).localStorage;
    }
  });
});

describe('天气偏好（sc.weather.rain）', () => {
  /** 缺键时的日期默认（`docs/design/config.md` §4 的公式）。 */
  const datedDefault = (y: number, m: number, d: number): boolean =>
    Math.floor(Date.UTC(y, m, d) / 86_400_000) % 2 === 1;

  it('缺键 → 日期默认（相邻日相反），且不因此写入一条键', () => {
    const storage = fakeStorage();
    expect(readWeatherRain(new Date(2024, 0, 15), storage)).toBe(datedDefault(2024, 0, 15));
    expect(readWeatherRain(new Date(2024, 0, 16), storage)).toBe(!datedDefault(2024, 0, 15));
    expect(storage.data.has(PREFS.weatherRain)).toBe(false);
  });

  it('读回写下的值；`false` 也照写（单写入路径，不做「无雨就删键」）', () => {
    const storage = fakeStorage();
    writeWeatherRain(false, storage);
    expect(JSON.parse(storage.data.get(PREFS.weatherRain) ?? '')).toEqual({ v: 1, rain: false });
    // 已有键时日期默认不参与
    expect(readWeatherRain(new Date(2024, 0, 15), storage)).toBe(false);
  });

  it('坏 JSON / 版本不符 / 非布尔 rain → 日期默认，且该键已被删（不删就永久循环判废）', () => {
    const raws = ['{不是 JSON', JSON.stringify({ v: 2, rain: true }), JSON.stringify({ v: 1, rain: 'yes' })];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.weatherRain, raw);
      expect(readWeatherRain(new Date(2024, 0, 15), storage)).toBe(datedDefault(2024, 0, 15));
      expect(storage.data.has(PREFS.weatherRain)).toBe(false);
    }
  });

  it('setRain 写 store 与偏好；同值不写', () => {
    const storage = fakeStorage();
    (globalThis as { localStorage?: PrefStorage }).localStorage = storage;
    try {
      const next = !getState().rain;
      setRain(next);
      expect(getState().rain).toBe(next);
      expect(JSON.parse(storage.data.get(PREFS.weatherRain) ?? '')).toEqual({ v: 1, rain: next });

      storage.data.delete(PREFS.weatherRain);
      setRain(next);
      expect(storage.data.has(PREFS.weatherRain)).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: PrefStorage }).localStorage;
    }
  });
});

describe('键登记表镜像（docs/design/40-client-storage.md §3）', () => {
  it('文档里的键集合 === prefs.ts 的 PREFS 注册表', () => {
    const rows = tableRows(
      readDoc('design/40-client-storage.md'),
      '## 3. 键登记表',
      '**`sc.zoom.mode` 的语义**',
    );
    const documented = rows.map(([key]) => (key ?? '').replaceAll('`', '')).sort();
    expect(documented).toEqual(Object.values(PREFS).sort());
  });
});