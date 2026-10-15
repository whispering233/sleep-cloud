import { useEffect, useRef } from 'react';

import { sendLie, sendWalk } from '../ws';
import { clearSelection, selectPerson } from '../store';
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
    void (async () => {
      try {
        // 世界层单独成块：入场层不必等这几百 KB 下载完（手机是主场景）
        const { createWorld } = await import('../world/world');
        const handle = createWorld(host, {
          onWalk: (point) => sendWalk(point.x, point.y),
          onLie: (bedNo) => sendLie(bedNo),
          onSelect: (id) => selectPerson(id),
          onClearSelection: () => clearSelection(),
        });
        if (cancelled) handle.destroy();
        else world = handle;
      } catch {
        // 画布起不来不该把界面拖垮
      }
    })();

    return () => {
      cancelled = true;
      world?.destroy();
    };
  }, []);

  return <div className="world-layer" ref={hostRef} />;
}
