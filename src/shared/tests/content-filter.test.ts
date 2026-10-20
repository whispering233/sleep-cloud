import { describe, expect, it } from 'vitest';

import words from '../blocked-words.json';
import { CHAT_WORDS, detect, mask, NICKNAME_WORDS } from '../content-filter';

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

    it('打码长度不变（全角字母也算一个字符）', () => {
      const input = '你这个傻逼，ＦＵＣＫ you';
      expect(mask(input)).toHaveLength(input.length);
      expect(mask(input)).toBe('你这个**，**** you');
    });
  });

  describe('两条路径的词集分级', () => {
    it('昵称命中色情类词即拒绝', () => {
      expect(detect('爆乳')).not.toBeNull();
    });

    it('只有聊天词集覆盖的类目不挡昵称', () => {
      expect(detect('代开发票')).toBeNull();
    });

    it('拆词残留与九类里的日常词不挡昵称', () => {
      for (const word of ['兼职', '招聘', '疫情', '网络']) expect(detect(word)).toBeNull();
    });

    it('单字词条不挡昵称（但聊天照打码）', () => {
      expect(detect('党')).toBeNull();
      expect(mask('党')).toBe('*');
    });

    it('手工表在两条路径上都命中', () => {
      expect(detect('傻逼')).toBe('傻逼');
      expect(mask('傻逼')).toBe('**');
    });

    it('全角字母归一后命中', () => {
      expect(detect('ＦＵＣＫ')).toBe('fuck');
    });

    it('昵称词集是聊天词集的子集', () => {
      const chat = new Set(CHAT_WORDS);
      expect(NICKNAME_WORDS.filter((word) => !chat.has(word))).toEqual([]);
    });
  });

  describe('词库产物', () => {
    it('手工表恰 33 条，外来词条总数不少于 24,000（生成脚本见 tools/words/）', () => {
      expect(words.curated).toHaveLength(33);
      const total = Object.values(words.categories).flat().length;
      expect(total).toBeGreaterThanOrEqual(24_000);
    });
  });
});
