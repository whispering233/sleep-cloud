/**
 * 条目元数据（`docs/design/140-games-page.md` §4.1）：扫描器 **eager** 读它，所以列表能拿到标题与说明
 * 而不载入游戏代码。字段只有这三个，`base` 是舞台的基准尺寸。
 */
export const meta = {
  title: '窗',
  blurb: '一排别人的窗，灯随机亮灭',
  base: { w: 320, h: 640 },
};
