import { useEffect, useRef, useState } from 'react';

import { parseJumpTarget } from '../bed-jump';
import { exitComposer } from '../focus';
import { getState, setRain, setSwitching, showNotice } from '../store';
import { APP_VERSION } from '../version';
import { weatherLabel } from '../weather';
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
 * （`床号 n ↑` / `GO` / 缩放胶囊）、右 = 设置齿轮（点开是一个 `popover`：**更换床位** + 版本号），
 * 门控行紧贴其下。**打字态**（`composer === 'typing'`）右端那把齿轮换成「收起」胶囊——
 * 它是输入会话唯一的常驻可见出口（`docs/design/60-interaction-shell.md` §2）。
 * 分组**只靠外观区分**：纯文字不是按钮，描边胶囊是（`hud-action`）。
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
  /** 浮层本体：它的开关归平台（再点齿轮 / 点外面 / `Esc`），只有「换床」那一项要手关一次 */
  const menuRef = useRef<HTMLDivElement>(null);

  // 缩放选项开着时的 `Esc`：键盘用户不必靠再点那颗胶囊才能关
  // （齿轮浮层的 `Esc` 归 `popover` 自己，这里不再管）
  useEffect(() => {
    if (gate !== 'zoom') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setGate('none');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gate]);

  const closeGate = (): void => {
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
    closeGate();
  };

  return (
    <>
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
              onClick={() => (gate === 'jump' ? closeGate() : setGate('jump'))}
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

        {/* 右端：`typing` 态换成 **44px「收起」胶囊**（唯一的可见出口，`docs/design/60-interaction-shell.md` §2），
            空闲态是齿轮。两者共用同一个右端位置，`margin-inline-start: auto` 在 `.hud-settings` 上 */}
        <div className="hud-settings">
          {view.composer === 'typing' ? (
            <button
              // **必须有 `key`**：不加时 React 会把这颗按钮原地复用成齿轮（同一个 `<button>` 只换属性），
              // 而点击的「激活行为」（`popovertarget` 开浮层）在事件处理器之后才跑——于是按一下「收起」
              // 会顺手弹出设置浮层（实测）。换个 `key` 让它们是两个节点，激活行为无处可落。
              key="collapse"
              type="button"
              className="hud-action"
              aria-label="收起输入"
              // 拦掉 `pointerdown` 默认行为：否则它一聚焦就触发 `focusout` 对账，面板在这一帧就换位
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => exitComposer()}
            >
              收起
            </button>
          ) : (
            <>
              {/* 齿轮就是浮层的触发源：`popoverTarget` = 平台开关（开 / 关 / 点外面 / `Esc` 全归它），
                  `aria-expanded` 由浏览器自己往无障碍树上映射，不再手写 */}
              <button key="gear" type="button" className="hud-settings-button" aria-label="设置" popoverTarget="hud-menu">
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

              {/* 浮层：`popover="auto"`——顶层渲染、light-dismiss、焦点管理全部由平台给，所以没有遮罩、
                  也没有手写的开关状态（`docs/design/60-interaction-shell.md` §4）。位置锚在齿轮上（CSS）。
                  三项：**更换床位**（可点，胶囊外观）与**天气开关**（文案 = 当前天气）在上、版本号（纯文字）在下。模式期间第一项文案变「取消换床」
                  ——入口那处就是出口那处，用户不必另找按钮。版本号是构建期注入的，不存在于任何运行时请求里 */}
              <div className="hud-menu" id="hud-menu" popover="auto" ref={menuRef}>
                <div className="hud-menu-group">
                  <button
                    type="button"
                    className="hud-action hud-menu-action"
                    aria-pressed={view.switching}
                    onClick={() => {
                      setSwitching(!view.switching);
                      // 选择即完成：浮层自己收起（其余路径全由平台管）
                      menuRef.current?.hidePopover();
                      closeGate();
                    }}
                  >
                    {view.switching ? '取消换床' : '更换床位'}
                  </button>
                  {/* 天气开关：文案 = 当前天气，`aria-pressed` 表达开 / 关。点它**不关浮层**
                      ——天气是可连续切换的设置（不像「更换床位」那样是模式入口）。
                      独立 `key` + `pointerdown` 拦默认行为：与「收起」那颗同理，免得被原地复用 / 聚焦换位 */}
                  <button
                    key="weather"
                    type="button"
                    className="hud-action hud-menu-action"
                    aria-pressed={view.rain}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setRain(!view.rain)}
                  >
                    {weatherLabel(view.rain)}
                  </button>
                </div>
                <div className="hud-menu-version">v{APP_VERSION}</div>
              </div>
            </>
          )}
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
              if (event.key === 'Escape') closeGate();
            }}
          />
          <button type="submit" className="action-primary">
            确定
          </button>
          <button type="button" className="gate-cancel" aria-label="取消" onClick={closeGate}>
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
