import type { SessionView } from '../../shared/http-api';
import { confirmAge, setNickname } from '../api';
import { ERROR_FALLBACK_TEXT, errorTextFor } from '../error-text';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';
import { useState } from 'react';

/** 入场层出错时的文案：通用的错误码到文案映射在错误反馈层，这里只留兜底。 */
const errorText = (code: string) => errorTextFor(code) ?? ERROR_FALLBACK_TEXT;

export interface EntryOverlayProps {
  session: SessionView;
  /** 厅满（`/api/me` 的 `2002`）：只剩最小档也满了，先不让进 */
  blocked?: boolean;
  onDone: (session: SessionView) => void;
}

/**
 * 入场层：18 岁自述 + 昵称。**每次进入大厅前都出现**；会话已完善时它是「预填 + 一键继续」。
 * 改名只发生在这里（建连之前），因此协议不需要「名字变更」消息。
 * 没有大区选择：只有一个厅（见 `docs/design/config.md` §1）。
 */
export function EntryOverlay({ session, blocked = false, onDone }: EntryOverlayProps) {
  const [nickname, setNicknameDraft] = useState(session.nickname);
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
        <h1 className="entry-title">云上睡眠大厅</h1>

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