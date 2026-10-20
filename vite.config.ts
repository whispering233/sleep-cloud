import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { BASE_PORT, readDevPort } from './tools/dev/dev-port.mjs';

// 版本号从 package.json 读文件取，构建期注入成 `__APP_VERSION__`（齿轮浮层里显示，形如 `v0.0.4`）。
// 客户端不 `import` package.json：那会把整个文件打进产物，而我们只要一个字符串。
const readVersion = (): string => {
  try {
    const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
    return version;
  } catch (error) {
    throw new Error(`读 package.json 的 version 失败：${String(error)}`);
  }
};
const version = readVersion();

// 前端产物交给 Worker 的静态资源托管（`wrangler.jsonc` 的 assets.directory）。
// 静态资源请求免费且不计入每日接口请求额度。
export default defineConfig({
  root: 'src/client',
  // 场景数据是「一份数据，两个读者」：客户端从静态资源取，服务端在构建时读入同一份文件
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    // 兼容基线是 Chromium 100（夸克 / UC 内核，见 `docs/design/architecture.md` §1）：Vite 8 的默认 target 比它新。
    target: 'chrome100',
    // 引擎单独切包：Phaser 占了整个懒加载分支的 99%（自己 1.37 MB），单独成一个 chunk 后它的 hash
    // 只在升级 Phaser 时变化；老用户回访只需重下十几 kB 的世界代码，而不是整包。
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'phaser', test: /node_modules[/\\]phaser/ }] } },
    },
  },
  server: {
    // 开发时把 /api（含 WebSocket 升级）代理到本地 Worker，保持「同源」语义。
    // 端口由 `npm run dev` 自动 +1 选中并写进 `.wrangler/dev-port`；没起后端时回落到起始端口。
    proxy: {
      // 键写成正则（`^` 开头）：只匹配 `/api` 与 `/api/...`。
      // 写 `'/api'` 是前缀匹配，会把客户端模块 `src/client/api.ts`（浏览器请求 `/api.ts`）
      // 也代理给后端；后端 SPA 回退返回 index.html，浏览器以 `text/html` 拒绝这个模块，
      // 于是 `npm run dev:web` 整页空白（`docs/design/build.md` §2）
      '^/api(/|$)': { target: `http://127.0.0.1:${readDevPort() ?? BASE_PORT}`, changeOrigin: true, ws: true },
    },
  },
});
