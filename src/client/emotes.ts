import { EMOTE_IDS } from '../shared/protocol';
import type { EmoteId } from '../shared/protocol';

/**
 * 表情的中文短标签：**面板按钮与世界内气泡共用这一份**。
 * 画布不依赖 emoji 字体（渲染不了 emoji 的机器上会变成豆腐块）。
 */
export const EMOTE_LABELS: Record<EmoteId, string> = {
  wave: '挥手',
  zzz: '晚安',
  heart: '比心',
  cry: '想哭',
  hug: '抱抱',
};

/** 按钮顺序 = 共享枚举的顺序（协议、按钮、气泡三处一个次序）。 */
export const EMOTE_LIST = EMOTE_IDS;
