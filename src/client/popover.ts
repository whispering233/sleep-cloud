/**
 * Popover API（Chromium 114+）。兼容基线是 Chromium 100（夸克 / UC 内核，见 `docs/design/architecture.md` §1），
 * 所以**全仓的能力判断只此一处**：组件里不许各写一份 `'showPopover' in …`。
 */
export const HAS_POPOVER = 'showPopover' in HTMLElement.prototype;
