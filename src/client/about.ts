/**
 * 说明面板的内容（`docs/design/90-about-panel.md` §4）：纯数据 + 一个纯函数，DOM-free、无副作用。
 * 内容随 bundle 走——无请求、无接口、天然缓存，改文案只碰这一个文件。
 *
 * `ANNOUNCE.version` 是**公告版本**（只有内容真的变了才升），与 `package.json` 的发布版本不是同一个数。
 * 标题不在这里：它与入场层标题同一颗，也不加公告版本号（§4.1）。
 */

export interface AnnounceSection {
  title: string;
  items: string[];
}

export interface Announce {
  version: string;
  intro: string;
  sections: AnnounceSection[];
}

export const ANNOUNCE: Announce = {
  version: '0.0.7',
  intro:
    '浏览器打开就是一个睡眠大厅：每个人有一张属于自己的床，躺下时小人睡在床上，睡不着的人可以在厅里走动、看见别人、说句话。',
  sections: [
    {
      title: '这是什么',
      items: [
        '只有一个厅，床位随人来人往在 117 ~ 9558 之间伸缩，你的床永远不动',
        '第一次躺下就认领那张床，别人不能睡；30 天不回来才会释放',
        '睡不着就起身：点地面走过去、点小人看名字、点床号跳过去看',
        '说话只在大厅里：头顶一个气泡停 8 秒，不保存、不留历史',
      ],
    },
    {
      title: '最近更新 v0.0.7',
      items: [
        '新增「关于失眠云」：产品说明与每次更新的内容都在这一页',
        '首次进入大厅前会自动显示一次，读一次就够',
      ],
    },
  ],
};

/**
 * 该不该自动弹（§3）：`seen !== ANNOUNCE.version`。
 * **不校验 `seen` 是不是合法版本号**：它只被拿去逐字比较，坏值唯一的后果是**再弹一次**（无副作用）。
 */
export function shouldShowAbout(seen: string | undefined): boolean {
  return seen !== ANNOUNCE.version;
}
