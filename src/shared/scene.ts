/**
 * 场景数据类型（手写 JSON，见 `docs/design/config.md` §5）。
 *
 * 坐标一律按网格计：`(x, y)` 是第 x 列第 y 行的格子，不是像素。
 */
export interface SceneBed {
  /** 厅内固定槽位号，0 ~ capacity-1 */
  bedNo: number;
  x: number;
  y: number;
}

/** 装饰与背景元素：画在网格上的图集贴图。 */
export interface SceneSprite {
  /** 图集内的贴图名 */
  sprite: string;
  x: number;
  y: number;
}

export interface Scene {
  /** 场景标识，客户端与服务端必须一致（比对失败返回 `2003`） */
  guid: string;
  /** 网格列数 */
  width: number;
  /** 网格行数 */
  height: number;
  /** 床位槽位：床号 → 格子坐标 */
  beds: SceneBed[];
  /** 不可行走格（墙与家具）。床格由 `beds` 推导，不需要在这里重复 */
  blocked: Array<[number, number]>;
  /** 画在人物之上的装饰（床的线稿本体、桌椅等） */
  decorates: SceneSprite[];
  /** 画在最底层的背景（地板、地毯等） */
  backgrounds: SceneSprite[];
}
