import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FEEDBACK_MAX_LEN } from '../../shared/constants';
import { exitComposer } from '../focus';
import { PRIVACY_PAGE_HREF, openPrivacyPage } from '../privacy-link';
import { clearFeedbackError } from '../store';
import { sendFeedback } from '../ws';
import { PrimaryAction } from './PrimaryAction';

/**
 * 反馈与建议表单（插槽面板的内容源之一，`docs/design/130-feedback.md` §3）。
 *
 * 与举报表单同一套结构：**独立 `<form>`**、顶对齐、按钮在反馈框下方；插槽面板里的按钮
 * `pointerdown` 里拦一下保住焦点（否则下一帧的焦点对账会赶在 `submit` 之前退场）。
 *
 * 可恢复的失败（`4001` / `4003` / `4004`）**在表单内显示**、内容原样留着；成功走 `5004`，
 * 由连接层退场并给一行确认。提交中按钮禁用、文案换成「发送中…」，防止连点发第二条。
 */
export function FeedbackForm({ error }: { error?: string }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // `autoFocus` 在插槽面板从 `inert` 转出来的同一帧里可能被浏览器忽略（focus 落在 body 上），
  // 于是下一帧的焦点对账立刻退场。这里在 commit 之后再聚焦一次，保证「打开即聚焦」是真的
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  // 服务端给了可恢复错误 = 这一轮结束了：按钮恢复，内容还在，人可以改完再发
  useEffect(() => {
    if (error !== undefined) setPending(false);
  }, [error]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '' || pending) return;
    clearFeedbackError();
    setPending(true);
    // 发不出去（连接已断）就当场恢复按钮：让人看得见「这条还在，没发出去」
    if (!sendFeedback(trimmed)) setPending(false);
  }

  const length = [...text].length;

  return (
    <form className="feedback-form" onSubmit={submit}>
      <p className="feedback-note">哪里让你睡不着？想加点什么？</p>
      <textarea
        ref={fieldRef}
        className="input-field feedback-text"
        aria-label="反馈与建议"
        placeholder="想说的都写在这里"
        rows={5}
        autoFocus
        value={text}
        maxLength={FEEDBACK_MAX_LEN}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="feedback-meta">
        <span
          className="feedback-count"
          data-near={length >= FEEDBACK_MAX_LEN - 50 ? '' : undefined}
          data-full={length >= FEEDBACK_MAX_LEN ? '' : undefined}
        >
          {`已写 ${length}/${FEEDBACK_MAX_LEN}`}
        </span>
      </div>
      <p className="feedback-note">
        反馈会保存 90 天，只有运维能看到，不会公开，也不回复。
        <a
          className="feedback-link"
          href={PRIVACY_PAGE_HREF}
          onClick={(event) => openPrivacyPage(event, (url, target) => window.open(url, target))}
        >
          使用须知
        </a>
      </p>
      {error !== undefined && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      <div className="feedback-actions">
        <button
          key="cancel"
          type="button"
          className="feedback-cancel"
          onPointerDown={(event) => event.preventDefault()}
          onClick={exitComposer}
        >
          取消
        </button>
        {/* 插槽面板里的按钮 `pointerdown` 里拦一下（`docs/design/50-slot-panel.md` §4）：
            别把焦点反馈框抢走，否则下一帧的焦点对账会赶在 `submit` 之前退场 */}
        <PrimaryAction
          type="submit"
          onPointerDown={(event) => event.preventDefault()}
          disabled={text.trim() === '' || pending}
        >
          {pending ? '发送中…' : '发送反馈'}
        </PrimaryAction>
      </div>
    </form>
  );
}
