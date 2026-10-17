import { useEffect, useRef, useState } from 'react';

import { CONNECT_BANNER_DELAY_MS, connBannerOf } from '../conn-banner';
import { getState, subscribe } from '../store';
import { retryNow } from '../ws';

/**
 * 断连的常驻提示条（`docs/ui/DESIGN.md` 的 `conn-banner`）：占 `chat-panel` 的**第一个子元素**位置
 * （占位、不浮层，所以可用视口自动扣掉它）、**不自动消失**、无入场动画、不抢焦点。
 * 自己订阅 store 的 `connection`——连接态不进 `ChatPanel` 的 `PanelView`（那道差分守卫只吃面板真用得上的字段）。
 */
export function ConnectionBanner() {
  const connectionRef = useRef(getState().connection);
  /** 进入 `connecting` 的本地时刻 = 3 秒阈值的起点；每一次重连都重新算。 */
  const sinceRef = useRef<number | undefined>(connectionRef.current === 'connecting' ? Date.now() : undefined);
  const [connection, setConnection] = useState(connectionRef.current);
  // 阈值没有别的信号：到点后重取一次 `now`，让纯函数自己翻面
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    return subscribe((state) => {
      if (state.connection === connectionRef.current) return;
      connectionRef.current = state.connection;
      sinceRef.current = state.connection === 'connecting' ? Date.now() : undefined;
      setConnection(state.connection);
    });
  }, []);

  useEffect(() => {
    if (connection !== 'connecting') return;
    // **只在 `connecting` 期间**挂这一个 3 秒计时器：状态一变或组件卸载就清掉（见 `AGENTS.md` 硬纪律 6）。
    // 不用常驻 interval：那会让页面整夜无法休眠。
    const timer = setTimeout(() => setNow(Date.now()), CONNECT_BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [connection]);

  const banner = connBannerOf({ connection, connectingSinceMs: sinceRef.current, now });
  if (!banner.visible) return null;

  return (
    <div className="conn-banner" role="status" aria-live="polite">
      <span>{banner.text}</span>
      <button type="button" className="conn-banner-retry" onClick={() => retryNow()}>
        尝试连接
      </button>
    </div>
  );
}
