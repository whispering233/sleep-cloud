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
  __audio: AudioContext[];
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

    // 记下每个 `AudioContext` 及其状态：解锁只能发生在**手势内**，而手势外的
    // `resume()` 在无自动播放豁免的环境里会被拒（context 永远挂在 `suspended`）
    const contexts: AudioContext[] = [];
    (window as unknown as Instrumented).__audio = contexts;
    const Native = window.AudioContext;
    window.AudioContext = class TrackedAudioContext extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
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

/** 同样：可访问名就是文案（`雨声` / `静音`）。 */
const soundButton = (page: Page) => page.getByRole('button', { name: /^(雨声|静音)$/ });

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

test('全新浏览器：雨声缺键就是静音，且不落盘', async ({ page }) => {
  await page.goto('/');
  await enterHall(page);
  await page.getByRole('button', { name: '设置' }).click();

  const toggle = soundButton(page);
  await expect(toggle).toHaveText('静音');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate((key) => localStorage.getItem(key), PREFS.audioRain)).toBeNull();
});

test('雨声与天气互不联动：各自落盘、各自重载保持', async ({ page }) => {
  await page.goto('/');
  await enterHall(page);
  await page.getByRole('button', { name: '设置' }).click();

  // 只点雨声：声音开、天气仍无雨——无雨也能只听雨
  await soundButton(page).click();
  await expect(soundButton(page)).toHaveText('雨声');
  await expect(weatherButton(page)).toHaveText('无雨');
  // 而且真的能出声：context 已建且已跑起来（手势内解锁，不靠自动播放豁免）
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as Instrumented).__audio.map((c) => c.state)))
    .toEqual(['running']);
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), PREFS.audioRain)) ?? '')).toEqual({
    v: 1,
    on: true,
  });
  expect(await page.evaluate((key) => localStorage.getItem(key), PREFS.weatherRain)).toBeNull();

  // 再点天气：画面变雨天，声音不被改（雨天也能静音是同一个道理）
  await weatherButton(page).click();
  await expect(weatherButton(page)).toHaveText('雨天');
  await expect(soundButton(page)).toHaveText('雨声');

  await page.reload();
  await enterHall(page);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(soundButton(page)).toHaveText('雨声');
  await expect(weatherButton(page)).toHaveText('雨天');
});
