import type { AboutSource } from './store';

/** 整屏页开关的快照（`docs/design/60-interaction-shell.md` §5.2）。 */
export interface WorldCover {
  /** `/api/me` 回来了：四页都等它，没回来时什么都没画 */
  hasSession: boolean;
  /** 已经进厅（入场层收起） */
  entered: boolean;
  /** 说明面板：`null` = 关着，`'auto'` / `'manual'` 都算开着 */
  aboutOpen: AboutSource | null;
  gamesOpen: boolean;
  lotOpen: boolean;
}

/**
 * 屏上有没有一块不透明的整屏页盖住厅——有就整帧停渲染（`60-interaction-shell.md` §5.2）。
 *
 * 判据是**可见性**，不是页面名：今天盖满整屏的四页全都复用 `.entry-overlay`
 * （不透明满屏），所以任一页开着即 `true`。按页面名列一份名单就是本缺陷的形态
 * （漏一页 → 2.7 Mpx 画布在整页底下照旧满帧，症状是「关页慢」）。
 */
export function coversWorld(cover: WorldCover): boolean {
  if (!cover.hasSession) return false;
  if (!cover.entered) return true;
  return cover.aboutOpen !== null || cover.gamesOpen || cover.lotOpen;
}
