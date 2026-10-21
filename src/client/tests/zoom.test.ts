import { describe, expect, it } from 'vitest';

import { ZOOM_TIERS } from '../../shared/constants';
import { sameZoomMode, zoomOptions, zoomShortLabel } from '../zoom';

describe('缩放档位', () => {
  it('文案：自由档写「自由」，固定档取档位表里那一档（同序同长，错位就红）', () => {
    expect(zoomShortLabel({ kind: 'free' })).toBe('自由');
    expect(ZOOM_TIERS.map((z) => zoomShortLabel({ kind: 'fixed', z }))).toEqual(['全厅', '0.5×', '0.75×', '1×']);
    expect(zoomShortLabel({ kind: 'fixed', z: 0.6 })).toBe('0.6×');
  });

  it('选项 = 自由缩放在前 + 每一个固定档，顺序与档位表一致', () => {
    expect(zoomOptions()).toEqual([{ kind: 'free' }, ...ZOOM_TIERS.map((z) => ({ kind: 'fixed', z }))]);
    expect(zoomOptions()).toHaveLength(ZOOM_TIERS.length + 1);
  });

  it('sameZoomMode 逐字段比较：同档相等，跨档 / 跨模式都不等', () => {
    expect(sameZoomMode({ kind: 'free' }, { kind: 'free' })).toBe(true);
    expect(sameZoomMode({ kind: 'fixed', z: 0.75 }, { kind: 'fixed', z: 0.75 })).toBe(true);
    expect(sameZoomMode({ kind: 'fixed', z: 0.75 }, { kind: 'fixed', z: 1 })).toBe(false);
    expect(sameZoomMode({ kind: 'free' }, { kind: 'fixed', z: ZOOM_TIERS[0] })).toBe(false);
    expect(sameZoomMode({ kind: 'fixed', z: ZOOM_TIERS[0] }, { kind: 'free' })).toBe(false);
  });
});
