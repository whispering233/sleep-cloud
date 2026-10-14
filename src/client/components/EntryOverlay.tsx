import { NICKNAME_MAX_LEN } from '../../shared/constants';
import type { HallSummary, SessionView } from '../../shared/http-api';
import { confirmAge, setNickname, switchHall } from '../api';
import { PrimaryAction } from './PrimaryAction';
import { TextInput } from './TextInput';
import { useState } from 'react';

/** 入场层专用文案（通用的错误码到文案映射在错误反馈层）。 */
const ERROR_TEXT: Record<string, string> = {
  '1002': '进入前请先确认',
  '1004': `名字最多 ${NICKNAME_MAX_LEN} 个字`,
  '1005': '这个名字不能用，换一个',
  '2001': '这个大厅不存在',
  '2002': '这个大厅满了，换个厅试试',
  '9001': '出了点问题，稍后再试',
};

const errorText = (code: string) => ERROR_TEXT[code] ?? '出了点问题，稍后再试';

/** 浏览器本地时区（服务端无从得知，必须由客户端上报一次）。 */
const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

export interface EntryOverlayProps {
  session: SessionView;
  halls: HallSummary[];
  onDone: (session: SessionView) => void;
}

/**
 * 入场层：18 岁自述 + 昵称 + 大区，一次走完。**每次进入大厅前都出现**；
 * 会话已完善时它是「预填 + 一键继续」。改名只发生在这里（建连之前），因此协议不需要「名字变更」消息。
 */
export function EntryOverlay({ session, halls, onDone }: EntryOverlayProps) {
  const [nickname, setNicknameDraft] = useState(session.nickname);
  const [ageConfirmed, setAgeConfirmed] = useState(session.ageConfirmed);
  const [hallId, setHallId] = useState(session.hallId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = Boolean(session.nickname) && session.ageConfirmed;
  const canContinue = ageConfirmed && nickname.trim().length > 0 && !busy;

  /** 把一次写入的结果落到会话上：`1001` 表示会话被换新（静默），`1006` 表示时区回退但昵称已保存。 */
  const runStep = async (
    step: () => Promise<{ code: string; data?: SessionView }>,
    current: SessionView,
  ): Promise<SessionView> => {
    const res = await step();
    if (res.code === '0' || res.code === '1001' || res.code === '1006') return res.data ?? current;
    throw new Error(errorText(res.code));
  };

  const continueEntry = async () => {
    setError(null);
    setBusy(true);
    try {
      let current = session;
      if (!current.ageConfirmed) current = await runStep(confirmAge, current);

      const name = nickname.trim();
      if (name !== current.nickname) {
        current = await runStep(() => setNickname(name, localTimezone()), current);
      }

      if (hallId !== current.hallId) current = await runStep(() => switchHall(hallId), current);
      onDone(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '出了点问题，稍后再试');
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

        <div className="entry-field">
          <label className="field-label" htmlFor="entry-hall">
            大区
          </label>
          <select
            id="entry-hall"
            className="input-field"
            value={hallId}
            onChange={(event) => setHallId(event.target.value)}
          >
            {halls.map((hall) => (
              <option key={hall.id} value={hall.id}>
                {hall.name}（{hall.acceptedBeds}/{hall.capacity}）
              </option>
            ))}
          </select>
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
