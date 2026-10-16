import { useEffect, useState } from 'react';

import { parseJumpTarget } from '../bed-jump';
import { hudViewOf, sameHudView } from '../hud-view';
import type { HudView } from '../hud-view';
import { getState, showNotice, subscribe } from '../store';
import { focusBed, focusMyBed } from '../world-handle';
import { sendHop } from '../ws';
import type { BedDirection } from '../world/rules';
import { TextInput } from './TextInput';

/** 离屏方位 → 字形（`docs/ui/DESIGN.md` 的 `hud` 组件行）。 */
const DIRECTION_ARROW: Record<BedDirection, string> = {
  nw: '↖',
  n: '↑',
  ne: '↗',
  e: '→',
  se: '↘',
  s: '↓',
  sw: '↙',
  w: '←',
};

/**
 * 顶部的极简信息条：**我的床号（+ 离屏时的方位字形）+ 在线人数 + 一个「⇢」按钮**。
 * **只吃 `HudView` 的三个字段**：位置节拍每 100 ms 通知一次 store，用不上的变化不能变成重渲染。
 * 不显示昵称（我知道我是谁）、不显示厅名（只有一个厅）。
 *
 * 「⇢」点开后 **HUD 下沿展开一行输入床号**（`hop`）：输入的是**显示床号**（1 起），
 * 由 `parseJumpTarget` 按当前 `bedCount` 先拦一道——非法就给可见提示且**不发送**（可点击的界面不静默失败）。
 */
export function Hud() {
  const [view, setView] = useState<HudView>(() => hudViewOf(getState()));
  /** 「⇢」展开的输入行：提交、取消、Esc 都收起（不留一个空行占着 HUD 下沿） */
  const [jumpOpen, setJumpOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const sync = (): void => setView((prev) => (sameHudView(prev, hudViewOf(getState())) ? prev : hudViewOf(getState())));
    sync();
    return subscribe(sync);
  }, []);

  const closeJump = (): void => {
    setJumpOpen(false);
    setDraft('');
  };

  const jump = (): void => {
    const bedCount = getState().hall?.bedCount;
    if (bedCount === undefined) return; // 快照还没到：没有可校验的范围，厅也还没画出来
    const target = parseJumpTarget(draft, bedCount);
    if ('error' in target) {
      showNotice(target.error);
      return;
    }
    sendHop(target.bedNo);
    focusBed(target.bedNo);
    closeJump();
  };

  return (
    <>
      <header className="hud">
        {/* 还没有床就不显示床号：没有内容的一项不占位。方位字形只在床不在可用视口里时出现
            （世界里的暖标记已经够了）；整条可点 = **小人回自己的床 + 相机跟着到位** */}
        {view.bedNo !== undefined ? (
          <button type="button" className="hud-my-bed" aria-label="回我的床" onClick={() => { sendHop(); focusMyBed(); }}>
            床号 <span className="hud-numeric">{view.bedNo}</span>
            {view.bedDirection !== undefined ? (
              <span aria-hidden="true"> {DIRECTION_ARROW[view.bedDirection]}</span>
            ) : null}
          </button>
        ) : null}
        {view.online !== undefined ? (
          <span>
            在线 <span className="hud-numeric">{view.online}</span>
          </span>
        ) : null}
        <button
          type="button"
          className="hud-jump-toggle"
          aria-label="跳到指定床号"
          aria-expanded={jumpOpen}
          onClick={() => (jumpOpen ? closeJump() : setJumpOpen(true))}
        >
          ⇢
        </button>
      </header>

      {/* HUD 下沿那一行：输入显示床号（1 起），回车或「确定」提交，Esc 或「取消」收起 */}
      {jumpOpen ? (
        <form
          className="hud-jump"
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          <div className="hud-jump-row">
            <TextInput
              className="hud-jump-input"
              value={draft}
              inputMode="numeric"
              enterKeyHint="go"
              aria-label="跳到床号"
              placeholder="床号"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeJump();
              }}
            />
            <button type="submit" className="action-primary">
              确定
            </button>
            <button type="button" className="hud-jump-cancel" aria-label="取消" onClick={closeJump}>
              取消
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}