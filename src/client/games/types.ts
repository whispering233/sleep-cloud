/**
 * 游戏契约（`docs/design/140-games-page.md` §4）：游戏页里每个游戏只实现这一层接口。
 * 它拿不到大厅的任何数据——发上行、读本地存储、读网络全部禁止，也禁止 `import` 任何大厅模块
 * （`store` / `ws` / `world` / `audio` / `prefs`…）；唯一例外是游戏用 `import type` 引本文件的两张接口
 * （产物里一行不剩）。所以每个游戏都能独立删除，改大厅也不会连带改游戏。
 */
export interface GameModule {
  /** 画进 `el`，返回值为 `dispose`。必须自己管 rAF / 定时器 / 事件，并在 `dispose` 里停掉。 */
  mount(el: HTMLElement, ctx: GameCtx): () => void;
}

export interface GameCtx {
  base: { w: number; h: number }; // 条目自己声明的基准尺寸
  dpr: number; // 每基准像素对应的设备像素（= min(dpr, MAX_DPR) × 舞台 scale，封顶 2 × MAX_DPR）
  now: () => number; // 外壳给的单调时钟，游戏不必自建时间源
}

/**
 * 列表里的一个条目（`docs/design/140-games-page.md` §3）：**只有这五个字段**，没有缩略图。
 * 「横屏更好」由 `base.w > base.h` 现推，不另存字段。
 */
export interface GameEntry {
  id: string;
  title: string;
  /** 一句说明 */
  blurb: string;
  base: GameCtx['base'];
  /** 条目本体按需加载（独立 chunk，首屏不载它） */
  load: () => Promise<{ default: GameModule }>;
}
