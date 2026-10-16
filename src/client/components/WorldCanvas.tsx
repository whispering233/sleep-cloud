import { useEffect, useRef } from 'react';

import { sendLie, sendWalk } from '../ws';
import { clearSelection, selectPerson } from '../store';
import { setWorldHandle } from '../world-handle';
import type { WorldHandle } from '../world/world';

/**
 * 世界画布的宿主：React 只负责挂载与卸载。
 * 画什么、什么时候重画由 Phaser 的 game loop 与 store 决定——**画布不参与 React 的渲染循环**。
 */
export function WorldCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let world: WorldHandle | undefined;
    let cancelled = false;
    // 界面实占的两块：顶部 HUD 与底部聊天面板。只把元素指出来，高度由世界层去读
    // （面板会随私聊目标行 / 床上动作行的有无变高变矮，所以每帧取值，不在这里缓存）
    const shell = host.closest('.app-shell');
    const insetsOf = () => ({
      top: shell?.querySelector<HTMLElement>('.hud') ?? null,
      bottom: shell?.querySelector<HTMLElement>('.chat-panel') ?? null,
    });
    void (async () => {
      try {
        // 世界层单独成块：入场层不必等这几百 KB 下载完（手机是主场景）
        const { createWorld } = await import('../world/world');
        const handle = createWorld(
          host,
          {
            onWalk: (point) => sendWalk(point.x, point.y),
            onLie: (bedNo) => sendLie(bedNo),
            onSelect: (id) => selectPerson(id),
            onClearSelection: () => clearSelection(),
          },
          insetsOf,
        );
        if (cancelled) handle.destroy();
        else {
          world = handle;
          setWorldHandle(handle);
        }
      } catch {
        // 画布起不来不该把界面拖垮
      }
    })();

    return () => {
      cancelled = true;
      setWorldHandle(undefined);
      world?.destroy();
    };
  }, []);

  return <div className="world-layer" ref={hostRef} />;
}
