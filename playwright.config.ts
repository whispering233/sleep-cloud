import process from 'node:process';

import { defineConfig } from '@playwright/test';

/**
 * L2 契约 spec：界面壳层的不变式（`docs/design/60-interaction-shell.md` §6 / §7、`docs/design/test.md` §1）。
 *
 * **没有 `webServer`**：站点由人先起（`npm run dev`，端口看终端），再把 baseURL 指过去：
 *
 * ```text
 * baseURL=http://localhost:8791 npm run e2e
 * ```
 *
 * 手机视口 = 基线设备（393×852 / DPR 3 / 触摸）。它不测像素、也不需要 IME。
 */
export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  workers: 1,
  use: {
    baseURL: process.env.baseURL ?? 'http://localhost:8787',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    hasTouch: true,
    /**
     * 宿主机已有的 Chromium：devDep 不下载浏览器（`npx playwright install` 不跑），
     * 所以缺的时候把已有的那个指过来：`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run e2e`。
     * 不配则用 Playwright 自己的那一个。
     */
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
  },
});
