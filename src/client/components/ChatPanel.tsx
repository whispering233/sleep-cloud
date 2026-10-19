import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { PersonState } from '../../shared/protocol';
import { CHAT_MAX_LEN } from '../../shared/constants';
import { bubbleHintOf } from '../bubble-fit';
import { EMOTE_SHORTCUTS } from '../emotes';
import { blurFocusedEditable } from '../focus';
import { setSlotSource, slotActive, subscribeSlot } from '../slot';
import { clearSelection, getState, subscribe } from '../store';
import type { ClientState } from '../store';
import { sendChat, sendRise, sendSleep, sendWhisper } from '../ws';
import { ActionRow } from './ActionRow';
import { ConnectionBanner } from './ConnectionBanner';
import { PrimaryAction } from './PrimaryAction';
import { QuickPhrases } from './QuickPhrases';
import { SlotPanel } from './SlotPanel';
import { TextInput } from './TextInput';

/**
 * 底部常驻的面板 = **底部控制台**（见 `docs/ui/DESIGN.md` 的 `chat-panel` 行）：连接提示条 →
 * 私聊目标行 → 床上动作行 → 气泡弱提示 → 动作行 → 门控行 → 输入行，顺序固定，窄屏也不收进菜单。
 * **没有消息列表**——聊天只在世界里（头顶那一格气泡，见 `world.ts`），
 * 所以面板高度只跟这几行控件有关。私聊目标就是**唯一选中对象**——点 × 取消选中，
 * 目标离开大厅时选中已被清掉。
 *
 * **表情面板与输入行共用同一行**（`emoteOpen` 一个开关、`.chat-composer` 一个行容器）：
 * 收起是 `输入框 + 😀 + 发送`，展开原地换成 `😀 + 5 个 emoji`——不新增行、不做浮层，
 * 所以两态都是 44px 一行，面板高度与可用视口不变。`draft` 在组件里，展开收起不动它。
 */
interface PanelView {
  selectedId?: string;
  targetName?: string;
  meState?: PersonState;
}

/** 面板只吃这几个字段：位置节拍每秒通知十次，用不上的变化不该渲染。 */
function viewOf(state: ClientState): PanelView {
  return {
    selectedId: state.selectedId,
    targetName: state.selectedId === undefined ? undefined : state.people.get(state.selectedId)?.name,
    meState: state.me?.state,
  };
}

const sameView = (a: PanelView, b: PanelView): boolean =>
  a.selectedId === b.selectedId && a.targetName === b.targetName && a.meState === b.meState;

export function ChatPanel() {
  const panelRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<PanelView>(() => viewOf(getState()));
  const [draft, setDraft] = useState('');
  const [emoteOpen, setEmoteOpen] = useState(false);
  /** 插槽面板开着 = 悬挂态：整个底部组合挪到 HUD 下沿 */
  const [docked, setDocked] = useState(slotActive);
  /** 贴顶的位移（px，向上为负）：`--dock-y` 与插槽面板的高度都要它 */
  const [dockShift, setDockShift] = useState(0);

  useEffect(() => {
    setView(viewOf(getState()));
    return subscribe((state) => {
      const next = viewOf(state);
      setView((prev) => (sameView(prev, next) ? prev : next));
    });
  }, []);

  useEffect(() => {
    setDocked(slotActive());
    return subscribeSlot(() => setDocked(slotActive()));
  }, []);

  // 贴顶的位移只走 transform（`inset` 一过渡就是逐帧布局，那是画布重建的老病根）。
  // 量的是**布局**值：`offsetTop` / `offsetHeight` 不吃 transform，所以量到的是终点位置而不是滑到一半的位置。
  // HUD 高度随安全区变，面板随提示条 / 私聊行变高变矮，两个盒子都要重算
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const shell = panel.closest<HTMLElement>('.app-shell');
    const hud = shell?.querySelector<HTMLElement>('.hud');
    if (!shell || !hud) return;
    const sync = (): void => {
      const hudBottom = hud.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
      setDockShift(hudBottom - panel.offsetTop);
    };
    const observer = new ResizeObserver(sync);
    for (const box of [shell, hud, panel]) observer.observe(box);
    sync();
    return () => observer.disconnect();
  }, []);

  const { selectedId, targetName, meState } = view;
  const hint = bubbleHintOf(draft);

  // 表情切换键：两态共用同一个按钮，两态位置相同（收起时在发送键左边、展开时钉在最右）。
  // **必须保住焦点**：它在 docked 态位于屏幕上方，一旦被抢走焦点 → 触发源清 active →
  // 整组面板下移五百多像素，而 emoji 行会跟着跑到屏幕底部（用户点了却像没反应）。
  // 退场交给「点某个 emoji」那一下自然失焦——那时 emoji 已经发出、退场正是想要的
  const emoteToggle = (
    <button
      type="button"
      className="emote-toggle"
      aria-label="表情"
      aria-expanded={emoteOpen}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => setEmoteOpen((open) => !open)}
    >
      😀
    </button>
  );

  return (
    <section
      ref={panelRef}
      className="chat-panel"
      aria-label="聊天与操作"
      // 悬挂态：`top` = 整个底部组合贴到 HUD 下沿（位置靠 `--dock-y` 的 transform，见 `../styles/app.css`）
      data-docked={docked ? 'top' : undefined}
      style={{ '--dock-y': `${dockShift}px` } as CSSProperties}
    >
      {/* 插槽面板挂在整块面板**下沿**（绝对定位，不撑开这里）；首版内容 = 快捷用语（`docs/design/50-slot-panel.md` §附），
          点一条只改草稿、不发送、不退场。`dockShift` 只在贴顶时传：那是它量高度时要加上的位移 */}
      <SlotPanel onBlankPointerDown={blurFocusedEditable} dockShift={docked ? dockShift : 0}>
        <QuickPhrases onFill={setDraft} />
      </SlotPanel>

      {/* 连接提示条：占位（不浮层），所以可用视口自动扣掉它；显示与否由自己订阅的连接态决定 */}
      <ConnectionBanner />

      {/* 私聊目标行：查不到名字就不渲染（目标离开时选中已被清掉，这里只是兜底） */}
      {selectedId !== undefined && targetName !== undefined && (
        <div className="whisper-target">
          {`私聊 ${targetName}`}
          <button
            type="button"
            className="whisper-target-clear"
            aria-label="取消私聊"
            onClick={() => clearSelection()}
          >
            ×
          </button>
        </div>
      )}

      {/* 床上动作只在床上出现：不躺着的时候这些按钮没有对象，就不占位 */}
      {meState !== undefined && meState !== 'roaming' && (
        <div className="bed-actions">
          <button type="button" className="action-primary" onClick={() => sendRise()}>
            起身
          </button>
          <button
            type="button"
            className="action-primary"
            disabled={meState === 'asleep'}
            onClick={() => sendSleep()}
          >
            睡了
          </button>
        </div>
      )}

      {/* 输入行上方的弱提示：草稿放不进气泡两行时提前说一声（估算，宁可保守；不拦发送） */}
      {hint !== undefined && <p className="chat-hint">{hint}</p>}

      {/* 动作行 + 门控行：可点击组与齿轮紧贴输入行上方（触发在上、展开在下） */}
      <ActionRow />

      {/* 输入行 / 表情行：同一行、同一位置，由 `emoteOpen` 切换（展开时输入框与发送都不出现） */}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return; // 空消息由服务端兜底 4003，这里只是不发
          if (selectedId !== undefined) sendWhisper(selectedId, draft);
          else sendChat(draft);
          setDraft('');
          // 发出去的内容只在世界里以气泡出现 → 必须让世界回来才看得见。**显式**收焦点：
          // 「按钮抢焦点」在 Chromium 成立、Safari 不一定，不能靠那个差异（`50-slot-panel.md` §3）
          blurFocusedEditable();
        }}
      >
        {emoteOpen ? (
          <>
            {EMOTE_SHORTCUTS.map(({ glyph, label }) => (
              <button
                key={glyph}
                type="button"
                className="emote-item"
                aria-label={label}
                onClick={() =>
                  selectedId !== undefined ? sendWhisper(selectedId, glyph) : sendChat(glyph)
                }
              >
                {glyph}
              </button>
            ))}
            {emoteToggle}
          </>
        ) : (
          <>
            <TextInput
              value={draft}
              placeholder="说点什么…"
              aria-label="聊天输入框"
              enterKeyHint="send"
              // 只是免得到服务端才吃 4001，**不是**气泡的显示容量（见 `docs/design/config.md` 的 `CHAT_MAX_LEN`）
              maxLength={CHAT_MAX_LEN}
              onChange={(event) => setDraft(event.target.value)}
              // 焦点是插槽面板首版**唯一**的触发源：开、关都归它（`../slot.ts`），不写「失焦即退场」
              onFocus={() => setSlotSource('chat-input', true)}
              onBlur={() => setSlotSource('chat-input', false)}
            />
            {emoteToggle}
            {/* 发送按钮必须在这里保住焦点（同快捷用语）：它在 docked 态位于屏幕上方，
                一旦被按钮抢走焦点 → 触发源清 active → 整组面板下移五百多像素 →
                pointerup 落在空处，`click` 根本不触发，用户得再点一次。
                发送后的退场由 `onSubmit` 里显式的 `blurFocusedEditable()` 负责，不靠这个默认行为 */}
            <PrimaryAction type="submit" onPointerDown={(event) => event.preventDefault()}>
              发送
            </PrimaryAction>
          </>
        )}
      </form>
    </section>
  );
}
