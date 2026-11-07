import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { M4B_MONTH, activeTemplates, deleteRunMasters, seedMaster, seedResults } from '../support/m4b-fixtures';
import { runIdOrThrow } from '../support/m4-fixtures';
import { work } from '../support/m4b-ui';

// P04 E2E（M4 Q23 與差異判定）：經理選門市、選督導與經理巡店、開始比較；差異統計、只看差異、查看明細。
let t: Awaited<ReturnType<typeof activeTemplates>>;
test.beforeAll(async () => {
  runIdOrThrow();
  t = await activeTemplates(5);
  const sup = await seedMaster({ store: 'ZT05', inspector: 'supervisor', date: `${M4B_MONTH.compare}-15`, status: 'completed', total: 200, tag: 'p04-e2e-sup' });
  const mgr = await seedMaster({ store: 'ZT05', inspector: 'ops_manager', date: `${M4B_MONTH.compare}-16`, status: 'completed', total: 190, type: 'manager', tag: 'p04-e2e-mgr' });
  await seedResults(sup, [
    { template: t[0], deduction: 5 },
    { template: t[1], deduction: 0 },
    { template: t[2], deduction: 3 },
    { template: t[3], deduction: 4 },
  ]);
  await seedResults(mgr, [
    { template: t[0], deduction: 2 },
    { template: t[1], deduction: 4 },
    { template: t[3], deduction: 4 },
  ]);
});
test.afterAll(async () => {
  await deleteRunMasters();
});

test('選門市與兩份已完成紀錄比較：差異統計正確，只看差異會收掉相同項目，可查看督導明細', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'ops_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '巡店比較');
    const storeSelect = work(page).getByLabel('比較門市');
    const options = await storeSelect.locator('option').all();
    for (const o of options) {
      if ((await o.textContent())?.includes('ZT05')) await storeSelect.selectOption((await o.getAttribute('value'))!);
    }
    await expect(work(page).getByLabel('督導巡店')).not.toHaveValue('');
    await expect(work(page).getByLabel('經理巡店')).not.toHaveValue('');
    await work(page).getByRole('button', { name: '開始比較' }).click();
    const summary = work(page).locator('p.module-actions').first();
    await expect(summary).toContainText('扣分不同 1 項');
    await expect(summary).toContainText('僅經理扣分 1 項');
    await expect(summary).toContainText('僅督導扣分 1 項');
    await expect(summary).toContainText(/缺少明細 \d+ 項/);
    // 一邊沒紀錄（t2 督導扣 3、經理沒有）算「僅督導扣分」，不是缺少明細
    await expect(work(page).locator(`tr[data-status="supervisor_only"]`)).toHaveCount(1);
    await expect(work(page).locator(`tr[data-status="both_different"]`)).toHaveCount(1);
    await work(page).getByLabel('只看扣分差異與缺少明細').check();
    await expect(work(page).locator('tr[data-status="same"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`p04-compare-${testInfo.project.name}.png`), fullPage: true });
    expect(await noPageOverflow(page)).toBe(true);
    await work(page).getByRole('button', { name: '查看督導明細' }).click();
    await expect(work(page).getByRole('heading', { name: '巡店紀錄明細' })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
