/**
 * `act` → 用户可见的后缀。**中文只在客户端**：服务端只发机器值 `'game'`，协议里不放中文
 * （同 `error-text.ts` 的做法，见 `docs/design/110-games-page.md` §6）。
 *
 * 前导分隔符与文字放一处：名字行整条就是 `名字 | 游戏中`，连上名字只用一次字符串拼接，
 * 调用方不必知道空格与竖线。
 */
export function actTextOf(act: 'game' | undefined): string {
  return act === 'game' ? ' | 游戏中' : '';
}
