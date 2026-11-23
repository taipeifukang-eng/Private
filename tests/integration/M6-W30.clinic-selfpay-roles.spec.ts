import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { apiForUser, cleanupM6Clinic, clinicFileName, M6_SCENARIOS, runIdOrThrow, setupM6Users, testStoreIds, type M6User } from '../support/m6-fixtures';
import { batchesOf, claimForm, countObjects, itemsOf, NEW, objectExists, priceForm, pricesOf, screenshotPaths, send, shot, shots, db } from '../support/clinic-api';
import { canSeeClinicSelfpayMenu, resolveAccess } from '../../lib/clinic-selfpay/access';

/**
 * M6 第三批 3a W30 診所自費藥毛利：workspace API 權限矩陣與業務規則（正式區 has_permission 語意）。
 * 帳號（臨時 m6-test-cs-*，角色 m6_test_cs_*）：只有計算器權限（A 店 VW001、B 店 VW002）、只有主檔管理、舊整合權限 margin、只有刪批次、
 *   職稱店長（無專屬權限）、職稱區經理（有門市／沒綁門市）、只有舊 Navbar 月報四碼、完全沒權限；另用 admin（應用層後備）。
 * 資料：診所檔與價格檔名 m6w30-<runId>-…，期間 2038，門市只用 VW001／VW002，截圖在桶內以測試門市為路徑前綴；只刪自己的（含儲存物件）。
 */
const KEYS = ['cs_calc_a', 'cs_calc_b', 'cs_mapping', 'cs_margin', 'cs_delete_only', 'cs_title_store', 'cs_title_mgr', 'cs_title_mgr_nostore', 'cs_old_nav', 'cs_none'];
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const apis: Record<string, APIRequestContext> = {};
const Y11 = '2038-11';
const Y10 = '2038-10';
const f = (tag: string, ext = 'xlsx') => clinicFileName(tag, ext);

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Clinic();
  ({ users, teardown } = await setupM6Users(KEYS));
  sid = await testStoreIds();
  apis.admin = await apiAs('admin');
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k]);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  const r = await cleanupM6Clinic(db(), Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
  expect(r.leftoverObjects, '桶內不應留下測試截圖').toEqual([]);
});
test.beforeEach(() => test.setTimeout(180_000));

const importPrice = (who: string, store: string, fixture: string, tag: string, month = Y11) =>
  send(apis[who], 'post', `${NEW}/prices/import`, { multipart: priceForm({ store: sid[store], month, fixture, fileName: f(tag) }) });
const importClaim = (who: string, store: string, fixture: string, tag: string, o: { month?: string; shots?: ReturnType<typeof shots>; flags?: Record<string, string> } = {}) =>
  send(apis[who], 'post', `${NEW}/batches/import`, { multipart: claimForm({ store: sid[store], month: o.month || Y11, fixture, fileName: f(tag), shots: o.shots, flags: o.flags }) });

test.describe.serial('權限矩陣（對照 resolveAccess）', () => {
  const perms = (key: string) => M6_SCENARIOS[key].perms;
  const title = (key: string) => M6_SCENARIOS[key].jobTitle || '測試';

  test('GET permissions 回傳的三個旗標，與 resolveAccess（舊版規則）逐帳號相同', async () => {
    for (const key of KEYS) {
      const r = await send(apis[key], 'get', `${NEW}/permissions`);
      expect(r.status, key).toBe(200);
      expect(r.body.access, key).toEqual(resolveAccess(perms(key), title(key)));
    }
    const a = await send(apis.admin, 'get', `${NEW}/permissions`);
    expect(a.status).toBe(200);
    expect(a.body.access.canUseCalculator && a.body.access.canManageMapping && a.body.access.canDeleteBatch, 'admin 應用層後備').toBe(true);
  });

  test('D1：session 的選單可見旗標與導覽項目 = 實際能用（舊 Navbar 四碼單獨持有時看不到，也真的 403）', async () => {
    for (const key of KEYS) {
      const expected = canSeeClinicSelfpayMenu(resolveAccess(perms(key), title(key)));
      const s = await send(apis[key], 'get', '/api/workspace/session');
      expect(s.status, key).toBe(200);
      expect(s.body.capabilities.clinicSelfpay, `${key} capability`).toBe(expected);
      const item = s.body.navigation.flatMap((g: any) => g.items).find((i: any) => i.label === '診所自費藥毛利計算');
      expect(!!item, `${key} 導覽（沒有權限的項目不會出現在回應）`).toBe(expected);
      if (expected) expect(item.kind, key).toBe('clinic-selfpay');
      // 看得到就一定能用：能開頁的人，兩個必要的 API 至少一個能用
      const stores = await send(apis[key], 'get', `${NEW}/stores`);
      expect(stores.status === 200, `${key} stores`).toBe(expected);
    }
    expect((await send(apis.cs_old_nav, 'get', `${NEW}/stores`)).status).toBe(403);
    expect((await send(apis.cs_delete_only, 'get', `${NEW}/stores`)).status).toBe(403);
  });

  test('各 API 的權限：計算器、主檔管理、刪批次三組分開，沒登入 401，缺 Origin 的寫入 403', async () => {
    for (const key of KEYS) {
      const acc = resolveAccess(perms(key), title(key));
      const batches = await send(apis[key], 'get', `${NEW}/batches`);
      expect(batches.status, `${key} batches`).toBe(acc.canUseCalculator ? 200 : 403);
      const maps = await send(apis[key], 'get', `${NEW}/mappings`, { params: { store_id: sid.VW001 } });
      // 有權限者：綁了 VW001 才是 200，沒綁門市（區經理無門市）是 403（門市範圍）；沒權限一律 403
      expect(maps.status, `${key} mappings`).toBe(acc.canManageMapping && M6_SCENARIOS[key].managed?.includes('VW001') ? 200 : 403);
      const close = await send(apis[key], 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: '2038-12' } });
      expect(close.status, `${key} close`).toBe(acc.canManageMapping && M6_SCENARIOS[key].managed?.includes('VW001') ? 400 : 403); // 有權限但 2038-12 沒有主檔資料 -> 400（沒綁門市的區經理先被門市範圍擋 403）
      const del = await send(apis[key], 'delete', `${NEW}/batches/00000000-0000-4000-8000-000000000000`);
      expect(del.status, `${key} delete`).toBe(acc.canDeleteBatch ? 404 : 403);
    }
    const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
    try {
      expect((await anon.get(`${NEW}/permissions`)).status()).toBe(401);
      expect((await anon.get(`${NEW}/batches`)).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
    // 缺 Origin：用同一個登入狀態但不帶 Origin 標頭
    const state = await apis.cs_calc_a.storageState();
    const noOrigin = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: state });
    try {
      const r = await noOrigin.post(`${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: '2038-12' } });
      expect(r.status()).toBe(403);
    } finally {
      await noOrigin.dispose();
    }
  });

  test('門市範圍：非 admin 只看自己綁定的門市（區經理沒綁門市看到 0 間），admin 看全部啟用門市', async () => {
    const names = async (k: string) => ((await send(apis[k], 'get', `${NEW}/stores`)).body.stores || []).map((s: any) => s.store_code);
    expect(await names('cs_calc_a')).toEqual(['VW001']);
    expect(await names('cs_calc_b')).toEqual(['VW002']);
    expect(await names('cs_margin')).toEqual(['VW001', 'VW002']);
    expect(await names('cs_title_mgr_nostore')).toEqual([]);
    const all = await names('admin');
    expect(all).toEqual(expect.arrayContaining(['VW001', 'VW002']));
  });
});

test.describe.serial('價格主檔、匯入規則 D2／D3／D4、截圖、關帳、刪除', () => {
  let batchA: string;
  test('區經理（職稱規則）替 VW001、VW002 匯入多月價格檔：依工作表分月、別名、去重保留最後一筆、略過缺欄列；沒權限者 403', async () => {
    expect((await importPrice('cs_calc_a', 'VW001', 'price-multi-month.xlsx', 'pm-denied')).status).toBe(403);
    expect((await importPrice('cs_delete_only', 'VW001', 'price-multi-month.xlsx', 'pm-denied2')).status).toBe(403);
    expect((await importPrice('cs_title_mgr_nostore', 'VW001', 'price-multi-month.xlsx', 'pm-nostore')).status, '沒綁門市').toBe(403);
    const r = await importPrice('cs_title_mgr', 'VW001', 'price-multi-month.xlsx', 'pm');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ imported: 7, rawRows: 8, deduplicatedRows: 1, importedMonths: [Y10, Y11], skippedClosedMonths: [] });
    expect(r.body.warning).toContain('1 筆重複健保碼');
    const m11 = await pricesOf(sid.VW001, Y11);
    expect(m11.map((x) => x.health_insurance_code)).toEqual(['ZTA000001', 'ZTA000002', 'ZTA000003', 'ZTB000010']);
    const b = m11.find((x) => x.health_insurance_code === 'ZTB000010');
    expect([Number(b.member_price), Number(b.cost_price), b.selfpay_drug_name, b.product_code]).toEqual([1250.5, 900, '測試藥品丁粉', '00012348']);
    expect(Number(m11[1].member_price)).toBe(250.5);
    expect(await pricesOf(sid.VW001, Y10)).toHaveLength(3);
    const r2 = await importPrice('cs_margin', 'VW002', 'price-multi-month.xlsx', 'pm2');
    expect(r2.status).toBe(200);
    // 重複匯入同一份：upsert，不重複
    expect((await importPrice('cs_title_mgr', 'VW001', 'price-multi-month.xlsx', 'pm-again')).status).toBe(200);
    expect(await pricesOf(sid.VW001, Y11)).toHaveLength(4);
  });

  test('價格檔錯誤：空檔、沒有選門市月份、不是 Excel 都有清楚的 400', async () => {
    const empty = await importPrice('cs_title_mgr', 'VW001', 'price-empty.xlsx', 'pe');
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain('找不到有效資料');
    const bad = await send(apis.cs_title_mgr, 'post', `${NEW}/prices/import`, { multipart: priceForm({ store: '', month: Y11, fixture: 'price-single-sheet.xlsx', fileName: f('bad') }) });
    expect(bad.status).toBe(400);
    const badMonth = await importPrice('cs_title_mgr', 'VW001', 'price-single-sheet.xlsx', 'badm', '2038-1');
    expect(badMonth.status).toBe(400);
  });

  test('店長（綁 VW001）匯入診所檔 + 截圖：批次、明細、快照、合計、截圖路徑與儲存物件', async () => {
    const r = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'basic', { shots: shots(2) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    batchA = r.body.batchId;
    expect(r.body).toMatchObject({ clinicCode: 'ZT038001', clinicName: '測試診所甲', yearMonth: Y11, sourceYearMonth: Y11, screenshotCount: 2 });
    expect(r.body.summary).toMatchObject({ itemCount: 8, matchedCount: 8, unmatchedCount: 0 });
    const [b] = await batchesOf(sid.VW001);
    expect(b).toMatchObject({ id: batchA, year_month: Y11, clinic_code: 'ZT038001', clinic_name: '測試診所甲', period_start: '2038-11-01', period_end: '2038-11-30', item_count: 8, imported_by: users.cs_calc_a.id, source_file_name: f('basic') });
    const paths = screenshotPaths(b.screenshot_path);
    expect(paths).toHaveLength(2);
    expect(b.screenshot_path.startsWith('['), '多張存 JSON 陣列字串（舊頁相容）').toBe(true);
    for (const p of paths) {
      expect(p.startsWith(`${sid.VW001}/${Y11}/`)).toBe(true);
      expect(await objectExists(p), p).toBe(true);
    }
    const items = await itemsOf(batchA);
    expect(items).toHaveLength(8);
    // ZTA000002 第 2 列：L 欄 3 個、會員價 250.5、成本 180.25
    expect([Number(items[1].qty), Number(items[1].billing_amount), Number(items[1].gross_profit_amount), Number(items[1].matched_member_price), Number(items[1].matched_cost_price), items[1].match_status]).toEqual([3, 751.5, 210.75, 250.5, 180.25, 'matched']);
    // ZTB000010 取最後一筆價格（1250.5／900）：數量 2 -> 2501、毛利 701
    expect([Number(items[3].billing_amount), Number(items[3].gross_profit_amount)]).toEqual([2501, 701]);
    // 批次合計小數 1 位
    const sumBilling = items.reduce((a, x) => a + Number(x.billing_amount), 0);
    expect(Number(b.total_billing_amount)).toBe(Math.round(sumBilling * 10) / 10);
    expect(Number(b.total_qty)).toBeCloseTo(10 + 3 + 5 + 2 + 4 + 1200 + 3 + 1.5, 6);
  });

  test('批次清單與明細：店長看得到成本與毛利、簽名網址可讀、別店店長 403 且清單看不到', async () => {
    const list = await send(apis.cs_calc_a, 'get', `${NEW}/batches`, { params: { store_id: sid.VW001 } });
    expect(list.status).toBe(200);
    expect(list.body.batches.map((x: any) => x.id)).toContain(batchA);
    expect(list.body.batches.find((x: any) => x.id === batchA)).toMatchObject({ store_code: 'VW001' });
    const d = await send(apis.cs_calc_a, 'get', `${NEW}/batches/${batchA}`);
    expect(d.status).toBe(200);
    expect(d.body.items).toHaveLength(8);
    expect(d.body.items[1]).toMatchObject({ matched_cost_price: 180.25, matched_member_price: 250.5 });
    expect(d.body.summary).toMatchObject({ itemCount: 8, matchedCount: 8 });
    expect(d.body.screenshotUrls).toHaveLength(2);
    const img = await pwRequest.newContext();
    try {
      for (const u of d.body.screenshotUrls) expect((await img.get(u)).status(), '簽名網址可讀').toBe(200);
    } finally {
      await img.dispose();
    }
    const other = await send(apis.cs_calc_b, 'get', `${NEW}/batches/${batchA}`);
    expect(other.status).toBe(403);
    const otherList = await send(apis.cs_calc_b, 'get', `${NEW}/batches`);
    expect(otherList.body.batches.map((x: any) => x.id)).not.toContain(batchA);
    const none = await send(apis.cs_calc_b, 'get', `${NEW}/batches`, { params: { store_id: sid.VW001 } });
    expect(none.body.batches).toEqual([]);
    expect((await send(apis.cs_calc_a, 'get', `${NEW}/batches/not-a-uuid`)).status).toBe(404);
    expect((await importClaim('cs_calc_b', 'VW001', 'claim-basic.xlsx', 'other-store')).status, '別店匯入').toBe(403);
    expect((await send(apis.cs_calc_b, 'delete', `${NEW}/batches/${batchA}`)).status, '沒有刪除權限').toBe(403);
  });

  test('D2：有藥品找不到價格 -> 整批擋下、回傳缺少的健保代碼與藥名；沒有批次、沒有截圖留下', async () => {
    const before = (await batchesOf(sid.VW001)).length;
    const objects = await countObjects(sid.VW001, Y11);
    const r = await importClaim('cs_calc_a', 'VW001', 'claim-unmatched.xlsx', 'unmatched');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('UNMATCHED');
    expect(r.body.unmatched).toEqual([{ code: 'ZTU000001', name: '測試未匹配藥甲' }, { code: 'ZTU000002', name: '測試未匹配藥乙' }]);
    expect(r.body.error).toContain('健保代碼ZTU000001 藥品名稱:測試未匹配藥甲');
    expect((await batchesOf(sid.VW001)).length).toBe(before);
    expect(await countObjects(sid.VW001, Y11)).toBe(objects);
  });

  test('其他匯入錯誤：沒有任何藥品、該月沒有價格主檔、缺檔案、缺截圖', async () => {
    const empty = await importClaim('cs_calc_a', 'VW001', 'claim-empty.xlsx', 'empty');
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain('未解析出藥品明細');
    expect(empty.body.debug.parseStats.skippedExcludedCode).toBe(1);
    const noPrice = await importClaim('cs_calc_a', 'VW001', 'claim-no-period.xlsx', 'noprice', { month: '2038-12' });
    expect(noPrice.status).toBe(400);
    expect(noPrice.body.error).toBe('尚未有12月成本、會員價的月度紀錄請聯繫營業部匯入');
    expect(noPrice.body.code).toBe('NO_PRICE_MONTH');
    const noFile = await send(apis.cs_calc_a, 'post', `${NEW}/batches/import`, { multipart: (() => { const fd = new FormData(); fd.append('store_id', sid.VW001); fd.append('year_month', Y11); return fd; })() });
    expect(noFile.status).toBe(400);
    const noShot = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'noshot', { shots: [] });
    expect(noShot.status).toBe(400);
    expect(noShot.body.error).toContain('至少上傳 1 張');
  });

  test('D6：截圖張數、格式、大小限制（伺服端），違規一律不建批次、不留物件', async () => {
    const before = (await batchesOf(sid.VW001)).length;
    const objects = await countObjects(sid.VW001, Y11);
    const eleven = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'd6-11', { shots: shots(11) });
    expect(eleven.status).toBe(400);
    expect(eleven.body.error).toContain('最多上傳 10 張');
    const gif = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'd6-gif', { shots: [shot(1, 'image/gif')] });
    expect(gif.status).toBe(400);
    expect(gif.body.error).toContain('png、jpeg、webp');
    const big = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'd6-big', { shots: [{ name: 'big.png', type: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) }] });
    expect(big.status).toBe(400);
    expect(big.body.error).toContain('5MB');
    expect((await batchesOf(sid.VW001)).length).toBe(before);
    expect(await countObjects(sid.VW001, Y11)).toBe(objects);
    // 恰好 10 張與 webp、jpeg 可以（用另一個診所，避免觸發重複提示）
    const ten = await importClaim('cs_calc_a', 'VW001', 'claim-clinic-b.xlsx', 'd6-10', { shots: [...shots(8), shot(9, 'image/webp'), shot(10, 'image/jpeg')] });
    expect(ten.status, JSON.stringify(ten.body)).toBe(200);
    expect(ten.body.screenshotCount).toBe(10);
  });

  test('D3：檔案期間（十月）與選的年月（十一月）不同 -> 409 提示；確認後以檔案期間為準歸入十月', async () => {
    const before = (await batchesOf(sid.VW001)).length;
    const ask = await importClaim('cs_calc_a', 'VW001', 'claim-october.xlsx', 'oct', { month: Y11 });
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ code: 'PERIOD_MISMATCH', fileYearMonth: Y10, selectedYearMonth: Y11, error: '檔案是 10 月，與你選的 11 月不同，確定嗎？' });
    expect((await batchesOf(sid.VW001)).length, '提示階段不寫入').toBe(before);
    const ok = await importClaim('cs_calc_a', 'VW001', 'claim-october.xlsx', 'oct', { month: Y11, flags: { confirm_period: '1' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.yearMonth).toBe(Y10);
    const row = (await batchesOf(sid.VW001, f('oct'))).pop();
    expect(row.year_month).toBe(Y10);
    expect(screenshotPaths(row.screenshot_path)[0].startsWith(`${sid.VW001}/${Y10}/`)).toBe(true);
    // 選的月份與檔案一致時不需要確認；沒有期間的檔案以選的月份為準，也不需要確認
    // 沒有期間的檔案沿用診所 ZT038001，已有同月批次，所以帶 D4 確認旗標；重點是不會有 D3（期間不同）提示
    const same = await importClaim('cs_calc_a', 'VW001', 'claim-no-period.xlsx', 'noperiod', { month: Y11, flags: { confirm_duplicate: '1' } });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body.sourceYearMonth).toBeNull();
    expect(same.body.yearMonth).toBe(Y11);
  });

  test('D4：同門市同月同診所再匯入 -> 409 提示；確認後仍新增、舊批次保留；不同診所不提示；沒有診所代碼也算同一個', async () => {
    const before = (await batchesOf(sid.VW001)).length;
    const ask = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'dup');
    expect(ask.status).toBe(409);
    expect(ask.body.code).toBe('DUPLICATE_BATCH');
    expect(ask.body.existing.map((e: any) => e.id)).toContain(batchA);
    expect(ask.body.error).toContain('ZT038001');
    expect((await batchesOf(sid.VW001)).length).toBe(before);
    const ok = await importClaim('cs_calc_a', 'VW001', 'claim-basic.xlsx', 'dup', { flags: { confirm_duplicate: '1' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.batchId).not.toBe(batchA);
    expect((await batchesOf(sid.VW001)).length).toBe(before + 1);
    expect((await batchesOf(sid.VW001)).map((b) => b.id)).toContain(batchA);
    // 沒有診所代碼：第一次不提示、第二次提示
    const n1 = await importClaim('cs_calc_a', 'VW001', 'claim-no-clinic.xlsx', 'noclinic1');
    expect(n1.status, JSON.stringify(n1.body)).toBe(200);
    expect(n1.body.clinicCode).toBeNull();
    const n2 = await importClaim('cs_calc_a', 'VW001', 'claim-no-clinic.xlsx', 'noclinic2');
    expect(n2.status).toBe(409);
    expect(n2.body.code).toBe('DUPLICATE_BATCH');
  });

  test('價格快照：之後改價再匯入並關帳，舊批次的單價、成本、金額與合計都不會改；新批次用新價格', async () => {
    const before = await itemsOf(batchA);
    const batchRowBefore = (await db().from('clinic_selfpay_claim_batches').select('total_billing_amount,total_gross_profit_amount,total_qty,item_count').eq('id', batchA).single()).data;
    const oldPrice = (await pricesOf(sid.VW001, Y11)).find((p) => p.health_insurance_code === 'ZTA000001');
    expect(Number(oldPrice.member_price)).toBe(100);
    const changed = await importPrice('cs_title_mgr', 'VW001', 'price-changed.xlsx', 'pm-changed');
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const newPrice = (await pricesOf(sid.VW001, Y11)).find((p) => p.health_insurance_code === 'ZTA000001');
    expect(Number(newPrice.member_price), 'price_entries 內的價格確實變了').toBe(999);
    expect(Number(newPrice.cost_price)).toBe(1);
    const close = await send(apis.cs_mapping, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: Y11 } });
    expect(close.body).toMatchObject({ isClosed: true, action: 'closed' });
    const after = await itemsOf(batchA);
    expect(after).toEqual(before);
    for (const [i, it] of after.entries()) {
      for (const k of ['matched_member_price', 'matched_cost_price', 'billing_amount', 'gross_profit_amount']) expect(it[k], `${k} #${i}`).toEqual(before[i][k]);
    }
    expect((await db().from('clinic_selfpay_claim_batches').select('total_billing_amount,total_gross_profit_amount,total_qty,item_count').eq('id', batchA).single()).data).toEqual(batchRowBefore);
    // 重新開帳；新匯入的批次（不同診所代碼避免重複提示）要用新價格
    expect((await send(apis.cs_mapping, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: Y11 } })).body).toMatchObject({ isClosed: false, action: 'reopened' });
    const nb = await importClaim('cs_calc_a', 'VW001', 'claim-clinic-b.xlsx', 'snap-new', { flags: { confirm_duplicate: '1' } });
    expect(nb.status, JSON.stringify(nb.body)).toBe(200);
    const nItems = await itemsOf(nb.body.batchId);
    const a1 = nItems.find((i) => i.health_insurance_code === 'ZTA000001');
    expect(a1, 'claim-clinic-b 應含 ZTA000001').toBeTruthy();
    expect(Number(a1.matched_member_price)).toBe(999);
    expect(Number(a1.matched_cost_price)).toBe(1);
    // 還原價格，避免影響後面的測試
    const restore = await importPrice('cs_title_mgr', 'VW001', 'price-single-sheet.xlsx', 'pm-restore');
    expect(restore.status).toBe(200);
  });

  test('關帳月份：價格匯入略過關帳月份、全部關帳回 400；無資料的月份不能關帳；開帳後可再覆蓋', async () => {
    const close = await send(apis.cs_margin, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW002, year_month: Y10 } });
    expect(close.body).toMatchObject({ isClosed: true, yearMonth: Y10 });
    const r = await importPrice('cs_margin', 'VW002', 'price-oct-only.xlsx', 'oct-closed', Y10);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(`已關帳，未匯入任何資料：${Y10}`);
    const multi = await importPrice('cs_margin', 'VW002', 'price-multi-month.xlsx', 'pm2-closed');
    expect(multi.status).toBe(200);
    expect(multi.body.skippedClosedMonths).toEqual([Y10]);
    expect(multi.body.importedMonths).toEqual([Y11]);
    const maps = await send(apis.cs_margin, 'get', `${NEW}/mappings`, { params: { store_id: sid.VW002, year_month: Y10 } });
    expect(maps.status).toBe(200);
    expect(maps.body.meta).toEqual({ yearMonth: Y10, isClosed: true });
    const open = await send(apis.cs_mapping, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: Y10 } });
    expect(open.body.isClosed).toBe(true);
    const reopen = await send(apis.cs_mapping, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: Y10 } });
    expect(reopen.body).toMatchObject({ isClosed: false, action: 'reopened' });
    const none = await send(apis.cs_mapping, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW001, year_month: '2038-12' } });
    expect(none.status).toBe(400);
    expect(none.body.error).toContain('尚無主檔資料');
    expect((await send(apis.cs_mapping, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW002, year_month: Y10 } })).status, '別店的店長不能關這間（cs_mapping 只綁 VW001）').toBe(403);
    // 清掉關帳讓後面的月份回到未關帳
    await send(apis.cs_margin, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW002, year_month: Y10 } });
  });

  test('對應主檔與歷史價格：每個健保碼一列（取最新月份）、歷史由新到舊；萬用字元不會比對到別的代碼', async () => {
    const maps = await send(apis.cs_mapping, 'get', `${NEW}/mappings`, { params: { store_id: sid.VW001 } });
    expect(maps.status).toBe(200);
    expect(maps.body.items.map((m: any) => m.health_insurance_code)).toEqual(['ZTA000001', 'ZTA000002', 'ZTA000003', 'ZTB000010']);
    expect(maps.body.items[0]).toMatchObject({ product_code: '00012345', drug_name: '測試藥品甲錠', latest_year_month: Y11 });
    const h = await send(apis.cs_mapping, 'get', `${NEW}/mappings/history`, { params: { store_id: sid.VW001, health_insurance_code: 'zta000001' } });
    expect(h.status).toBe(200);
    expect(h.body.items.map((x: any) => x.year_month)).toEqual([Y11, Y10]);
    expect(Number(h.body.items[1].member_price)).toBe(90);
    const wild = await send(apis.cs_mapping, 'get', `${NEW}/mappings/history`, { params: { store_id: sid.VW001, health_insurance_code: 'ZTA%' } });
    expect(wild.body.items).toEqual([]);
    expect((await send(apis.cs_mapping, 'get', `${NEW}/mappings/history`, { params: { store_id: sid.VW002, health_insurance_code: 'ZTA000001' } })).status).toBe(403);
    expect((await send(apis.cs_mapping, 'get', `${NEW}/mappings`, { params: { store_id: sid.VW001, year_month: '2038-1' } })).status).toBe(400);
    expect((await send(apis.cs_mapping, 'get', `${NEW}/mappings`)).status).toBe(400);
  });

  test('刪除批次：沒權限 403、別店 403；有權限先刪截圖物件再刪資料列（明細一併）；刪不存在的批次 404', async () => {
    const paths = screenshotPaths((await batchesOf(sid.VW001)).find((b) => b.id === batchA)!.screenshot_path);
    expect(paths.length).toBe(2);
    expect((await send(apis.cs_calc_a, 'delete', `${NEW}/batches/${batchA}`)).status, '只有計算器權限不能刪').toBe(403);
    expect((await send(apis.cs_title_mgr_nostore, 'delete', `${NEW}/batches/${batchA}`)).status, '區經理沒綁門市：門市範圍擋下').toBe(403);
    const del = await send(apis.cs_delete_only, 'delete', `${NEW}/batches/${batchA}`);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, removedScreenshots: 2 });
    for (const p of paths) expect(await objectExists(p), `${p} 應已刪除`).toBe(false);
    expect((await batchesOf(sid.VW001)).map((b) => b.id)).not.toContain(batchA);
    expect(await itemsOf(batchA)).toEqual([]);
    expect((await send(apis.cs_delete_only, 'delete', `${NEW}/batches/${batchA}`)).status).toBe(404);
    // 其餘批次由 afterAll 的清除（含儲存物件）處理
  });
});
