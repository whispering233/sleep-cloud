import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 类型文本的契约（`docs/design/50-slot-panel.md` §11 第 3 条）：点阅读入口就有一条能读，
 * 抽一条会换一条、退出再进来还是它，而且**全程不发任何上行**（它是纯本地内容）。
 */

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

const shell = (page: Page) => page.locator('.app-shell');
const body = (page: Page) => page.locator('.type-text-body');

async function enterHall(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.entry-card').waitFor();
  const about = page.getByRole('button', { name: '知道了' });
  if ((await about.count()) > 0) await about.click();
  await page.getByLabel('你的名字').fill(`e2e-${Date.now().toString(36)}`);
  await page.getByLabel('我已满 18 岁').check();
  await page.getByRole('button', { name: /进入大厅|继续/ }).click();
  await expect(page.locator('.world-layer canvas')).toHaveCount(1);
  await expect(shell(page)).toHaveAttribute('data-composer', 'idle');
}

/** 打开阅读面板并等正文出现，返回正文文本（一行一条，用换行拼回去便于比较）。 */
async function openReading(page: Page): Promise<string> {
  await page.getByRole('button', { name: '随机阅读' }).click();
  await expect(shell(page)).toHaveAttribute('data-composer', 'reading');
  await expect(body(page).locator('p').first()).toBeVisible();
  return (await body(page).locator('p').allInnerTexts()).join('\n');
}

test('点阅读入口就有正文，抽一条会换一条，且不发任何上行', async ({ page }) => {
  await enterHall(page);

  const first = await openReading(page);
  expect(first.trim().length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '随机一条' }).click();
  const second = (await body(page).locator('p').allInnerTexts()).join('\n');
  expect(second).not.toBe(first); // 抽签排除当前条，所以必定换一条

  // 收起回 idle，再进来还是刚才那条（当前条保留）
  await page.getByRole('button', { name: '收起输入' }).click();
  await expect(shell(page)).toHaveAttribute('data-composer', 'idle');
  expect(await openReading(page)).toBe(second);

  // 阅读全程零上行：面板是纯本地的（`type-texts.ts` 的静态包）
  const frames = await page.evaluate(() => (window as unknown as Instrumented).__frames);
  expect(frames.filter((frame) => frame.includes('"t":"walk"'))).toHaveLength(0);
});

test('刷新之后读到的还是同一条（进度与当前条都落盘）', async ({ page }) => {
  await enterHall(page);
  const before = await openReading(page);

  await page.reload();
  await enterHall(page);
  expect(await openReading(page)).toBe(before);
});
