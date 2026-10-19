import { displayBedNoOf } from '../shared/layout';
import type { ComposerState } from './composer';
import type { BedDirection } from './world/rules';
import type { ClientState } from './store';
import { sameZoomMode } from './zoom';
import type { ZoomMode } from './zoom';

/**
 * 界面的**派生视图**（纯函数，可单测）：顶部显示条与动作行共用这一份。
 *
 * 只吃这几个字段：位置节拍每 100 ms 通知一次 store，用不上的变化不该触发渲染
 * （与 `ChatPanel` 的 `viewOf` / `sameView` 同一模式，见 `AGENTS.md` 硬纪律 17）。
 */
export interface HudView {
  /** 我的床号（**归属**，不是占用；**显示值**，= 内部床号 + 1）：还没有这张床时这一项不显示 */
  bedNo?: number;
  /** 我的床在可用视口里的方位；在视野内（或还没有床）为 `undefined`，那一项不补字形 */
  bedDirection?: BedDirection;
  /** 服务端算的在线人数；快照还没到时不知道 */
  online?: number;
  /**
   * **无主空床**（= 床位数 − 归属数）：这就是「这个厅还有没有位置」的同义词，
   * 所以它到 0 才算真的满（占用/睡痕不占名额）。快照还没到时不知道。
   */
  emptyBeds?: number;
  /** 最近一次延迟样本（毫秒）；还没有样本时不知道，那一项不占位 */
  rttMs?: number;
  /** 换床模式是否开着：开着时门控行换成换床提示、可点击组收起 `GO`（见 `docs/ui/DESIGN.md`） */
  switching: boolean;
  /** 世界缩放档位：动作行那颗缩放胶囊的文案吃它（见 `src/client/zoom.ts`） */
  zoomMode: ZoomMode;
  /** 输入会话：`typing` 时动作行右端的齿轮换成「收起」胶囊（见 `docs/design/60-interaction-shell.md` §2） */
  composer: ComposerState;
}

export function hudViewOf(state: ClientState): HudView {
  const ownedBedNo = state.me?.ownedBedNo;
  return {
    bedNo: ownedBedNo === undefined ? undefined : displayBedNoOf(ownedBedNo),
    bedDirection: state.bedDirection,
    online: state.hall?.online,
    emptyBeds: state.hall === undefined ? undefined : state.hall.bedCount - state.ownedBeds.size,
    rttMs: state.rttMs,
    switching: state.switching,
    zoomMode: state.zoomMode,
    composer: state.composer,
  };
}

/** 字段逐个比较：只有它们真的变了才换掉视图对象（对象身份用于 React 的 `useState`）。 */
export function sameHudView(a: HudView, b: HudView): boolean {
  return (
    a.bedNo === b.bedNo &&
    a.bedDirection === b.bedDirection &&
    a.online === b.online &&
    a.emptyBeds === b.emptyBeds &&
    a.rttMs === b.rttMs &&
    a.switching === b.switching &&
    a.composer === b.composer &&
    sameZoomMode(a.zoomMode, b.zoomMode)
  );
}
