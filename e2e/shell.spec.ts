import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * L2 契约 spec（`docs/design/60-interaction-shell.md` §6 / §7 的 I4 / I6 / I7 / I8 / I11，判据见 §10）。
 *
 * 全部走真实页面：手机视口、进厅走入场层、不做任何 mock。站点要人先起（见 `playwright.config.ts`）。
 */

/** 测试侧打点：出站帧（不是生产代码的一部分）。 */
interface Instrumented {
  __frames: string[];
  __canvasResizes: { count: number };
  __blankDown: { seen: number; prevented: number };
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
  // 首访会被说明面板挡在入场层之前（`docs/design/90-about-panel.md` §1）：先点掉它。
  // 两个页面态共用 `.entry-card`，先等它出现再判断——直接 `count()` 会与「面板还没渲染」赛跑
  await page.locator('.entry-card').waitFor();
  const about = page.getByRole('button', { name: '知道了' });
  if ((await about.count()) > 0) await about.click();
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

test('点插槽面板空白不产生 walk', async ({ page }) => {
  await enterHall(page);

  // 空白处那一下 `pointerdown` 的 `defaultPrevented`：监听挂在冒泡阶段，面板自己的处理器先跑
  await page.evaluate(() => {
    const log = { seen: 0, prevented: 0 };
    (window as unknown as Instrumented).__blankDown = log;
    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.classList.contains('slot-panel')) return;
      log.seen += 1;
      if (event.defaultPrevented) log.prevented += 1;
    });
  });

  for (let i = 0; i < 8; i += 1) {
    await page.getByLabel('聊天输入框').focus();
    await expectComposer(page, 'typing');
    const blank = await pointOn(page, '.slot-panel');
    await page.touchscreen.tap(blank.x, blank.y);
    // 退场挂在抬手的 `click` 上：按下只 `preventDefault()`，整次手势期间面板不换手
    await expectComposer(page, 'idle');
  }

  // ① 空白处每一下 `pointerdown` 都被取消（浏览器据此不再派发兼容鼠标事件）
  expect(await page.evaluate(() => (window as unknown as Instrumented).__blankDown)).toEqual({
    seen: 8,
    prevented: 8,
  });
  // ② 全程 0 次 `walk`（旧实现在这里一次点按就可能让小人走开）
  expect(await walkCount(page)).toBe(0);
});

test('打字期间与退场之后画布像素尺寸都不动，宽度变化立即生效', async ({ page }) => {
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
  // 退场也不补算：画布停在进打字态前的尺寸（补算会在键盘收起中途缩一次、再涨回来 = 两帧黑闪）
  expect(await sizeOf()).toEqual(before);
  expect(await resizes()).toBe(0);

  // 真正的尺寸变化（不受冻结影响）：宽度一变就重算
  await page.setViewportSize({ width: 400, height: 700 });
  await page.waitForTimeout(400);
  expect(await sizeOf()).toEqual({ width: 400 * 3, height: 700 * 3 });
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

test('隐私说明两处入口都指向静态页，入场层仍是三项', async ({ page }) => {
  await page.goto('/');
  // 首访会先看到说明面板（否则入场层根本不存在）
  await page.getByRole('button', { name: '知道了' }).click();
  const link = page.locator('.entry-privacy');
  await expect(link).toBeVisible();
  // 12px 一行：折成两行就把入场层挤出屏（393×852 是基线）
  expect((await link.boundingBox())?.height).toBeLessThan(30);
  // 「18 岁自述」只有两个 `.entry-field` 同伴：昵称、形象。多一个就成了第四个区块
  await expect(page.locator('.entry-card .entry-field')).toHaveCount(2);

  const [privacy] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await expect(privacy.locator('main > ol > li')).toHaveCount(6);
  await privacy.close();

  await enterHall(page);
  await page.locator('.hud-settings-button').click();
  await expect(page.locator('.hud-menu-link')).toHaveAttribute('href', '/privacy.html');
});

/**
 * 降级路径：没有 Popover API 的内核（Chromium 100 = 夸克 / UC，见 `docs/design/architecture.md` §1）。
 *
 * 判据（`docs/design/60-interaction-shell.md` §4 末条）：三个 Popover 方法全删掉后仍能进厅、不抛错，
 * 减光层退回普通 `position: fixed` 整屏块，齿轮菜单退回手写开关：开 → `Esc` 关且焦点回齿轮 → 再开
 * 能选中「更换床位」→ 点外面关。原生 Popover 那条路（其余四条用例）行为不变。
 *
 * 初始化脚本只能加在用例里（不能进 `beforeEach`）：其余四条跑的是原生 Popover 环境。
 */
test('没有 Popover API 的内核能进厅，齿轮菜单靠手写开关走完开 / 关 / 换床', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    for (const name of ['showPopover', 'hidePopover', 'togglePopover']) delete proto[name];
  });

  await enterHall(page);
  await expect(shell(page)).toBeVisible();

  // 减光层不是顶层 `popover` 了，靠 `position: fixed; inset: 0` 仍是整屏一块
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('量不到视口尺寸');
  const tone = await page.locator('.tone-layer').boundingBox();
  if (!tone) throw new Error('找不到减光层');
  expect(Math.abs(tone.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(tone.height - viewport.height)).toBeLessThanOrEqual(1);

  const gear = page.getByRole('button', { name: '设置' });
  const menu = page.locator('.hud-menu');

  // ① 开：菜单出现、`aria-expanded` 手写为 true、焦点进菜单首项
  await gear.click();
  await expect(menu).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('button', { name: '更换床位' })).toBeFocused();

  // ② `Esc` 关：菜单卸载，焦点回齿轮（不接回来就落到 `body`）
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await expect(gear).toBeFocused();

  // ③ 菜单项可用：进换床模式后门控行给出常驻提示
  await gear.click();
  await menu.getByRole('button', { name: '更换床位' }).click();
  await expect(page.getByText('点一张空床搬过去')).toBeVisible();
  await expect(menu).toHaveCount(0);

  // ④ 点外面关：点面板本体（`downElement !== canvas`，不会顺带发世界上行）。菜单锚在底部，点在面板上就算外面
  await gear.click();
  await expect(menu).toBeVisible();
  const outside = await pointOn(page, '.chat-panel');
  const framesBefore = (await framesOf(page)).length;
  await page.touchscreen.tap(outside.x, outside.y);
  await expect(menu).toHaveCount(0);
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  // 点外关闭只是关菜单：一条上行都不该有（换床模式还开着）
  expect((await framesOf(page)).length).toBe(framesBefore);

  // 全程不抛错：降级路径不许裸调那三个方法
  expect(errors).toEqual([]);
});
