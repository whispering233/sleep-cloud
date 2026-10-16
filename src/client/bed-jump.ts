/**
 * HUD 的「⇢」那一行输入 → `hop` 的 `bedNo`（纯函数，可单测）。
 *
 * 输入的是**显示床号**（1 起，见 `layout.ts` 的 `displayBedNoOf`），返回**内部床号**（显示值 − 1）。
 * 为什么在客户端先拦一道：服务端对越界只回静默类的 `3001`，而可点击的界面不能静默失败
 * （见 `docs/design/10-hall-runtime.md` §5.1）。
 */
export function parseJumpTarget(raw: string, bedCount: number): { bedNo: number } | { error: string } {
  const text = raw.trim();
  // 只认纯数字：`Number('')` / `Number('  ')` 是 0，`Number('1.5')` 是小数，都得挡在这里
  const display = Number(text);
  if (!/^\d+$/.test(text) || display < 1 || display > bedCount) return { error: `床号要在 1~${bedCount} 之间` };
  return { bedNo: display - 1 };
}