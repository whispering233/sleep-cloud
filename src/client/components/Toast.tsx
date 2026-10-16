import { useEffect, useState } from 'react';

import { getState, setState, subscribe } from '../store';
import type { Notice } from '../store';

/**
 * 可恢复错误的提示条（`docs/ui/DESIGN.md` 的 `toast-recoverable`）。
 *
 * 只显示 `notice`：文案层已经筛过静默类错误，这里不再判码。
 * **自清靠 CSS 动画的 `animationend`，不挂 `setTimeout`**——内存定时器会让页面无法休眠（见 `AGENTS.md` 硬纪律 6）。
 */
export function Toast() {
  const [notice, setNotice] = useState<Notice | undefined>(() => getState().notice);

  useEffect(() => {
    setNotice(getState().notice);
    return subscribe((state) => {
      setNotice((prev) => (prev?.id === state.notice?.id ? prev : state.notice));
    });
  }, []);

  return (
    // 空壳常驻：`role="status"` 的节点与文本同一帧插入时，部分读屏器不会播报（与 ChatPanel 的常驻 aria-live 一致）
    <div className="toast-host" role="status" aria-live="polite">
      {notice ? (
        <p
          // key 换了就重新挂载：新提示的动画从头播（也就是靠它把 id 用起来）
          key={notice.id}
          className="toast-recoverable"
          onAnimationEnd={() => setState({ notice: undefined })}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}