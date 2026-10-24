import { useEffect, useRef, useState } from 'react';

import { parseJumpTarget } from '../bed-jump';
import { unlock as unlockAudio } from '../audio';
import { DECOR_BLOCK_ORDER, blockLabel, decorOptionsOf } from '../decor';
import { exitComposer } from '../focus';
import { HAS_POPOVER } from '../popover';
import { PRIVACY_PAGE_HREF, openPrivacyPage } from '../privacy-link';
import { getState, openAbout, openFeedback, openGames, openLot, setComposer, setDecor, setSound, setSwitching, setWeather, showNotice } from '../store';
import { APP_VERSION } from '../version';
import { soundLabel, weatherLabel, weatherOptionsOf } from '../weather';
import { focusBed, focusMyBed, setZoomMode } from '../world-handle';
import { sendHop } from '../ws';
import type { BedDirection } from '../world/rules';
import { sameZoomMode, zoomOptions, zoomShortLabel } from '../zoom';
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
 * 动作行右端那颗**礼物**胶囊拉出的托盘四入口（`docs/ui/DESIGN.md` 的 `gift-tray` / `hud-action` 行）：
 * 顺序固定 = 睡不着留言板 → 求签 → 游戏 → 随机阅读。每一项**直接持有完整的 `<svg>`**：三枚是设计给的
 * 24 × 24 绘制区（源文件 `stroke-width 1.6`）、书本是自绘的 20 绘制区（`1.5`）——按钮里都按 20×20 渲染，
 * 所以 24 那三枚的描边写 `1.8`，视觉上才等于 20 绘制区上的 `1.5px`（`1.8 / 24 × 20 = 1.5`，光学重量本来就相等）。
 * 不把 `viewBox` / `strokeWidth` 提到外层：那等于把差异藏起来，下次换图标就会画错。
 * **求签与游戏接通了功能**（拉起来签页 `docs/design/110-lot.md` / 拉起游戏页 `docs/design/140-games-page.md`）；
 * 睡不着留言板先上界面、后接功能：点它只出一条弱提示，**不发任何上行**（没有协议就没有野心）。
 */
const ICON_ENTRIES = [
  {
    key: 'board',
    label: '睡不着留言板',
    on: () => showNotice('睡不着留言板 · 还没做'),
    icon: (
      <svg
        className="hud-icon-glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="14.6" rx="2.2" />
        <circle cx="8" cy="5" r="1.05" />
        <circle cx="16" cy="5" r="1.05" />
        <path d="M7.2 9.4h9.6M7.2 12.6h7M7.2 15.8h4.4" />
      </svg>
    ),
  },
  {
    key: 'fortune',
    label: '求签',
    on: openLot,
    icon: (
      <svg
        className="hud-icon-glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M5.9 9.8v6.6c0 2.3 2.7 3.5 6.1 3.5s6.1-1.2 6.1-3.5V9.8" />
        <ellipse cx="12" cy="9.8" rx="6.1" ry="1.7" />
        <path d="M8.9 9.6 8.1 5.2M10.6 9.6V3.4M12.4 9.6V2.2M14.2 9.6V3.8M15.4 9.6l.7-4.2" />
        <path d="M6.3 15.2h11.4" />
      </svg>
    ),
  },
  {
    key: 'game',
    label: '游戏',
    on: () => openGames(),
    icon: (
      <svg
        className="hud-icon-glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M8.3 7.2h7.4c2.5 0 4.6 1.9 4.9 4.4l.5 4c.2 1.9-2.1 3.1-3.5 1.7l-2.1-2.2H8.5l-2.1 2.2c-1.4 1.4-3.7.2-3.5-1.7l.5-4C3.7 9.1 5.8 7.2 8.3 7.2Z" />
        <path d="M7.3 10v3.8M5.4 11.9h3.8" />
        <circle cx="16.2" cy="11.5" r="1" />
        <circle cx="18" cy="13.4" r="1" />
      </svg>
    ),
  },
  {
    key: 'read',
    label: '随机阅读',
    on: () => setComposer({ kind: 'read' }),
    // 内联 SVG 书本图标（与齿轮同一套画法：`currentColor` 描边、20×20 绘制区）
    icon: (
      <svg
        className="hud-icon-glyph"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {/* 摊开的一本书：左页 2.6→9.4、右页 10.6→17.4，书脊一根竖线 */}
        <path d="M2.6 5.2c2.1-1.1 4.4-1.1 7.4.6 3-1.7 5.3-1.7 7.4-.6v10.2c-2.1-1.1-4.4-1.1-7.4.6-3-1.7-5.3-1.7-7.4-.6z" />
        <path d="M10 5.8v10.2" />
      </svg>
    ),
  },
] as const;

/**
 * `chat-panel` 里的**动作行** + 门控行（`docs/ui/DESIGN.md` 的 `action-row` 行）：左 = 可点击组
 * （`床号 n ↑` / `GO`）、右 = 礼物与设置齿轮（礼物拉出托盘：**睡不着留言板** / **求签** / **游戏** / **随机阅读**；
 * 齿轮点开的浮层：**更换床位** / **缩放档位**（二级视图）/ **装饰**（二级视图）/ **天气**（二级视图）/ **雨声** / **反馈与建议** / **关于失眠云** / 版本号 / 隐私说明；
 * 没有 Popover 的内核退回手写开关，见 `../popover.ts`），
 * 门控行紧贴其下。**非空闲态**（`composer !== 'idle'`：打字或举报）右端那一组换成「收起」胶囊——
 * 它是输入会话唯一的常驻可见出口（`docs/design/60-interaction-shell.md` §2）。
 * 分组**只靠外观区分**：纯文字不是按钮，描边胶囊是（`hud-action`）。
 *
 * `GO` 点开后在门控行展开输入床号（`hop`）：输入的是**显示床号**（1 起），由 `parseJumpTarget`
 * 按当前 `bedCount` 先拦一道——非法就给可见提示且**不发送**（可点击的界面不静默失败）。
 * **缩放**住在齿轮浮层的二级（`zoom-picker`）：浮层根上那一项写「缩放 · 当前档位」，进去是五个档位 + 一行返回。
 * 它既是世界缩放的单指入口（WCAG 2.5.1：多指手势必须有单指替代，而且捏合没有可发现性），
 * 也是档位状态的一处显示；**常驻的那一处显示在顶部 HUD**（`缩放 0.75×`）——两个职能各归一处，
 * 动作行右端才收得成礼物 + 齿轮两颗（`action-row` / `gift-tray` 行）。点一档不关浮层：可以连续比。
 * **装饰**紧在缩放之下，同样进二级（`decor-picker`）：每块单选 + 「无装饰」，点一项立即生效、也不关浮层
 * （`docs/design/80-reserve-decor.md` §4.3）。它是纯本地偏好，无上行。
 *
 * **换床模式**（`bed-switch-mode`）：齿轮浮层里那项进 / 出；模式期间可点击组**收起 `GO`**
 * （它是「看一眼」的，换床是「搬过去」，摆在一起必混），门控行换成换床提示（互斥）。
 * 模式的可见状态必须**常驻**：它跨聊天、跨起身活着，忘了自己在模式里的人点一张空床，代价与误点一样。
 */
export function ActionRow() {
  const view = useHudView();
  /**
   * 门控行的唯一占用者（`GO` 的输入）：提交、取消、`Esc` 都收起（不留一个空行占着面板版面）。
   * 另一个占用者「换床提示」不占这里——它由 `view.switching` 驱动，优先级最高（模式是常驻事实，
   * 展开项是临时动作）。缩放档位选项已搬进齿轮浮层，不在门控行里。
   */
  const [gate, setGate] = useState<'none' | 'jump'>('none');
  const [draft, setDraft] = useState('');
  /** 降级路径（无 Popover，见 `../popover.ts`）的浮层开关：有 Popover 时不用它，开关归平台。
      一个联合类型同时回答「谁开着」与「不会两个都开」——齿轮菜单与礼物托盘共用下面那一段点外 / `Esc` / 焦点归还 */
  const [openMenu, setOpenMenu] = useState<'none' | 'gift' | 'gear'>('none');
  /** 浮层当前显示哪一级：`root` = 设置列表，`zoom` = 缩放档位二级（`zoom-picker`），`decor` = 装饰二级
      （`decor-picker`），`weather` = 天气二级（`weather-picker`）。关掉浮层就回 `root` */
  const [menuView, setMenuView] = useState<'root' | 'zoom' | 'decor' | 'weather'>('root');
  /** 齿轮菜单本体（礼物托盘是 `giftTrayRef`） */
  const menuRef = useRef<HTMLDivElement>(null);
  /** 礼物托盘本体 */
  const giftTrayRef = useRef<HTMLDivElement>(null);
  /** 齿轮 / 礼物：降级路径打开时它们要交班焦点给浮层首项，关闭时接回来 */
  const gearRef = useRef<HTMLButtonElement>(null);
  const giftRef = useRef<HTMLButtonElement>(null);

  const closeGate = (): void => {
    setGate('none');
    setDraft('');
  };

  /** 收浮层：有 Popover 时交给平台（其余开关路径也全归它）；降级路径自己关，并把焦点送回触发源
      ——浮层节点随后被卸载，不接回来焦点就落到 `body` 上。点外关闭传 `false`：native light-dismiss
      不搬焦点，搬了它会让 Space / Enter 又把浮层打开 */
  const closeMenu = (target: 'gift' | 'gear', restoreFocus = true): void => {
    if (HAS_POPOVER) {
      (target === 'gift' ? giftTrayRef : menuRef).current?.hidePopover();
      return;
    }
    setOpenMenu('none');
    // 齿轮浮层重新打开时从根开始（二级视图是「先看档位」的那一眼，不该黏住）；托盘没有分级
    if (target === 'gear') setMenuView('root');
    if (restoreFocus) (target === 'gift' ? giftRef : gearRef).current?.focus();
  };

  // 降级路径（Chromium 100 没有 Popover）里浮层的开关、点外关闭、`Esc`、焦点全得自己来。
  // 齿轮菜单与礼物托盘共用这一段：只有「哪个节点、哪个触发源」不同
  useEffect(() => {
    if (HAS_POPOVER || openMenu === 'none') return undefined;
    const popup = (openMenu === 'gift' ? giftTrayRef : menuRef).current;
    const trigger = (openMenu === 'gift' ? giftRef : gearRef).current;
    if (!popup) return undefined;
    // 开时焦点进浮层首项：键盘用户不必先 Tab 过整条动作行
    popup.querySelector('button')?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // 点触发源（开关自己）或浮层里（菜单项）都不算点外面
      if (popup.contains(target) || trigger?.contains(target)) return;
      closeMenu(openMenu, false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu(openMenu);
    };
    // 捕获阶段：面板里别处的 `pointerdown` 常被 `preventDefault` / 不再冒泡，冒泡阶段会漏
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  // 非空闲态右端被「收起」占位（礼物、齿轮与两个浮层一起卸载）：浮层跟着收，否则退场后它会开着回来
  useEffect(() => {
    if (view.composer !== 'idle') {
      setOpenMenu('none');
      setMenuView('root');
      if (HAS_POPOVER) {
        menuRef.current?.hidePopover();
        giftTrayRef.current?.hidePopover();
      }
    }
  }, [view.composer]);

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

  /** 齿轮就是菜单的触发源：有 Popover 时 `popoverTarget` = 平台开关（开 / 关 / 点外面 / `Esc` 全归它，
      `aria-expanded` 由浏览器自己往无障碍树上映射）；降级路径自己写这两样。
      两条路径都在这里把视图重置回 `root`——浮层关掉就算「重新进店」，二级视图不跨次次活着 */
  const gearMenuProps = HAS_POPOVER
    ? { popoverTarget: 'hud-menu', onClick: () => setMenuView('root') }
    : {
        'aria-expanded': openMenu === 'gear',
        onClick: () => {
          if (openMenu === 'gear') return closeMenu('gear');
          setMenuView('root');
          setOpenMenu('gear');
        },
      };

  /** 礼物是托盘的开源：与齿轮完全对称（`popoverTarget: 'gift-tray'` 对应托盘的 `id`），
      降级路径共用 `openMenu`——两个浮层因此天然互斥 */
  const giftMenuProps = HAS_POPOVER
    ? { popoverTarget: 'gift-tray' }
    : {
        'aria-expanded': openMenu === 'gift',
        onClick: () => {
          if (openMenu === 'gift') return closeMenu('gift');
          setOpenMenu('gift');
        },
      };

  return (
    <>
      {/* 可点击组在左、礼物与齿轮在右，中间由右端那一组的 `margin-inline-start: auto` 拉开（两端对齐） */}
      <div className="action-row">
        <div className="action-row-actions">
          {/* 还没有床就不显示床号：没有内容的一项不占位。方位字形只在床不在可用视口里时出现
              （世界里的暖标记已经够了）；整条可点 = **小人回自己的床 + 相机跟着到位**。
              已经在床上时只对准相机：`hop` 的服务端语义是「在床上先起身」，躺着点一下就起身给人看见、
              睡着点一下就被叫醒（`docs/design/00-master-design.md` 的「导航」）。快照还没到（`me` 为
              `undefined`）按走动处理，照旧发 `hop` */}
          {view.bedNo !== undefined ? (
            <button
              type="button"
              className="hud-action hud-bed"
              // 可见文字只剩「号 + 方位」：393 宽下再写「床号」二字就多 28px，一行排不下（`action-row` 行）
              aria-label={`床号 ${view.bedNo}`}
              onClick={() => {
                const me = getState().me;
                if (me === undefined || me.state === 'roaming') sendHop();
                focusMyBed();
              }}
            >
              <span className="hud-numeric">{view.bedNo}</span>
              {view.bedDirection !== undefined ? (
                <span aria-hidden="true">{DIRECTION_ARROW[view.bedDirection]}</span>
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
          {/* 缩放不在这两行里：单指入口与档位选择都搬进了齿轮浮层的二级（`zoom-picker`），
              档位状态常驻显示在顶部 HUD，四个杂项入口搬进礼物托盘——右端因此只剩两颗 44px 胶囊 */}
        </div>

        {/* 右端：非空闲态换成 **44px「收起」胶囊**（唯一的可见出口，`docs/design/60-interaction-shell.md` §2），
            空闲态是礼物 + 齿轮。两者共用同一个右端位置，`margin-inline-start: auto` 在 `.hud-settings` 上。
            举报态也必须有出口：超额被静默丢弃时服务端不回执，没有「收起」就回不到大厅 */}
        <div className="hud-settings">
          {view.composer !== 'idle' ? (
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
              {/* 礼物：托盘的开源（`docs/ui/DESIGN.md` 的 `gift-tray` 行）。写法与齿轮对称——它自己
                  **不加** `pointerdown` 拦截，因为「打开浮层」是它唯一的动作。
                  独立 `key`：免得被 React 在原地复用成另一颗按钮，让激活行为（`popovertarget`）落到旧的节点上 */}
              <button
                key="gift"
                type="button"
                className="hud-action hud-icon"
                aria-label="更多入口"
                ref={giftRef}
                {...giftMenuProps}
              >
                {/* 礼物盒：已定稿的五段几何（24 绘制区、内联写 `1.8`，见 `ICON_ENTRIES` 那段注释） */}
                <svg
                  className="hud-icon-glyph"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="3.4" y="7.1" width="17.2" height="3.5" rx="1.1" />
                  <path d="M5 10.6v8.3c0 .8.6 1.4 1.4 1.4h11.2c.8 0 1.4-.6 1.4-1.4v-8.3" />
                  <path d="M12 7.1v3.5M12 10.6v9.7" />
                  <path d="M12 7.1C10.6 5.3 9.4 4 8.6 3.4c-1.2-.9-2.5.1-2.2 1.6.3 1.6 2.4 2.1 3.6 2.1H12" />
                  <path d="M12 7.1c1.4-1.8 2.6-3.1 3.4-3.7 1.2-.9 2.5.1 2.2 1.6-.3 1.6-2.4 2.1-3.6 2.1H12" />
                </svg>
              </button>
              {/* 齿轮：菜单的开关（两条路径的差别全写在 `gearMenuProps` 里） */}
              <button
                key="gear"
                type="button"
                className="hud-settings-button"
                aria-label="设置"
                ref={gearRef}
                {...gearMenuProps}
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

              {/* 菜单：有 Popover 时 `popover="auto"`——顶层渲染、light-dismiss、焦点管理全部由平台给，
                  所以没有遮罩、也没有手写的开关状态（`docs/design/60-interaction-shell.md` §4）。位置锚在齿轮上（CSS）。
                  **根视图七项**：**更换床位**（可点，胶囊外观）、**缩放**（进二级）、**装饰**（同样进二级：
                  每块单选 + 「无装饰」，见 `decor-picker`）、**天气**（进二级，文案 = 当前天气，见 `weather-picker`）、
                  **雨声开关**、**反馈与建议**与**关于失眠云**，版本号与**隐私说明**（两行纯文字）在下。模式期间第一项文案变「取消换床」
                  ——入口那处就是出口那处，用户不必另找按钮。版本号是构建期注入的，不存在于任何运行时请求里。
                  **二级视图**（`zoom-picker` / `decor-picker` / `weather-picker`）只换框里的内容：缩放五档 + 一行返回，
                  装饰每块一个标题 + 候选与「无装饰」+ 一行返回，天气三项单选 + 一行返回。
                  没有 Popover 时退回手写的开关：无 `popover` 属性，按 `openMenu === 'gear'` 条件渲染 */}
              {HAS_POPOVER || openMenu === 'gear' ? (
                <div className="hud-menu" id="hud-menu" ref={menuRef} popover={HAS_POPOVER ? 'auto' : undefined}>
                  {menuView === 'zoom' ? (
                    // 点一档立即生效、**不关浮层**（可以连续比）；「返回」回根。选中项仍是实心 + ✓
                    <div className="hud-menu-group">
                      {zoomOptions().map((option) => (
                        <button
                          key={zoomShortLabel(option)}
                          type="button"
                          className={
                            sameZoomMode(option, view.zoomMode)
                              ? 'hud-action hud-menu-action menu-option-selected'
                              : 'hud-action hud-menu-action'
                          }
                          aria-pressed={sameZoomMode(option, view.zoomMode)}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => setZoomMode(option)}
                        >
                          {sameZoomMode(option, view.zoomMode) ? '✓ ' : ''}
                          {zoomShortLabel(option)}
                        </button>
                      ))}
                      {/* 返回根：与上面五个档位同一套外观（都是 44px 胶囊），不另造一种「次级按钮」 */}
                      <button
                        type="button"
                        className="hud-action hud-menu-action"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => setMenuView('root')}
                      >
                        返回
                      </button>
                    </div>
                  ) : menuView === 'decor' ? (
                    // 装饰（`decor-picker`，`docs/design/80-reserve-decor.md` §4.3）：**每块单选 + 「无装饰」**。
                    // 标题是纯文字（不可点，也不占 44px）；候选项与选中态沿用缩放那一套单选语言。
                    // 点一项**立即生效、不关浮层**：可以连着换，也能一眼看出两个块现在的样子
                    <div className="hud-menu-group">
                      {DECOR_BLOCK_ORDER.map((block) => (
                        <div className="decor-block" key={block}>
                          <p className="decor-block-title">{blockLabel(block)}</p>
                          {decorOptionsOf(block).map((option) => {
                            const selected = view.decor[block] === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                className={
                                  selected
                                    ? 'hud-action hud-menu-action menu-option-selected'
                                    : 'hud-action hud-menu-action'
                                }
                                aria-pressed={selected}
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={() => setDecor(block, option.id)}
                              >
                                {selected ? `✓ ${option.label}` : option.label}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                      {/* 返回根：与候选同一套外观（都是 44px 胶囊） */}
                      <button
                        type="button"
                        className="hud-action hud-menu-action"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => setMenuView('root')}
                      >
                        返回
                      </button>
                    </div>
                  ) : menuView === 'weather' ? (
                    // 天气（`weather-picker`，`docs/design/config.md` §4）：三项**单选**，与缩放那一套同形
                    // （竖排胶囊 + 选中态 + 一行返回）。点一项立即生效、**不关浮层**（可连续比较）。
                    // 候选与文案只来自 `weatherOptionsOf()`：界面不写第二份
                    <div className="hud-menu-group">
                      {weatherOptionsOf().map((option) => {
                        const selected = view.weather === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={
                              selected ? 'hud-action hud-menu-action menu-option-selected' : 'hud-action hud-menu-action'
                            }
                            aria-pressed={selected}
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => setWeather(option.id)}
                          >
                            {selected ? `✓ ${option.label}` : option.label}
                          </button>
                        );
                      })}
                      {/* 返回根：与上面三项同一套外观（都是 44px 胶囊） */}
                      <button
                        type="button"
                        className="hud-action hud-menu-action"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => setMenuView('root')}
                      >
                        返回
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="hud-menu-group">
                        <button
                          type="button"
                          className="hud-action hud-menu-action"
                          aria-pressed={view.switching}
                          onClick={() => {
                            setSwitching(!view.switching);
                            // 选择即完成：菜单自己收起
                            closeMenu('gear');
                            closeGate();
                          }}
                        >
                          {view.switching ? '取消换床' : '更换床位'}
                        </button>
                        {/* 缩放：进二级（`docs/ui/DESIGN.md` 的 `zoom-picker` 行）。文案带当前档位——
                            它是动作行那颗胶囊搬走之后，这一页里唯一说「现在锁在哪一档」的地方 */}
                        <button
                          key="zoom"
                          type="button"
                          className="hud-action hud-menu-action"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => setMenuView('zoom')}
                        >
                          缩放 · {zoomShortLabel(view.zoomMode)}
                        </button>
                        {/* 装饰：同样进二级（`decor-picker`），同样**不关浮层**。root 只写「装饰」：
                            选没选在世界里本来就看得见（猫在不在、火燃不燃），这里不必再说一遍 */}
                        <button
                          key="decor"
                          type="button"
                          className="hud-action hud-menu-action"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => setMenuView('decor')}
                        >
                          装饰
                        </button>
                        {/* 天气：进二级（`weather-picker`，`docs/ui/DESIGN.md`）。文案带当前天气——它是天气那一段里
                            唯一说「现在下什么」的地方。与缩放、装饰同形：点它**不关浮层**、只换这一块内容，
                            所以它是**导航项**，不带 `aria-pressed`（每项真开关在二级里） */}
                        <button
                          key="weather"
                          type="button"
                          className="hud-action hud-menu-action"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => setMenuView('weather')}
                        >
                          天气 · {weatherLabel(view.weather)}
                        </button>
                        {/* 雨声开关：与天气各自独立（无雨也能只听雨、雨天也能静音）。文案 = 当前状态。
                            点它同样不关浮层；同样需要独立 `key` + `pointerdown` 拦默认行为 */}
                        <button
                          key="sound"
                          type="button"
                          className="hud-action hud-menu-action"
                          aria-pressed={view.sound}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            // 解锁必须在 **click 同步路径** 里：store 的 effect 已在手势之外，那里建的
                            // `AudioContext` 在 Safari 会永久停在 `suspended`（静音开关是后开的常态路径）
                            if (!view.sound) unlockAudio();
                            setSound(!view.sound);
                          }}
                        >
                          {soundLabel(view.sound)}
                        </button>
                        {/* 「反馈与建议」：进 `feedback` 会话，插槽面板换成反馈表单
                            （`docs/design/50-slot-panel.md` §附）。点它关浮层。
                            独立 `key` + `pointerdown` 拦默认行为：与「关于失眠云」那颗同理 */}
                        <button
                          key="feedback"
                          type="button"
                          className="hud-action hud-menu-action"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            closeMenu('gear');
                            // 等浮层关完再进 feedback：`hidePopover()` 的焦点归还会在提交之后
                            // 把焦点抢回齿轮，下一帧的焦点对账就会把刚开的面板当成「焦点跑到面板外」
                            window.setTimeout(openFeedback, 0);
                          }}
                        >
                          反馈与建议
                        </button>
                        {/* 「关于失眠云」：手动入口（`docs/design/90-about-panel.md` §1），与自动那一次共用面板。
                            点它关浮层并打开面板——手动路径没有勾选框（`source` 决定）。
                            独立 `key` + `pointerdown` 拦默认行为：与天气那颗同理 */}
                        <button
                          key="about"
                          type="button"
                          className="hud-action hud-menu-action"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            closeMenu('gear');
                            openAbout('manual');
                          }}
                        >
                          关于失眠云
                        </button>
                      </div>
                      <div className="hud-menu-version">v{APP_VERSION}</div>
                      {/* 隐私告知与入场层那一行同源（`70-privacy-risk.md` §8.1）：
                          静态页、零接口；新标签打开、被拦退回同标签（理由见 `../privacy-link.ts`） */}
                      <a
                        className="hud-menu-link"
                        href={PRIVACY_PAGE_HREF}
                        onClick={(event) => openPrivacyPage(event, (url, target) => window.open(url, target))}
                      >
                        使用须知与隐私说明
                      </a>
                    </>
                  )}
                </div>
              ) : null}

              {/* 礼物托盘（`docs/ui/DESIGN.md` 的 `gift-tray` 行）：外观与定位全复用 `.hud-menu`——目标锚也是
                  齿轮那个 `--hud-settings-gear`（礼物与齿轮同一行同高，一个新 `anchor-name` 都不加）。
                  `popover="auto"` 与齿轮菜单天然互斥（后开的那个把先开的挤掉）；降级路径靠 `openMenu` 互斥。
                  **必须带可见标签**：留言板与求签两枚线描图形都是「一个容器」的形状，纯图标只有靠猜。
                  `hud-menu-group` 只管竖排 8px 间距（与齿轮根视图同一套），不另造间距规则 */}
              {HAS_POPOVER || openMenu === 'gift' ? (
                <div
                  className="hud-menu gift-tray"
                  id="gift-tray"
                  ref={giftTrayRef}
                  popover={HAS_POPOVER ? 'auto' : undefined}
                >
                  <div className="hud-menu-group">
                    {ICON_ENTRIES.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className="hud-action hud-menu-action"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          // 一次点按 = 一次事务：四颗都先关托盘，再执行各自的动作
                          closeMenu('gift');
                          entry.on();
                        }}
                      >
                        {entry.icon}
                        <span>{entry.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
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
    </>
  );
}
