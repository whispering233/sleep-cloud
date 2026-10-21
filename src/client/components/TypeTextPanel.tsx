import { useEffect, useState } from 'react';

import type { ReadProgress } from '../prefs';
import { drawReadItem, ensureReadItem, replayRead } from '../store';
import { loadTypeTextPack, paragraphsOf, poolSize } from '../type-texts';
import type { TypeTextCategory, TypeTextItem } from '../type-texts';

/** 插槽里的按钮一律在 `pointerdown` 里拦默认行为：插槽面板的红线（`docs/design/50-slot-panel.md` §7）。 */
const keepFocus = (event: React.PointerEvent): void => {
  event.preventDefault();
};

/**
 * 插槽面板的第二个内容：类型文本（`docs/design/50-slot-panel.md` §附）。
 *
 * - 打开时**有当前条就原样显示**（收起 / 刷新回来还是它），没有才抽一条。
 * - 正文顶对齐、自己滚；按钮钉在右下角，抽干后同一位置换成「再看一遍」。
 * - 没有标签行：分类名只作这一块的 `aria-label`。
 */
export function TypeTextPanel({ progress }: { progress: ReadProgress }) {
  const [pack, setPack] = useState<TypeTextCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [current, setCurrent] = useState<TypeTextItem | null>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadTypeTextPack()
      .then((categories) => {
        const category = categories[0];
        if (!alive) return;
        if (!category) {
          setFailed(true);
          return;
        }
        setPack(categories);
        setCurrent(ensureReadItem(category.id, category.items));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const category = pack?.[0];
  const currentId = category === undefined ? undefined : progress.current[category.id];
  // 抽干 = 池里一条不剩（当前条多数时候已在 `seen` 里，池自然不含它）
  const canDraw =
    category !== undefined && poolSize(category.items, progress.seen[category.id] ?? [], currentId) > 0;
  const draw = (): void => {
    if (!category) return;
    const next = canDraw ? drawReadItem(category.id, category.items) : replayRead(category.id, category.items);
    if (next) setCurrent(next);
  };

  return (
    <div className="type-text" role="group" aria-label={category?.label ?? '类型文本'}>
      <div className="type-text-body">
        {failed ? (
          <p className="type-text-note">内容没取到</p>
        ) : current ? (
          paragraphsOf(current.text).map((paragraph, index) => <p key={index}>{paragraph}</p>)
        ) : pack ? null : (
          <p className="type-text-note">取内容…</p>
        )}
      </div>
      <div className="type-text-actions">
        {failed ? (
          <button type="button" className="hud-action" onPointerDown={keepFocus} onClick={() => setAttempt((n) => n + 1)}>
            重试
          </button>
        ) : category === undefined ? null : canDraw ? (
          <button
            type="button"
            className="hud-action type-text-random"
            aria-label="随机一条"
            onPointerDown={keepFocus}
            onClick={draw}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M16 10a6 6 0 1 1-2.2-4.65" />
              <path d="M14.1 2.2l.3 3.3-3.3.3" />
            </svg>
          </button>
        ) : (
          <button type="button" className="hud-action" onPointerDown={keepFocus} onClick={draw}>
            再看一遍
          </button>
        )}
      </div>
    </div>
  );
}
