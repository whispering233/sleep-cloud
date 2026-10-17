import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { BASE_PORT, readDevPort } from './tools/dev/dev-port.mjs';

// 版本号从 package.json 读文件取，构建期注入成 `__APP_VERSION__`（浮层里显示 `v0.0.3`）。
// 客户端不 `import` package.json：那会把整个文件打进产物，而我们只要一个字符串。
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// 前端产物交给 Worker 的静态资源托管（`wrangler.jsonc` 的 assets.directory）。
// 静态资源请求免费且不计入每日接口请求额度。
export default defineConfig({
  root: 'src/client',
  // 场景数据是「一份数据，两个读者」：客户端从静态资源取，服务端在构建时读入同一份文件
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    // 开发时把 /api（含 WebSocket 升级）代理到本地 Worker，保持「同源」语义。
    // 端口由 `npm run dev` 自动 +1 选中并写进 `.wrangler/dev-port`；没起后端时回落到起始端口。
    proxy: {
      '/api': { target: `http://127.0.0.1:${readDevPort() ?? BASE_PORT}`, changeOrigin: true, ws: true },
    },
  },
});
