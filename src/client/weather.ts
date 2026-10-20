/**
 * 天气（**客户端本地偏好**，见 `docs/design/config.md` §4、`docs/design/40-client-storage.md` §3）。
 * 纯函数：偏好层与界面层共用这一份，不自己写第二套默认值或文案。
 */

/** 齿轮浮层里那颗天气胶囊的文案 = 当前天气（开 / 关由 `aria-pressed` 表达）。 */
export function weatherLabel(rain: boolean): string {
  return rain ? '雨天' : '无雨';
}
