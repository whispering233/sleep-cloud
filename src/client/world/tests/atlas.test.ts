import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ART_SCALE, BED_H, BED_W } from '../../../shared/constants';
import type { Appearance } from '../../../shared/protocol';
import { bedLook, personFrame } from '../rules';
import type { BedLook } from '../rules';

/**
 * 图集是**构建期产物**（`npm run art`），客户端按帧名取图。这里比对的是两者的接口：
 * 客户端会要的每一帧都在、尺寸与 `BED_W`/`BED_H` 对得上、锚点就是约定值。
 * 图集缺帧或换了尺寸时，靠目视验收发现太晚。
 */
const atlas = JSON.parse(readFileSync(join(process.cwd(), 'public', 'sprites', 'atlas.json'), 'utf8')) as {
  frames: Record<
    string,
    {
      frame: { x: number; y: number; w: number; h: number };
      spriteSourceSize: { x: number; y: number; w: number; h: number };
      sourceSize: { w: number; h: number };
      anchor: { x: number; y: number };
      face?: { x: number; y: number };
    }
  >;
  meta: { image: string; size: { w: number; h: number } };
};

const APPEARANCES: Appearance[] = ['boy', 'girl'];

/** 客户端可能问到的所有贴图（床位真值表 × 两种外观）。 */
const askedLooks: BedLook[] = [
  bedLook({ owned: false }),
  bedLook({ owned: true }),
  ...APPEARANCES.flatMap((appearance) =>
    (['lying', 'asleep', 'trace'] as const).map((state) => bedLook({ owned: true, occupant: { state, appearance } })),
  ),
];
const askedFrames = [...askedLooks.map((look) => look.frame), ...APPEARANCES.map((appearance) => personFrame(appearance))];

/**
 * 猫与篝火的帧：素材管线的白名单是 idle / walk / run / sleep / fire 五组（`pat` / `nuzzle` 不打）。
 * 动画按帧名前缀 + 序号取帧，所以这里也按同一规则点名。
 */
const numberedFrames = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
const CAT_FRAMES = [
  ...numberedFrames('cat-idle-', 8),
  ...numberedFrames('cat-walk-', 4),
  ...numberedFrames('cat-run-', 4),
  ...numberedFrames('cat-sleep-', 4),
];
const FIRE_FRAMES = numberedFrames('fire-', 6);
const DECOR_FRAMES = [...CAT_FRAMES, ...FIRE_FRAMES, 'fire-out'];

describe('图集与客户端的接口', () => {
  it('客户端会要的每一帧都在图集里（缺帧只会在画面里变成空白，靠目视发现太晚）', () => {
    expect(askedFrames.length).toBeGreaterThan(0);
    for (const name of askedFrames) expect(atlas.frames[name], name).toBeDefined();
  });

  it('每帧都带 Phaser 需要的裁剪字段，且 `sourceSize` 与帧一致', () => {
    for (const [name, frame] of Object.entries(atlas.frames)) {
      expect(frame.spriteSourceSize, name).toEqual({ x: 0, y: 0, w: frame.frame.w, h: frame.frame.h });
      expect(frame.sourceSize, name).toEqual({ w: frame.frame.w, h: frame.frame.h });
    }
  });

  it('床贴图的墨迹尺寸就是 BED_W × BED_H（素材 × ART_SCALE，高度丢的 0.5px 是有意的）', () => {
    for (const name of Object.keys(atlas.frames).filter((frame) => frame.startsWith('bed_'))) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, name).toBe(BED_W);
      expect(Math.trunc(frame.frame.h * ART_SCALE), name).toBe(BED_H);
    }
  });

  it('锚点就是约定的那两个：床 = 墨迹左上角、小人 = 墨迹底边中心', () => {
    const anchorOf = (name: string) => (name.startsWith('bed_') ? { x: 0, y: 0 } : { x: 0.5, y: 1 });
    for (const [name, frame] of Object.entries(atlas.frames)) {
      expect(frame.anchor, name).toEqual(anchorOf(name));
    }
  });

  it('frames.css 每帧一条规则，坐标与图集同源（入场层的形象预览按它取图）', () => {
    const css = readFileSync(join(process.cwd(), 'public', 'sprites', 'frames.css'), 'utf8');
    const rules = [
      ...css.matchAll(
        /\.sprite-(\S+) \{ width: (\d+)px; height: (\d+)px; background-image: url\('\.\/atlas\.png'\); background-position: -(\d+)px -(\d+)px; \}/g,
      ),
    ];
    expect(rules.length).toBe(Object.keys(atlas.frames).length);
    for (const [, name, w, h, x, y] of rules) {
      const frame = atlas.frames[name ?? ''];
      if (!frame) throw new Error(`frames.css 里的 ${name} 不在图集里`);
      expect(frame.frame, name).toEqual({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    }
  });

  it('脸部锚点只写在铺着人的那两张上，且落在帧内', () => {
    for (const [name, frame] of Object.entries(atlas.frames)) {
      const hasFace = name === 'bed_boy' || name === 'bed_girl';
      expect(frame.face === undefined, name).toBe(!hasFace);
      if (!frame.face) continue;
      expect(frame.face.x).toBeGreaterThan(0);
      expect(frame.face.x).toBeLessThan(frame.frame.w);
      expect(frame.face.y).toBeGreaterThan(0);
      expect(frame.face.y).toBeLessThan(frame.frame.h);
    }
  });

  it('图集本身是一张图（Phaser 按文件名去取它）', () => {
    expect(atlas.meta.image).toBe('atlas.png');
    expect(atlas.meta.size.w).toBe(256);
  });

  it('帧都落在图集里且互不重叠（打包错了会直接串图）', () => {
    const rects = Object.entries(atlas.frames).map(([name, frame]) => ({ name, ...frame.frame }));
    for (const rect of rects) {
      expect(rect.x, rect.name).toBeGreaterThanOrEqual(0);
      expect(rect.y, rect.name).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w, rect.name).toBeLessThanOrEqual(atlas.meta.size.w);
      expect(rect.y + rect.h, rect.name).toBeLessThanOrEqual(atlas.meta.size.h);
    }
    for (const [index, rect] of rects.entries()) {
      for (const other of rects.slice(index + 1)) {
        const apart =
          rect.x + rect.w <= other.x ||
          other.x + other.w <= rect.x ||
          rect.y + rect.h <= other.y ||
          other.y + other.h <= rect.y;
        expect(apart, `${rect.name} 与 ${other.name}`).toBe(true);
      }
    }
  });
});

describe('图集里的猫与篝火（多色素材，两支映射）', () => {
  it('猫 20 帧与篝火 7 帧都在图集里（缺一帧就是一段空动画）', () => {
    for (const name of DECOR_FRAMES) expect(atlas.frames[name], name).toBeDefined();
  });

  it('每帧的裁剪字段与帧一致，锚点是墨迹底边中心 {0.5, 1}', () => {
    for (const name of DECOR_FRAMES) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.spriteSourceSize, name).toEqual({ x: 0, y: 0, w: frame.frame.w, h: frame.frame.h });
      expect(frame.sourceSize, name).toEqual({ w: frame.frame.w, h: frame.frame.h });
      expect(frame.anchor, name).toEqual({ x: 0.5, y: 1 });
    }
  });

  it('猫帧的世界尺寸落在 38~50 × 38~58（只是防呆上界，不是语义真值）', () => {
    for (const name of CAT_FRAMES) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeGreaterThanOrEqual(38);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(50);
      expect(frame.frame.h * ART_SCALE, `${name} 高`).toBeGreaterThanOrEqual(38);
      expect(frame.frame.h * ART_SCALE, `${name} 高`).toBeLessThanOrEqual(58);
    }
  });

  it('篝火燃烧帧的世界宽度落在 46~50，熄灭帧的高度落在 19~23（火堆不能比床还大）', () => {
    for (const name of FIRE_FRAMES) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeGreaterThanOrEqual(46);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(50);
    }
    const out = atlas.frames['fire-out'];
    if (!out) throw new Error('图集里没有 fire-out');
    expect(out.frame.h * ART_SCALE).toBeGreaterThanOrEqual(19);
    expect(out.frame.h * ART_SCALE).toBeLessThanOrEqual(23);
  });

  it('`pat` / `nuzzle` 不进图集（`npm run art` 只打白名单里的五组）', () => {
    for (const name of Object.keys(atlas.frames)) {
      expect(/^(?:cat-)?(?:pat|nuzzle)/.test(name), name).toBe(false);
    }
  });
});
