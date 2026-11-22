import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage, workPanel } from '../support/w05-fixtures';

// W06 冒煙層（M2 後續問卷 H.6）：升職職位下拉預設只列門市職等與兼職職位，總部職位收在「顯示總部職位」之後（仍可選）；
// 人員異動管理的批次輸入與門市批次升遷兩個入口都一樣。沒有 console 錯誤與頁面層級水平溢出（桌機 1440 與手機 390）。唯讀。

const HQ = ['總經理', '副總經理', '資深經理', '資深副理', '副理', '資深專員', '高級專員', '出納專員', '助理'];
const STORE = ['經理', '督導', '店長', '副店長', '主任', '組長', '專員', '新人', '行政', '兼職專員', '兼職藥師', '兼職藥師專員', '兼職助理'];

async function optionTexts(select: ReturnType<Page['locator']>) {
  return (await select.locator('option').allTextContents()).map((t) => t.trim());
}

async function checkGrouping(page: Page, select: ReturnType<Page['locator']>, toggle: ReturnType<Page['locator']>) {
  const collapsed = await optionTexts(select);
  for (const p of STORE) expect(collapsed, p).toContain(p);
  for (const p of HQ) expect(collapsed, p).not.toContain(p);
  await toggle.check();
  const expanded = await optionTexts(select);
  for (const p of [...STORE, ...HQ]) expect(expanded, p).toContain(p);
  await expect(select.locator('optgroup')).toHaveAttribute('label', '總部職位');
  // 展開後仍可選總部職位
  await select.selectOption('副理');
  await expect(select).toHaveValue('副理');
  await expect(toggle).toBeDisabled(); // 已選的是總部職位時不能收起
  await select.selectOption('專員');
  await expect(toggle).toBeEnabled();
  await toggle.uncheck();
  expect(await optionTexts(select)).not.toContain('總經理');
  expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
}

test('人員異動管理 → 批次輸入異動：升職職位預設不列總部職位，勾選「顯示總部職位」後可選', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '人員異動管理');
    const p = workPanel(page);
    await p.getByLabel('異動類型').selectOption('promotion');
    const select = p.getByRole('combobox', { name: '升任後職位' });
    await expect(select).toBeVisible({ timeout: 60_000 });
    await checkGrouping(page, select, p.getByRole('checkbox', { name: '顯示總部職位' }));
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('門市批次升遷頁：職位下拉同樣預設不列總部職位', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '門市管理');
    const p = workPanel(page);
    await p.getByLabel('搜尋門市').fill('ZT01');
    const row = p.locator('tbody tr').filter({ hasText: 'ZT01' }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: '批次升遷', exact: true }).click();
    await expect(page.getByRole('heading', { name: '批次升遷', exact: true })).toBeVisible({ timeout: 60_000 });
    const q = workPanel(page);
    const select = q.getByRole('combobox', { name: '職位' }).first();
    await expect(select).toBeVisible({ timeout: 60_000 });
    await checkGrouping(page, select, q.getByRole('checkbox', { name: '顯示總部職位' }).first());
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
