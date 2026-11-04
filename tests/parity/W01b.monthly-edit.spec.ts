import { expect, test, type APIRequestContext, type Dialog, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, compareSideEffects, compareTables, loadMap, ParityRecorder, readRowsAsServiceRole, type ColumnSpec } from '../support/parity';
import { addManual, clearDraftMonth, editUpdates, ensureSummarySafe, postSave, readMonth, registerFixtureRows, staffCode, testStoreIds, W01B_MONTHS } from '../support/w01b-fixtures';

// W01b 對等層：同一份輸入，舊 /monthly-status/edit/[id] 與新「人員編輯」逐案比對。
// 每個情境各建兩列相同的人員（一列給舊頁、一列給新頁），避免兩邊互相覆蓋。
// 資料只用 ZT 測試門市與保留月份 2099-11（草稿）、2099-12（已送審 / 已確認）；測後由 sweeper 清除。
// 與舊版不同之處（白名單 approvedBy:null）：W01b-q1 區塊預覽、W01b-q2 新人提醒、W01b-q3 不滿月不自動改、
// 已送審鎖定、外務時數不寫入未滿月備註。

const map = loadMap('monthly-edit');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('monthly-edit');
const PD = W01B_MONTHS.parityDraft; // 2099-11（30 天）
const PL = W01B_MONTHS.parityLocked; // 2099-12
const STORE_LABEL = 'ZT01 ZT 測試門市 01';
const ROLES_LOCKED = ['admin', 'store_manager'];

const col = (canonical: string, type: ColumnSpec['type'] = 'string'): ColumnSpec => ({ canonical, legacy: canonical, type });
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const ok = ['pass', 'allowed', 'pending-approval'];

let admin: APIRequestContext;
let zt01 = '';
let zt02 = '';
const tagPool = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const rows: Record<string, { code: string; id: string }> = {};

async function dbRow(id: string) {
  return (await readRowsAsServiceRole('monthly_staff_status', { eq: { id } }))[0];
}

/** 每個情境建 L（舊頁）與 N（新頁）兩列。 */
async function makePair(key: string, base: { name: string; position?: string; employment_type?: 'full_time' | 'part_time'; work_days?: number; work_hours?: number; newbie_level?: string }, patch: Record<string, unknown> = {}, store = zt01, month = PD) {
  for (const side of ['L', 'N']) {
    const code = staffCode(tagPool.shift()!);
    const created = await addManual(admin, store, month, { ...base, name: `${base.name}${side}`, code });
    const rec = (await readMonth(admin, store, month)).body.records.find((r: any) => r.id === created.id);
    const res = await postSave(admin, store, month, created.id, rec.updated_at, editUpdates({ position: base.position || '專員', employment_type: base.employment_type || 'full_time', work_days: base.work_days ?? 30, work_hours: base.work_hours ?? 0, newbie_level: base.newbie_level || null, ...patch }));
    expect(res.status(), `${key}${side} 建立`).toBe(200);
    rows[`${key}${side}`] = { code, id: created.id };
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(420_000); // 約 40 列 fixture，每列 3 次 API
  admin = await apiAs('admin');
  const stores = await testStoreIds(admin, PD);
  zt01 = stores.ZT01;
  zt02 = stores.ZT02;
  // 區塊預覽
  await makePair('b1', { name: 'PAR 專員整月' });
  await makePair('b3', { name: 'PAR 外務', position: '專員' }, { extra_tasks: ['長照外務'], extra_task_external_hours: 5 });
  await makePair('b4', { name: 'PAR 督導店長雙', position: '督導(店長)' }, { position: '督導(店長)', is_dual_position: true });
  await makePair('b5', { name: 'PAR 兼職待勾藥師', position: '助理', employment_type: 'part_time', work_days: 0, work_hours: 40 });
  // 規劃時數（b3 外務整月 160 同時是區塊預覽的外務案例）
  await makePair('x2', { name: 'PAR 外務十天', work_days: 10 }, { extra_tasks: ['診所業務'], monthly_status: 'new_hire', work_days: 10 });
  await makePair('x3', { name: 'PAR 督導雙時數', position: '督導(代理店長)', work_days: 0, work_hours: 96 }, { position: '督導(代理店長)', is_dual_position: true, work_hours: 96, work_days: null, extra_tasks: ['長照外務'] });
  // 新人提醒（月份 2099-11）
  await makePair('n1', { name: 'PAR 新人一月', position: '新人', newbie_level: '未過階新人' }, { start_date: '2099-10-10' });
  await makePair('n2', { name: 'PAR 新人二月', position: '新人', newbie_level: '一階新人' }, { start_date: '2099-09-10' });
  await makePair('n6', { name: 'PAR 新人六月', position: '新人', newbie_level: '二階新人' }, { start_date: '2099-05-10' });
  await makePair('n0', { name: 'PAR 新人當月', position: '新人', newbie_level: '未過階新人' }, { start_date: '2099-11-02' });
  // 整月自動判斷
  await makePair('m1', { name: 'PAR 整月改二十天', work_days: 30 });
  await makePair('m2', { name: 'PAR 新進改滿月', work_days: 10 }, { monthly_status: 'new_hire', work_days: 10 });
  // 行政必填
  await makePair('a1', { name: 'PAR 行政' });
  await makePair('s1', { name: 'PAR 儲存成功' });
  // 儲存回讀
  await makePair('e1', { name: 'PAR 勾外務' });
  await makePair('e2', { name: 'PAR 卡班關閉' }, { is_supervisor_rotation: true, supervisor_employee_code: 'S001', supervisor_name: 'PAR 督導', supervisor_position: '督導', supervisor_shift_hours: 10 });
  await ensureSummarySafe(admin, zt01, PD);
  await registerFixtureRows(zt01, PD);

  // 已送審（ZT02）與已確認（ZT01）月份 2099-12
  for (const store of [zt01, zt02]) {
    await makePair(store === zt01 ? 'cf' : 'sb', { name: store === zt01 ? 'PAR 已確認' : 'PAR 已送審' }, {}, store, PL);
    await ensureSummarySafe(admin, store, PL);
  }
  expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: PL, skipChecks: true } })).status()).toBe(200);
  expect((await admin.post('/api/workspace/monthly', { data: { action: 'confirm', store: zt01, month: PL } })).status()).toBe(200);
  expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt02, month: PL, skipChecks: true } })).status()).toBe(200);
  await registerFixtureRows(zt01, PL);
  await registerFixtureRows(zt02, PL);
});

test.afterAll(async () => {
  // 把已送審／已確認月份退回草稿並刪除人員，不讓鎖定狀態殘留到 sweeper（其他頁面 e2e 會共用同樣的 ZT01／ZT02 與月份，例如 P01 手機 2099-12）。盡力而為，sweeper 仍是後備。
  if (admin) {
    for (const [store, month] of [[zt01, PL], [zt02, PL], [zt01, PD], [zt02, PD]] as const) {
      try {
        for (const action of ['unconfirm', 'revert']) await admin.post('/api/workspace/monthly', { data: { action, store, month } });
        await clearDraftMonth(admin, [store], month);
      } catch {
        /* sweeper 後備 */
      }
    }
  }
  await admin?.dispose();
});

// ---------------------------------------------------------------------------
// 舊頁與新頁的操作 helper
// ---------------------------------------------------------------------------

const LX = {
  select: (label: string) => `xpath=//label[contains(normalize-space(.), "${label}")]/following-sibling::select[1]`,
  days: 'xpath=//label[contains(normalize-space(.), "本月工作天數")]/following-sibling::div//input',
  notes: 'xpath=//label[contains(normalize-space(.), "備註")]/following-sibling::textarea',
  block: 'xpath=//h4[contains(., "系統自動計算區塊")]/following-sibling::div//span[contains(., "區塊")][1]',
};

async function openLegacy(page: Page, id: string, store: string, month: string) {
  await page.goto(`/monthly-status/edit/${id}?year_month=${month}&store_id=${store}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.body.innerText.includes('載入中'), undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function openNative(page: Page, code: string, month: string, storeLabel = STORE_LABEL) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
  await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
  await page.getByLabel('門市', { exact: true }).selectOption({ label: storeLabel });
  await page.getByLabel('月份').fill(month);
  await page.getByRole('button', { name: '查詢人員' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
  const row = page.locator(`tr[data-staff="${code}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /^編輯$|查看明細/ }).click();
  await expect(page.locator('section.work-page:visible form.module-editor, section.work-page:visible [data-confirmed-screen]').first()).toBeVisible({ timeout: 30_000 });
}
const panel = (page: Page) => page.locator('section.work-page:visible');
/** 新版儲存成功：跳 alert 並回到名冊，編輯表單消失。 */
async function nativeEditorClosed(page: Page) {
  await expect(panel(page).locator('form.module-editor')).toHaveCount(0, { timeout: 20_000 });
}

async function legacyBlock(page: Page) {
  return norm(await page.locator(LX.block).first().textContent()).replace('區塊', '').trim();
}
async function nativeBlock(page: Page) {
  return norm(await panel(page).locator('.block-chip').textContent()).replace('區塊', '').trim();
}

// ---------------------------------------------------------------------------
// 1. 區塊預覽（W01b-q1）
// ---------------------------------------------------------------------------

for (const role of ['admin']) {
  test(`區塊預覽對等 ${role}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await loginAs(browser, role);
    try {
      const legacyRows: Record<string, unknown>[] = [];
      const nativeRows: Record<string, unknown>[] = [];
      for (const key of ['b1', 'b3', 'b4', 'b5']) {
        const lp = await ctx.newPage();
        await openLegacy(lp, rows[`${key}L`].id, zt01, PD);
        const np = await ctx.newPage();
        await openNative(np, rows[`${key}N`].code, PD);
        let scenario = key;
        if (key === 'b5') {
          // 兼職助理（區塊 6）：勾選前兩邊一致
          legacyRows.push({ scenario: 'b5-part-time', block: await legacyBlock(lp) });
          nativeRows.push({ scenario: 'b5-part-time', block: await nativeBlock(np) });
          // 勾選是否藥師後預覽：舊版用載入時的藥師狀態（不更新），新版跟著勾選
          await lp.locator(LX.select('是否藥師')).selectOption('true');
          await panel(np).getByLabel('藥師').check();
          await lp.waitForTimeout(400);
          scenario = 'b5-tick-pharmacist';
        }
        legacyRows.push({ scenario, block: await legacyBlock(lp) });
        nativeRows.push({ scenario, block: await nativeBlock(np) });
        await lp.close();
        await np.close();
      }
      const result = compareTables({ recorder, entry: 'block-preview', title: '區塊預覽逐案比對', role, legacySource: entry('block-preview').legacy.ui!.route, nativeSource: entry('block-preview').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('block')], key: 'scenario' });
      assertNoUnlistedDiffs(result);
      expect(ok).toContain(result.status);
      // 已知差異必須真的出現（督導(店長)-雙、勾選藥師），否則白名單條目是死的
      expect(result.diffs.map((d) => d.key).sort()).toEqual(['b4#block', 'b5-tick-pharmacist#block']);
    } finally {
      await ctx.close();
    }
  });
}

// ---------------------------------------------------------------------------
// 2. 外務規劃時數
// ---------------------------------------------------------------------------

test('外務規劃時數對等（整月 160、十天 64、督導雙時數 96；外務時數欄位另測）', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyRows: Record<string, unknown>[] = [];
    const nativeRows: Record<string, unknown>[] = [];
    for (const key of ['b3', 'x2', 'x3']) {
      const lp = await ctx.newPage();
      await openLegacy(lp, rows[`${key}L`].id, zt01, PD);
      const np = await ctx.newPage();
      await openNative(np, rows[`${key}N`].code, PD);
      legacyRows.push({ scenario: key, planned: String(Number(await lp.locator('input[readonly]').first().inputValue())), block: await legacyBlock(lp) });
      nativeRows.push({ scenario: key, planned: String(Number(await panel(np).locator('[data-planned-hours]').inputValue())), block: await nativeBlock(np) });
      await lp.close();
      await np.close();
    }
    const result = compareTables({ recorder, entry: 'planned-hours', title: '規劃實上時數與區塊', role: 'admin', legacySource: entry('planned-hours').legacy.ui!.route, nativeSource: entry('planned-hours').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('planned', 'number'), col('block')], key: 'scenario' });
    assertNoUnlistedDiffs(result);
    expect(result.status).toBe('pass');
    expect(nativeRows.map((r) => r.planned)).toEqual(['160', '64', '96']);
    expect(nativeRows.map((r) => r.block)).toEqual(['4', '4', '4']);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 3. 新人升階提醒（W01b-q2）
// ---------------------------------------------------------------------------

test('新人升階提醒對等：是否提醒、訊息、回答「否」後是否仍儲存', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyRows: Record<string, unknown>[] = [];
    const nativeRows: Record<string, unknown>[] = [];
    for (const key of ['n1', 'n2', 'n6', 'n0']) {
      // 舊頁：改備註 -> 儲存 -> confirm 一律取消（「否」）
      const lp = await ctx.newPage();
      const messages: string[] = [];
      lp.on('dialog', (d: Dialog) => {
        if (d.type() === 'confirm') {
          messages.push(d.message());
          void d.dismiss();
        } else void d.accept();
      });
      await openLegacy(lp, rows[`${key}L`].id, zt01, PD);
      await lp.locator(LX.notes).fill('PAR 提醒測試');
      await lp.getByRole('button', { name: '儲存', exact: true }).click();
      await lp.waitForTimeout(2500);
      const legacySaved = norm((await dbRow(rows[`${key}L`].id)).notes) === 'PAR 提醒測試';
      legacyRows.push({ scenario: key, prompted: messages.length ? 'Y' : 'N', message: messages[0] || '', savedAfterNo: legacySaved ? 'Y' : 'N' });
      await lp.close();

      // 新頁：改備註 -> 儲存 -> 視窗出現則按「取消」（與舊頁 confirm 取消相同，中止儲存）
      const np = await ctx.newPage();
      await openNative(np, rows[`${key}N`].code, PD);
      await panel(np).locator('[name=notes]').fill('PAR 提醒測試');
      await panel(np).getByRole('button', { name: '儲存出勤資料' }).click();
      const dialog = np.getByRole('dialog', { name: '新人階段提醒' });
      let message = '';
      if (await dialog.isVisible().catch(() => false) || (await dialog.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false))) {
        message = norm(await dialog.locator('p').first().textContent());
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        await np.waitForTimeout(2500);
      } else {
        await nativeEditorClosed(np);
      }
      const nativeSaved = norm((await dbRow(rows[`${key}N`].id)).notes) === 'PAR 提醒測試';
      nativeRows.push({ scenario: key, prompted: message ? 'Y' : 'N', message, savedAfterNo: nativeSaved ? 'Y' : 'N' });
      await np.close();
    }
    const result = compareTables({ recorder, entry: 'newbie-reminder', title: '新人升階提醒（第 0／1／2／6 個月）', role: 'admin', legacySource: entry('newbie-reminder').legacy.source!, nativeSource: entry('newbie-reminder').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('prompted'), col('message'), col('savedAfterNo')], key: 'scenario' });
    assertNoUnlistedDiffs(result);
    expect(ok).toContain(result.status);
    // 觸發條件一致（誰會被提醒）、取消後都不儲存；差異只在六個月的訊息文字
    expect(legacyRows.map((r) => `${r.scenario}:${r.prompted}`)).toEqual(nativeRows.map((r) => `${r.scenario}:${r.prompted}`));
    expect(nativeRows.map((r) => `${r.scenario}:${r.savedAfterNo}`)).toEqual(legacyRows.map((r) => `${r.scenario}:${r.savedAfterNo}`));
    expect(legacyRows.map((r) => r.prompted)).toEqual(['Y', 'Y', 'Y', 'N']);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 4. 天數與本月狀態（W01b-q3）
// ---------------------------------------------------------------------------

test('天數與本月狀態：滿月自動整月一致；不滿月舊版自動改新進、新版不改並提示', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyRows: Record<string, unknown>[] = [];
    const nativeRows: Record<string, unknown>[] = [];
    for (const [key, days] of [['m1', '20'], ['m2', '30']] as const) {
      const lp = await ctx.newPage();
      await openLegacy(lp, rows[`${key}L`].id, zt01, PD);
      await lp.locator(LX.days).fill(days);
      await lp.waitForTimeout(400);
      legacyRows.push({ scenario: key, statusAfterDays: await lp.locator(LX.select('本月狀態')).inputValue(), hintShown: (await lp.getByText('請確認本月狀態').count()) ? 'Y' : 'N' });
      await lp.close();
      const np = await ctx.newPage();
      await openNative(np, rows[`${key}N`].code, PD);
      await panel(np).locator('[name=work_days]').fill(days);
      await np.waitForTimeout(400);
      nativeRows.push({ scenario: key, statusAfterDays: await panel(np).locator('[name=monthly_status]').inputValue(), hintShown: (await panel(np).locator('[data-partial-hint]').count()) ? 'Y' : 'N' });
      await np.close();
    }
    const result = compareTables({ recorder, entry: 'partial-month-status', title: '天數改動後的本月狀態與提示', role: 'admin', legacySource: entry('partial-month-status').legacy.source!, nativeSource: entry('partial-month-status').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('statusAfterDays'), col('hintShown')], key: 'scenario' });
    assertNoUnlistedDiffs(result);
    expect(ok).toContain(result.status);
    expect(legacyRows).toEqual([{ scenario: 'm1', statusAfterDays: 'new_hire', hintShown: 'N' }, { scenario: 'm2', statusAfterDays: 'full_month', hintShown: 'N' }]);
    expect(nativeRows).toEqual([{ scenario: 'm1', statusAfterDays: 'full_month', hintShown: 'Y' }, { scenario: 'm2', statusAfterDays: 'full_month', hintShown: 'N' }]);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 5. 行政階段必填
// ---------------------------------------------------------------------------

test('行政職位未選階段：兩邊都擋下儲存、訊息相同、DB 不變', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const lp = await ctx.newPage();
    const alerts: string[] = [];
    lp.on('dialog', (d: Dialog) => {
      alerts.push(d.message());
      void d.accept();
    });
    await openLegacy(lp, rows.a1L.id, zt01, PD);
    await lp.locator('xpath=//label[contains(normalize-space(.), "職位 *")]/following-sibling::select[1]').selectOption('行政');
    await lp.getByRole('button', { name: '儲存', exact: true }).click();
    await lp.waitForTimeout(1500);
    const legacyRows = [{ scenario: 'a1', blocked: alerts.length ? 'Y' : 'N', message: alerts[0] || '', savedToDb: (await dbRow(rows.a1L.id)).position === '行政' ? 'Y' : 'N' }];
    await lp.close();

    const np = await ctx.newPage();
    await openNative(np, rows.a1N.code, PD);
    await panel(np).locator('[name=position]').selectOption('行政');
    await panel(np).getByRole('button', { name: '儲存出勤資料' }).click();
    const alert = panel(np).getByRole('alert').filter({ hasText: '行政' }).first();
    await expect(alert).toBeVisible();
    const nativeRows = [{ scenario: 'a1', blocked: 'Y', message: norm(await alert.textContent()), savedToDb: (await dbRow(rows.a1N.id)).position === '行政' ? 'Y' : 'N' }];
    await np.close();

    const result = compareTables({ recorder, entry: 'admin-level-required', title: '行政未選階段', role: 'admin', legacySource: entry('admin-level-required').legacy.source!, nativeSource: entry('admin-level-required').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('blocked'), col('message'), col('savedToDb')], key: 'scenario' });
    assertNoUnlistedDiffs(result);
    expect(result.status).toBe('pass');
    expect(nativeRows[0]).toMatchObject({ blocked: 'Y', savedToDb: 'N' });
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 5b. 儲存成功後的行為（規格 C.3，照舊版）
// ---------------------------------------------------------------------------

test('儲存成功後：舊版與新版都跳「✅ 儲存成功」並回名冊（規格 C.3）', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const lp = await ctx.newPage();
    const alerts: string[] = [];
    lp.on('dialog', (d: Dialog) => {
      alerts.push(d.message());
      void d.accept();
    });
    await openLegacy(lp, rows.s1L.id, zt01, PD);
    await lp.locator(LX.notes).fill('PAR 儲存成功 舊');
    await lp.getByRole('button', { name: '儲存', exact: true }).click();
    await lp.waitForURL(/\/monthly-status(\?|$)/, { timeout: 30_000 });
    const legacyRows = [{ scenario: 's1', message: alerts[0] || '', afterSave: 'roster' }];
    await lp.close();

    const np = await ctx.newPage();
    const nativeAlerts: string[] = [];
    np.on('dialog', (d: Dialog) => {
      nativeAlerts.push(d.message());
      void d.accept();
    });
    await openNative(np, rows.s1N.code, PD);
    await panel(np).locator('[name=notes]').fill('PAR 儲存成功 新');
    await panel(np).getByRole('button', { name: '儲存出勤資料' }).click();
    await nativeEditorClosed(np);
    await expect(panel(np).locator('tr[data-staff]').first()).toBeVisible({ timeout: 20_000 });
    const nativeRows = [{ scenario: 's1', message: nativeAlerts[0] || '', afterSave: (await panel(np).locator('tr[data-staff]').count()) ? 'roster' : 'other' }];
    await np.close();

    const result = compareTables({ recorder, entry: 'save-success', title: '儲存成功後的行為', role: 'admin', legacySource: entry('save-success').legacy.source!, nativeSource: entry('save-success').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('message'), col('afterSave')], key: 'scenario' });
    assertNoUnlistedDiffs(result);
    expect(ok).toContain(result.status);
    expect(legacyRows[0].message).toBe('✅ 儲存成功');
    expect(nativeRows[0]).toMatchObject({ message: '✅ 儲存成功', afterSave: 'roster' });
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 6. 已確認專屬畫面、已送審鎖定
// ---------------------------------------------------------------------------

for (const role of ROLES_LOCKED) {
  test(`已確認專屬畫面對等 ${role}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await loginAs(browser, role);
    try {
      const lp = await ctx.newPage();
      await openLegacy(lp, rows.cfL.id, zt01, PL);
      const legacyRows = [{ scenario: 'confirmed', title: norm(await lp.locator('h2').first().textContent()), notice: norm(await lp.locator('h2 + p').first().textContent()), hasReturn: (await lp.getByRole('button', { name: '返回', exact: true }).count()) ? 'Y' : 'N', hasSave: (await lp.getByRole('button', { name: '儲存', exact: true }).count()) ? 'Y' : 'N' }];
      await lp.close();
      const np = await ctx.newPage();
      await openNative(np, rows.cfN.code, PL);
      const screen = panel(np).locator('[data-confirmed-screen]');
      const nativeRows = [{ scenario: 'confirmed', title: norm(await screen.locator('h2').textContent()), notice: norm(await screen.locator('h2 + p').textContent()), hasReturn: (await screen.getByRole('button', { name: '返回', exact: true }).count()) ? 'Y' : 'N', hasSave: (await np.getByRole('button', { name: '儲存出勤資料' }).count()) ? 'Y' : 'N' }];
      await np.close();
      const result = compareTables({ recorder, entry: 'confirmed-screen', title: '已確認專屬畫面', role, legacySource: entry('confirmed-screen').legacy.ui!.route, nativeSource: entry('confirmed-screen').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('title'), col('notice'), col('hasReturn'), col('hasSave')], key: 'scenario' });
      assertNoUnlistedDiffs(result);
      expect(result.status).toBe('pass');
      expect(nativeRows[0].title).toBe('此資料已確認');
    } finally {
      await ctx.close();
    }
  });

  test(`已送審人員的編輯頁 ${role}：舊版可儲存、新版鎖定`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await loginAs(browser, role);
    try {
      const lp = await ctx.newPage();
      await openLegacy(lp, rows.sbL.id, zt02, PL);
      const legacyRows = [{ scenario: 'submitted', canSave: (await lp.getByRole('button', { name: '儲存', exact: true }).count()) ? 'Y' : 'N' }];
      await lp.close();
      const np = await ctx.newPage();
      await openNative(np, rows.sbN.code, PL, 'ZT02 ZT 測試門市 02');
      const nativeRows = [{ scenario: 'submitted', canSave: (await np.getByRole('button', { name: '儲存出勤資料' }).count()) ? 'Y' : 'N' }];
      await expect(panel(np).locator('[data-readonly-notice]')).toBeVisible();
      await np.close();
      const result = compareTables({ recorder, entry: 'submitted-edit', title: '已送審的編輯頁是否可儲存', role, legacySource: entry('submitted-edit').legacy.ui!.route, nativeSource: entry('submitted-edit').native.source!, legacyRows, nativeRows, columns: [col('scenario'), col('canSave')], key: 'scenario' });
      assertNoUnlistedDiffs(result);
      expect(ok).toContain(result.status);
      expect(nativeRows[0].canSave).toBe('N');
    } finally {
      await ctx.close();
    }
  });
}

// ---------------------------------------------------------------------------
// 7. 儲存回讀：同樣操作，逐欄比對 DB
// ---------------------------------------------------------------------------

const READBACK_COLUMNS = ['position', 'employment_type', 'monthly_status', 'work_days', 'work_hours', 'is_dual_position', 'has_manager_bonus', 'is_supervisor_rotation', 'is_pharmacist', 'is_acting_manager', 'newbie_level', 'partial_month_reason', 'partial_month_days', 'partial_month_notes', 'supervisor_shift_hours', 'supervisor_employee_code', 'supervisor_name', 'supervisor_position', 'extra_tasks', 'extra_task_planned_hours', 'extra_task_external_hours', 'calculated_block', 'start_date', 'notes'];
const pickCols = (row: Record<string, unknown>, scenario: string) => ({ scenario, ...Object.fromEntries(READBACK_COLUMNS.map((c) => [c, Array.isArray(row[c]) ? (row[c] as unknown[]).join(',') : row[c] ?? null])) });

test('儲存回讀對等：勾外務與關閉督導卡班後，DB 欄位逐欄一致（含外務時數寫入未滿月備註）', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    // e1：勾長照外務、外務時數 5
    const lp1 = await ctx.newPage();
    lp1.on('dialog', (d: Dialog) => void d.accept());
    await openLegacy(lp1, rows.e1L.id, zt01, PD);
    await lp1.locator('label:has-text("長照外務")').first().click(); // 舊版 checkbox 以樣式隱藏，點 label
    await lp1.locator('input[placeholder="外務時數"]').fill('5');
    await lp1.getByRole('button', { name: '儲存', exact: true }).click();
    await lp1.waitForTimeout(2500);
    await lp1.close();
    const np1 = await ctx.newPage();
    await openNative(np1, rows.e1N.code, PD);
    await panel(np1).getByLabel('長照外務').check();
    await panel(np1).locator('[name=extra_task_external_hours]').fill('5');
    await panel(np1).getByRole('button', { name: '儲存出勤資料' }).click();
    await nativeEditorClosed(np1);
    await np1.close();

    // e2：關閉督導卡班
    const lp2 = await ctx.newPage();
    lp2.on('dialog', (d: Dialog) => void d.accept());
    await openLegacy(lp2, rows.e2L.id, zt01, PD);
    await lp2.locator('label:has-text("督導卡班")').first().click();
    await lp2.getByRole('button', { name: '儲存', exact: true }).click();
    await lp2.waitForTimeout(2500);
    await lp2.close();
    const np2 = await ctx.newPage();
    await openNative(np2, rows.e2N.code, PD);
    await panel(np2).getByLabel('督導卡班').uncheck();
    await panel(np2).getByRole('button', { name: '儲存出勤資料' }).click();
    await nativeEditorClosed(np2);
    await np2.close();

    const legacyRows = [pickCols(await dbRow(rows.e1L.id), 'e1-external'), pickCols(await dbRow(rows.e2L.id), 'e2-rotation-off')];
    const nativeRows = [pickCols(await dbRow(rows.e1N.id), 'e1-external'), pickCols(await dbRow(rows.e2N.id), 'e2-rotation-off')];
    const result = compareSideEffects({
      recorder,
      entry: 'save-readback',
      title: '舊編輯頁與新編輯頁儲存後的 monthly_staff_status 欄位',
      role: 'admin',
      legacyAction: '舊編輯頁操作後按儲存（updateStaffStatus）',
      nativeAction: '新編輯頁操作後按儲存（POST /api/workspace/monthly action=save）',
      tables: [{ table: 'monthly_staff_status', key: 'scenario', legacyRows, nativeRows }],
    });
    assertNoUnlistedDiffs(result);
    expect(ok).toContain(result.status);
    // 規格 C.2：外務時數寫入未滿月備註照舊版，所有欄位（含 partial_month_notes、calculated_block）完全一致
    expect(result.diffs).toEqual([]);
    expect(result.status).toBe('pass');
    expect(nativeRows[0]).toMatchObject({ calculated_block: 4, extra_task_planned_hours: 160, extra_task_external_hours: 5 });
    expect(nativeRows[1]).toMatchObject({ supervisor_name: null, supervisor_shift_hours: null, calculated_block: 1 });
  } finally {
    await ctx.close();
  }
});
