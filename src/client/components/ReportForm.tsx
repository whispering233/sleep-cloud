import { useState } from 'react';
import type { FormEvent } from 'react';
import { REPORT_REASON_MAX_LEN } from '../../shared/constants';
import { sendReport } from '../ws';
import { PrimaryAction } from './PrimaryAction';

/**
 * 举报事由表单（插槽面板的第三个内容源，`docs/design/50-slot-panel.md` §4）。
 *
 * **独立的 `<form>`**：不能嵌进聊天那个表单——表单不能嵌表单，而且提交按钮会变成聊天输入框的
 * 隐式提交按钮。`Enter` 在这里是换行（默认行为），只有点「确认举报」才提交。
 *
 * 顶对齐、按钮在事由框**下方**：整块底部组合在非空闲态贴着 HUD（`60-interaction-shell.md` §3），
 * 键盘弹起盖住的是世界，盖不到按钮。
 */
export function ReportForm({ toId }: { toId?: string }) {
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === '' || toId === undefined) return;
    // 回执是 `5003`（`docs/api/20-api-ws.md` §4.9）：成功 / 超额被静默丢弃都不在这里分叉，
    // 唯一的出口是「收起」与服务端回执
    sendReport(toId, trimmed);
  }

  return (
    <form className="report-form" onSubmit={submit}>
      <textarea
        className="input-field report-reason"
        aria-label="举报事由"
        placeholder="举报事由"
        rows={3}
        autoFocus
        value={reason}
        maxLength={REPORT_REASON_MAX_LEN}
        onChange={(event) => setReason(event.target.value)}
      />
      {/* 插槽面板里的按钮 `pointerdown` 里拦一下（`docs/design/50-slot-panel.md` §4）：
          别把焦点从事由框抢走，否则下一帧的焦点对账会赶在 `submit` 之前退场 */}
      <PrimaryAction
        type="submit"
        onPointerDown={(event) => event.preventDefault()}
        disabled={reason.trim() === '' || toId === undefined}
      >
        确认举报
      </PrimaryAction>
    </form>
  );
}
