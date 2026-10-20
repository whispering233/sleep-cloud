/**
 * 天气（**客户端本地偏好**，见 `docs/design/config.md` §4、`docs/design/40-client-storage.md` §3）。
 * 纯函数：偏好层与界面层共用这一份，不自己写第二套默认值或文案。
 */

/** 齿轮浮层里那颗天气胶囊的文案 = 当前天气（开 / 关由 `aria-pressed` 表达）。 */
export function weatherLabel(rain: boolean): string {
  return rain ? '雨天' : '无雨';
}

/**
 * 隔壁那颗雨声胶囊的文案 = 当前状态。**与天气无关**：文案不说"下雨"，因为无雨也能开雨声
 * （`docs/design/40-client-storage.md` §3）。
 */
export function soundLabel(on: boolean): string {
  return on ? '雨声' : '静音';
}
