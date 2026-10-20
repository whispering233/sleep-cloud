import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * L2 契约 spec（`docs/design/90-about-panel.md` §2 的已读语义、§7 验收表里 L2 那一行）。
 *
 * 每个测试都是新的 browser context = 空的 localStorage，所以「干净存储首访」天然成立，不用手动清。
 * 站点要人先起（见 `playwright.config.ts`）。断言只吃可见文案与角色，不断言像素。
 */

const DISMISS = '知道了';
const REMEMBER = '以后不再自动显示';

/** 说明面板的勾选框：只在自动打开的那一次存在（§2） */
const rememberBox = (page: Page) => page.getByRole('checkbox', { name: REMEMBER });

test('首访自动弹出说明面板，点「知道了」后入场层出现', async ({ page }) => {
  await page.goto('/');

  const card = page.locator('.entry-card');
  await expect(card.getByRole('heading', { name: '失眠云' })).toBeVisible();
  await expect(card.getByRole('button', { name: DISMISS })).toBeVisible();
  await expect(rememberBox(page)).toBeChecked();
  // 页面态顺序是 说明面板 → 入场层 → 大厅：面板在时入场层整棵都不渲染
  await expect(page.getByLabel('你的名字')).toHaveCount(0);

  await card.getByRole('button', { name: DISMISS }).click();

  await expect(card.getByRole('button', { name: DISMISS })).toHaveCount(0);
  await expect(page.getByLabel('你的名字')).toBeVisible();
});

test('勾选着关掉：重载不再自动弹', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: DISMISS }).click();
  await expect(page.getByLabel('你的名字')).toBeVisible();

  await page.reload();

  await expect(page.getByLabel('你的名字')).toBeVisible();
  await expect(page.getByRole('button', { name: DISMISS })).toHaveCount(0);
  await expect(rememberBox(page)).toHaveCount(0);
});

test('取消勾选再关：重载仍弹', async ({ page }) => {
  await page.goto('/');
  await rememberBox(page).uncheck();
  await page.getByRole('button', { name: DISMISS }).click();
  await expect(page.getByLabel('你的名字')).toBeVisible();

  await page.reload();

  // 不写 `sc.about.seen` = 「下次还想看」：自动那一次照旧出现，勾选框也回来
  await expect(rememberBox(page)).toBeVisible();
  await expect(page.getByRole('button', { name: DISMISS })).toBeVisible();
  await expect(page.getByLabel('你的名字')).toHaveCount(0);
});

test('齿轮「关于失眠云」能打开并关闭面板，关掉后仍在厅里', async ({ page }) => {
  // 手动入口要先进厅，而自动那一次会挡在前面：先点掉（这里是首访，面板一定在）
  await page.goto('/');
  await page.getByRole('button', { name: DISMISS }).click();

  await page.getByLabel('你的名字').fill(`e2e-${Date.now().toString(36)}`);
  await page.getByLabel('我已满 18 岁').check();
  await page.getByRole('button', { name: /进入大厅|继续/ }).click();
  await expect(page.locator('.world-layer canvas')).toHaveCount(1);
  await expect(page.locator('.hud-info')).toContainText('在线');

  await page.locator('.hud-settings-button').click();
  await page.getByRole('button', { name: '关于失眠云' }).click();

  // 手动路径不带勾选框（「你不读也会被记住」在这里不成立）
  await expect(page.getByRole('button', { name: DISMISS })).toBeVisible();
  await expect(rememberBox(page)).toHaveCount(0);

  await page.getByRole('button', { name: DISMISS }).click();

  await expect(page.getByRole('button', { name: DISMISS })).toHaveCount(0);
  await expect(page.locator('.world-layer canvas')).toHaveCount(1);
  await expect(page.getByLabel('聊天输入框')).toBeVisible();
});
