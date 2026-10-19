/**
 * 插槽面板的触发源登记（`docs/design/50-slot-panel.md` §2、§3）。
 *
 * 契约：每个源自己 provide 一个 `active`，**面板显示 = 任一源 active**，关掉也由该源自己清。
 * 这里**没有**全局的「失焦即退场」——否则第二个源（统计按钮之类）打开时，用户点空白没有焦点可失，
 * 面板就关不掉。首版只有一个源：聊天输入行的焦点（`ChatPanel.tsx`）。
 *
 * 纯状态、不碰 DOM：界面层订阅它决定 `SlotPanel` 的显示，
 * 世界层不 import 它。
 */
const sources = new Set<string>();
const listeners = new Set<() => void>();

/** 登记某个触发源的 `active`：同值不通知（位置节拍之类的重入不该白渲染）。 */
export function setSlotSource(id: string, on: boolean): void {
  if (on === sources.has(id)) return;
  if (on) sources.add(id);
  else sources.delete(id);
  for (const listener of listeners) listener();
}

/** 面板此刻该不该出现：任一源 active 就出现。 */
export function slotActive(): boolean {
  return sources.size > 0;
}

export function subscribeSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 插槽面板高度 = 可用视口下沿 − 聊天面板下沿（§3）：它挂在聊天面板**下沿**，撑到屏幕底。
 * 两个盒子都会变（提示条只在断连时占位、私聊行只在有目标时出现），所以调用方随变化重算。
 * 夹到 0 是因为面板比视口还高时不该出现负高度。
 */
export function slotHeightOf(edges: { panelBottom: number; viewportBottom: number }): number {
  return Math.max(0, edges.viewportBottom - edges.panelBottom);
}
