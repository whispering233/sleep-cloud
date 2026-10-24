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
const atlas = JSON.parse(readFileSync(join(process.cwd(), 'src', 'client', 'assets', 'sprites', 'atlas.json'), 'utf8')) as {
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
 * 猫、篝火与南瓜灯的帧：素材管线的白名单是 idle / walk / run / pat / nuzzle / sleep / fire / pumpkin 八组。
 * 动画按帧名前缀 + 序号取帧，所以这里也按同一规则点名。
 */
const numberedFrames = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
const CAT_FRAMES = [
  ...numberedFrames('cat-idle-', 8),
  ...numberedFrames('cat-walk-', 4),
  ...numberedFrames('cat-run-', 4),
  ...numberedFrames('cat-sleep-', 4),
  ...numberedFrames('cat-pat-', 6),
  ...numberedFrames('cat-nuzzle-', 6),
];
const FIRE_FRAMES = numberedFrames('fire-', 6);
/** 南瓜灯：床头块第二个候选（6 帧亮 + 1 张灭帧，与篝火同一套视图，见 `../views.ts` 的 `HEAD_DECOR_SKINS`）。 */
const PUMPKIN_FRAMES = numberedFrames('cat-pumpkin-', 6);
const DECOR_FRAMES = [...CAT_FRAMES, ...FIRE_FRAMES, ...PUMPKIN_FRAMES, 'fire-out', 'pumpkin-out'];

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
    const css = readFileSync(join(process.cwd(), 'src', 'client', 'styles', 'frames.css'), 'utf8');
    const rules = [
      ...css.matchAll(
        /\.sprite-(\S+) \{ width: (\d+)px; height: (\d+)px; background-image: url\('\.\.\/assets\/sprites\/atlas\.png'\); background-position: -(\d+)px -(\d+)px; \}/g,
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

describe('图集里的猫、篝火与南瓜灯（多色素材，两支映射）', () => {
  it('猫 32 帧、篝火 7 帧与南瓜灯 7 帧都在图集里（缺一帧就是一段空动画）', () => {
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

  it('猫帧的世界尺寸落在 38~56 × 38~60（只是防呆上界，不是语义真值）', () => {
    for (const name of CAT_FRAMES) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeGreaterThanOrEqual(38);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(56);
      expect(frame.frame.h * ART_SCALE, `${name} 高`).toBeGreaterThanOrEqual(38);
      expect(frame.frame.h * ART_SCALE, `${name} 高`).toBeLessThanOrEqual(60);
    }
  });

  it('同一个动作的帧共用一个裁框（逐帧各裁 bbox 会让锚点随帧宽漂移，静止时看起来左右抽动）', () => {
    const sizeOf = (name: string) => {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      return `${frame.frame.w}x${frame.frame.h}`;
    };
    for (const [prefix, count] of [
      ['cat-idle-', 8],
      ['cat-walk-', 4],
      ['cat-run-', 4],
      ['cat-sleep-', 4],
      ['cat-pat-', 6],
      ['cat-nuzzle-', 6],
      ['fire-', 6],
    ] as const) {
      const sizes = new Set(Array.from({ length: count }, (_, index) => sizeOf(`${prefix}${index + 1}`)));
      expect(sizes.size, prefix).toBe(1);
    }
    // 站立的五组还要彼此同框：idle ⇄ walk ⇄ run ⇄ 摸头/蹭手切换时身体不能跳
    expect(
      new Set([
        sizeOf('cat-idle-1'),
        sizeOf('cat-walk-1'),
        sizeOf('cat-run-1'),
        sizeOf('cat-pat-1'),
        sizeOf('cat-nuzzle-1'),
      ]).size,
    ).toBe(1);
    // 熄灭帧与燃烧帧同框：切帧时柴堆与石圈不能位移
    expect(sizeOf('fire-out')).toBe(sizeOf('fire-1'));
    // 灭帧与亮帧同框：切亮灭时南瓜不能位移
    expect(sizeOf('pumpkin-out')).toBe(sizeOf('cat-pumpkin-1'));
  });

  it('南瓜灯帧的世界宽度不超过床头块（56），否则会压到隔壁格', () => {
    for (const name of [...PUMPKIN_FRAMES, 'pumpkin-out']) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(56);
    }
  });

  it('篝火帧的世界宽度落在 46~50（火堆不能比床还大）', () => {
    for (const name of [...FIRE_FRAMES, 'fire-out']) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeGreaterThanOrEqual(46);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(50);
    }
  });

  it('摸猫的两组帧都在图集里（点一下才有的看，缺帧只会变成空白）', () => {
    for (const prefix of ['cat-pat-', 'cat-nuzzle-'] as const) {
      expect(atlas.frames[`${prefix}1`]).toBeDefined();
      expect(atlas.frames[`${prefix}6`]).toBeDefined();
    }
  });
});
