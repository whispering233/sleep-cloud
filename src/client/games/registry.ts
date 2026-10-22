import type { GameEntry } from './types';

/**
 * 游戏列表（`docs/design/140-games-page.md` §3）：**纯数据 + `load`**，只有五个字段。
 * 空数组 = 页面上只剩一行「还在做」。
 */
export const GAMES: GameEntry[] = [
  {
    id: 'skyline',
    title: '窗',
    blurb: '一排别人的窗，灯随机亮灭',
    base: { w: 320, h: 640 },
    load: () => import('./skyline'),
  },
];
