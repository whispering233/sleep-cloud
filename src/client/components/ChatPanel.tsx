import { useEffect, useRef, useState } from 'react';

import type { PersonState } from '../../shared/protocol';
import { CHAT_MAX_LEN } from '../../shared/constants';
import { bubbleHintOf } from '../bubble-fit';
import { EMOTE_SHORTCUTS } from '../emotes';
import { exitComposer } from '../focus';
import { clearSelection, getState, startReport, subscribe } from '../store';
import type { ClientState } from '../store';
import { sendChat, sendRise, sendSleep, sendWhisper } from '../ws';
import { ActionRow } from './ActionRow';
import { ConnectionBanner } from './ConnectionBanner';
import { PrimaryAction } from './PrimaryAction';
import { QuickPhrases } from './QuickPhrases';
import { FeedbackForm } from './FeedbackForm';
import { ReportForm } from './ReportForm';
import { SlotPanel } from './SlotPanel';
import { TextInput } from './TextInput';
import { TypeTextPanel } from './TypeTextPanel';

/**
 * 底部常驻的面板 = **底部控制台**（见 `docs/ui/DESIGN.md` 的 `chat-panel` 行）：连接提示条 →
 * 私聊目标行 → 床上动作行 → 气泡弱提示 → 动作行 → 门控行 → 输入行，顺序固定，窄屏也不收进菜单。
 * **没有消息列表**——聊天只在世界里（头顶那一格气泡，见 `world.ts`），
 * 所以面板高度只跟这几行控件有关。私聊目标就是**唯一选中对象**——点 × 取消选中，
 * 目标离开大厅时选中已被清掉。行尾那颗「举报」进 `report` 态：插槽面板换成事由表单。
 *
 * **表情面板与输入行共用同一行**（`emoteOpen` 一个开关、`.chat-composer` 一个行容器）：
 * 收起是 `输入框 + 😀 + 发送`，展开原地换成 `😀 + 5 个 emoji`——不新增行、不做浮层，
 * 所以两态都是 44px 一行。
 *
 * **插槽面板是它的兄弟、不是子元素**：两块都是 `.app-shell` 的网格项，两态只换行
 * （`docs/design/60-interaction-shell.md` §3）。这里返回一个 fragment 就是为了这个。
 */
interface PanelView {
  selectedId?: string;
  targetName?: string;
  meState?: PersonState;
  /** 输入会话：非 `idle` 时两块面板换行、插槽面板打开（`docs/design/60-interaction-shell.md` §3） */
  composer: ClientState['composer'];
  /** 举报表单的对象（`composer === 'report'` 时才有） */
  reportTo?: string;
  /** 选中对象已在本次会话内举报过：私聊行那颗按钮置灰成「已举报」 */
  reported: boolean;
  /** 面板上那行常驻弱提示（`5003` / `5004` 回执）：盖过草稿长度提示，常驻到下一次操作 */
  chatHint?: string;
  /** 反馈表单里的可见错误（`4001` / `4003` / `4004`）：就地显示，不退场 */
  feedbackError?: string;
  /** 类型文本的阅读进度（`reading` 态才有用；抽签改的就是它） */
  readProgress: ClientState['readProgress'];
}

/** 面板只吃这几个字段：位置节拍每秒通知十次，用不上的变化不该渲染。 */
function viewOf(state: ClientState): PanelView {
  return {
    selectedId: state.selectedId,
    targetName: state.selectedId === undefined ? undefined : state.people.get(state.selectedId)?.name,
    meState: state.me?.state,
    composer: state.composer,
    reportTo: state.pendingReportTo,
    reported: state.selectedId !== undefined && state.reportedIds.has(state.selectedId),
    chatHint: state.chatHint,
    feedbackError: state.feedbackError,
    readProgress: state.readProgress,
  };
}

const sameView = (a: PanelView, b: PanelView): boolean =>
  a.selectedId === b.selectedId &&
  a.targetName === b.targetName &&
  a.meState === b.meState &&
  a.composer === b.composer &&
  a.reportTo === b.reportTo &&
  a.reported === b.reported &&
  a.chatHint === b.chatHint &&
  a.feedbackError === b.feedbackError &&
  // 阅读进度是**整体替换**的对象：只有抽签 / 再看一遍才换身份，所以比引用就够
  a.readProgress === b.readProgress;

export function ChatPanel() {
  const panelRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<PanelView>(() => viewOf(getState()));
  const [draft, setDraft] = useState('');
  const [emoteOpen, setEmoteOpen] = useState(false);

  useEffect(() => {
    setView(viewOf(getState()));
    return subscribe((state) => {
      const next = viewOf(state);
      setView((prev) => (sameView(prev, next) ? prev : next));
    });
  }, []);

  // 两态布局只换网格行，而两块面板都是 shell 的子元素 → 状态写成 shell 上的属性，让选择器够得着。
  // 纯状态→属性，没有量高、没有位移（`docs/design/60-interaction-shell.md` §3）
  useEffect(() => {
    const shell = panelRef.current?.closest<HTMLElement>('.app-shell');
    if (shell) shell.dataset.composer = view.composer;
  }, [view.composer]);

  const { selectedId, targetName, meState } = view;
  const hint = view.chatHint ?? bubbleHintOf(draft);

  // 表情切换键：两态共用同一个按钮，两态位置相同（收起时在发送键左边、展开时钉在最右）。
  // **必须保住焦点**：一旦 `pointerdown` 把焦点抢走，下一帧的焦点对账就会退场，
  // 而两态的面板差五百多像素——用户点了却像没反应。
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
    <>
      <section ref={panelRef} className="chat-panel" aria-label="聊天与操作">
        {/* 连接提示条：占位（不浮层），所以可用视口自动扣掉它；显示与否由自己订阅的连接态决定 */}
        <ConnectionBanner />

        {/* 私聊目标行：查不到名字就不渲染（目标离开时选中已被清掉，这里只是兜底）。
            三栏：名字 / 竖线 / 「举报」；× 在最右。两颗动作都是描边胶囊（`.hud-action` 家族，
            × 同 `.hud-settings-button`，见硬纪律 26）；举报在 `pointerdown` 里 `preventDefault()` 保住焦点，
            两颗各带独立的 `key` 避开 React 原地复用（硬纪律 35） */}
        {selectedId !== undefined && targetName !== undefined && (
          <div className="whisper-target">
            <span className="whisper-target-name">{`私聊 ${targetName}`}</span>
            <span className="whisper-target-divider" aria-hidden="true" />
            <button
              key="report"
              type="button"
              className="whisper-target-report"
              disabled={view.reported}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => startReport(selectedId)}
            >
              {view.reported ? '已举报' : '举报'}
            </button>
            <button
              key="clear"
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
            // 发出去的内容只在世界里以气泡出现 → 必须让世界回来才看得见。走唯一的出口（不看 `activeElement`，
            // 也不靠「按钮抢焦点」：那在 Chromium 成立、Safari 不一定，见 `50-slot-panel.md` §7）
            exitComposer();
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
              />
              {emoteToggle}
              {/* 发送按钮同样必须保住焦点：它在 `typing` 态位于屏幕上方，
                  一旦被按钮抢走焦点 → 下一帧的对账就退场 → 整组面板下移五百多像素，
                  pointerup 落在空处，`click` 根本不触发，用户得再点一次。
                  发送后的退场由 `onSubmit` 里的 `exitComposer()` 负责，不靠这个默认行为 */}
              <PrimaryAction type="submit" onPointerDown={(event) => event.preventDefault()}>
                发送
              </PrimaryAction>
            </>
          )}
        </form>
      </section>

      {/* 插槽面板在网格第 3 行（打字态铺满到屏底）。内容互斥：反馈表单 > 举报表单 > 类型文本 > 快捷用语
          （类型文本没有可编辑控件，退场只能靠那颗「收起」，`docs/design/50-slot-panel.md` §4） */}
      <SlotPanel active={view.composer !== 'idle'} onBlank={exitComposer}>
        {view.composer === 'feedback' ? (
          <FeedbackForm error={view.feedbackError} />
        ) : view.composer === 'report' ? (
          <ReportForm toId={view.reportTo} />
        ) : view.composer === 'reading' ? (
          <TypeTextPanel progress={view.readProgress} />
        ) : (
          <QuickPhrases onFill={setDraft} />
        )}
      </SlotPanel>
    </>
  );
}
