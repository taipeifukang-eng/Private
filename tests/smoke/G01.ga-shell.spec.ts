import { expect, test } from '@playwright/test';
import { expandGroup, gaNavTo, noPageOverflow, openFromMenu, openGaCenter, openGaSide, pageFor, shell, sideLabels } from '../support/g01-ui';

// M7/M8 G01 冒煙層：總務服務中心外殼與導覽（照舊版側欄分組與權限顯示）、進頁前先擋並說明、桌機 1440 與手機 390。
// 只讀測試：不建立任何資料。

test('總務角色：從全站選單進入服務中心；側欄分組照舊版；已移植頁面在新版頁籤開啟，未移植的以舊頁另開；無錯誤無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    expect(ctx.pages()).toHaveLength(1); // 是工作台頁籤，沒有另開舊站視窗
    await openGaSide(page);
    const side = shell(page).locator('aside');
    for (const g of ['工作台', '門市追蹤', '作業管理', '資產與庫存', '費用管理', '合作廠商']) await expect(side.getByRole('heading', { name: g, exact: true })).toBeVisible();
    // 已移植的頁面是按鈕（新版頁籤），未移植的是連到舊頁的連結（另開分頁）
    await expandGroup(page, '料件管理');
    await expect(side.getByRole('button', { name: '料件列表', exact: true })).toBeVisible();
    await expandGroup(page, '設備管理');
    // 第 2 批已移植設備清冊、保固管理與 QR 標籤列印（G10）（按鈕、新版頁籤）；尚未移植的項目照舊用連結另開舊頁
    await expect(side.getByRole('button', { name: '設備清冊', exact: true })).toBeVisible();
    await expect(side.getByRole('button', { name: '保固管理', exact: true }).first()).toBeVisible();
    await expect(side.getByRole('button', { name: 'QR 標籤列印', exact: true }).first()).toBeVisible();
    await expect(side.getByRole('link', { name: /QR 標籤列印/ })).toHaveCount(0);
    // 「規劃中」的項目照舊顯示且不可點
    await expandGroup(page, '庫存管理');
    await expect(side.locator('.ga-link.disabled', { hasText: '盤點' }).first()).toBeVisible();
    // 入口頁列出可用的新版功能
    await openGaSide(page);
    await page.keyboard.press('Escape');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('側欄開啟新版頁籤：分類、料件、型號與適用料件設定都以新頁籤出現；再次點同一項會切回已開的頁籤，不重複開', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備分類', '設備管理');
    await expect(page.getByRole('heading', { name: '設備分類', exact: true }).locator('visible=true')).toBeVisible();
    await gaNavTo(page, '公司設備型號', '設備管理');
    await expect(page.getByRole('heading', { name: '公司設備型號', exact: true }).locator('visible=true')).toBeVisible();
    await gaNavTo(page, '料件分類', '料件管理');
    await expect(page.getByRole('heading', { name: '料件分類', exact: true }).locator('visible=true')).toBeVisible();
    await gaNavTo(page, '適用料件設定', '料件管理');
    await expect(page.getByRole('heading', { name: '適用料件設定', exact: true }).locator('visible=true')).toBeVisible();
    await gaNavTo(page, '料件列表', '料件管理');
    await expect(page.getByRole('heading', { name: '料件列表', exact: true }).locator('visible=true')).toBeVisible();
    const tabs = await page.locator('[role="tab"]').count();
    await gaNavTo(page, '料件分類', '料件管理'); // 已開著：切過去
    expect(await page.locator('[role="tab"]').count()).toBe(tabs);
    await expect(page.getByRole('heading', { name: '料件分類', exact: true }).locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有料件查看權限：服務中心入口在選單裡；側欄不列分類、新增料件、適用料件設定、型號；料件列表沒有新增與編輯按鈕', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_part_view', testInfo);
  try {
    await openGaCenter(page);
    const labels = (await sideLabels(page)).map((t) => t.trim());
    expect(labels.some((t) => t.startsWith('料件列表'))).toBe(true);
    for (const hidden of ['料件分類', '新增料件', '適用料件設定', '公司設備型號', '公司設施架型', '設備分類', '設施分類']) expect(labels.some((t) => t.startsWith(hidden)), hidden).toBe(false);
    await gaNavTo(page, '料件列表', '料件管理');
    await expect(page.getByRole('heading', { name: '料件列表', exact: true }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增料件' }).locator('visible=true')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '操作' }).locator('visible=true')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有任何總務權限：全站選單沒有「服務中心首頁」', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageFor(browser, 'denied', testInfo);
  try {
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu')).toBeVisible();
    await expect(page.locator('.workspace-menu button.catalog-item[title="服務中心首頁"], .workspace-menu a.catalog-item[title^="服務中心首頁"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('進頁前先擋：權限在使用中被收回時，頁籤顯示「沒有權限」說明（寫明是哪一頁、找誰），不顯示內容也不再載入資料', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '料件列表', '料件管理');
    await expect(page.getByRole('heading', { name: '料件列表', exact: true }).locator('visible=true')).toBeVisible();
    let partCalls = 0;
    await page.route('**/api/workspace/general-affairs/parts**', (route) => { partCalls += 1; return route.continue(); });
    await page.route('**/api/workspace/session', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.capabilities.gaParts = false;
      await route.fulfill({ response: res, json: body });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const alert = page.getByRole('alert').filter({ hasText: '您沒有「料件列表」的使用權限' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('聯絡管理員或總務主管');
    await expect(page.getByRole('heading', { name: '料件列表', exact: true }).locator('visible=true')).toHaveCount(0);
    expect(partCalls).toBe(0);
  } finally {
    await ctx.close();
  }
});

test('舊網址入口仍可用：選單的「服務中心首頁」是新版頁籤，頁面提供「開啟舊版服務中心首頁」連結', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    const link = page.getByRole('link', { name: /開啟舊版服務中心首頁/ }).locator('visible=true');
    await expect(link).toHaveAttribute('href', /\/general-affairs$/);
    await expect(link).toHaveAttribute('target', '_blank');
  } finally {
    await ctx.close();
  }
});

void openFromMenu;
