import type { SessionView } from '../../shared/http-api';
import { APPEARANCES } from '../../shared/protocol';
import type { Appearance } from '../../shared/protocol';
import { confirmAge, setAppearance, setNickname } from '../api';
import { ERROR_FALLBACK_TEXT, errorTextFor } from '../error-text';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';
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
  /** 厅满（`/api/me` 的 `2002`）：只剩最小档也满了，先不让进 */
  blocked?: boolean;
  onDone: (session: SessionView) => void;
}

/**
 * 入场层：18 岁自述 + 昵称 + 形象二选一。**每次进入大厅前都出现**；会话已完善时它是「预填 + 一键继续」。
 * 改名与改形象都只发生在这里（建连之前），因此协议不需要「名字变更」/「形象变更」消息。
 * 没有大区选择：只有一个厅（见 `docs/design/config.md` §1）。
 */
export function EntryOverlay({ session, blocked = false, onDone }: EntryOverlayProps) {
  const [nickname, setNicknameDraft] = useState(session.nickname);
  const [appearance, setAppearanceDraft] = useState(session.appearance);
  const [ageConfirmed, setAgeConfirmed] = useState(session.ageConfirmed);
  const [error, setError] = useState<string | null>(blocked ? errorText('2002') : null);
  const [busy, setBusy] = useState(false);

  const ready = Boolean(session.nickname) && session.ageConfirmed;
  const canContinue = ageConfirmed && nickname.trim().length > 0 && !busy && !blocked;

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
        <h1 className="entry-title">失眠云</h1>

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

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(event) => setAgeConfirmed(event.target.checked)}
          />
          我已满 18 岁
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <PrimaryAction type="submit" disabled={!canContinue}>
          {ready ? '进入大厅' : '继续'}
        </PrimaryAction>
      </form>
    </div>
  );
}