import { QUICK_PHRASES } from '../quick-phrases';

/**
 * 快捷用语列表 = 插槽面板的首个内容（`docs/design/50-slot-panel.md` §5、§附）：竖排、每条 44px，
 * 点一条 = 把文本**填进输入框**（替换当前草稿，走 `onFill`），**不发送**。
 *
 * 焦点必须在 `pointerdown` 里 `preventDefault()` 保住：按钮默认会拿走输入行的焦点 → 唯一触发源清 active
 * → 面板退场 + 键盘收起 + 文本也填不进去（§6 红线 1）。`preventDefault` 只挡焦点，`click` 照常发。
 * 所以这里不 `blur`、不 `focus`、不碰 DOM，也不给世界句柄 / 相机 / 发送（§5 的窄接口）。
 */
export function QuickPhrases({ onFill }: { onFill: (text: string) => void }) {
  return (
    <div className="quick-phrases">
      {QUICK_PHRASES.map((phrase) => (
        <button
          key={phrase}
          type="button"
          className="hud-action quick-phrase"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onFill(phrase)}
        >
          {phrase}
        </button>
      ))}
    </div>
  );
}