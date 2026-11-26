import { expect, test } from '@playwright/test';
import { innerOverflow } from '../support/gaib1-ui';

// ga-improve-b1：確認「內層容器橫向溢出」的檢查函式真的抓得到問題（負向自檢），而且不會誤判有橫向捲動的容器與正常內容。
test('innerOverflow：抓得到擠出容器的內容與超出視窗的元素；橫向捲動容器與正常內容不算', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(`<div data-testid="ga-shell">
    <div id="box" style="width:200px"><div style="width:600px;height:20px;background:#ccc">寬子元素</div></div>
    <div id="ok1" style="overflow-x:auto;width:200px"><div style="width:600px">可橫向捲動</div></div>
    <div id="ok2" style="width:100%">正常內容</div>
  </div>`);
  const found = await innerOverflow(page);
  expect(found.length).toBeGreaterThan(0);
  expect(found.some((f) => f.includes('內容擠出容器') && f.includes('div'))).toBe(true);
  expect(found.some((f) => f.includes('可橫向捲動'))).toBe(false);
  await page.setContent(`<div data-testid="ga-shell"><div style="overflow-x:auto;width:200px"><div style="width:600px">可橫向捲動</div></div><p style="width:100%">正常</p></div>`);
  expect(await innerOverflow(page)).toEqual([]);
});
