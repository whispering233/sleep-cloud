import { describe, expect, it } from 'vitest';

import { ABOUT_BLOCKS, ABOUT_TOKEN, aboutToken, parseAbout, shouldShowAbout } from '../about';

describe('shouldShowAbout（docs/design/90-about-panel.md §3）', () => {
  it('缺键 → 弹（从未确认过任何公告）', () => {
    expect(shouldShowAbout(undefined)).toBe(true);
  });

  it('指纹相等 → 不弹', () => {
    expect(shouldShowAbout(ABOUT_TOKEN)).toBe(false);
  });

  it('旧指纹 → 弹', () => {
    expect(shouldShowAbout('1k9f3a2')).toBe(true);
  });

  it('判废后的坏值 → 弹（不校验格式，坏值唯一后果是再弹一次）', () => {
    for (const bad of ['', '不是指纹', '0.0.8']) expect(shouldShowAbout(bad)).toBe(true);
  });
});

describe('parseAbout（docs/design/90-about-panel.md §4）', () => {
  it('`## ` 行独立成小节标题，不并入相邻块', () => {
    expect(parseAbout('前言\n## 小节\n- 条目')).toEqual([
      { kind: 'paragraph', parts: [{ kind: 'text', text: '前言' }] },
      { kind: 'heading', parts: [{ kind: 'text', text: '小节' }] },
      { kind: 'list', items: [[{ kind: 'text', text: '条目' }]] },
    ]);
  });

  it('连续的 `- ` 行合成一个列表，非 `- ` 行即结束它', () => {
    expect(parseAbout('- 一\n- 二\n\n- 三\n正文\n- 四')).toEqual([
      {
        kind: 'list',
        items: [[{ kind: 'text', text: '一' }], [{ kind: 'text', text: '二' }]],
      },
      {
        kind: 'list',
        items: [[{ kind: 'text', text: '三' }]],
      },
      { kind: 'paragraph', parts: [{ kind: 'text', text: '正文' }] },
      {
        kind: 'list',
        items: [[{ kind: 'text', text: '四' }]],
      },
    ]);
  });

  it('一个非空行 = 一段；空行只为可读，忽略', () => {
    expect(parseAbout('第一段\n\n第二段\n')).toEqual([
      { kind: 'paragraph', parts: [{ kind: 'text', text: '第一段' }] },
      { kind: 'paragraph', parts: [{ kind: 'text', text: '第二段' }] },
    ]);
  });

  it('`[文字](https://…)` → 链接，块内前后文字都保住', () => {
    expect(parseAbout('- 见 [仓库](https://example.com/a) 吧')).toEqual([
      {
        kind: 'list',
        items: [
          [
            { kind: 'text', text: '见 ' },
            { kind: 'link', text: '仓库', href: 'https://example.com/a' },
            { kind: 'text', text: ' 吧' },
          ],
        ],
      },
    ]);
  });

  it('`http:` 与坏 URL 按字面显示（不补全、不丢弃）', () => {
    const parts = parseAbout('[a](http://example.com) [b](javascript:x) [c](not-a-url) [d]() [e](https://)');
    expect(parts).toEqual([{ kind: 'paragraph', parts: [{ kind: 'text', text: '[a](http://example.com) [b](javascript:x) [c](not-a-url) [d]() [e](https://)' }] }]);
  });

  it('`# x` / `* x` / `1. x` 一律当正文', () => {
    expect(parseAbout('# 一级\n* 星号\n1. 数字')).toEqual([
      { kind: 'paragraph', parts: [{ kind: 'text', text: '# 一级' }] },
      { kind: 'paragraph', parts: [{ kind: 'text', text: '* 星号' }] },
      { kind: 'paragraph', parts: [{ kind: 'text', text: '1. 数字' }] },
    ]);
  });

  it('空前缀（`## ` / `- ` 后没有字）丢掉，CRLF 不影响结果', () => {
    expect(parseAbout('## \r\n- \r\n## 小节\r\n- 条目\r\n')).toEqual([
      { kind: 'heading', parts: [{ kind: 'text', text: '小节' }] },
      { kind: 'list', items: [[{ kind: 'text', text: '条目' }]] },
    ]);
  });
});

describe('内容指纹（docs/design/90-about-panel.md §3.1）', () => {
  it('只改空白（空行、行内 / 行尾空白）→ 指纹不变', () => {
    expect(aboutToken('a\n\nb\n')).toBe(aboutToken('  a  \n b '));
    expect(aboutToken('a\r\nb\r\n')).toBe(aboutToken('a\nb\n'));
  });

  it('换行切分变 → 指纹变', () => {
    expect(aboutToken('一\n二')).not.toBe(aboutToken('一 二'));
  });

  it('改一个字 → 指纹变', () => {
    expect(aboutToken('第一段\n第二段')).not.toBe(aboutToken('第一段\n第二段。'));
  });
});

describe('about.json 本身合规（docs/design/90-about-panel.md §4、§7）', () => {
  it('正文非空，且指纹落在 `sc.about.seen` 的 ≤ 32 字符窗口内', () => {
    expect(ABOUT_BLOCKS.length).toBeGreaterThan(0);
    expect(ABOUT_TOKEN).toMatch(/^[0-9a-z]{1,32}$/);
  });

  it('≤ 24 块（超了该拆成文档，而不是让面板变成长篇）', () => {
    expect(ABOUT_BLOCKS.length).toBeLessThanOrEqual(24);
  });

  it('至少一个小节标题', () => {
    expect(ABOUT_BLOCKS.some((block) => block.kind === 'heading')).toBe(true);
  });

  it('解析结果里没有空块', () => {
    for (const block of ABOUT_BLOCKS) {
      if (block.kind === 'list') {
        expect(block.items.length).toBeGreaterThan(0);
        for (const item of block.items) expect(item.length).toBeGreaterThan(0);
      } else {
        expect(block.parts.length).toBeGreaterThan(0);
      }
    }
  });
});
