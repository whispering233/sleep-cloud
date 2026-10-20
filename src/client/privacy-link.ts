/**
 * 隐私说明静态页的入口行为（入场层与齿轮浮层共用这一份，两处表现必须一致）。
 *
 * 地址**带扩展名**：生产由平台资产服务，`/privacy.html` 会被 307 到 `/privacy`；
 * 而 `npm run dev:web`（Vite）**没有** `html_handling`，省略扩展名的 `/privacy` 会落进 SPA 回退、
 * 返回大厅首页——点开一个「和刚才一样的页面」，看起来就是「点了没反应」。
 */
export const PRIVACY_PAGE_HREF = '/privacy.html';

/**
 * 新标签打开隐私说明；**浏览器拦下弹窗时退回同标签**。
 *
 * 为什么不能只写 `target="_blank"`：被拦下的唯一表现是「点了什么都没有」，而隐私说明恰恰是最不能
 * 静默失败的一条链路（见 `docs/design/70-privacy-risk.md` §8.1）。
 * 所以 `<a>` 上**不写 `target`**：受信任的点击走 `window.open`（成功就 `preventDefault`，避免开两次），
 * 被拦下（返回 `null`）时什么都不做，让 `<a>` 自己按同标签导航——至少用户看得到页面。
 *
 * Ctrl/⌘ 点击与「在新标签打开」也照旧归浏览器处理（那时不会进这里）。
 */
/** `window.open` 的形状（由调用方传进来：这个模块不碰 DOM 全局，纯函数才能在 node 里单测）。 */
export type OpenWindow = (url: string, target: string) => { opener: unknown } | null;

export function openPrivacyPage(event: { preventDefault: () => void }, open: OpenWindow): void {
  const opened = open(PRIVACY_PAGE_HREF, '_blank');
  if (!opened) return; // 被拦下：交给 <a> 的同标签导航
  opened.opener = null; // window.open 出来的是同源窗口，把 opener 摘掉（等价 rel=noopener）
  event.preventDefault();
}
