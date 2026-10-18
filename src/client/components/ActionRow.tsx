import { useEffect, useState } from 'react';

import { parseJumpTarget } from '../bed-jump';
import { getState, setSwitching, showNotice } from '../store';
import { focusBed, focusMyBed, setZoomMode } from '../world-handle';
import { sendHop } from '../ws';
import type { BedDirection } from '../world/rules';
import { sameZoomMode, zoomModeLabel, zoomOptions } from '../zoom';
import { useHudView } from './Hud';
import { TextInput } from './TextInput';

/** 离屏方位 → 字形（`docs/ui/DESIGN.md` 的 `action-row` 行）。 */
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
 * `chat-panel` 里的**动作行** + 门控行（`docs/ui/DESIGN.md` 的 `action-row` 行）：左 = 可点击组
 * （`床号 n ↑` / `GO` / 缩放胶囊）、右 = 设置齿轮（点开是一个向上展开的浮层：**更换床位** + 版本号），
 * 门控行紧贴其下。分组**只靠外观区分**：纯文字不是按钮，描边胶囊是（`hud-action`）。
 *
 * `GO` 点开后在门控行展开输入床号（`hop`）：输入的是**显示床号**（1 起），由 `parseJumpTarget`
 * 按当前 `bedCount` 先拦一道——非法就给可见提示且**不发送**（可点击的界面不静默失败）。
 * 缩放胶囊点开后在同一个行位置展开档位选项（`zoom-picker`）：**它既是世界缩放的单指入口**
 * （WCAG 2.5.1：多指手势必须有单指替代，而且捏合没有可发现性），也是档位状态的**常驻显示**
 * ——忘了自己锁在 `0.5×` 的人会以为捏合坏了。
 *
 * **换床模式**（`bed-switch-mode`）：齿轮浮层里那项进 / 出；模式期间可点击组**收起 `GO` 与缩放胶囊**
 * （两者都是「看一眼」的，换床是「搬过去」，摆在一起必混），门控行换成换床提示（互斥）。
 * 模式的可见状态必须**常驻**：它跨聊天、跨起身活着，忘了自己在模式里的人点一张空床，代价与误点一样。
 */
export function ActionRow() {
  const view = useHudView();
  /**
   * 门控行的唯一占用者（`GO` 的输入 / 缩放选项）：提交、取消、选中一项、`Esc` 都收起
   * （不留一个空行占着面板版面）。第三个占用者「换床提示」不占这里——它由 `view.switching` 驱动，
   * 优先级最高（模式是常驻事实，展开项是临时动作）。
   */
  const [gate, setGate] = useState<'none' | 'jump' | 'zoom'>('none');
  const [draft, setDraft] = useState('');
  /** 齿轮浮层：遮罩 / `Esc` / 再点齿轮三条路径都收起（`docs/ui/DESIGN.md` 的 `hud-menu` 行） */
  const [menuOpen, setMenuOpen] = useState(false);

  // 浮层或缩放选项开着时的 `Esc`：键盘用户不必靠鼠标点遮罩 / 再点那颗胶囊才能关
  // （遮罩是 `aria-hidden` 的纯点击面）
  useEffect(() => {
    if (!menuOpen && gate !== 'zoom') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setGate('none');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, gate]);

  const closeJump = (): void => {
    setGate('none');
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
      {/* 透明遮罩：只在浮层开着时存在。它**吃掉那一下点击**——否则点「外面」会同时关掉浮层
          并让小人在世界层开始走路（Phaser 只在自己的画布上收指针事件，遮罩盖在画布之上就够了） */}
      {menuOpen ? <div className="hud-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} /> : null}

      {/* 可点击组在左、齿轮在右，中间由齿轮的 `margin-inline-start: auto` 拉开（两端对齐） */}
      <div className="action-row">
        <div className="action-row-actions">
          {/* 还没有床就不显示床号：没有内容的一项不占位。方位字形只在床不在可用视口里时出现
              （世界里的暖标记已经够了）；整条可点 = **小人回自己的床 + 相机跟着到位** */}
          {view.bedNo !== undefined ? (
            <button
              type="button"
              className="hud-action"
              aria-label="回我的床"
              onClick={() => {
                sendHop();
                focusMyBed();
              }}
            >
              床号 <span className="hud-numeric">{view.bedNo}</span>
              {view.bedDirection !== undefined ? (
                <span aria-hidden="true"> {DIRECTION_ARROW[view.bedDirection]}</span>
              ) : null}
            </button>
          ) : null}
          {/* 可见文案是 `GO`，屏读念中文（`aria-label`）：两个字母念出来没有意义。
              换床模式里不显示：`GO` 是「跳过去看」（`hop`），换床是「搬过去」（`lie`），摆在一起必混 */}
          {view.switching ? null : (
            <button
              type="button"
              className="hud-action"
              aria-label="跳到指定床号"
              aria-expanded={gate === 'jump'}
              onClick={() => (gate === 'jump' ? closeJump() : setGate('jump'))}
            >
              GO
            </button>
          )}
          {/* 缩放胶囊：文案 = **当前档位**（它是档位状态的常驻显示），点开在门控行展开选项。
              换床模式里不显示（与 `GO` 一致：模式期间门控行归换床提示） */}
          {view.switching ? null : (
            <button
              type="button"
              className="hud-action"
              aria-label="画布缩放"
              aria-expanded={gate === 'zoom'}
              onClick={() => setGate(gate === 'zoom' ? 'none' : 'zoom')}
            >
              {zoomModeLabel(view.zoomMode)}
            </button>
          )}
        </div>

        {/* 齿轮：与可点击组同一套描边胶囊外观，但是 44×44 的正方形（里面只有图标）。
            它也是浮层的定位基准——齿轮已经在屏幕最底部，所以浮层只能向上展开 */}
        <div className="hud-settings">
          <button
            type="button"
            className="hud-settings-button"
            aria-label="设置"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {/* 内联 SVG 而不是 `⚙` 字形：Android / Windows 常把字形回落成彩色 emoji，
                与单色夜调不是一回事（`docs/ui/DESIGN.md` 的 `hud-action` 行） */}
            <svg
              className="hud-settings-icon"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* 8 齿 + 中心圆：外径 8.3、齿根 6.1，坐标由 45° 步进的齿形算出来，不手调 */}
              <path d="M18.09 8.13L18.09 11.87L15.17 13.23L17.04 14.4L14.4 17.04L11.37 15.94L11.87 18.09L8.13 18.09L6.77 15.17L5.6 17.04L2.96 14.4L4.06 11.37L1.91 11.87L1.91 8.13L4.83 6.77L2.96 5.6L5.6 2.96L8.63 4.06L8.13 1.91L11.87 1.91L13.23 4.83L14.4 2.96L17.04 5.6L15.94 8.63Z" />
              <circle cx="10" cy="10" r="2.6" />
            </svg>
          </button>

          {/* 浮层：`position: absolute` 锚在齿轮**上方**右对齐（定位基准是 `position: relative` 的
              `.hud-settings`）——齿轮已经在屏幕最底部，向下展开会直接出屏。
              两项：**更换床位**（可点，胶囊外观）在上、版本号（纯文字）在下。模式期间文案变「取消换床」
              ——入口那处就是出口那处，用户不必另找按钮。版本号是构建期注入的，不存在于任何运行时请求里 */}
          {menuOpen ? (
            <div className="hud-menu">
              <button
                type="button"
                className="hud-action hud-menu-action"
                aria-pressed={view.switching}
                onClick={() => {
                  setSwitching(!view.switching);
                  setMenuOpen(false);
                  closeJump();
                }}
              >
                {view.switching ? '取消换床' : '更换床位'}
              </button>
              {/* pi-lens-ignore: 2304 —— 构建期注入的全局量，声明在 src/globals.d.ts（两个 tsconfig 都 include 它） */}
              <div className="hud-menu-version">v{__APP_VERSION__}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* 门控行：插在动作行与输入行之间（触发在上、展开在下）。换床提示占 `GO` 那个输入行的位置
          ——模式期间 `GO` 不显示，两者不会同屏。它必须常驻：模式跨聊天、跨起身活着，
          用户要能一眼看出「现在点一张空床会搬过去」 */}
      {view.switching ? (
        <div className="gate-row">
          <p className="gate-hint">点一张空床搬过去</p>
          <button type="button" className="gate-cancel" onClick={() => setSwitching(false)}>
            取消
          </button>
        </div>
      ) : null}

      {/* `GO` 展开的门控行：输入显示床号（1 起），回车或「确定」提交，Esc 或「取消」收起 */}
      {gate === 'jump' && !view.switching ? (
        <form
          className="gate-row"
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          <TextInput
            className="gate-input"
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
          <button type="button" className="gate-cancel" aria-label="取消" onClick={closeJump}>
            取消
          </button>
        </form>
      ) : null}

      {/* 缩放档位选项（`zoom-picker`，与 `GO` 的输入 / 换床提示同一个行位置）：点一项立即生效 + 收起，
          纯本地状态、无上行。选中项加实心 + ✓（`aria-pressed` 已表达选中） */}
      {gate === 'zoom' && !view.switching ? (
        <div className="gate-row zoom-row">
          {zoomOptions().map((option) => (
            <button
              key={zoomModeLabel(option)}
              type="button"
              className={sameZoomMode(option, view.zoomMode) ? 'hud-action zoom-option-selected' : 'hud-action'}
              aria-pressed={sameZoomMode(option, view.zoomMode)}
              onClick={() => {
                setZoomMode(option);
                setGate('none');
              }}
            >
              {sameZoomMode(option, view.zoomMode) ? '✓ ' : ''}
              {zoomModeLabel(option)}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
