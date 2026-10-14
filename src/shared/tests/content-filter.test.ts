import { describe, expect, it } from 'vitest';

import { detect, mask } from '../content-filter';

describe('内容过滤', () => {
  describe('检测入口（昵称：命中即拒绝）', () => {
    it('命中普通写法', () => {
      expect(detect('傻逼')).toBe('傻逼');
    });

    it('命中插入干扰字符的写法', () => {
      expect(detect('傻·逼')).toBe('傻逼');
      expect(detect('傻（逼）')).toBe('傻逼');
      expect(detect('傻 逼')).toBe('傻逼');
      expect(detect('傻\u200b逼')).toBe('傻逼');
    });

    it('英文不区分大小写', () => {
      expect(detect('FUCK')).toBe('fuck');
    });

    it('干净文本返回 null', () => {
      expect(detect('小明')).toBeNull();
      expect(detect('')).toBeNull();
      expect(detect('   ')).toBeNull();
      expect(detect('今晚月色很好，睡不着')).toBeNull();
    });
  });

  describe('打码入口（聊天：打码但不拦截）', () => {
    it('命中词被打码，其余内容照常送达', () => {
      expect(mask('你这个傻逼')).toBe('你这个**');
    });

    it('插入干扰字符时连干扰字符一起打码（长度不变）', () => {
      expect(mask('傻·逼')).toBe('***');
      expect(mask('傻 逼')).toBe('***');
    });

    it('同一句里的多个命中都被打码', () => {
      expect(mask('傻逼和傻B')).toBe('**和**');
    });

    it('未命中时原样返回', () => {
      expect(mask('睡不着，聊聊天吧')).toBe('睡不着，聊聊天吧');
      expect(mask('')).toBe('');
    });

    it('打码结果里不再有命中', () => {
      expect(detect(mask('你他妈的傻逼'))).toBeNull();
    });
  });
});
