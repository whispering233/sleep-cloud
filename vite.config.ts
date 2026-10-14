import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 前端产物交给 Worker 的静态资源托管（`wrangler.jsonc` 的 assets.directory）。
// 静态资源请求免费且不计入每日接口请求额度。
export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    // 开发时把 /api（含 WebSocket 升级）代理到本地 Worker，保持「同源」语义
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: true },
    },
  },
});
