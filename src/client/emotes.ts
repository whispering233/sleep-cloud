/**
 * 表情快捷表：点击即发一条**聊天消息**，内容就是那个 emoji（见 `docs/api/20-api-ws.md` §4.8）。
 * `glyph` 给眼睛看，`label` 只给屏读（`aria-label` 不念 emoji 字符）；没有独立通道、也没有独立的显示时长。
 */
export const EMOTE_SHORTCUTS: ReadonlyArray<{ glyph: string; label: string }> = [
  { glyph: '👋', label: '挥手' },
  { glyph: '😴', label: '晚安' },
  { glyph: '💗', label: '比心' },
  { glyph: '😢', label: '想哭' },
  { glyph: '🤗', label: '抱抱' },
];
