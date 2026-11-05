import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import {
  W05_MONTHS,
  addMonthlyManual,
  adminDb,
  createEmployee,
  ensureStats,
  masterRows,
  monthlyRows,
  openEmployeeCreate,
  openNativePage,
  purgeCodes,
  recheckRows,
  registerCode,
  registerRoster,
  resetMonths,
  storeIds,
  w05Code,
  workPanel,
} from '../support/w05-fixtures';
import { randomUUID } from 'node:crypto';

// W05 對等層：舊版 /admin/employee-management 與新版「員工管理／新增員工」。
// 兩邊以同樣的輸入走同樣的情境，擷取「是否接受、寫入的員編、員工類型、職位、月份資料」逐欄比對。
// 與舊版不同且使用者已核可的差異（M2 E.1 入口範圍、E.2 FKI、E.3 FKPT 兼職、E.4 改職位）登記在 allowlist.json。
// 舊版與新版各用自己的員編（同一個資料庫，不能共用同一個員編），事實中只比較與員編無關的欄位。

const map = loadMap('employee-management');
const recorder = new ParityRecorder('employee-management');
const entry = (id: string) => map.entries.find((e) => e.id === id)!.id;

type Facts = Record<string, unknown>;

test.describe('W05 員工管理對等', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  const used: string[] = [];
  const track = (code: string) => {
    used.push(code);
    return code;
  };

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    zt01 = (await storeIds(admin, W05_MONTHS.draft)).ZT01;
    await resetMonths([zt01]);
  });
  test.afterAll(async () => {
    for (const code of used) await registerCode(code).catch(() => undefined);
    await purgeCodes(used).catch(() => undefined);
    await resetMonths([zt01]).catch(() => undefined);
    await admin?.dispose();
  });

  /** 舊版：在新增員工視窗填入並儲存，收集 alert／confirm，回傳畫面結果。 */
  async function legacyAdd(page: Page, code: string, name: string, position = '') {
    const dialogs: string[] = [];
    let done: () => void = () => {};
    const alerted = new Promise<void>((resolve) => (done = resolve));
    page.removeAllListeners('dialog');
    page.on('dialog', async (d) => {
      dialogs.push(`${d.type()}:${d.message()}`);
      await d.accept();
      if (d.type() === 'alert') done();
    });
    await page.goto('/admin/employee-management', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^新增員工$/ }).first().click();
    await page.getByPlaceholder('FK1234').fill(code);
    await page.getByPlaceholder('王小明').fill(name);
    if (position) await page.locator('select').filter({ hasText: '請選擇（選填）' }).first().selectOption(position);
    await page.getByRole('button', { name: /^儲存$/ }).click();
    await Promise.race([alerted, page.waitForTimeout(15_000)]);
    return dialogs;
  }

  /** 新版：在新增員工頁填入並送出，回傳是否出現錯誤、是否出現確認視窗。 */
  async function nativeAdd(page: Page, code: string, name: string, position = '') {
    await openEmployeeCreate(page);
    const p = workPanel(page);
    await p.getByLabel('員編').first().fill(code);
    await p.getByLabel('姓名').fill(name);
    if (position) await p.getByLabel('當前職位').selectOption(position);
    await p.getByRole('button', { name: '核對並新增' }).click();
    const dialog = page.getByRole('dialog');
    const alert = p.getByRole('alert');
    await expect(dialog.or(alert).first()).toBeVisible({ timeout: 15_000 });
    if (await dialog.count()) {
      await dialog.getByRole('button', { name: '確認新增' }).click();
      await expect(p.getByRole('status').filter({ hasText: '已新增' }).or(p.getByRole('alert')).first()).toBeVisible({ timeout: 30_000 });
    }
  }

  const stored = async (code: string, input: string): Promise<Facts> => {
    const rows = await masterRows(code);
    const row = rows[0];
    return {
      accepted: rows.length === 1,
      codeStoredUppercase: row ? row.employee_code === input.trim().toUpperCase() : null,
      employmentType: row?.employment_type ?? null,
      position: row?.current_position ?? null,
      isActive: row?.is_active ?? null,
      hasStore: row ? row.store_id !== null : null,
    };
  };

  const scenarios: Array<{ id: string; title: string; legacyCode: () => string; nativeCode: () => string; input: (c: string) => string; position?: string }> = [
    { id: 'create-fk', title: 'FK+4 碼（小寫輸入）', legacyCode: () => w05Code('FK', 31), nativeCode: () => w05Code('FK', 32), input: (c) => c.toLowerCase(), position: '專員' },
    { id: 'create-fkf', title: 'FKF+5 碼', legacyCode: () => w05Code('FKF', 31), nativeCode: () => w05Code('FKF', 32), input: (c) => c },
    { id: 'create-fkpt', title: 'FKPT+3 碼', legacyCode: () => w05Code('FKPT', 31), nativeCode: () => w05Code('FKPT', 32), input: (c) => c },
    { id: 'create-fki', title: 'FKI+3 碼（實習生）', legacyCode: () => `FKI9${w05Code('FK', 0).slice(3, 5)}`, nativeCode: () => `FKI8${w05Code('FK', 0).slice(3, 5)}`, input: (c) => c },
    { id: 'create-bad-format', title: '格式錯誤（FK+2 碼）', legacyCode: () => `FK9${w05Code('FK', 0).slice(3, 4)}`, nativeCode: () => `FK8${w05Code('FK', 0).slice(3, 4)}`, input: (c) => c },
  ];

  for (const s of scenarios) {
    test(`新增員工對等：${s.title}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await loginAs(browser, 'admin');
      try {
        const legacyCode = track(s.legacyCode());
        const nativeCode = track(s.nativeCode());
        await purgeCodes([legacyCode, nativeCode]);
        const legacyPage = await ctx.newPage();
        const nativePage = await ctx.newPage();
        await nativePage.setViewportSize({ width: 1440, height: 900 });
        await legacyAdd(legacyPage, s.input(legacyCode), `W05對等 ${s.id}`, s.position);
        await nativeAdd(nativePage, s.input(nativeCode), `W05對等 ${s.id}`, s.position);
        const legacy = await stored(legacyCode, s.input(legacyCode));
        const native = await stored(nativeCode, s.input(nativeCode));
        await registerCode(legacyCode);
        await registerCode(nativeCode);
        assertNoUnlistedDiffs(
          recorder.record({
            entry: entry(s.id),
            mechanism: 'ui-extract',
            role: 'admin',
            title: `新增員工 ${s.title}：是否接受、員編大小寫、員工類型、職位、狀態`,
            legacy: { endpoint: '/admin/employee-management 新增員工' },
            native: { endpoint: '新增員工頁' },
            compared: { facts: Object.keys(legacy).length },
            diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
          }),
        );
      } finally {
        await ctx.close();
      }
    });
  }

  test('入口範圍對等：繞過畫面直接呼叫新增 API 送格式錯誤員編', async () => {
    const legacyCode = track(`FK9${w05Code('FK', 0).slice(3, 5)}`);
    const nativeCode = track(`FK8${w05Code('FK', 0).slice(3, 5)}`.replace(/^FK8(\d\d)$/, 'FK8$1'));
    await purgeCodes([legacyCode, nativeCode]);
    const legacyRes = await admin.post('/api/employees/add', { data: { employee_code: legacyCode, employee_name: 'W05對等 繞過' } });
    const nativeRes = await createEmployee(admin, { employee_code: nativeCode, employee_name: 'W05對等 繞過' });
    const facts = async (code: string, status: number, ok: boolean): Promise<Facts> => ({ accepted: ok, rowsWritten: (await masterRows(code)).length, httpOk: status >= 200 && status < 300 });
    const legacy = await facts(legacyCode, legacyRes.status(), (await legacyRes.json()).success === true);
    const native = await facts(nativeCode, nativeRes.status, nativeRes.status === 200);
    await registerCode(legacyCode);
    await registerCode(nativeCode);
    assertNoUnlistedDiffs(
      recorder.record({
        entry: entry('create-api-bypass'),
        mechanism: 'write-readback',
        role: 'admin',
        title: '直接呼叫新增 API 送格式錯誤員編（FK+3 碼）',
        legacy: { endpoint: 'POST /api/employees/add' },
        native: { endpoint: 'POST /api/workspace/employees' },
        compared: { facts: Object.keys(legacy).length },
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
  });

  test('編輯員工對等：同一份月人員資料（草稿＋已送審）改姓名與職位', async () => {
    test.setTimeout(180_000);
    const legacyCode = track(w05Code('FK', 41));
    const nativeCode = track(w05Code('FK', 42));
    await purgeCodes([legacyCode, nativeCode]);
    await resetMonths([zt01]);
    for (const code of [legacyCode, nativeCode]) {
      expect((await createEmployee(admin, { employee_code: code, employee_name: 'W05對等 編輯前', current_position: '專員' })).status).toBe(200);
      expect((await addMonthlyManual(admin, zt01, W05_MONTHS.draft, { employee_name: 'W05對等 編輯前', employee_code: code })).status).toBe(200);
      expect((await addMonthlyManual(admin, zt01, W05_MONTHS.locked, { employee_name: 'W05對等 編輯前', employee_code: code })).status).toBe(200);
    }
    await ensureStats(admin, zt01, W05_MONTHS.locked);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: W05_MONTHS.locked, skipChecks: true } })).status()).toBe(200);
    await registerRoster(zt01, W05_MONTHS.draft);
    await registerRoster(zt01, W05_MONTHS.locked);

    const legacyRes = await admin.post('/api/employees/update', { data: { employee_code: legacyCode, employee_name: 'W05對等 編輯後', current_position: '主任', start_date: null, birthday: null } });
    expect((await legacyRes.json()).success).toBe(true);
    const state = (await (await admin.get('/api/workspace/employees/edit', { params: { employee: nativeCode } })).json()).expected;
    const nativeRes = await admin.put('/api/workspace/employees/edit', { data: { requestId: randomUUID(), expected: state, data: { employee_code: nativeCode, employee_name: 'W05對等 編輯後', current_position: '主任', start_date: '', birthday: '' } } });
    expect(nativeRes.status()).toBe(200);

    const facts = async (code: string): Promise<Facts> => {
      const months = Object.fromEntries((await monthlyRows(code)).map((r) => [r.year_month, r]));
      const master = (await masterRows(code))[0];
      return {
        masterName: master?.employee_name,
        masterPosition: master?.current_position,
        draftName: months[W05_MONTHS.draft]?.employee_name,
        draftPosition: months[W05_MONTHS.draft]?.position,
        lockedName: months[W05_MONTHS.locked]?.employee_name,
        lockedPosition: months[W05_MONTHS.locked]?.position,
        lockedStatus: months[W05_MONTHS.locked]?.status,
        recheckPending: (await recheckRows(code)).filter((r) => r.status === 'pending').length,
      };
    };
    const legacy = await facts(legacyCode);
    const native = await facts(nativeCode);
    await registerCode(legacyCode);
    await registerCode(nativeCode);
    assertNoUnlistedDiffs(
      recorder.record({
        entry: entry('edit-position-sync'),
        mechanism: 'write-readback',
        role: 'admin',
        title: '編輯員工：主檔、草稿月份、已送審月份的姓名與職位，以及需重新確認筆數',
        legacy: { endpoint: 'POST /api/employees/update' },
        native: { endpoint: 'PUT /api/workspace/employees/edit' },
        compared: { facts: Object.keys(legacy).length },
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
  });

  test('員工名冊對等：同一組測試員工在舊頁與新版表格逐欄比對', async ({ browser }) => {
    test.setTimeout(180_000);
    const codes = [track(w05Code('FK', 51)), track(w05Code('FKPT', 51))];
    await purgeCodes(codes);
    expect((await createEmployee(admin, { employee_code: codes[0], employee_name: 'W05名冊 甲', current_position: '組長', start_date: '2025-03-04', birthday: '1991-02-03' })).status).toBe(200);
    expect((await createEmployee(admin, { employee_code: codes[1], employee_name: 'W05名冊 乙' })).status).toBe(200);
    // 離職狀態：直接把第二位標為離職，確認兩邊狀態欄一致（測試範圍內員編）。
    await adminDb().from('store_employees').update({ is_active: false, employment_status: 'resigned' }).eq('employee_code', codes[1]);
    for (const code of codes) await registerCode(code);

    const ctx = await loginAs(browser, 'admin');
    try {
      const legacyPage = await ctx.newPage();
      const nativePage = await ctx.newPage();
      await nativePage.setViewportSize({ width: 1440, height: 900 });
      await legacyPage.goto('/admin/employee-management', { waitUntil: 'networkidle' });
      await legacyPage.getByPlaceholder('搜尋員編或姓名...').fill('W05名冊');
      await expect(legacyPage.locator('table tbody tr')).toHaveCount(2, { timeout: 30_000 });
      const legacyRows = await legacyPage.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).slice(0, 6).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));

      await openNativePage(nativePage, '員工管理');
      const p = workPanel(nativePage);
      await p.getByPlaceholder('員編、姓名或職位').fill('W05名冊');
      await expect(p.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
      const nativeRows = await p.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).slice(0, 6).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));

      // 扁平成「員編#欄位」，白名單可用欄位名比對任何一列。
      const shape = (rows: string[][]) =>
        Object.fromEntries(rows.flatMap((r) => Object.entries({ name: r[1], position: r[2], status: r[3], startDate: r[4], birthday: r[5] }).map(([k, v]) => [`${r[0]}#${k}`, v])));
      assertNoUnlistedDiffs(
        recorder.record({
          entry: entry('list-ui'),
          mechanism: 'ui-extract',
          role: 'admin',
          title: '員工名冊（搜尋 W05名冊）：員編、姓名、當前職位、狀態、到職日、生日',
          legacy: { endpoint: '/admin/employee-management table' },
          native: { endpoint: '員工管理 table' },
          compared: { rows: legacyRows.length },
          diffs: valueDiffsToDiffs(diffNormalized(shape(legacyRows), shape(nativeRows))),
        }),
      );
    } finally {
      await ctx.close();
    }
  });
});
