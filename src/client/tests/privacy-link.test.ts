import { describe, expect, it, vi } from 'vitest';

import { PRIVACY_PAGE_HREF, openPrivacyPage } from '../privacy-link';

describe('隐私说明入口：新标签打不开时退回同标签', () => {
  it('地址带扩展名（Vite 开发服务器没有 html_handling，省略扩展名会落进 SPA 回退）', () => {
    expect(PRIVACY_PAGE_HREF).toBe('/privacy.html');
  });

  it('弹窗没被拦下：新标签打开、摘掉 opener，并阻止 <a> 再导航一次', () => {
    const opened = { opener: {} as unknown };
    const open = vi.fn(() => opened);
    const preventDefault = vi.fn();

    openPrivacyPage({ preventDefault }, open);

    expect(open).toHaveBeenCalledWith(PRIVACY_PAGE_HREF, '_blank');
    expect(opened.opener).toBeNull();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('弹窗被拦下：什么都不做，让 <a> 自己导航（否则就是「点了没反应」）', () => {
    const preventDefault = vi.fn();

    openPrivacyPage({ preventDefault }, () => null);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
