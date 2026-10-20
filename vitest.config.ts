import { defineConfig } from 'vitest/config';

// 单元测试跑在 Node 上（vite.config.ts 的 root 指向前端目录，因此这里单列一份配置）。
export default defineConfig({
  test: {
    include: ['src/**/tests/**/*.test.ts'],
  },
});
