import tokens from '../styles/tokens.json';

/**
 * 世界画布的色值全部来自 `npm run tokens` 从 `docs/ui/DESIGN.md` 导出的 JSON：
 * **JS 里不写死色值**。注意不能读 CSS 变量——Tailwind 会把没被用到的主题变量裁掉。
 */
const colors = tokens.theme.extend.colors as Record<string, string>;

export interface WorldPalette {
  background: number;
  /** 场景结构线（墙、地板缝） */
  structure: number;
  /** 轮廓梯次：床上有人 > 睡痕 > 有主空床 > 不画 */
  bed: { line: number; trace: number; claimed: number };
  /** 暖灯标记（只用于「是我的」与床头灯） */
  marker: number;
  ink: number;
  inkMuted: number;
}

function color(name: string): number {
  const hex = colors[name];
  if (!hex) throw new Error(`设计令牌里没有 ${name}（先跑 npm run tokens）`);
  return Number.parseInt(hex.replace('#', ''), 16);
}

export function palette(mode: 'day' | 'night'): WorldPalette {
  const day = mode === 'day';
  return {
    background: color(day ? 'day-bg' : 'primary'),
    structure: color(day ? 'day-line' : 'line'),
    bed: {
      line: color(day ? 'day-line' : 'line'),
      trace: color(day ? 'day-trace' : 'trace'),
      claimed: color(day ? 'day-claimed' : 'claimed'),
    },
    marker: color(day ? 'tertiary-day' : 'tertiary'),
    ink: color(day ? 'day-ink' : 'neutral'),
    inkMuted: color(day ? 'day-ink-muted' : 'neutral-muted'),
  };
}
