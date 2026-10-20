import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RAIN_INTRO_URL, RAIN_LOOP_URL } from '../../shared/constants';

interface WavInfo {
  channels: number;
  sampleRate: number;
  bits: number;
  seconds: number;
  /** 峰值电平（dBFS）：素材重编码后响度会静默漂移，所以连电平一起守 */
  peakDb: number;
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
  let dataOffset = 0;
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
    if (id === 'data') {
      dataSize = size;
      dataOffset = offset + 8;
    }
    offset += 8 + size + (size % 2); // chunk 按偶数字节对齐
  }
  if (!fmt || dataSize === undefined) throw new Error(`${url} 不是完整的 WAV`);
  let peak = 0;
  for (let offset = dataOffset; offset + 1 < dataOffset + dataSize; offset += 2) {
    const sample = Math.abs(bytes.readInt16LE(offset));
    if (sample > peak) peak = sample;
  }
  return {
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bits: fmt.bits,
    seconds: dataSize / fmt.byteRate,
    peakDb: 20 * Math.log10(peak / 32_768),
  };
}

describe('雨声素材（docs/design/config.md §4）', () => {
  it('主循环：单声道 / 32000 Hz / 16-bit PCM / 30.000 s / 峰值约 -3 dBFS', () => {
    const info = readWav(RAIN_LOOP_URL);
    expect(info).toMatchObject({ channels: 1, sampleRate: 32_000, bits: 16, seconds: 30 });
    // 加工时统一过 +6 dB，峰值落在 -3.1 dBFS；留一格余量，只抓「重编码把响度改了」这种漂移
    expect(info.peakDb).toBeGreaterThan(-6);
    expect(info.peakDb).toBeLessThan(-1);
  });

  it('早播小循环：同一格式、8.000 s（它只负责尽快出声）', () => {
    const info = readWav(RAIN_INTRO_URL);
    expect(info).toMatchObject({ channels: 1, sampleRate: 32_000, bits: 16, seconds: 8 });
    expect(info.peakDb).toBeGreaterThan(-6);
    expect(info.peakDb).toBeLessThan(-1);
  });
});
