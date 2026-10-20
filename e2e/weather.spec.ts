import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { PREFS } from '../src/client/prefs';

/**
 * 天气开关的 L2 契约：缺键（全新浏览器）→ 无雨；点胶囊 → `aria-pressed` 翻转 +
 * `localStorage` 写入 → 重载后保持；点浮层不把点击漏给画布（不产生 `walk`）。
 */

/** 测试侧打点：出站帧（不是生产代码的一部分）。 */
interface Instrumented {
  __frames: string[];
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const frames: string[] = [];
    (window as unknown as Instrumented).__frames = frames;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function trackedSend(
      this: WebSocket,
      data: Parameters<WebSocket['send']>[0],
    ): void {
      frames.push(String(data));
      send.call(this, data);
    };
  });
});

const walkCount = async (page: Page): Promise<number> =>
  (await page.evaluate(() => (window as unknown as Instrumented).__frames)).filter((frame) =>
    frame.includes('"t":"walk"'),
  ).length;

/** 进厅：入场层每次都在（`EntryOverlay`），昵称 + 18 岁 + 提交。 */
async function enterHall(page: Page): Promise<void> {
  await page.getByLabel('你的名字').fill(`rain-${Date.now().toString(36)}`);
  await page.getByLabel('我已满 18 岁').check();
  await page.getByRole('button', { name: /进入大厅|继续/ }).click();
  // 快照到了 HUD 才有「在线」：这一步等的是「画布 + 面板 + 服务端状态」都就位
  await expect(page.locator('.hud-info')).toContainText('在线');
}

/** 胶囊的可访问名就是它的可见文案（= 当前天气）。 */
const weatherButton = (page: Page) => page.getByRole('button', { name: /^(雨天|无雨)$/ });

test('全新浏览器：天气缺键就是无雨，且不落盘', async ({ page }) => {
  await page.goto('/');
  await enterHall(page);
  await page.getByRole('button', { name: '设置' }).click();

  const toggle = weatherButton(page);
  await expect(toggle).toHaveText('无雨');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate((key) => localStorage.getItem(key), PREFS.weatherRain)).toBeNull();
});

test('天气胶囊：开关翻转、落盘、重载保持，且点它不让小人走', async ({ page }) => {
  await page.goto('/');
  await enterHall(page);

  await page.getByRole('button', { name: '设置' }).click();
  const toggle = weatherButton(page);
  const before = (await toggle.getAttribute('aria-pressed')) === 'true';

  await page.evaluate(() => {
    (window as unknown as Instrumented).__frames.length = 0;
  });
  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-pressed', String(!before));
  await expect(toggle).toHaveText(before ? '无雨' : '雨天');
  // 点它不关浮层：天气是可连续切换的设置
  await expect(toggle).toBeVisible();

  const stored = await page.evaluate((key) => localStorage.getItem(key), PREFS.weatherRain);
  expect(JSON.parse(stored ?? '')).toEqual({ v: 1, rain: !before });

  await page.waitForTimeout(200);
  expect(await walkCount(page)).toBe(0);

  // 重载：偏好从本地存储读回来（缺键的日期默认不再参与）
  await page.reload();
  await enterHall(page);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(weatherButton(page)).toHaveAttribute('aria-pressed', String(!before));
  await expect(weatherButton(page)).toHaveText(before ? '无雨' : '雨天');
});
