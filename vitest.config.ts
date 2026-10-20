import { defineConfig } from 'vitest/config';

// 单元测试跑在 Node 上（vite.config.ts 的 root 指向前端目录，因此这里单列一份配置）。
export default defineConfig({
  test: {
    include: ['src/**/tests/**/*.test.ts'],
    // 「按本地日历日」的用例只有在非 UTC 时区才有判别力：UTC runner 上一个错用 getUTC* 的实现也会绿
    env: { TZ: 'Asia/Shanghai' },
  },
});
