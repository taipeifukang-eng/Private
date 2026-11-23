import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { apiForUser, cleanupM6Clinic, clinicFileName, M6_SCENARIOS, runIdOrThrow, setupM6Users, testStoreIds, type M6User } from '../support/m6-fixtures';
import { batchesOf, claimForm, itemsOf, NEW, OLD, objectExists, priceForm, pricesOf, screenshotPaths, send, shot, shots, db, type Res } from '../support/clinic-api';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';
import { canSeeClinicSelfpayMenu, resolveAccess } from '../../lib/clinic-selfpay/access';

/**
 * M6 第三批 3a W30 對等：舊 /api/clinic-selfpay/** 與新 /api/workspace/clinic-selfpay/** 對同一批自造檔各跑一遍。
 * 做法：舊版寫入 VW001、新版寫入 VW002（兩店各有同一份價格主檔），再比對回應與資料表內容（欄位逐一、去掉 id 與時間）。
 *  - 一致：價格檔匯入結果與資料列、診所檔解析與計算（含 .xls、列內診所別、沒有期間、沒有診所代碼）、各種錯誤訊息（D2 未匹配、沒有藥品、沒有價格月份）、
 *    對應主檔與歷史價格讀取、批次清單與明細、關帳與開帳、刪除（含截圖物件）、各角色的權限旗標與狀態碼。
 *  - 已登記差異：D1 選單可見性、D3 期間不同要確認、D4 重複批次要確認、D6 截圖張數／格式／大小限制、歷史價格萬用字元跳脫。
 * 資料：m6w30-<runId>-… 檔名、期間 2038、門市只用 VW001／VW002；只刪自己的（含儲存物件）。
 */
const recorder = new ParityRecorder('clinic-selfpay');
const KEYS = ['cs_calc_a', 'cs_calc_b', 'cs_mapping', 'cs_margin', 'cs_delete_only', 'cs_title_store', 'cs_title_mgr', 'cs_title_mgr_nostore', 'cs_old_nav', 'cs_none'];
const Y10 = '2038-10';
const Y11 = '2038-11';
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const apis: Record<string, APIRequestContext> = {};
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
test.beforeEach(() => test.setTimeout(300_000));

const rec = (entry: string, title: string, role: string, diffs: Diff[], compared: Record<string, number | string | boolean>, mechanism: 'api-read' | 'write-readback' = 'api-read') => {
  const r = recorder.record({ entry, mechanism, role, title, legacy: { endpoint: `${OLD}（舊）` }, native: { endpoint: `${NEW}（新）` }, compared, diffs });
  assertNoUnlistedDiffs(r);
  expect(['pass', 'allowed', 'pending-approval'], `${entry}：${JSON.stringify(r.diffs)}`).toContain(r.status);
  return r;
};
const same = (key: string, l: unknown, n: unknown): Diff[] => (JSON.stringify(l) === JSON.stringify(n) ? [] : [{ kind: 'changed', key, legacy: l, native: n }]);
const status = (key: string, l: number, n: number): Diff[] => (l === n ? [] : [{ kind: 'status', key, legacy: l, native: n }]);

const BATCH_FIELDS = ['year_month', 'clinic_code', 'clinic_name', 'period_start', 'period_end', 'item_count', 'total_qty', 'total_billing_amount', 'total_gross_profit_amount', 'status', 'source_b2_text', 'source_b4_text'];
const batchView = (b: any) => BATCH_FIELDS.map((k) => (['total_qty', 'total_billing_amount', 'total_gross_profit_amount', 'item_count'].includes(k) ? Number(b[k]) : b[k]));
const ITEM_FIELDS = ['line_no', 'health_insurance_code', 'drug_name', 'qty', 'matched_product_code', 'matched_member_price', 'matched_cost_price', 'billing_amount', 'gross_profit_amount', 'match_status'];
const itemView = (i: any) => ITEM_FIELDS.map((k) => (['qty', 'matched_member_price', 'matched_cost_price', 'billing_amount', 'gross_profit_amount'].includes(k) && i[k] !== null ? Number(i[k]) : i[k]));
const PRICE_FIELDS = ['year_month', 'health_insurance_code', 'product_code', 'product_name', 'selfpay_drug_name', 'member_price', 'cost_price'];
const priceView = (p: any) => PRICE_FIELDS.map((k) => (['member_price', 'cost_price'].includes(k) ? Number(p[k]) : p[k]));

const legacyPrice = (who: string, store: string, fixture: string, tag: string, month = Y11) => send(apis[who], 'post', `${OLD}/prices/import`, { multipart: priceForm({ store: sid[store], month, fixture, fileName: f(tag) }) });
const nativePrice = (who: string, store: string, fixture: string, tag: string, month = Y11) => send(apis[who], 'post', `${NEW}/prices/import`, { multipart: priceForm({ store: sid[store], month, fixture, fileName: f(tag) }) });
type ClaimOpt = { month?: string; shots?: ReturnType<typeof shots>; flags?: Record<string, string>; ext?: string };
const legacyClaim = (who: string, fixture: string, tag: string, o: ClaimOpt = {}) => send(apis[who], 'post', `${OLD}/batches/import`, { multipart: claimForm({ store: sid.VW001, month: o.month || Y11, fixture, fileName: f(tag, o.ext), shots: o.shots }) });
const nativeClaim = (who: string, fixture: string, tag: string, o: ClaimOpt = {}) => send(apis[who], 'post', `${NEW}/batches/import`, { multipart: claimForm({ store: sid.VW002, month: o.month || Y11, fixture, fileName: f(tag, o.ext), shots: o.shots, flags: o.flags }) });
const rowOf = async (store: string, tag: string, ext = 'xlsx') => (await batchesOf(sid[store], f(tag, ext))).pop();

test('權限：各帳號的三個旗標與各 API 狀態碼，新舊相同（舊版 data 對新版 access）', async () => {
  const diffs: Diff[] = [];
  for (const key of KEYS) {
    const l = await send(apis[key], 'get', `${OLD}/permissions`);
    const n = await send(apis[key], 'get', `${NEW}/permissions`);
    diffs.push(...status(`${key}:permissions:status`, l.status, n.status));
    if (l.status === 200 && n.status === 200) diffs.push(...same(`${key}:access`, l.body.data, n.body.access));
    for (const [name, lu, nu, params] of [
      ['stores', `${OLD}/stores`, `${NEW}/stores`, undefined],
      ['batches', `${OLD}/batches`, `${NEW}/batches`, undefined],
      ['mappings', `${OLD}/mappings`, `${NEW}/mappings`, { store_id: sid.VW001 }],
    ] as const) {
      const a = await send(apis[key], 'get', lu, params ? { params } : undefined);
      const b = await send(apis[key], 'get', nu, params ? { params } : undefined);
      diffs.push(...status(`${key}:${name}:status`, a.status, b.status));
      if (name === 'stores' && a.status === 200 && b.status === 200) diffs.push(...same(`${key}:stores`, a.body.data.map((s: any) => s.store_code), b.body.stores.map((s: any) => s.store_code)));
    }
    const dl = await send(apis[key], 'delete', `${OLD}/batches/00000000-0000-4000-8000-000000000000`);
    const dn = await send(apis[key], 'delete', `${NEW}/batches/00000000-0000-4000-8000-000000000000`);
    diffs.push(...status(`${key}:delete-missing:status`, dl.status, dn.status));
  }
  rec('permissions', '各帳號權限旗標、門市清單與各 API 狀態碼（含刪除不存在的批次）', 'multi', diffs, { roles: KEYS.length });
});

test('D1 選單可見性：舊 Navbar 用四個月報權限碼；新版 = 實際能用（resolveAccess）。差異只出現在「選單可見但不能用」或「能用但選單看不到」的帳號', async () => {
  const OLD_NAV = ['monthly.status.view_own', 'monthly.status.view_all', 'employee.movement.manage', 'store.manage'];
  const diffs: Diff[] = [];
  for (const key of KEYS) {
    const sc = M6_SCENARIOS[key];
    const legacyVisible = sc.perms.some((p) => OLD_NAV.includes(p));
    const s = await send(apis[key], 'get', '/api/workspace/session');
    const nativeVisible = !!s.body.navigation.flatMap((g: any) => g.items).find((i: any) => i.label === '診所自費藥毛利計算');
    expect(nativeVisible, `${key} 新版可見 = 實際能用`).toBe(canSeeClinicSelfpayMenu(resolveAccess(sc.perms, sc.jobTitle || '測試')));
    diffs.push(...same(`${key}:menu-visible`, legacyVisible, nativeVisible));
  }
  const r = rec('menu-visibility', '診所毛利選單可見性：舊 Navbar 條件 vs 新版實際能用規則', 'multi', diffs, { roles: KEYS.length });
  expect(r.diffs.length, '至少抓到一個差異（舊 Navbar 條件與實際能用不一致，這就是 D1 要修的）').toBeGreaterThan(0);
});

test('價格檔匯入：回應與資料列新舊相同（多月工作表、別名、去重、略過缺欄列、關帳月份略過與全部略過）', async () => {
  const diffs: Diff[] = [];
  const l = await legacyPrice('cs_margin', 'VW001', 'price-multi-month.xlsx', 'pm');
  const n = await nativePrice('cs_margin', 'VW002', 'price-multi-month.xlsx', 'pm');
  expect([l.status, n.status], JSON.stringify([l.body, n.body])).toEqual([200, 200]);
  const pickRes = (r: Res) => [r.body.imported, r.body.rawRows, r.body.deduplicatedRows, r.body.importedMonths, r.body.skippedClosedMonths, r.body.warning];
  diffs.push(...same('multi:response', pickRes(l), pickRes(n)));
  for (const ym of [Y10, Y11]) diffs.push(...same(`multi:rows:${ym}`, (await pricesOf(sid.VW001, ym)).map(priceView), (await pricesOf(sid.VW002, ym)).map(priceView)));
  // 單一工作表（用畫面選的月份）與別名欄位
  const l2 = await legacyPrice('cs_margin', 'VW001', 'price-single-sheet.xlsx', 'ps', '2038-12');
  const n2 = await nativePrice('cs_margin', 'VW002', 'price-single-sheet.xlsx', 'ps', '2038-12');
  diffs.push(...same('single:response', pickRes(l2), pickRes(n2)));
  diffs.push(...same('single:rows', (await pricesOf(sid.VW001, '2038-12')).map(priceView), (await pricesOf(sid.VW002, '2038-12')).map(priceView)));
  // 空檔、缺檔、錯誤月份
  for (const [tag, fixture, month] of [['empty', 'price-empty.xlsx', Y11], ['badmonth', 'price-single-sheet.xlsx', '2038-1']] as const) {
    const a = await legacyPrice('cs_margin', 'VW001', fixture, tag, month);
    const b = await nativePrice('cs_margin', 'VW002', fixture, tag, month);
    diffs.push(...status(`${tag}:status`, a.status, b.status), ...same(`${tag}:error`, a.body.error, b.body.error));
  }
  // 關帳 2038-10 後再匯入
  const cl = await send(apis.cs_margin, 'post', `${OLD}/mappings/close`, { data: { store_id: sid.VW001, year_month: Y10 } });
  const cn = await send(apis.cs_margin, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW002, year_month: Y10 } });
  diffs.push(...status('close:status', cl.status, cn.status), ...same('close:body', [cl.body.yearMonth, cl.body.isClosed, cl.body.action], [cn.body.yearMonth, cn.body.isClosed, cn.body.action]));
  const l3 = await legacyPrice('cs_margin', 'VW001', 'price-multi-month.xlsx', 'pm-closed');
  const n3 = await nativePrice('cs_margin', 'VW002', 'price-multi-month.xlsx', 'pm-closed');
  diffs.push(...status('closed:status', l3.status, n3.status), ...same('closed:response', pickRes(l3), pickRes(n3)));
  const l4 = await legacyPrice('cs_margin', 'VW001', 'price-oct-only.xlsx', 'oct-closed', Y10);
  const n4 = await nativePrice('cs_margin', 'VW002', 'price-oct-only.xlsx', 'oct-closed', Y10);
  diffs.push(...status('allclosed:status', l4.status, n4.status), ...same('allclosed:error', l4.body.error, n4.body.error));
  rec('price-import', '價格檔匯入（含關帳月份略過）：回應與資料列新舊相同', 'cs_margin', diffs, { cases: 8 }, 'write-readback');
});

test('對應主檔、歷史價格、關帳狀態讀取：新舊相同；歷史價格的萬用字元在新版不再比對到其他代碼（已登記）', async () => {
  const diffs: Diff[] = [];
  for (const ym of ['', Y11, Y10]) {
    const params = (store: string) => ({ store_id: sid[store], ...(ym ? { year_month: ym } : {}) });
    const l = await send(apis.cs_margin, 'get', `${OLD}/mappings`, { params: params('VW001') });
    const n = await send(apis.cs_margin, 'get', `${NEW}/mappings`, { params: params('VW002') });
    diffs.push(...status(`mappings:${ym || 'all'}:status`, l.status, n.status), ...same(`mappings:${ym || 'all'}:items`, l.body.data, n.body.items), ...same(`mappings:${ym || 'all'}:meta`, l.body.meta, n.body.meta));
  }
  for (const code of ['ZTA000001', 'zta000002', 'ZTB000010', 'ZTNOPE']) {
    const l = await send(apis.cs_margin, 'get', `${OLD}/mappings/history`, { params: { store_id: sid.VW001, health_insurance_code: code } });
    const n = await send(apis.cs_margin, 'get', `${NEW}/mappings/history`, { params: { store_id: sid.VW002, health_insurance_code: code } });
    diffs.push(...status(`history:${code}:status`, l.status, n.status), ...same(`history:${code}:items`, l.body.data.map(priceView), n.body.items.map(priceView)));
  }
  for (const [q, name] of [[{ year_month: Y11 }, 'nostore'], [{ store_id: sid.VW001, year_month: '2038-1' }, 'badmonth']] as const) {
    const l = await send(apis.cs_margin, 'get', `${OLD}/mappings`, { params: q as any });
    const n = await send(apis.cs_margin, 'get', `${NEW}/mappings`, { params: q as any });
    diffs.push(...status(`mappings:${name}:status`, l.status, n.status));
  }
  rec('mappings-read', '對應主檔、歷史價格與錯誤參數：新舊相同', 'cs_margin', diffs, { cases: 14 });
  const wl = await send(apis.cs_margin, 'get', `${OLD}/mappings/history`, { params: { store_id: sid.VW001, health_insurance_code: 'ZTA%' } });
  const wn = await send(apis.cs_margin, 'get', `${NEW}/mappings/history`, { params: { store_id: sid.VW002, health_insurance_code: 'ZTA%' } });
  expect(wl.body.data.length, '舊版把 % 當萬用字元').toBeGreaterThan(0);
  rec('history-wildcard', '歷史價格查詢：輸入 % 或 _ 時，舊版當萬用字元比對到其他健保碼，新版只比對字面', 'cs_margin', same('history:wildcard:count', wl.body.data.length, wn.body.items.length));
});

test('診所檔匯入：各種版面（.xlsx、.xls、列內診所別、沒有期間、沒有診所代碼、另一家診所）批次與明細資料列新舊逐欄相同；回應摘要相同', async () => {
  const cases: [string, string, string?][] = [['claim-basic.xlsx', 'basic'], ['claim-basic.xls', 'basicxls', 'xls'], ['claim-clinic-in-body.xlsx', 'inbody'], ['claim-no-period.xlsx', 'noperiod'], ['claim-no-clinic.xlsx', 'noclinic'], ['claim-clinic-b.xlsx', 'clinicb']];
  const diffs: Diff[] = [];
  for (const [fixture, tag, ext] of cases) {
    // 新版會對「同門市同月同診所」要求確認（D4，另有獨立項目），所以這裡一律帶確認旗標，只比對解析與計算
    const l = await legacyClaim('cs_margin', fixture, tag, { ext, shots: shots(2) });
    const n = await nativeClaim('cs_margin', fixture, tag, { ext, shots: shots(2), flags: { confirm_period: '1', confirm_duplicate: '1' } });
    expect([l.status, n.status], `${fixture} ${JSON.stringify([l.body, n.body]).slice(0, 400)}`).toEqual([200, 200]);
    diffs.push(...same(`${tag}:summary`, l.body.summary, n.body.summary), ...same(`${tag}:clinic`, [l.body.clinicCode, l.body.clinicName, l.body.sourceYearMonth], [n.body.clinicCode, n.body.clinicName, n.body.sourceYearMonth]));
    const lb = (await rowOf('VW001', tag, ext))!;
    const nb = (await rowOf('VW002', tag, ext))!;
    diffs.push(...same(`${tag}:batch`, batchView(lb), batchView(nb)));
    diffs.push(...same(`${tag}:items`, (await itemsOf(lb.id)).map(itemView), (await itemsOf(nb.id)).map(itemView)));
    // 截圖：兩張，都存在，格式同為「多張存 JSON 陣列字串」
    diffs.push(...same(`${tag}:shots-format`, [lb.screenshot_path.startsWith('['), screenshotPaths(lb.screenshot_path).length], [nb.screenshot_path.startsWith('['), screenshotPaths(nb.screenshot_path).length]));
    for (const p of screenshotPaths(nb.screenshot_path)) expect(await objectExists(p)).toBe(true);
  }
  rec('claim-import', `診所檔匯入 ${cases.length} 種版面：批次、明細、金額、截圖格式新舊相同`, 'cs_margin', diffs, { fixtures: cases.length }, 'write-readback');
  // 單張截圖：舊版單張存純路徑字串，新版相同
  const l1 = await legacyClaim('cs_margin', 'claim-basic.xlsx', 'single', { shots: [shot(1)] });
  const n1 = await nativeClaim('cs_margin', 'claim-basic.xlsx', 'single', { shots: [shot(1)], flags: { confirm_duplicate: '1' } });
  expect([l1.status, n1.status]).toEqual([200, 200]);
  const lr = (await rowOf('VW001', 'single'))!, nr = (await rowOf('VW002', 'single'))!;
  rec('claim-single-screenshot', '單張截圖的路徑存成純字串（與舊版相同，舊頁都讀得到）', 'cs_margin', same('single:format', [lr.screenshot_path.startsWith('['), lr.screenshot_path.split('/').length], [nr.screenshot_path.startsWith('['), nr.screenshot_path.split('/').length]));
});

test('匯入錯誤：D2 未匹配（訊息與清單相同）、沒有藥品（除錯統計相同）、沒有價格月份、缺檔案、缺截圖：新舊狀態碼與訊息相同；失敗不留批次與截圖', async () => {
  const diffs: Diff[] = [];
  const before = [(await batchesOf(sid.VW001)).length, (await batchesOf(sid.VW002)).length];
  const l = await legacyClaim('cs_margin', 'claim-unmatched.xlsx', 'unm');
  const n = await nativeClaim('cs_margin', 'claim-unmatched.xlsx', 'unm');
  diffs.push(...status('unmatched:status', l.status, n.status), ...same('unmatched:error', l.body.error, n.body.error), ...same('unmatched:list', l.body.unmatched, n.body.unmatched), ...same('unmatched:debug', l.body.debug, n.body.debug));
  const le = await legacyClaim('cs_margin', 'claim-empty.xlsx', 'empty');
  const ne = await nativeClaim('cs_margin', 'claim-empty.xlsx', 'empty');
  diffs.push(...status('empty:status', le.status, ne.status), ...same('empty:error', le.body.error, ne.body.error), ...same('empty:debug', le.body.debug, ne.body.debug));
  const lp = await legacyClaim('cs_margin', 'claim-no-period.xlsx', 'nop', { month: '2039-02' });
  const np = await nativeClaim('cs_margin', 'claim-no-period.xlsx', 'nop', { month: '2039-02' });
  diffs.push(...status('noprice:status', lp.status, np.status), ...same('noprice:error', lp.body.error, np.body.error), ...same('noprice:debug', lp.body.debug, np.body.debug));
  const ls = await legacyClaim('cs_margin', 'claim-basic.xlsx', 'nos', { shots: [] });
  const ns = await nativeClaim('cs_margin', 'claim-basic.xlsx', 'nos', { shots: [] });
  diffs.push(...status('noshot:status', ls.status, ns.status));
  const lf = await send(apis.cs_margin, 'post', `${OLD}/batches/import`, { multipart: (() => { const fd = new FormData(); fd.append('store_id', sid.VW001); fd.append('year_month', Y11); return fd; })() });
  const nf = await send(apis.cs_margin, 'post', `${NEW}/batches/import`, { multipart: (() => { const fd = new FormData(); fd.append('store_id', sid.VW002); fd.append('year_month', Y11); return fd; })() });
  diffs.push(...status('nofile:status', lf.status, nf.status));
  const lo = await send(apis.cs_calc_a, 'post', `${OLD}/batches/import`, { multipart: claimForm({ store: sid.VW002, month: Y11, fixture: 'claim-basic.xlsx', fileName: f('otherstore') }) });
  const no = await send(apis.cs_calc_a, 'post', `${NEW}/batches/import`, { multipart: claimForm({ store: sid.VW002, month: Y11, fixture: 'claim-basic.xlsx', fileName: f('otherstore') }) });
  diffs.push(...status('otherstore:status', lo.status, no.status));
  diffs.push(...same('no-leftover', before, [(await batchesOf(sid.VW001)).length, (await batchesOf(sid.VW002)).length]));
  rec('import-errors', '匯入錯誤情境：狀態碼、訊息、清單與除錯統計新舊相同；失敗不留下批次', 'cs_margin', diffs, { cases: 6 });
});

test('D3：檔案期間（十月）與選的年月（十一月）不同 -> 舊版直接以檔案為準匯入；新版先 409 提示，確認後結果與舊版相同（已登記）', async () => {
  const l = await legacyClaim('cs_margin', 'claim-october.xlsx', 'oct', { month: Y11 });
  const n = await nativeClaim('cs_margin', 'claim-october.xlsx', 'oct', { month: Y11 });
  expect([l.status, n.status]).toEqual([200, 409]);
  expect(n.body.error).toBe('檔案是 10 月，與你選的 11 月不同，確定嗎？');
  expect(await rowOf('VW002', 'oct'), '提示階段新版不寫入').toBeUndefined();
  rec('import-period-mismatch', '檔案期間與畫面選的年月不同：新版加確認提示', 'cs_margin', status('period-mismatch:status', l.status, n.status));
  const n2 = await nativeClaim('cs_margin', 'claim-october.xlsx', 'oct', { month: Y11, flags: { confirm_period: '1' } });
  expect(n2.status).toBe(200);
  const lb = (await rowOf('VW001', 'oct'))!, nb = (await rowOf('VW002', 'oct'))!;
  rec('import-period-confirmed', '確認後的結果（歸屬年月、明細、金額）與舊版相同', 'cs_margin', [...same('oct:batch', batchView(lb), batchView(nb)), ...same('oct:items', (await itemsOf(lb.id)).map(itemView), (await itemsOf(nb.id)).map(itemView))], { month: Y10 }, 'write-readback');
});

test('D4：同門市同月同診所再匯入 -> 舊版直接新增；新版先 409 提示，確認後仍新增、舊批次保留（已登記）', async () => {
  const l = await legacyClaim('cs_margin', 'claim-basic.xlsx', 'basic', { shots: [shot(7)] });
  const n = await nativeClaim('cs_margin', 'claim-basic.xlsx', 'basic', { shots: [shot(7)] });
  expect([l.status, n.status]).toEqual([200, 409]);
  expect(n.body.code).toBe('DUPLICATE_BATCH');
  rec('import-duplicate', '同門市同月同診所重複匯入：新版加確認提示', 'cs_margin', status('duplicate:status', l.status, n.status));
  const beforeIds = (await batchesOf(sid.VW002, f('basic'))).map((b) => b.id);
  const n2 = await nativeClaim('cs_margin', 'claim-basic.xlsx', 'basic', { shots: [shot(7)], flags: { confirm_duplicate: '1' } });
  expect(n2.status).toBe(200);
  const after = (await batchesOf(sid.VW002, f('basic'))).map((b) => b.id);
  expect(after.length).toBe(beforeIds.length + 1);
  expect(after).toEqual(expect.arrayContaining(beforeIds));
});

test('D6：截圖張數、格式、大小限制（舊版沒有限制）。合法情境新舊都成功', async () => {
  const diffs: Diff[] = [];
  const cases: [string, ReturnType<typeof shots>][] = [
    ['eleven', shots(11)],
    ['gif', [shot(1, 'image/gif')]],
    ['big', [{ name: 'big.png', type: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) }]],
  ];
  for (const [tag, list] of cases) {
    const l = await legacyClaim('cs_margin', 'claim-clinic-b.xlsx', `d6-${tag}`, { shots: list });
    const n = await nativeClaim('cs_margin', 'claim-clinic-b.xlsx', `d6-${tag}`, { shots: list, flags: { confirm_duplicate: '1' } });
    expect(n.status, `${tag} 新版應擋下`).toBe(400);
    diffs.push(...status(`${tag}:status`, l.status, n.status));
  }
  const ok = [shot(1), shot(2, 'image/jpeg'), shot(3, 'image/webp')];
  const l = await legacyClaim('cs_margin', 'claim-clinic-b.xlsx', 'd6-ok', { shots: ok });
  const n = await nativeClaim('cs_margin', 'claim-clinic-b.xlsx', 'd6-ok', { shots: ok, flags: { confirm_duplicate: '1' } });
  expect([l.status, n.status]).toEqual([200, 200]);
  rec('import-screenshot-limits', '截圖限制（最多 10 張、png/jpeg/webp、每張 5MB 內）：舊版沒有限制，新版違規一律 400', 'cs_margin', diffs, { cases: 3 });
});

test('批次清單與明細：同一批次由舊版與新版讀取，明細、合計、截圖數相同；新舊互相能讀對方建立的批次', async () => {
  const diffs: Diff[] = [];
  const lb = (await rowOf('VW001', 'basic'))!;
  const nb = (await rowOf('VW002', 'basic'))!;
  // 舊版建立的批次（VW001）用新版讀、新版建立的批次（VW002）用舊版讀（舊頁在新版上線後仍要讀得到）
  for (const [id, label] of [[lb.id, 'legacy-made'], [nb.id, 'native-made']] as const) {
    const l = await send(apis.cs_margin, 'get', `${OLD}/batches/${id}`);
    const n = await send(apis.cs_margin, 'get', `${NEW}/batches/${id}`);
    expect([l.status, n.status], label).toEqual([200, 200]);
    diffs.push(...same(`${label}:items`, l.body.items.map(itemView), n.body.items.map(itemView)), ...same(`${label}:summary`, l.body.summary, n.body.summary), ...same(`${label}:shots`, l.body.screenshotUrls.length, n.body.screenshotUrls.length), ...same(`${label}:batch`, batchView(l.body.batch), batchView(n.body.batch)));
  }
  for (const store of ['VW001', 'VW002']) {
    const l = await send(apis.cs_margin, 'get', `${OLD}/batches`, { params: { store_id: sid[store], year_month: Y11 } });
    const n = await send(apis.cs_margin, 'get', `${NEW}/batches`, { params: { store_id: sid[store], year_month: Y11 } });
    const mine = (r: any[]) => r.filter((b) => b.clinic_code && String(b.clinic_code).startsWith('ZT')).map((b) => [b.id, b.year_month, b.clinic_code, Number(b.total_billing_amount), Number(b.total_gross_profit_amount), b.store_code]);
    diffs.push(...status(`list:${store}:status`, l.status, n.status), ...same(`list:${store}:rows`, mine(l.body.data), mine(n.body.batches)));
  }
  const miss = '00000000-0000-4000-8000-000000000000';
  diffs.push(...status('detail:missing', (await send(apis.cs_margin, 'get', `${OLD}/batches/${miss}`)).status, (await send(apis.cs_margin, 'get', `${NEW}/batches/${miss}`)).status));
  diffs.push(...status('detail:other-store', (await send(apis.cs_calc_b, 'get', `${OLD}/batches/${lb.id}`)).status, (await send(apis.cs_calc_b, 'get', `${NEW}/batches/${lb.id}`)).status));
  rec('batch-read', '批次清單與明細（含互相讀取對方建立的批次、找不到、別店）：新舊相同', 'cs_margin', diffs, { batches: 2 });
});

test('刪除批次：新舊都先刪截圖檔再刪資料列（明細一併）；互相能刪對方建立的批次；沒有權限者新舊都 403', async () => {
  const diffs: Diff[] = [];
  const lb = (await batchesOf(sid.VW001, f('single'))).pop()!;
  const nb = (await batchesOf(sid.VW002, f('single'))).pop()!;
  const lp = screenshotPaths(lb.screenshot_path), np = screenshotPaths(nb.screenshot_path);
  diffs.push(...status('delete:no-permission', (await send(apis.cs_calc_a, 'delete', `${OLD}/batches/${lb.id}`)).status, (await send(apis.cs_calc_a, 'delete', `${NEW}/batches/${nb.id}`)).status));
  // 舊版建立的批次由新版刪、新版建立的批次由舊版刪
  const dn = await send(apis.cs_margin, 'delete', `${NEW}/batches/${lb.id}`);
  const dl = await send(apis.cs_margin, 'delete', `${OLD}/batches/${nb.id}`);
  // cs_margin 沒有刪除權限（margin 不含刪批次）：兩邊都 403；改用 admin
  diffs.push(...status('delete:margin-no-delete', dl.status, dn.status));
  const dn2 = await send(apis.admin, 'delete', `${NEW}/batches/${lb.id}`);
  const dl2 = await send(apis.admin, 'delete', `${OLD}/batches/${nb.id}`);
  expect([dn2.status, dl2.status], JSON.stringify([dn2.body, dl2.body])).toEqual([200, 200]);
  for (const p of [...lp, ...np]) expect(await objectExists(p), `${p} 應已刪除`).toBe(false);
  diffs.push(...same('delete:rows-gone', [(await batchesOf(sid.VW001, f('single'))).length, (await batchesOf(sid.VW002, f('single'))).length], [0, 0]));
  diffs.push(...same('delete:items-gone', [(await itemsOf(lb.id)).length, (await itemsOf(nb.id)).length], [0, 0]));
  rec('batch-delete', '刪除批次（含互刪、截圖物件、明細、權限）：新舊相同', 'multi', diffs, { batches: 2 }, 'write-readback');
});

test('開帳與無資料月份的關帳：狀態碼與訊息新舊相同', async () => {
  const diffs: Diff[] = [];
  const l = await send(apis.cs_margin, 'post', `${OLD}/mappings/close`, { data: { store_id: sid.VW001, year_month: Y10 } });
  const n = await send(apis.cs_margin, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW002, year_month: Y10 } });
  diffs.push(...status('reopen:status', l.status, n.status), ...same('reopen:body', [l.body.action, l.body.isClosed], [n.body.action, n.body.isClosed]));
  const l2 = await send(apis.cs_margin, 'post', `${OLD}/mappings/close`, { data: { store_id: sid.VW001, year_month: '2039-06' } });
  const n2 = await send(apis.cs_margin, 'post', `${NEW}/mappings/close`, { data: { store_id: sid.VW002, year_month: '2039-06' } });
  diffs.push(...status('empty-month:status', l2.status, n2.status), ...same('empty-month:error', l2.body.error, n2.body.error));
  const l3 = await send(apis.cs_margin, 'post', `${OLD}/mappings/close`, { data: { store_id: '', year_month: Y10 } });
  const n3 = await send(apis.cs_margin, 'post', `${NEW}/mappings/close`, { data: { store_id: '', year_month: Y10 } });
  diffs.push(...status('bad-input:status', l3.status, n3.status));
  rec('close-month', '開帳、沒有主檔資料的月份、錯誤參數：新舊相同', 'cs_margin', diffs, { cases: 3 });
});
