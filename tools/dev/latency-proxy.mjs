// 链路时延注入（开发 / 验收用，不进构建产物）：把每个方向的字节都推迟 `delay` 毫秒再转发。
//
// 为什么不是 CDP 的 `Network.emulateNetworkConditions`：实测（Chrome 145 / API 37 / 模拟器）
// 它只压 HTTP，**WebSocket 升级之后的帧一点不压**——`latency: 1000` 下 HTTP 1016ms、握手 1010ms、
// 帧往返 4ms。行走位置全走 WS，所以那条路对本项目的基线无效。见 `docs/design/test.md` §2。
//
// 只延迟数据、不延迟建连：TCP 三次握手不受影响，所以页面不会「连不上」，只是慢。

import net from 'node:net';
import { readDevPort } from './dev-port.mjs';

/** 转发目标 = 本 worktree 的 dev server（端口由 `dev.mjs` 现找，写进 `.wrangler/dev-port`）。 */
const targetPort = Number(process.argv[2]) || readDevPort() || 8787;
/** 监听口避开 inspector 用的 `devPort + 1000`。 */
const listenPort = Number(process.argv[3]) || targetPort + 500;
const delayMs = Number(process.argv[4]) || 500;

/**
 * 把一个方向的字节流按 `delayMs` 推迟后转发。逐块推迟等价于逐帧推迟：客户端只看到字节流，
 * 均匀晚到 `delayMs` 就够（不需要解析 WS 帧，也就不需要维护第二套协议状态）。
 */
const delayedPipe = (src, dst) => {
  src.on('data', (chunk) => {
    // shortcut: 不处理背压（dst 写满也不等待），大流量会堆在内存里；这是本机开发工具、只跑一个页面
    setTimeout(() => {
      if (!dst.destroyed) dst.write(chunk);
    }, delayMs);
  });
  src.on('end', () => setTimeout(() => dst.destroyed || dst.end(), delayMs));
  src.on('error', () => dst.destroy());
};

const server = net.createServer((client) => {
  // Nagle 会自己加延迟：两边都关掉，否则测出来的时延不是我们想注入的那个数
  client.setNoDelay(true);
  const upstream = net.connect({ port: targetPort, host: '127.0.0.1' });
  upstream.setNoDelay(true);
  delayedPipe(client, upstream);
  delayedPipe(upstream, client);
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`[latency-proxy] 127.0.0.1:${listenPort} → 127.0.0.1:${targetPort}，每方向 +${delayMs}ms`);
  console.log(`[latency-proxy] 设备侧：adb reverse tcp:${targetPort} tcp:${listenPort}`);
});
