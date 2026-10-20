import type { SessionView } from '../../shared/http-api';
import { PRIVACY_PAGE_HREF, openPrivacyPage } from '../privacy-link';
import { APPEARANCES } from '../../shared/protocol';
import type { Appearance } from '../../shared/protocol';
import { confirmAge, setAppearance, setNickname } from '../api';
import { unlock } from '../audio';
import { ERROR_FALLBACK_TEXT, blockedTextFor, errorTextFor } from '../error-text';
import { getState } from '../store';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';
import { APP_VERSION } from '../version';
import { useState } from 'react';

/** 入场层出错时的文案：通用的错误码到文案映射在错误反馈层，这里只留兜底。 */
const errorText = (code: string) => errorTextFor(code) ?? ERROR_FALLBACK_TEXT;

/** 图集帧名（`public/sprites/frames.css`，坐标由素材管线生成，不手抄）与可访问名。
 * **选项只有预览图、不写可见文字**（写「男孩 / 女孩」是给画面加它没有的信息），所以这个名字只给屏幕阅读器；
 * 它描述的是素材差异（发型），不是性别——素材换了就要跟着改。
 * 两个表都是 `Record<Appearance, …>`：枚举加第三种时这里会直接编译不过。 */
const PREVIEW_FRAME: Record<Appearance, string> = { boy: 'boy_stand', girl: 'girl_stand' };
const APPEARANCE_LABEL: Record<Appearance, string> = { boy: '侧边短发', girl: '双马尾' };

export interface EntryOverlayProps {
  session: SessionView;
  /** 入场前的拦截（`/api/me` 的码）：厅满（`2002`）或封禁（`5002`，带到期时间） */
  block?: EntryBlock;
  onDone: (session: SessionView) => void;
}

/** 入场前的两种拦截：厅满只剩最小档也满了；封禁带 `untilAt`（`null` = 永久）。 */
export type EntryBlock = { code: '2002' } | { code: '5002'; untilAt: number | null };

/**
 * 入场层：18 岁自述 + 昵称 + 形象二选一。**每次进入大厅前都出现**；会话已完善时它是「预填 + 一键继续」。
 * 改名与改形象都只发生在这里（建连之前），因此协议不需要「名字变更」/「形象变更」消息。
 * 没有大区选择：只有一个厅（见 `docs/design/config.md` §1）。
 */
export function EntryOverlay({ session, block, onDone }: EntryOverlayProps) {
  const [nickname, setNicknameDraft] = useState(session.nickname);
  const [appearance, setAppearanceDraft] = useState(session.appearance);
  const [ageConfirmed, setAgeConfirmed] = useState(session.ageConfirmed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = Boolean(session.nickname) && session.ageConfirmed;
  const canContinue = ageConfirmed && nickname.trim().length > 0 && !busy && block === undefined;
  // 拦截文案在**这一次渲染**算一次：封禁的剩余分钟不养倒计时定时器（硬纪律 6）
  const blockText =
    block === undefined
      ? undefined
      : block.code === '2002'
        ? errorText('2002')
        : blockedTextFor(block.untilAt, Date.now());

  /** 把一次写入的结果落到会话上：`1001` 表示会话被换新（静默）。 */
  const runStep = async (
    step: () => Promise<{ code: string; data?: SessionView }>,
    current: SessionView,
  ): Promise<SessionView> => {
    const res = await step();
    if (res.code === '0' || res.code === '1001') return res.data ?? current;
    throw new Error(errorText(res.code));
  };

  const continueEntry = async () => {
    // 必须在**手势处理器内部同步**解锁音频：Safari 只认这一种，而 `onDone` 已经在几次请求之后了。
    // 只在雨天做：无雨时连 `AudioContext` 都不建（见了 `audio.ts` 的 `unlock`）
    if (getState().rain) unlock();
    setError(null);
    setBusy(true);
    try {
      let current = session;
      if (!current.ageConfirmed) current = await runStep(confirmAge, current);

      const name = nickname.trim();
      if (name !== current.nickname) current = await runStep(() => setNickname(name), current);
      if (appearance !== current.appearance) current = await runStep(() => setAppearance(appearance), current);

      onDone(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ERROR_FALLBACK_TEXT);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="entry-overlay">
      <form
        className="entry-card"
        onSubmit={(event) => {
          event.preventDefault();
          void continueEntry();
        }}
      >
        <div className="entry-head">
          <h1 className="entry-title">失眠云</h1>
          <span className="entry-version">v{APP_VERSION}</span>
        </div>

        <div className="entry-field">
          <label className="field-label" htmlFor="entry-nickname">
            你的名字
          </label>
          <TextInput
            id="entry-nickname"
            value={nickname}
            placeholder="给自己起个名字"
            autoComplete="off"
            enterKeyHint="go"
            onChange={(event) => setNicknameDraft(event.target.value)}
          />
        </div>

        <div className="entry-field" role="group" aria-label="你的样子">
          <span className="field-label">你的样子</span>
          <div className="appearance-row">
            {APPEARANCES.map((value) => (
              <button
                key={value}
                type="button"
                className={value === appearance ? 'appearance-option appearance-option-selected' : 'appearance-option'}
                aria-pressed={value === appearance}
                aria-label={APPEARANCE_LABEL[value]}
                onClick={() => setAppearanceDraft(value)}
              >
                <span className="appearance-frame">
                  <span className={`appearance-preview sprite-${PREVIEW_FRAME[value]}`} />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 18 岁自述与它的隐私入口是**同一块同意面**（`70-privacy-risk.md` §8.1）：两者贴在一起，
            所以包一层而不是各占一个 `entry-field`——入场层只有三项，第四个区块会让入场层重新排版 */}
        <div className="entry-age">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(event) => setAgeConfirmed(event.target.checked)}
            />
            我已满 18 岁
          </label>
          {/* 静态页、零接口。新标签打开（不丢入场层已经填过的昵称），被弹窗拦截时退回同标签
              —— 两种行为的理由都在 `../privacy-link.ts` */}
          <a
            className="entry-privacy"
            href={PRIVACY_PAGE_HREF}
            onClick={(event) => openPrivacyPage(event, (url, target) => window.open(url, target))}
          >
            使用须知与隐私说明
          </a>
        </div>

        {blockText ?? error ? (
          <p className="form-error" role="alert">
            {blockText ?? error}
          </p>
        ) : null}

        <PrimaryAction type="submit" disabled={!canContinue}>
          {ready ? '进入大厅' : '继续'}
        </PrimaryAction>
      </form>
    </div>
  );
}