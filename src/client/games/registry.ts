/// <reference types="vite/client" />
import type { GameEntry, GameModule } from './types';

/**
 * 游戏列表（`docs/design/140-games-page.md` §3、§4.1）：**文件夹即注册**——仓库根的 `games/<id>/` 就是一次注册。
 * 两条扫描：`meta.ts` eager（列表要标题与说明，但不能为此载入游戏代码）、`index.ts` lazy（点开才载）。
 * 加一个游戏 = 加一个文件夹，这个文件一个字都不改；缺一半由守护单测（`tests/games-registry.test.ts`）报出来。
 */
interface GameMeta {
  title: string;
  blurb: string;
  base: { w: number; h: number };
}

const metas = import.meta.glob<{ meta: GameMeta }>('../../../games/*/meta.ts', { eager: true });
const loaders = import.meta.glob<{ default: GameModule }>('../../../games/*/index.ts');

/** `…/games/<id>/meta.ts` → `<id>`：条目 id 就是文件夹名 */
const idOf = (path: string): string => path.replace(/^.*\/([^/]+)\/meta\.ts$/, '$1');

export const GAMES: GameEntry[] = Object.entries(metas).map(([path, { meta }]) => ({
  id: idOf(path),
  title: meta.title,
  blurb: meta.blurb,
  base: meta.base,
  // 同一个文件夹的另一半：glob 的 lazy 形态本身就是 `() => import(…)`，不再包一层
  load: loaders[path.replace(/meta\.ts$/, 'index.ts')] as GameEntry['load'],
}));
