import { describe, expect, it } from 'vitest';

import { readDoc, tableRows } from '../../shared/tests/doc';
import { TYPE_TEXTS_PER_CATEGORY } from '../../shared/constants';
import { LOT_POOL_SIZE } from '../lots';
import {
  PREFS,
  readAboutSeen,
  readDecor,
  readLot,
  readProgress,
  readSound,
  readWeather,
  readZoomMode,
  writeAboutSeen,
  writeDecor,
  writeLot,
  writeProgress,
  writeSound,
  writeWeather,
} from '../prefs';
import type { PrefStorage } from '../prefs';
import { getState, setRain, setSound, setZoomMode } from '../store';

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

describe('天气偏好（sc.weather）', () => {
  it('缺键 → 无雨（默认值是常量），且不因此写入一条键', () => {
    const storage = fakeStorage();
    expect(readWeather(storage)).toBe('none');
    expect(storage.data.has(PREFS.weather)).toBe(false);
  });

  it('读回写下的值；`false` 也照写（单写入路径，不做「无雨就删键」）', () => {
    const storage = fakeStorage();
    writeWeather('rain', storage);
    expect(readWeather(storage)).toBe('rain');
    writeWeather('none', storage);
    expect(JSON.parse(storage.data.get(PREFS.weather) ?? '')).toEqual({ v: 1, kind: 'none' });
    expect(readWeather(storage)).toBe('none');
  });

  it('坏 JSON / 版本不符 / 表外 kind → 无雨，且该键已被删（不删就永久循环判废）', () => {
    const raws = ['{不是 JSON', JSON.stringify({ v: 2, kind: 'rain' }), JSON.stringify({ v: 1, kind: 'snow' })];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.weather, raw);
      expect(readWeather(storage)).toBe('none');
      expect(storage.data.has(PREFS.weather)).toBe(false);
    }
  });

  it('setRain 写 store 与偏好；同值不写', () => {
    const storage = fakeStorage();
    (globalThis as { localStorage?: PrefStorage }).localStorage = storage;
    try {
      const next = !getState().rain;
      setRain(next);
      expect(getState().rain).toBe(next);
      expect(JSON.parse(storage.data.get(PREFS.weather) ?? '')).toEqual({ v: 1, kind: next ? 'rain' : 'none' });

      storage.data.delete(PREFS.weather);
      setRain(next);
      expect(storage.data.has(PREFS.weather)).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: PrefStorage }).localStorage;
    }
  });
});

describe('说明面板已读（sc.about.seen）', () => {
  it('缺键 → undefined（首访），且不因此写入一条键', () => {
    const storage = fakeStorage();
    expect(readAboutSeen(storage)).toBeUndefined();
    expect(storage.data.has(PREFS.aboutSeen)).toBe(false);
  });

  it('写后读回：落盘形状是 { v: 1, seen }', () => {
    const storage = fakeStorage();
    writeAboutSeen('0.0.7', storage);
    expect(JSON.parse(storage.data.get(PREFS.aboutSeen) ?? '')).toEqual({ v: 1, seen: '0.0.7' });
    expect(readAboutSeen(storage)).toBe('0.0.7');
  });

  it('坏 JSON / 版本不符 / 空串 / 非字符串 / 超 32 字符 → undefined，且该键已被删', () => {
    const raws = [
      '{不是 JSON',
      JSON.stringify({ v: 2, seen: '0.0.7' }),
      JSON.stringify({ v: 1, seen: '' }),
      JSON.stringify({ v: 1, seen: 7 }),
      JSON.stringify({ v: 1, seen: 'x'.repeat(33) }),
    ];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.aboutSeen, raw);
      expect(readAboutSeen(storage)).toBeUndefined();
      expect(storage.data.has(PREFS.aboutSeen)).toBe(false);
    }
  });

  it('长度边界：正好 32 字符收，33 字符判废（不校验版本号格式）', () => {
    const storage = fakeStorage();
    writeAboutSeen(`1.0.0-${'x'.repeat(26)}`, storage);
    expect(readAboutSeen(storage)).toHaveLength(32);
    storage.data.set(PREFS.aboutSeen, JSON.stringify({ v: 1, seen: 'y'.repeat(33) }));
    expect(readAboutSeen(storage)).toBeUndefined();
  });
});

describe('阅读进度（sc.read.seen）', () => {
  it('缺键 → 两边都是空映射（一条都没读过），且不因此写入一条键', () => {
    const storage = fakeStorage();
    expect(readProgress(storage)).toEqual({ seen: {}, current: {} });
    expect(storage.data.has(PREFS.readSeen)).toBe(false);
  });

  it('写后读回；落盘形状是 { v: 1, seen, current }，两个字段一起落地', () => {
    const storage = fakeStorage();
    writeProgress({ seen: { joke: ['j1', 'j3'] }, current: { joke: 'j3' } }, storage);
    expect(JSON.parse(storage.data.get(PREFS.readSeen) ?? '')).toEqual({
      v: 1,
      seen: { joke: ['j1', 'j3'] },
      current: { joke: 'j3' },
    });
    expect(readProgress(storage)).toEqual({ seen: { joke: ['j1', 'j3'] }, current: { joke: 'j3' } });
  });

  it('坏 JSON / 版本不符 / 形状不对 → 回默认，且该键已被删', () => {
    const tooMany = Array.from({ length: TYPE_TEXTS_PER_CATEGORY + 1 }, (_, i) => `j${i}`);
    const raws = [
      '{不是 JSON',
      JSON.stringify({ v: 2, seen: {}, current: {} }),
      JSON.stringify({ v: 1, seen: ['j1'], current: {} }),
      JSON.stringify({ v: 1, seen: {}, current: { joke: 7 } }),
      JSON.stringify({ v: 1, seen: { joke: ['j1'] }, current: { [`x`.repeat(33)]: 'j1' } }),
      JSON.stringify({ v: 1, seen: { joke: ['y'.repeat(33)] }, current: {} }),
      JSON.stringify({ v: 1, seen: { joke: tooMany }, current: {} }),
    ];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.readSeen, raw);
      expect(readProgress(storage)).toEqual({ seen: {}, current: {} });
      expect(storage.data.has(PREFS.readSeen)).toBe(false);
    }
  });

  it('每类正好 120 条仍收；多出来的字段不是错误（只是不读）', () => {
    const storage = fakeStorage();
    const ids = Array.from({ length: TYPE_TEXTS_PER_CATEGORY }, (_, i) => `j${i}`);
    storage.data.set(
      PREFS.readSeen,
      JSON.stringify({ v: 1, seen: { joke: ids }, current: { joke: 'j0' }, extra: 'ignored' }),
    );
    expect(readProgress(storage).seen.joke).toHaveLength(TYPE_TEXTS_PER_CATEGORY);
    expect(readProgress(storage).current.joke).toBe('j0');
  });
});

describe('雨声偏好（sc.sound）', () => {
  it('缺键 → 静音（默认值是常量），且不因此写入一条键', () => {
    const storage = fakeStorage();
    expect(readSound(storage)).toBe('none');
    expect(storage.data.has(PREFS.sound)).toBe(false);
  });

  it('读回写下的值；`false` 也照写（单写入路径，不做「静音就删键」）', () => {
    const storage = fakeStorage();
    writeSound('rain', storage);
    expect(readSound(storage)).toBe('rain');
    writeSound('none', storage);
    expect(JSON.parse(storage.data.get(PREFS.sound) ?? '')).toEqual({ v: 1, kind: 'none' });
    expect(readSound(storage)).toBe('none');
  });

  it('坏 JSON / 版本不符 / 表外 kind → 静音，且该键已被删', () => {
    const raws = ['{不是 JSON', JSON.stringify({ v: 2, kind: 'rain' }), JSON.stringify({ v: 1, kind: 'fan' })];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.sound, raw);
      expect(readSound(storage)).toBe('none');
      expect(storage.data.has(PREFS.sound)).toBe(false);
    }
  });

  it('setSound 只动声音：写 store 与自己的键，不碰天气；反之亦然', () => {
    const storage = fakeStorage();
    (globalThis as { localStorage?: PrefStorage }).localStorage = storage;
    try {
      const rainBefore = getState().rain;
      const sound = !getState().sound;
      setSound(sound);
      expect(getState().sound).toBe(sound);
      expect(getState().rain).toBe(rainBefore);
      expect(JSON.parse(storage.data.get(PREFS.sound) ?? '')).toEqual({ v: 1, kind: sound ? 'rain' : 'none' });
      expect(storage.data.has(PREFS.weather)).toBe(false);

      setRain(!rainBefore);
      expect(getState().sound).toBe(sound);
      expect(storage.data.has(PREFS.sound)).toBe(true);
    } finally {
      delete (globalThis as { localStorage?: PrefStorage }).localStorage;
    }
  });
});

describe('求签（`sc.lot`，`docs/design/110-lot.md` §3）', () => {
  it('缺键 → `undefined`（= 今天没求过）', () => {
    expect(readLot(fakeStorage())).toBeUndefined();
  });

  it('写下的值原样读回，形状是 `{v, date, no}`', () => {
    const storage = fakeStorage();
    writeLot({ date: '2026-10-22', no: 7 }, storage);
    expect(JSON.parse(storage.data.get(PREFS.lot) ?? '')).toEqual({ v: 1, date: '2026-10-22', no: 7 });
    expect(readLot(storage)).toEqual({ date: '2026-10-22', no: 7 });
  });

  it('`no` 越界 / 非整数 / `date` 形状不符 → 删键 + 当没求过（坏值唯一后果就是再求一次）', () => {
    const raws = [
      JSON.stringify({ v: 1, date: '2026-10-22', no: LOT_POOL_SIZE }),
      JSON.stringify({ v: 1, date: '2026-10-22', no: 1.5 }),
      JSON.stringify({ v: 1, date: '2026/10/22', no: 7 }),
      JSON.stringify({ v: 1, date: '2026-10-22' }),
    ];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.lot, raw);
      expect(readLot(storage)).toBeUndefined();
      expect(storage.data.has(PREFS.lot)).toBe(false);
    }
  });

  it('版本不符 → 删键 + 当没求过（不写迁移代码）', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.lot, JSON.stringify({ v: 2, date: '2026-10-22', no: 7 }));
    expect(readLot(storage)).toBeUndefined();
    expect(storage.data.has(PREFS.lot)).toBe(false);
  });
});

describe('预留位装饰（`sc.decor`，`docs/design/80-reserve-decor.md` §4）', () => {
  it('缺键 → 全回默认（篝火 + 猫 = 选择上线前的行为），且不因此写入一条键', () => {
    const storage = fakeStorage();
    expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'cat' });
    expect(storage.data.has(PREFS.decor)).toBe(false);
  });

  it('写后原样读回；落盘形状是 `{ v: 1, head, foot }`（一个键管所有块）', () => {
    const storage = fakeStorage();
    writeDecor({ head: 'none', foot: 'cat' }, storage);
    expect(JSON.parse(storage.data.get(PREFS.decor) ?? '')).toEqual({ v: 1, head: 'none', foot: 'cat' });
    expect(readDecor(storage)).toEqual({ head: 'none', foot: 'cat' });
  });

  it('`none` 能存能读回（它是「我关了」，不是「没写过」）', () => {
    const storage = fakeStorage();
    writeDecor({ head: 'fire', foot: 'none' }, storage);
    expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'none' });
    writeDecor({ head: 'none', foot: 'none' }, storage);
    expect(readDecor(storage)).toEqual({ head: 'none', foot: 'none' });
  });

  it('坏 JSON / 版本不符 / 根本不是对象 → **全回默认**，且该键已被删（与其它键同一条口径）', () => {
    const raws = [
      '{不是 JSON',
      JSON.stringify({ v: 2, head: 'none', foot: 'none' }),
      JSON.stringify(['fire', 'cat']),
      JSON.stringify('fire'),
    ];
    for (const raw of raws) {
      const storage = fakeStorage();
      storage.data.set(PREFS.decor, raw);
      expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'cat' });
      expect(storage.data.has(PREFS.decor)).toBe(false);
    }
  });

  it('表外 id 只回**该块**默认，另一块保留（坏值的粒度是块，键不删）', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.decor, JSON.stringify({ v: 1, head: 'lamp', foot: 'none' }));
    expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'none' });
    // 不是整键判废：另一块的选择得留着，下次写入也不会把用户的选择抹平
    expect(storage.data.has(PREFS.decor)).toBe(true);

    storage.data.set(PREFS.decor, JSON.stringify({ v: 1, head: 'none', foot: 'dog' }));
    expect(readDecor(storage)).toEqual({ head: 'none', foot: 'cat' });
  });

  it('**跨块 id** 不通过：猫搬不到床头块、火搬不到床尾块，两块各自回自己的默认', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.decor, JSON.stringify({ v: 1, head: 'cat', foot: 'none' }));
    expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'none' });

    storage.data.set(PREFS.decor, JSON.stringify({ v: 1, head: 'none', foot: 'fire' }));
    expect(readDecor(storage)).toEqual({ head: 'none', foot: 'cat' });
  });

  it('缺块 / 非字符串的值也只影响自己那一块', () => {
    const storage = fakeStorage();
    storage.data.set(PREFS.decor, JSON.stringify({ v: 1, foot: 'none' }));
    expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'none' });

    storage.data.set(PREFS.decor, JSON.stringify({ v: 1, head: 7, foot: 'cat' }));
    expect(readDecor(storage)).toEqual({ head: 'fire', foot: 'cat' });
  });
});

describe('旧键（v0.0.6 及更早）', () => {
  it('读取时把两条旧键删掉：不迁移，偏好回默认', () => {
    const storage = fakeStorage();
    storage.data.set('sc.weather.rain', JSON.stringify({ v: 1, rain: true }));
    storage.data.set('sc.audio.rain', JSON.stringify({ v: 1, on: true }));
    expect(readWeather(storage)).toBe('none');
    expect(readSound(storage)).toBe('none');
    expect(storage.data.has('sc.weather.rain')).toBe(false);
    expect(storage.data.has('sc.audio.rain')).toBe(false);
  });
});

describe('键登记表镜像（docs/design/40-client-storage.md §3）', () => {
  it('文档里的键集合 === prefs.ts 的 PREFS 注册表', () => {
    const rows = tableRows(
      readDoc('design/40-client-storage.md'),
      '## 3. 键登记表',
      '## 4. 非目标与候选项',
    );
    const documented = rows.map(([key]) => (key ?? '').replaceAll('`', '')).sort();
    expect(documented).toEqual(Object.values(PREFS).sort());
  });
});
