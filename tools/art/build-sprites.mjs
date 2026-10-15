#!/usr/bin/env node
/**
 * 构建期素材管线：`WheatCloudSleep` 的 5 张母图 → 8 张贴图 → 一张图集。
 *
 * 三条规则来自 `docs/ui/DESIGN.md`「构建期要产出的变体」：
 * 1. **两色渐变映射**：按亮度在黑线端点与白填充端点之间插值（母图是 2 色 + 抗锯齿灰，
 *    只替换两个色值会让边缘烂成锯齿），白填充映射为 `paper` 或**透明**（空芯）；
 * 2. **裁到墨迹 bbox**（bbox 由脚本算，不硬编码），并输出锚点：
 *    床 = 墨迹左上角对齐格左上角，小人 = 墨迹底边中心对齐站立点；
 * 3. 产物是**提交物**（`public/sprites/`），`npm run art` 重新生成；**不挂进 `npm run build`**。
 *
 * 色值只从 `docs/ui/DESIGN.md` 的 frontmatter 读（脚本里不写第二份）。
 * 不新增依赖：PNG 读写用 `node:zlib` 自己做（8-bit RGBA、非隔行——母图就是这种格式）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MASTERS = join(ROOT, 'tools', 'art', 'masters');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const DESIGN = join(ROOT, 'docs', 'ui', 'DESIGN.md');
const LICENSE_OUT = join(OUT_DIR, 'LICENSE-wheatcloudsleep.txt');
/** 图集宽度取 256（2 列床 = 2×122 + 间隙）：够宽、又不浪费填充率。 */
const ATLAS_WIDTH = 256;
const GAP = 1;

/**
 * 8 张贴图（`docs/ui/DESIGN.md`「构建期要产出的变体」）：
 * `fill: null` = 白填充映射为透明（空芯，地板直接透出来）。
 */
const VARIANTS = [
  { name: 'bed_empty_hollow', master: 'bedEmpty', ink: 'claimed', fill: null },
  { name: 'bed_empty_owned', master: 'bedEmpty', ink: 'claimed', fill: 'paper' },
  { name: 'bed_boy', master: 'bedBoy', ink: 'line', fill: 'paper' },
  { name: 'bed_girl', master: 'bedGirl', ink: 'line', fill: 'paper' },
  { name: 'bed_boy_trace', master: 'bedBoy', ink: 'trace', fill: 'paper' },
  { name: 'bed_girl_trace', master: 'bedGirl', ink: 'trace', fill: 'paper' },
  { name: 'boy_stand', master: 'Boy', ink: 'neutral', fill: 'paper' },
  { name: 'girl_stand', master: 'Girl', ink: 'neutral', fill: 'paper' },
];

/** 锚点：床贴图的墨迹左上角 = 格子左上角；小人贴图的墨迹底边中心 = 站立点。 */
const BED_ANCHOR = { x: 0, y: 0 };
const STAND_ANCHOR = { x: 0.5, y: 1 };

// ————————————————————————— 设计令牌（唯一来源：DESIGN.md frontmatter） —————————————————————————

/** 读 frontmatter 的 `colors:` 块。宁可在这里报错，也不要让素材悄悄用上别的颜色。 */
function readColors() {
  const block = readFileSync(DESIGN, 'utf8').split(/^---$/m)[1] ?? '';
  const colors = {};
  let inColors = false;
  for (const line of block.split('\n')) {
    if (/^colors:\s*$/.test(line)) {
      inColors = true;
      continue;
    }
    if (!inColors) continue;
    const match = /^ {2}([a-z-]+):\s*"(#[0-9a-fA-F]{6})"/.exec(line);
    if (!match) {
      if (line.trim() !== '') inColors = false;
      continue;
    }
    colors[match[1]] = rgb(match[2]);
  }
  return colors;
}

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

// ————————————————————————— 最小 PNG 读写（8-bit RGBA、非隔行） —————————————————————————

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function decodePng(buffer) {
  let offset = 8;
  let width;
  let height;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('只支持 8-bit RGBA 非隔行 PNG');
    }
    if (type === 'IDAT') idat.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? current[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      const value = line[i];
      let out;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + a; break;
        case 2: out = value + b; break;
        case 3: out = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知的 PNG 行过滤器 ${filter}`);
      }
      current[i] = out & 0xff;
    }
    current.copy(data, y * stride);
    previous = current;
  }
  return { width, height, data };
}

function encodePng(width, height, data) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ————————————————————————— 墨迹 bbox、渐变映射、脸部锚点 —————————————————————————

const luminance = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** 墨迹 bbox = 所有非全透明像素的包围盒（母图的画布是 256×256，画在中间）。 */
function inkBox(image) {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('母图是空的（没有任何非透明像素）');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 两色渐变映射 + 裁到 bbox。
 *
 * 亮度 0 = 黑线端点（`ink`），亮度 1 = 白填充端点（`fill`；为 `null` 时映射成**透明**）。
 * 母图的 alpha 是覆盖率，所以输出 alpha = 覆盖率 × 这一端的 alpha——透明的母图像素不会
 * 因为「亮度=0（黑）」而被画成不透明的黑块。空芯里透明像素的 RGB 一律留墨色，
 * 免得线性采样时 0-alpha 邻居把地板拉出黑边。
 */
function mapFrame(image, box, ink, fill) {
  const out = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y += 1) {
    for (let x = 0; x < box.w; x += 1) {
      const source = ((box.y + y) * image.width + (box.x + x)) * 4;
      const r = image.data[source];
      const g = image.data[source + 1];
      const b = image.data[source + 2];
      const cover = image.data[source + 3] / 255;
      const t = luminance(r, g, b);
      const target = (y * box.w + x) * 4;
      out[target] = Math.round(ink.r + ((fill?.r ?? ink.r) - ink.r) * t);
      out[target + 1] = Math.round(ink.g + ((fill?.g ?? ink.g) - ink.g) * t);
      out[target + 2] = Math.round(ink.b + ((fill?.b ?? ink.b) - ink.b) * t);
      out[target + 3] = Math.round(cover * (1 - (fill ? 0 : t)) * 255);
    }
  }
  return out;
}

/** 4 邻域连通块（面积 + bbox），用于「哪块是床铺、哪块是脸」。 */
function regions(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const found = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (seen[y * width + x] || !mask(x, y)) continue;
      const stack = [[x, y]];
      seen[y * width + x] = 1;
      let area = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (seen[ny * width + nx] || !mask(nx, ny)) continue;
          seen[ny * width + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      found.push({ area, minX, minY, maxX, maxY });
    }
  }
  return found;
}

/**
 * 脸部锚点（供「睁眼躺姿叠两个点」）：脸是**整张床铺之上**那块最大的白填充连通块
 * （床铺 = 最大的白填充块，被子 + 床板一直连到底边）。
 *
 * - **x** = 脸框的水平中心（两个点对称叠在脸上）；
 * - **y** = 脸框高 40% 处——这个比例是**在 `bedBoy` 上量的**（脸 37..76、闭着的眼 49..57）；
 *   取暗色像素包围盒的中心会把点压到鼻子上去（鼻孔与皱纹也是暗的）。
 *
 * 两张床图推出来：男帧内 (61.5, 31)、女 (61.5, 33.4)，都是以帧左上角（= 墨迹左上角）为原点。
 * 已知偏差：男孩真正的双眼中点在 x = 68（推导值是脸框中心 61.5）——偏移 6.5 母图像素（3.2 世界像素），
 * 两个点因此叠在脸上而不是压在原图那两道闭眼弧上。
 */
function faceAnchor(image, box) {
  const isFilled = (x, y) => {
    const offset = (y * image.width + x) * 4;
    return (
      image.data[offset + 3] > 200 &&
      luminance(image.data[offset], image.data[offset + 1], image.data[offset + 2]) > 0.78
    );
  };
  const blocks = regions(isFilled, image.width, image.height).sort((a, b) => b.area - a.area);
  const bedding = blocks[0];
  if (!bedding) return undefined;
  const face = blocks.filter((block) => block !== bedding && block.maxY < bedding.minY)[0];
  if (!face) return undefined;

  const EYE_LINE_IN_FACE = 0.4;
  const round = (value) => Math.round(value * 10) / 10;
  return {
    x: round((face.minX + face.maxX) / 2 - box.x),
    y: round(face.minY + EYE_LINE_IN_FACE * (face.maxY - face.minY + 1) - box.y),
  };
}

// ————————————————————————— 图集打包 —————————————————————————

/** 货架打包：从左往右放，放不下就换下一行。帧之间留 1px 透明间隔，避免线性采样串色。 */
function pack(sizes) {
  const placements = {};
  let x = GAP;
  let y = GAP;
  let shelfHeight = 0;
  for (const size of sizes) {
    if (x + size.w + GAP > ATLAS_WIDTH) {
      x = GAP;
      y += shelfHeight + GAP;
      shelfHeight = 0;
    }
    placements[size.name] = { x, y, w: size.w, h: size.h };
    x += size.w + GAP;
    shelfHeight = Math.max(shelfHeight, size.h);
  }
  const height = y + shelfHeight + GAP;
  const pot = 2 ** Math.ceil(Math.log2(height));
  return { placements, height: pot };
}

// ————————————————————————— 主流程 —————————————————————————

function main() {
  const colors = readColors();
  const inkOf = (name) => {
    const value = colors[name];
    if (!value) throw new Error(`docs/ui/DESIGN.md 里没有颜色 ${name}`);
    return value;
  };

  const masters = new Map();
  const load = (name) => {
    if (!masters.has(name)) masters.set(name, decodePng(readFileSync(join(MASTERS, `${name}.png`))));
    return masters.get(name);
  };

  const frames = [];
  const report = [];
  for (const variant of VARIANTS) {
    const image = load(variant.master);
    const box = inkBox(image);
    const mapped = mapFrame(image, box, inkOf(variant.ink), variant.fill ? inkOf(variant.fill) : null);
    // 脸部锚点只对「床上有人且清醒」那条路径有用：只有铺着人的两张床图有脸
    const face = variant.name === 'bed_boy' || variant.name === 'bed_girl' ? faceAnchor(image, box) : undefined;
    frames.push({
      name: variant.name,
      master: variant.master,
      w: box.w,
      h: box.h,
      pixels: mapped,
      anchor: variant.name.startsWith('bed_') ? BED_ANCHOR : STAND_ANCHOR,
      face,
      fill: variant.fill ?? '透明（空芯）',
      ink: variant.ink,
    });
  }

  const { placements, height } = pack(frames);
  const atlas = Buffer.alloc(ATLAS_WIDTH * height * 4);
  for (const frame of frames) {
    const at = placements[frame.name];
    for (let y = 0; y < frame.h; y += 1) {
      frame.pixels.copy(
        atlas,
        ((at.y + y) * ATLAS_WIDTH + at.x) * 4,
        y * frame.w * 4,
        (y + 1) * frame.w * 4,
      );
    }
  }
  const atlasPng = encodePng(ATLAS_WIDTH, height, atlas);

  const json = {
    frames: Object.fromEntries(
      frames.map((frame) => {
        const at = placements[frame.name];
        return [
          frame.name,
          {
            frame: { x: at.x, y: at.y, w: frame.w, h: frame.h },
            rotated: false,
            trimmed: false,
            // 帧就是裁到墨迹 bbox 的这一块，没有再裁一层；坐标空间 = 帧左上角（= 锚点所在处）
            spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
            sourceSize: { w: frame.w, h: frame.h },
            // Phaser 按它设原点：床 = 墨迹左上角，小人 = 墨迹底边中心
            anchor: frame.anchor,
            ...(frame.face ? { face: frame.face } : {}),
          },
        ];
      }),
    ),
    meta: {
      app: 'tools/art/build-sprites.mjs',
      version: '1.0',
      image: 'atlas.png',
      format: 'RGBA8888',
      size: { w: ATLAS_WIDTH, h: height },
      scale: '1',
    },
    masters: Object.fromEntries(
      [...masters].map(([name, image]) => {
        const box = inkBox(image);
        return [name, { file: `masters/${name}.png`, ink: box }];
      }),
    ),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'atlas.png'), atlasPng);
  writeFileSync(join(OUT_DIR, 'atlas.json'), `${JSON.stringify(json, null, 2)}\n`);

  const license = readFileSync(join(MASTERS, 'LICENSE'), 'utf8');
  for (const required of ['MIT License', 'Copyright (c) 2022 WheatBox']) {
    if (!license.includes(required)) throw new Error(`tools/art/masters/LICENSE 里缺「${required}」`);
  }
  writeFileSync(
    LICENSE_OUT,
    [
      '素材来源与用途：本目录下的 atlas.png / atlas.json 由 WheatCloudSleep 的 5 张母图',
      '（Art/Legacy/Boy.png、Girl.png、bedEmpty.png、bedBoy.png、bedGirl.png）构建而成，',
      '用于 sleep-cloud 世界层的床位与小人渲染。以下为上游许可原文（未改动）。',
      '',
      license,
    ].join('\n'),
  );

  for (const frame of frames) {
    report.push(
      [
        `  ${frame.name.padEnd(17)}`,
        `${frame.w}×${frame.h}`.padEnd(9),
        (frame.anchor.x === 0 ? '锚点 左上角' : '锚点 底边中心').padEnd(14),
        `脸部锚点 ${frame.face ? `(${frame.face.x}, ${frame.face.y})` : '—'}`.padEnd(23),
        `${frame.master} 墨迹 黑→${frame.ink} 白→${frame.fill === '透明（空芯）' ? '透明' : frame.fill}`,
      ].join(' '),
    );
  }
  console.log(`素材管线：${DESIGN} 的色值 → ${MASTERS} 的 ${masters.size} 张母图`);
  console.log(report.join('\n'));
  console.log(
    `图集：public/sprites/atlas.png ${ATLAS_WIDTH}×${height}（${atlasPng.length} 字节）、` +
      `public/sprites/atlas.json（${JSON.stringify(json).length} 字节）`,
  );
  console.log(`许可：public/sprites/LICENSE-wheatcloudsleep.txt 在位（${license.length} 字节，MIT / © 2022 WheatBox）`);
}

main();