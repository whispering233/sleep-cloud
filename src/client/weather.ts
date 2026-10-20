/**
 * 天气（**客户端本地偏好**，见 `docs/design/config.md` §4、`docs/design/40-client-storage.md` §3）。
 * 纯函数：偏好层与界面层共用这一份，不自己写第二套默认值或文案。
 */

/**
 * 缺键时的初始化：**本地日历日**序号的奇偶（`Date.UTC` 只取日历事实，时区偏移与 DST 都不参与）。
 * 用序号而不是月内日号：31 号奇、次月 1 号也奇，会连着两天同天气。
 */
export function defaultRainAt(date: Date): boolean {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  return Math.floor(day) % 2 === 1;
}

/** 齿轮浮层里那颗天气胶囊的文案 = 当前天气（开 / 关由 `aria-pressed` 表达）。 */
export function weatherLabel(rain: boolean): string {
  return rain ? '雨天' : '无雨';
}
