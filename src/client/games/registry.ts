import type { GameEntry } from './types';

/**
 * 游戏列表（`docs/design/110-games-page.md` §3）：**纯数据 + `load`**，只有五个字段。
 * 空数组 = 页面上只剩一行「还在做」；第一个条目（Skyline）在卡 3 落。
 */
export const GAMES: GameEntry[] = [];
