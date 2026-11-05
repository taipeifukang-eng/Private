import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { P01_MONTHS, PHARMACIST_TITLE, PURCHASE_TITLE, collectErrors, noPageOverflow, openNativePage, panel, posBuffer, registerPurchases, purgeSeededRoster, seedPurchases, standardPos, xlsxFile } from '../support/p01-fixtures';
import { testStoreIds } from '../support/w01a-fixtures';

// P01 e2e：桌機 1440 與手機 390 各跑完整主流程（project 由 playwright-options 決定）。
//  員工購物（保留月份 2099，桌機 2099-11、手機 2099-12（不與其他頁面 e2e、W01a parity 的月份重疊；W01b parity 的 2099-12 於其 afterAll 退回草稿並刪除人員，故 P01 手機可用），ZT01／ZT02，sweeper 清除）：
//    查詢 → 職稱卡篩選與再點取消 → 月份變更自動查詢 → 員工明細（四項加總含購買筆數）→ 搜尋與排序 → 匯入（確認勾選、警告、放棄檔案）。
//  藥師管理（真實資料唯讀＋攔截主檔回應）：督導區總覽卡片、主檔執照逾期紅字、年費視窗 3.5 MB 上限與不送出請求。

const OVERDUE_RGB = 'rgb(192, 38, 45)';

function plan(mobile: boolean) {
  return mobile ? { month: P01_MONTHS.e2eMobile, empty: '2099-02' } : { month: P01_MONTHS.e2eDesktop, empty: '2099-03' };
}

async function query(page: Page, month: string) {
  const p = panel(page);
  await p.getByLabel('月份').fill(month);
  await p.getByRole('button', { name: '查詢員購' }).click();
  await expect(p.getByText(`顯示 ${month}`)).toBeVisible({ timeout: 30_000 });
}

test('員工購物主流程：查詢、職稱篩選、月份自動查詢、明細、搜尋排序、匯入', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const { month, empty } = plan(mobile);
  const admin = await apiAs('admin');
  const errors: string[] = [];
  try {
    const seeded = await seedPurchases(admin, month);
    const ctx = await loginAs(browser, 'employee_purchase_edit');
    try {
      const page = await ctx.newPage();
      await page.setViewportSize((testInfo.project.use as any).viewport);
      errors.push(...collectErrors(page));
      await openNativePage(page, PURCHASE_TITLE);
      const p = panel(page);
      await query(page, month);

      // 統計卡與彙總
      await expect(p.locator('.totals')).toContainText('450');
      await expect(p.locator('.totals')).toContainText('3 / 1');
      await expect(p.getByText(/最後匯入：/)).toBeVisible();
      await expect(p.getByText('符合 3 位')).toBeVisible();

      // 職稱卡：篩選「專員」只剩甲；再點同一張取消篩選（舊版行為）
      const card = p.locator('.position-grid button', { hasText: '專員' });
      await card.click();
      await expect(p.getByText(`顯示 ${month} · 專員`)).toBeVisible();
      await expect(p.getByText('符合 1 位')).toBeVisible();
      await expect(p.locator('.position-grid button[aria-pressed="true"]')).toContainText('專員');
      await p.locator('.position-grid button', { hasText: '專員' }).click();
      await expect(p.getByText(`顯示 ${month} · 全部職稱`)).toBeVisible();
      await expect(p.getByText('符合 3 位')).toBeVisible();

      // 月份變更會自動查詢（不必按查詢按鈕）；沒有資料的月份顯示空狀態
      await p.getByLabel('月份').fill(empty);
      await p.getByLabel('月份').dispatchEvent('change');
      await expect(p.getByText(`顯示 ${empty}`)).toBeVisible({ timeout: 30_000 });
      await expect(p.getByText('尚無此月份員工購物資料')).toBeVisible();
      await p.getByLabel('月份').fill(month);
      await p.getByLabel('月份').dispatchEvent('change');
      await expect(p.getByText(`顯示 ${month}`)).toBeVisible({ timeout: 30_000 });

      // 員工明細：四項加總（購買筆數、數量、金額、毛利）
      const rowA = p.locator('.module-table tbody tr', { hasText: 'ZT員購甲' });
      await rowA.getByRole('button', { name: '查看明細' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('ZT員購甲 · 購物明細');
      await expect(dialog.locator('[data-detail-totals]')).toHaveText('購買筆數 2 · 數量加總 3 · 金額加總 200 · 毛利加總 40', { timeout: 30_000 });
      await expect(dialog.locator('tbody tr')).toHaveCount(2);
      await dialog.getByRole('button', { name: '關閉' }).click();
      await expect(dialog).toHaveCount(0);

      // 未比對的員工：以會員編號與名稱呈現、職稱為「未比對職稱」，認列門市為總部；仍可查看明細
      const unmatched = p.locator('.module-table tbody tr', { hasText: '測試未比對甲' });
      await expect(unmatched).toContainText('未比對職稱');
      await expect(unmatched).toContainText('0000 總部');
      await unmatched.getByRole('button', { name: '查看明細' }).click();
      await expect(dialog.locator('[data-detail-totals]')).toHaveText('購買筆數 1 · 數量加總 1 · 金額加總 50 · 毛利加總 5', { timeout: 30_000 });
      await dialog.getByRole('button', { name: '關閉' }).click();

      // 搜尋與排序
      await p.getByLabel('搜尋員工或門市').fill('乙');
      await expect(p.getByText('符合 1 位')).toBeVisible();
      await expect(p.locator('.module-table tbody tr')).toHaveCount(1);
      await p.getByLabel('搜尋員工或門市').fill('');
      await p.getByRole('button', { name: /^消費總額/ }).click();
      await expect(p.locator('th[aria-sort="descending"]')).toContainText('消費總額');
      const amounts = await p.locator('.module-table tbody tr td:nth-child(6)').allTextContents();
      const nums = amounts.map((t) => Number(t.replace(/,/g, '')));
      expect(nums).toEqual([...nums].sort((a, b) => b - a));
      await p.getByRole('button', { name: /^消費總額/ }).click();
      await expect(p.locator('th[aria-sort="ascending"]')).toContainText('消費總額');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);

      // 匯入：未勾選確認不能送出；放棄檔案；非 Excel 檔被擋；有效檔含未知門市 → 顯示警告與結果
      await p.getByRole('button', { name: '匯入 POS Excel' }).click();
      const imp = page.getByRole('dialog', { name: '匯入 POS Excel' });
      await expect(imp).toContainText('POS 檔第一列會視為無效列');
      const submit = imp.getByRole('button', { name: '匯入並覆蓋銷售月份資料' });
      await expect(submit).toBeDisabled();
      await imp.locator('input[type=file]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') });
      await imp.getByLabel(/我確認以此檔案覆蓋/).check();
      await submit.click();
      await expect(imp).toContainText('僅支援 .xlsx 或 .xls 檔案');
      // 取消 → 有選檔案時要先確認是否放棄
      await imp.getByRole('button', { name: '取消' }).click();
      await expect(page.getByText('放棄尚未匯入的檔案？')).toBeVisible();
      await page.getByRole('button', { name: '繼續匯入' }).click();
      const pos = standardPos(month, seeded.codes);
      await imp.locator('input[type=file]').setInputFiles(xlsxFile(posBuffer(pos.rows.slice(0, 2).concat(pos.rows.slice(4)), pos.extra), 'p01-e2e.xlsx'));
      await imp.getByLabel(/我確認以此檔案覆蓋/).check();
      await submit.click();
      await expect(p.getByRole('status').filter({ hasText: '匯入完成' })).toContainText(`歸屬月份 ${month}，2 筆，已比對 2 筆，未比對 0 筆，跳過 1 筆，總金額 200`, { timeout: 60_000 });
      await expect(p.getByText('匯入警告（1）')).toBeVisible();
      await p.getByText('匯入警告（1）').click();
      await expect(p.getByText(/找不到門市代號「ZZ999」/)).toBeVisible();
      await expect(p.locator('.totals')).toContainText('200');
      await expect(p.locator('.totals')).toContainText('2 / 0');
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
    const ids = await testStoreIds(admin, month);
    await registerPurchases(month, [ids.ZT01, ids.ZT02]);
    await purgeSeededRoster(admin, seeded);
  } finally {
    await admin.dispose();
  }
});

test('藥師管理主流程：督導區總覽、主檔執照逾期紅字、年費視窗 3.5 MB 上限', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  // 只有系統管理員看得到真實門市（其他角色讀 stores 受 RLS 限制，與舊版相同）。
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(page);
    const proofRequests: string[] = [];
    page.on('request', (r) => {
      if (/\/pharmacists\/proof/.test(r.url()) && r.method() === 'POST') proofRequests.push(r.url());
    });
    // 主檔與年費清單攔截為固定資料：執照更新日 昨天（逾期）、明年（未逾期）、空白
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const base = { status: 'active', status_date: '2020-01-01', join_date: '2020-01-01', start_date: '2020-01-01', resignation_date: null, current_position: '藥師', store_code: 'ZT01', store_name: 'ZT 測試門市 01', source: 'auto', notes: null, school: '', education_level: '', is_responsible_pharmacist: false, annual_fee_is_blue: false, is_active: true };
    const masterRows = [
      { ...base, employee_code: 'ZTE2E1', employee_name: '逾期藥師', license_renewal_date: day(-1) },
      { ...base, employee_code: 'ZTE2E2', employee_name: '未逾期藥師', license_renewal_date: day(366) },
      { ...base, employee_code: 'ZTE2E3', employee_name: '空白藥師', license_renewal_date: null },
    ];
    await page.route('**/api/workspace/pharmacists/master**', (route) => route.fulfill({ json: { year: new Date().getFullYear(), isLocked: false, lockInfo: null, data: masterRows, syncedAt: new Date().toISOString() } }));
    await page.route('**/api/workspace/pharmacists/fees**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: [] } }) : route.abort()));

    await openNativePage(page, PHARMACIST_TITLE);
    const p = panel(page);

    // 督導區總覽（真實資料，唯讀）
    await expect(p.locator('.metrics')).toBeVisible({ timeout: 60_000 });
    await expect(p.locator('[data-view-only]')).toHaveCount(0);
    await expect(p.getByText('點選門市可查看藥師明細')).toBeVisible();
    const zones = p.locator('.zone');
    if (await zones.count()) {
      await expect(zones.first().locator('[data-zone-totals]')).toHaveText(/門市數：\d+\s+藥師數：\d+/);
      await zones.first().locator('.stores button').first().click();
      const rows = page.getByRole('dialog');
      await expect(rows.getByRole('columnheader', { name: '變化備註' })).toBeVisible();
      await rows.getByRole('button', { name: '關閉' }).click();
    }
    await p.getByRole('button', { name: '離職藥師' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();
    expect(await noPageOverflow(page), '總覽頁面層級水平溢出').toBe(true);

    // 主檔：執照更新日
    await p.getByRole('button', { name: '藥師主檔' }).click();
    await expect(p.getByRole('columnheader', { name: '執照更新日' })).toBeVisible({ timeout: 30_000 });
    await expect(p.locator('[data-master-legend]')).toContainText('執照更新日顯示紅色代表已逾期');
    // 規格 G.2：狀態篩選為舊版四個按鈕「在職／留停／已離職／全部」，預設在職；手機不得造成頁面水平溢出
    const statusButtons = p.locator('[data-status-filter]');
    await expect(statusButtons).toHaveText(['在職', '留停', '已離職', '全部']);
    await expect(statusButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await statusButtons.nth(1).click();
    await expect(p.getByText('符合 0 位')).toBeVisible();
    await statusButtons.nth(3).click();
    await expect(p.getByText('符合 3 位')).toBeVisible();
    await statusButtons.nth(0).click();
    await expect(p.getByText('符合 3 位')).toBeVisible();
    expect(await noPageOverflow(page), '主檔狀態按鈕頁面層級水平溢出').toBe(true);
    const cell = (name: string) => p.locator('tbody tr', { hasText: new RegExp(`^\\s*${name}`) }).locator('[data-license-date]');
    await expect(cell('逾期藥師')).toHaveAttribute('data-overdue', 'true');
    await expect(cell('逾期藥師')).toHaveCSS('color', OVERDUE_RGB);
    await expect(cell('未逾期藥師')).toHaveAttribute('data-overdue', 'false');
    await expect(cell('未逾期藥師')).not.toHaveCSS('color', OVERDUE_RGB);
    await expect(cell('空白藥師')).toHaveAttribute('data-overdue', 'false');
    await expect(cell('空白藥師')).toHaveText('—');

    // 年費視窗：上限文字統一 3.5 MB；超過上限時前端擋下，不送出任何上傳請求
    await p.locator('tbody tr', { hasText: /^\s*逾期藥師/ }).getByRole('button', { name: '查看／登記會費' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('尚無會費紀錄', { timeout: 30_000 });
    await dialog.getByRole('button', { name: '新增會費紀錄' }).click();
    await expect(dialog).toContainText('上傳檔案需在 3.5 MB 以內');
    await expect(dialog).not.toContainText(/10\s*MB/);
    await dialog.getByLabel('縣市公會').selectOption('台北市');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(4 * 1024 * 1024, 1) });
    await dialog.getByRole('button', { name: '儲存會費紀錄' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('檔案過大，請壓縮至 3.5 MB 以內');
    expect(proofRequests, '超過上限不應送出上傳請求').toEqual([]);
    expect(await noPageOverflow(page), '主檔頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
