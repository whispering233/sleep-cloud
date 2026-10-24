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
  animations: Array<{ group: string; frames: string[]; frameRate: number; loop: boolean; out?: string }>;
  meta: { image: string; size: { w: number; h: number } };
};

/**
 * 源母图：`npm run art` 从它生成上面那份 `animations` 段。两边**按帧名数组对齐**——源的组标识是 `id`
 * （`pat` / `idle` / …），产物是帧名主干（`cat-pat` / `cat-idle` / …），没有一张 `id → 组标识` 的表可抄。
 */
const master = JSON.parse(
  readFileSync(join(process.cwd(), 'tools', 'art', 'masters', 'cat-all-sprites-atlas.json'), 'utf8'),
) as {
  animations: Array<{ id: string; fps: number; loop: boolean; frames: Array<{ name: string }>; out?: { name: string } }>;
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
 * 猫、篝火与南瓜灯的帧：**一律从产物的 `animations` 段派生**（素材管线的白名单是 idle / walk / run / pat /
 * nuzzle / sleep / fire / pumpkin 八组，源在 `tools/art/masters/cat-all-sprites-atlas.json`）。
 * 手抄一份帧表就会与产物脱节：动画少一帧只会在画面里变成空白。
 */
const framesOf = (group: string): string[] => {
  const spec = atlas.animations.find((anim) => anim.group === group);
  if (!spec) throw new Error(`图集里没有 ${group} 这一组动画`);
  return spec.frames;
};
const outOf = (group: string): string => {
  const out = atlas.animations.find((anim) => anim.group === group)?.out;
  if (!out) throw new Error(`图集里 ${group} 这一组没有熄灭帧`);
  return out;
};
const CAT_FRAMES = ['cat-idle', 'cat-walk', 'cat-run', 'cat-sleep', 'cat-pat', 'cat-nuzzle'].flatMap(framesOf);
const FIRE_FRAMES = framesOf('fire');
const PUMPKIN_FRAMES = framesOf('cat-pumpkin');
const DECOR_FRAMES = atlas.animations.flatMap((anim) => (anim.out ? [...anim.frames, anim.out] : anim.frames));

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

  it('frames.css 恰好两条规则：boy_stand / girl_stand，坐标与图集同源（入场层的形象预览按它取图）', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'client', 'styles', 'frames.css'), 'utf8');
    const rules = [
      ...css.matchAll(
        /\.sprite-(\S+) \{ width: (\d+)px; height: (\d+)px; background-image: url\('\.\.\/assets\/sprites\/atlas\.png'\); background-position: -(\d+)px -(\d+)px; \}/g,
      ),
    ];
    expect(rules.map(([, name]) => name)).toEqual(['boy_stand', 'girl_stand']);
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
  it('产物 animations 与源母图逐组等价（组标识集合、帧名与顺序、帧率、循环、熄灭帧）', () => {
    const sourceOf = new Map(master.animations.map((anim) => [anim.frames.map((frame) => frame.name).join(' '), anim]));
    expect(atlas.animations.length).toBe(master.animations.length);
    for (const anim of atlas.animations) {
      const source = sourceOf.get(anim.frames.join(' '));
      if (!source) throw new Error(`母图里没有帧名为 ${anim.frames.join(' / ')} 的那一组`);
      expect(anim.frameRate, anim.group).toBe(source.fps);
      expect(anim.loop, anim.group).toBe(source.loop);
      expect(anim.out, anim.group).toBe(source.out?.name);
    }
  });

  it('animations 里的每一帧与熄灭帧都在图集 frames 里（名字写错就是一帧空白）', () => {
    for (const anim of atlas.animations) {
      for (const name of anim.frames) expect(atlas.frames[name], name).toBeDefined();
      if (anim.out) expect(atlas.frames[anim.out], anim.out).toBeDefined();
    }
  });

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
    for (const anim of atlas.animations) {
      const sizes = new Set(anim.frames.map((frame) => sizeOf(frame)));
      expect(sizes.size, anim.group).toBe(1);
    }
    // 站立的五组还要彼此同框：idle ⇄ walk ⇄ run ⇄ 摸头/蹭手切换时身体不能跳
    const standing = ['cat-idle', 'cat-walk', 'cat-run', 'cat-pat', 'cat-nuzzle'].map((group) =>
      sizeOf(framesOf(group)[0]),
    );
    expect(new Set(standing).size).toBe(1);
    // 熄灭帧与燃烧 / 点亮帧同框：切帧时柴堆、石圈与南瓜不能位移
    for (const group of ['fire', 'cat-pumpkin']) expect(sizeOf(outOf(group))).toBe(sizeOf(framesOf(group)[0]));
  });

  it('南瓜灯帧的世界宽度不超过床头块（56），否则会压到隔壁格', () => {
    for (const name of [...PUMPKIN_FRAMES, outOf('cat-pumpkin')]) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(56);
    }
  });

  it('篝火帧的世界宽度落在 46~50（火堆不能比床还大）', () => {
    for (const name of [...FIRE_FRAMES, outOf('fire')]) {
      const frame = atlas.frames[name];
      if (!frame) throw new Error(`图集里没有 ${name}`);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeGreaterThanOrEqual(46);
      expect(frame.frame.w * ART_SCALE, `${name} 宽`).toBeLessThanOrEqual(50);
    }
  });

  it('摸猫的两组帧都在图集里（点一下才有的看，缺帧只会变成空白）', () => {
    for (const group of ['cat-pat', 'cat-nuzzle']) {
      expect(framesOf(group)[0]).toBeDefined();
      expect(framesOf(group).at(-1)).toBeDefined();
    }
  });
});
