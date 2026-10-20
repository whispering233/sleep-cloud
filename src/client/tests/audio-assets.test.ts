import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RAIN_INTRO_URL, RAIN_LOOP_URL } from '../../shared/constants';

interface WavInfo {
  channels: number;
  sampleRate: number;
  bits: number;
  seconds: number;
}

/**
 * 读 RIFF/WAVE 头：`docs/design/config.md` §4 规定的格式与时长由素材保证，
 * 而素材是加工后入库的（没有脚本管线），所以这里按字节守住它。
 */
function readWav(url: string): WavInfo {
  const bytes = readFileSync(join(process.cwd(), 'public', url));
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');

  let fmt: { channels: number; sampleRate: number; byteRate: number; bits: number } | undefined;
  let dataSize: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      expect(bytes.readUInt16LE(offset + 8)).toBe(1); // PCM
      fmt = {
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        byteRate: bytes.readUInt32LE(offset + 16),
        bits: bytes.readUInt16LE(offset + 22),
      };
    }
    if (id === 'data') dataSize = size;
    offset += 8 + size + (size % 2); // chunk 按偶数字节对齐
  }
  if (!fmt || dataSize === undefined) throw new Error(`${url} 不是完整的 WAV`);
  return { channels: fmt.channels, sampleRate: fmt.sampleRate, bits: fmt.bits, seconds: dataSize / fmt.byteRate };
}

describe('雨声素材（docs/design/config.md §4）', () => {
  it('主循环：单声道 / 32000 Hz / 16-bit PCM / 30.000 s', () => {
    expect(readWav(RAIN_LOOP_URL)).toEqual({ channels: 1, sampleRate: 32_000, bits: 16, seconds: 30 });
  });

  it('早播小循环：同一格式、8.000 s（它只负责尽快出声）', () => {
    expect(readWav(RAIN_INTRO_URL)).toEqual({ channels: 1, sampleRate: 32_000, bits: 16, seconds: 8 });
  });
});
