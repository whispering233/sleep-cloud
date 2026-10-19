import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * L2 契约 spec（`docs/design/60-interaction-shell.md` §6 / §7 的 I4 / I6 / I7 / I8，判据见 §10）。
 *
 * 全部走真实页面：手机视口、进厅走入场层、不做任何 mock。站点要人先起（见 `playwright.config.ts`）。
 */

/** 测试侧打点：出站帧（不是生产代码的一部分）。 */
interface Instrumented {
  __frames: string[];
  __canvasResizes: { count: number };
}

/** 出站帧记录：包一层 `WebSocket.prototype.send`，`walk` 有没有发出去就问它。 */
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

const framesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Instrumented).__frames);
const walkCount = async (page: Page): Promise<number> =>
  (await framesOf(page)).filter((frame) => frame.includes('"t":"walk"')).length;
const clearFrames = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as Instrumented).__frames.length = 0;
  });

const shell = (page: Page) => page.locator('.app-shell');
const expectComposer = (page: Page, state: 'idle' | 'typing') =>
  expect(shell(page)).toHaveAttribute('data-composer', state);

/** 进厅：入场层每次都在（`EntryOverlay`），昵称 + 18 岁 + 提交。 */
async function enterHall(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('你的名字').fill(`e2e-${Date.now().toString(36)}`);
  await page.getByLabel('我已满 18 岁').check();
  await page.getByRole('button', { name: /进入大厅|继续/ }).click();

  await expect(page.locator('.world-layer canvas')).toHaveCount(1);
  // 快照到了 HUD 才有「在线 n」：这一步等的是「画布 + 面板 + 服务端状态」都就位
  await expect(page.locator('.hud-info')).toContainText('在线');
  await expectComposer(page, 'idle');
}

/**
 * 某个元素**自身**上的一点：`elementFromPoint` 命中它就说明那里不是按钮、也不是内容。
 * 面板的「点空白」只在 `event.target === event.currentTarget` 时生效（见 `SlotPanel`），
 * 所以点面板时必须先确认脚下是面板本体。
 */
async function pointOn(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    for (let y = rect.bottom - 8; y > rect.top; y -= 8) {
      for (const x of [rect.x + rect.width / 2, rect.x + 8, rect.right - 8]) {
        if (document.elementFromPoint(x, y) === element) return { x, y };
      }
    }
    return null;
  }, selector);
  if (!point) throw new Error(`${selector} 上找不到可点的空白点`);
  return point;
}

test('每个状态的出口都可达：收起 / 面板空白 / 表情行替换输入行', async ({ page }) => {
  await enterHall(page);

  // ① 常驻可见出口：动作行右端的「收起」胶囊
  await page.getByLabel('聊天输入框').focus();
  await expectComposer(page, 'typing');
  await page.getByRole('button', { name: '收起输入' }).click();
  await expectComposer(page, 'idle');

  // ② 点插槽面板空白
  await page.getByLabel('聊天输入框').focus();
  await expectComposer(page, 'typing');
  const blank = await pointOn(page, '.slot-panel');
  await page.touchscreen.tap(blank.x, blank.y);
  await expectComposer(page, 'idle');

  // ③ 表情行原地替换输入行：控件被卸载，靠焦点对账退场
  await page.getByLabel('聊天输入框').focus();
  await expectComposer(page, 'typing');
  await page.getByRole('button', { name: '表情' }).click();
  await expect(page.getByLabel('聊天输入框')).toHaveCount(0);
  await expectComposer(page, 'idle');
});

test('退场动画期间，面板区域不会把点击漏给画布', async ({ page }) => {
  await enterHall(page);
  await page.getByLabel('聊天输入框').focus();
  await expectComposer(page, 'typing');

  // 「收起」= 退场开始；从那一刻起每一帧采一次面板中心（160ms 过渡 + 余量）
  await page.getByRole('button', { name: '收起输入' }).click();
  const hits = await page.evaluate(async () => {
    const panel = document.querySelector('.slot-panel');
    const seen: string[] = [];
    if (!(panel instanceof HTMLElement)) return seen;
    const deadline = performance.now() + 250;
    await new Promise<void>((resolve) => {
      const sample = (): void => {
        const rect = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        seen.push(hit === null ? 'null' : hit.tagName);
        if (performance.now() >= deadline) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return seen;
  });

  expect(hits.length).toBeGreaterThan(1);
  // 至少有一帧命中的是面板本体（`div`）：证明采样确实盖住了过渡期，不是等它退完才开始
  expect(hits).toContain('DIV');
  expect(hits).not.toContain('CANVAS');
});

test('打字期间画布像素尺寸冻结，退出后补算', async ({ page }) => {
  await enterHall(page);
  const sizeOf = () =>
    page.evaluate(() => {
      const element = document.querySelector('.world-layer canvas');
      return element instanceof HTMLCanvasElement
        ? { width: element.width, height: element.height }
        : null;
    });
  const before = await sizeOf();
  expect(before).toEqual({ width: 393 * 3, height: 852 * 3 });

  // 冻结期间画布尺寸属性一次都不许动（I6）
  await page.evaluate(() => {
    const counter = { count: 0 };
    (window as unknown as Instrumented).__canvasResizes = counter;
    const observer = new MutationObserver((records) => {
      counter.count += records.length;
    });
    const element = document.querySelector('.world-layer canvas');
    if (element) observer.observe(element, { attributes: true, attributeFilter: ['width', 'height'] });
  });
  const resizes = (): Promise<number> =>
    page.evaluate(() => (window as unknown as Instrumented).__canvasResizes.count);

  await page.getByLabel('聊天输入框').focus();
  await expectComposer(page, 'typing');
  // 键盘的指纹：宽度不变、高度变小
  await page.setViewportSize({ width: 393, height: 700 });
  await page.waitForTimeout(400);
  expect(await sizeOf()).toEqual(before);
  expect(await resizes()).toBe(0);

  await page.getByRole('button', { name: '收起输入' }).click();
  await expectComposer(page, 'idle');
  await page.waitForTimeout(400);
  // 退出 typing 后的那一帧才补算：唯一的一次重排发生在这里
  expect(await sizeOf()).toEqual({ width: 393 * 3, height: 700 * 3 });
  expect(await resizes()).toBeGreaterThan(0);
});

test('只有从画布起手的 tap 才产生 walk', async ({ page }) => {
  await enterHall(page);

  // 先把相机对到厅中间一张床（`GO`）：床中心就落在可用视口中心，tap 的世界坐标才可推算
  await page.getByRole('button', { name: '跳到指定床号' }).click();
  await page.getByLabel('跳到床号').fill('60');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expectComposer(page, 'idle');

  // 床中心 + (120, 70) 世界像素：床高 100 + 走道 56，所以 +70 落在床脚前的横走道上（可走），
  // 且离我（hop 之后站在床脚前 +78）有 120px，不会被读成「点自己 = 相机回中」
  const floor = await page.evaluate(() => {
    const hud = document.querySelector('.hud');
    const panel = document.querySelector('.chat-panel');
    if (!(hud instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;
    return {
      x: window.innerWidth / 2 + 120,
      y: (hud.getBoundingClientRect().bottom + panel.getBoundingClientRect().top) / 2 + 70,
    };
  });
  if (!floor) throw new Error('量不到可用视口中心');

  // 从面板起手：面板盖住画布，那一下不派发进世界
  const panelPoint = await pointOn(page, '.chat-panel');
  await clearFrames(page);
  await page.touchscreen.tap(panelPoint.x, panelPoint.y);
  await page.waitForTimeout(200);
  expect(await walkCount(page)).toBe(0);

  // 从画布起手：走
  await page.touchscreen.tap(floor.x, floor.y);
  await expect.poll(() => walkCount(page)).toBeGreaterThan(0);
});
