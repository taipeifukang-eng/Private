import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { anonClient } from '../support/m7m8-po-fixtures';
import { ga6Name, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { computeAnomaly, shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

// M7/M8 第 6 批 G23（資料庫層）整合：ga_ws_ub_list／get／save／anomaly／pay／unpay／delete／report／stores。
// 涵蓋：權限矩陣（水電管理、水電檢視、總務全套、店長、只有分類區域、廠商管理、舊式管理員、無關權限、未登入）、輸入驗證 400、版本檢查（缺少 400、不符 409 STALE）、重複帳單白話並指出既有那一筆、
//      金額異常基準（歷史 0／1／2／3／4 筆、雙月、排除自己與 0 元、恰好 2 倍與一半不提醒、與 TS 規則逐筆對照）、標記已繳日期範圍與冪等、改回待繳確認、已繳改金額二次確認、刪除原因與軟刪除、已刪除檢視、
//      逾期定義與摘要（不受篩選與筆數上限影響）、報表（全部啟用門市、其他據點正規化、不含已刪除）、service_role 直接寫入被觸發器擋下（所以寫入一定走函式）。
// 測試資料：供應商名稱帶 QA-GA6- 標記、只用 VW／ZT 測試門市；歷史月份用 2038（不可標記已繳，因為不可選未來），標記已繳與逾期的案例用過去月份；結束只清自己的（cleanupM7M8）。與其他整合檔一樣循序執行。
test.describe.configure({ mode: 'serial' });

const KEYS: Ga6Key[] = ['util_mgr', 'util_view', 'ga_all', 'store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let st: Awaited<ReturnType<typeof stores>>;
let seq = 0;
const db = () => adminDb();
const fn = (who: Ga6Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const today = taipeiToday();
const THIS_MONTH = `${today.slice(0, 7)}-01`;
const PAST = shiftMonth(THIS_MONTH, -5); // 標記已繳類案例用：5 個月前（最早可選 6 個月前的 1 日，最晚今天）
const ident = (s = 'I') => `QA-GA6-${String((seq += 1)).padStart(4, '0')}-${s}`;
const provider = () => ga6Name('P');
const day = (offset: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

/** 新增或編輯一筆帳單的 payload；預設是 VW001、水費、2038-05、帶標記供應商與唯一識別號碼。 */
const payload = (over: Record<string, unknown> = {}) => ({ store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-05', provider_name: provider(), service_identifier: ident(), amount: 1000, ...over });
const save = (who: Ga6Key, p: Record<string, unknown>, id: string | null = null, expected: string | null = null, confirm = false) =>
  fn(who, 'ga_ws_ub_save', { p_id: id, p_payload: p, p_expected_updated_at: expected, p_confirm_paid_change: confirm });
async function mk(over: Record<string, unknown> = {}, who: Ga6Key = 'util_mgr') {
  const r = await save(who, payload(over));
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
}
const dbRow = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).maybeSingle()).data as any;
const get = async (id: string) => (await fn('util_mgr', 'ga_ws_ub_get', { p_id: id })).data as any;
const list = (filters: Record<string, unknown> = {}, page = 1, size = 20, who: Ga6Key = 'util_mgr') => fn(who, 'ga_ws_ub_list', { p_filters: filters, p_page: page, p_page_size: size });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  const a = await cleanupM7M8();
  const b = await teardownUsers();
  const rest = [...a, ...b];
  if (rest.length) throw new Error(`清除殘留：${rest.join('; ')}`);
});

test('權限矩陣：水電管理與總務全套可讀寫；水電檢視只能讀（寫入 403）；店長、只有分類區域、廠商管理、舊式管理員、無關權限全部 403；未登入被擋', async () => {
  const b = await mk();
  const reads: Array<[string, Record<string, unknown>]> = [
    ['ga_ws_ub_list', { p_filters: {}, p_page: 1, p_page_size: 5 }], ['ga_ws_ub_get', { p_id: b.id }], ['ga_ws_ub_stores', {}], ['ga_ws_ub_report', { p_mode: 'year', p_year: 2039, p_period: null }],
  ];
  const writes: Array<[string, Record<string, unknown>]> = [
    ['ga_ws_ub_save', { p_id: null, p_payload: payload(), p_expected_updated_at: null, p_confirm_paid_change: false }],
    ['ga_ws_ub_anomaly', { p_payload: payload(), p_exclude_id: null }],
    ['ga_ws_ub_pay', { p_id: b.id, p_paid_at: null, p_expected_updated_at: b.updated_at }],
    ['ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: b.updated_at }],
    ['ga_ws_ub_delete', { p_id: b.id, p_reason: '權限測試', p_confirm_paid_change: false, p_expected_updated_at: b.updated_at }],
  ];
  for (const who of ['util_mgr', 'util_view', 'ga_all'] as Ga6Key[]) for (const [name, args] of reads) { const r = await fn(who, name, args); expect(r.ok, `${who} ${name} ${JSON.stringify(r)}`).toBe(true); }
  for (const who of ['util_mgr', 'ga_all'] as Ga6Key[]) expect((await fn(who, 'ga_ws_ub_anomaly', writes[1][1])).ok, `${who} anomaly`).toBe(true);
  for (const [name, args] of writes) {
    const r = await fn('util_view', name, args);
    expect(r, `util_view ${name}`).toMatchObject({ ok: false, status: 403, code: 'PERMISSION_DENIED' });
  }
  for (const who of ['store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody'] as Ga6Key[]) {
    for (const [name, args] of [...reads, ...writes]) expect(await fn(who, name, args), `${who} ${name}`).toMatchObject({ ok: false, status: 403, code: 'PERMISSION_DENIED' });
  }
  // 沒有任何被擋下的寫入動到資料
  expect(await dbRow(b.id)).toMatchObject({ deleted_at: null, paid_at: null, updated_at: b.updated_at });
  const anon = anonClient();
  for (const [name, args] of [...reads, ...writes]) {
    const r = await anon.rpc(name, args);
    expect(r.error, `anon ${name}`).toBeTruthy();
  }
});

test('service_role 直接寫入資料表被觸發器擋下（AUTH_REQUIRED），所以新版寫入一律走函式；店長與只有水電檢視者直連資料表也寫不進去', async () => {
  const direct = await db().from('ga_utility_bills').insert({ location_name: 'QA-GA6 直接寫入', expense_type: 'WATER', billing_month: '2038-01-01', provider_name: provider(), service_identifier: ident(), amount: 1 });
  expect(direct.error?.message || '').toMatch(/AUTH_REQUIRED/);
  for (const who of ['util_view', 'store_mgr'] as Ga6Key[]) {
    const r = await (users[who].client as any).from('ga_utility_bills').insert({ location_name: 'QA-GA6 直接寫入', expense_type: 'WATER', billing_month: '2038-01-01', provider_name: provider(), service_identifier: ident(), amount: 1 });
    expect(r.error, who).toBeTruthy();
  }
});

test('新增驗證 400：費用類型、月份、金額、據點、識別號碼、日期、長度；全部失敗都沒有寫入', async () => {
  const before = (await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).like('provider_name', 'QA-GA6-%')).count;
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['沒有類型', payload({ expense_type: null }), 'TYPE_REQUIRED'], ['類型錯誤', payload({ expense_type: 'GAS' }), 'TYPE_REQUIRED'],
    ['沒有月份', payload({ billing_month: null }), 'MONTH_REQUIRED'], ['月份格式', payload({ billing_month: '2038/05' }), 'MONTH_FORMAT'], ['月份 13', payload({ billing_month: '2038-13' }), 'MONTH_FORMAT'],
    ['沒有金額', payload({ amount: null }), 'AMOUNT_REQUIRED'], ['負金額', payload({ amount: -1 }), 'AMOUNT_FORMAT'], ['文字金額', payload({ amount: '12abc' }), 'AMOUNT_FORMAT'], ['金額太大', payload({ amount: 1e12 }), 'AMOUNT_TOO_LARGE'],
    ['沒有據點', payload({ store_id: null, location_name: null }), 'LOCATION_REQUIRED'], ['門市不存在', payload({ store_id: '00000000-0000-4000-8000-000000000000' }), 'STORE_NOT_FOUND'], ['門市格式', payload({ store_id: 'abc' }), 'STORE_FORMAT'],
    ['沒有識別號碼', payload({ service_identifier: null }), 'IDENT_REQUIRED'], ['網路費兩個都沒有', payload({ expense_type: 'INTERNET', service_identifier: null, equipment_serial: null }), 'IDENT_REQUIRED'],
    ['到期日格式', payload({ due_date: '2038/06/01' }), 'DATE_FORMAT'], ['到期日不存在', payload({ due_date: '2038-02-30' }), 'DATE_FORMAT'],
    ['備註太長', payload({ notes: 'x'.repeat(1001) }), 'FIELD_TOO_LONG'], ['欄位型別', payload({ provider_name: { a: 1 } }), 'FIELD_TYPE'],
  ];
  for (const [label, p, code] of cases) {
    const r = await save('util_mgr', p);
    expect(r, label).toMatchObject({ ok: false, status: 400, code });
    expect(String(r.error).length, label).toBeGreaterThan(2);
  }
  expect(await save('util_mgr', 'not-object' as any)).toMatchObject({ ok: false, status: 400 });
  expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).like('provider_name', 'QA-GA6-%')).count).toBe(before);
});

test('新增：回讀資料庫欄位、門市同步據點名稱、月份正規化、電度與設備序號只留給對應類型、建立者與最後修改者', async () => {
  const r = await save('util_mgr', payload({ billing_month: '2038-05-17', expense_type: 'WATER', electricity_kwh: 300, equipment_serial: 'SN-X', amount: '1234.567', notes: '  備註  ', reference_no: ' R1 ' }));
  expect(r).toMatchObject({ ok: true, status: 201 });
  const row = await dbRow(r.data.id);
  expect(row).toMatchObject({ store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-05-01', created_by: users.util_mgr.id, updated_by: users.util_mgr.id, deleted_at: null, paid_at: null });
  expect(Number(row.amount)).toBe(1234.57);
  expect(row.electricity_kwh).toBeNull();
  expect(row.equipment_serial).toBeNull();
  expect(row.notes).toBe('備註');
  expect(row.reference_no).toBe('R1');
  expect(row.location_name).toMatch(/^VW001 /);
  expect(r.data).toMatchObject({ status: 'unpaid', overdue: false, created_by_name: expect.any(String) });
  const e = await save('util_mgr', payload({ expense_type: 'ELECTRICITY', electricity_kwh: 321.5 }));
  expect(Number((await dbRow(e.data.id)).electricity_kwh)).toBe(321.5);
  const n = await save('util_mgr', payload({ expense_type: 'INTERNET', service_identifier: null, equipment_serial: 'SN-Q-' + ident() }));
  expect(n.ok).toBe(true);
  expect((await dbRow(n.data.id)).equipment_serial).toMatch(/^SN-Q-/);
  const other = await save('util_mgr', payload({ store_id: null, location_name: '  QA-GA6 其他據點  ' }));
  expect(other.ok).toBe(true);
  expect(await dbRow(other.data.id)).toMatchObject({ store_id: null, location_name: 'QA-GA6 其他據點' });
});

test('重複帳單：白話訊息指出既有那一筆；供應商與識別號碼不分大小寫與前後空白；已刪除的不擋；編輯成重複也擋；資料不變', async () => {
  const id1 = ident('D');
  const a = await mk({ service_identifier: id1, amount: 4321, due_date: '2038-06-20' });
  const dup = await save('util_mgr', payload({ service_identifier: `  ${id1.toLowerCase()} `, provider_name: ` ${provider().toLowerCase()} `, amount: 99 }));
  expect(dup).toMatchObject({ ok: false, status: 409, code: 'DUPLICATE_BILL', existing: { id: a.id, amount: 4321 } });
  expect(dup.error).toContain('已經有一筆帳單');
  expect(dup.error).toContain('4,321');
  expect(dup.error).toContain('2038-06-20');
  // 不同月份、不同門市、不同供應商、不同類型都不算重複
  for (const over of [{ billing_month: '2038-06' }, { store_id: st.VW002.id }, { provider_name: ga6Name('Q') }, { expense_type: 'PHONE' }]) expect((await save('util_mgr', payload({ service_identifier: id1, ...over }))).ok, JSON.stringify(over)).toBe(true);
  // 刪除後同鍵可再建
  const del = await fn('util_mgr', 'ga_ws_ub_delete', { p_id: a.id, p_reason: '重建測試', p_confirm_paid_change: false, p_expected_updated_at: a.updated_at });
  expect(del.ok).toBe(true);
  expect((await save('util_mgr', payload({ service_identifier: id1, amount: 5 }))).ok).toBe(true);
  // 編輯成與另一筆重複
  const x = await mk({ service_identifier: ident('E1') });
  const y = await mk({ service_identifier: ident('E2') });
  const bad = await save('util_mgr', { service_identifier: x.service_identifier }, y.id, y.updated_at);
  expect(bad).toMatchObject({ ok: false, status: 409, code: 'DUPLICATE_BILL', existing: { id: x.id } });
  expect((await dbRow(y.id)).service_identifier).toBe(y.service_identifier);
});

test('金額異常：歷史 0／1／2／3／4 筆、雙月、排除自己與 0 元、恰好 2 倍與一半不提醒、本筆 0 元提醒；SQL 與 TS 規則逐筆對照', async () => {
  const anomaly = async (key: string, month: string, amount: number, excludeId: string | null = null) =>
    (await fn('util_mgr', 'ga_ws_ub_anomaly', { p_payload: payload({ service_identifier: key, billing_month: month, amount }), p_exclude_id: excludeId })).data as any;
  const seedHist = async (key: string, hist: Array<[string, number]>) => { for (const [m, a] of hist) await mk({ service_identifier: key, billing_month: m, amount: a }); };
  const scenarios: Array<{ hist: Array<[string, number]>; month: string; amount: number }> = [
    { hist: [], month: '2038-05', amount: 99999 },
    { hist: [], month: '2038-05', amount: 0 },
    { hist: [['2038-04', 1000]], month: '2038-05', amount: 2500 },
    { hist: [['2038-04', 1000], ['2038-03', 2000]], month: '2038-05', amount: 600 },
    { hist: [['2038-04', 900], ['2038-03', 1000], ['2038-02', 1100]], month: '2038-05', amount: 1000 },
    { hist: [['2038-01', 9000], ['2038-02', 1000], ['2038-03', 1000], ['2038-04', 1000]], month: '2038-05', amount: 1000 },
    { hist: [['2038-01', 600], ['2038-03', 800], ['2038-05', 1000], ['2038-07', 5000]], month: '2038-09', amount: 3000 },
    { hist: [['2038-04', 1000], ['2038-03', 1000], ['2038-02', 1000]], month: '2038-05', amount: 2000 },
    { hist: [['2038-04', 1000], ['2038-03', 1000], ['2038-02', 1000]], month: '2038-05', amount: 2000.01 },
    { hist: [['2038-04', 1000], ['2038-03', 1000], ['2038-02', 1000]], month: '2038-05', amount: 500 },
    { hist: [['2038-04', 1000], ['2038-03', 1000], ['2038-02', 1000]], month: '2038-05', amount: 499.99 },
    { hist: [['2038-04', 1000], ['2038-03', 1000], ['2038-02', 1000]], month: '2038-05', amount: 0 },
    { hist: [['2038-04', 0], ['2038-03', 1000], ['2038-05', 7777]], month: '2038-05', amount: 1200 },
    { hist: [['2038-04', 1200], ['2038-03', 1300], ['2038-02', 1100]], month: '2038-05', amount: 12000 },
  ];
  for (const [i, sc] of scenarios.entries()) {
    const key = ident(`A${i}`);
    await seedHist(key, sc.hist);
    const sql = await anomaly(key, sc.month, sc.amount);
    const ts = computeAnomaly(sc.hist.map(([m, a]) => ({ billing_month: `${m}-01`, amount: a })), { billing_month: `${sc.month}-01`, amount: sc.amount });
    expect({ warn: sql.warn, reason: sql.reason, baseline: sql.baseline === null ? null : Number(sql.baseline), n: sql.sample_count, partial: sql.partial }, `情境 ${i}`)
      .toEqual({ warn: ts.warn, reason: ts.reason, baseline: ts.baseline, n: ts.sample_count, partial: ts.partial });
    expect(sql.samples.map((s: any) => [String(s.billing_month).slice(0, 7), Number(s.amount)]), `情境 ${i} 明細`).toEqual(ts.samples.map((s) => [s.billing_month.slice(0, 7), s.amount]));
    if (sql.warn) expect(String(sql.message).length).toBeGreaterThan(5);
  }
  // 儲存時回提醒但仍已存；提醒文字附基準金額
  const key = ident('S');
  await seedHist(key, [['2038-02', 1200], ['2038-03', 1300], ['2038-04', 1100]]);
  const saved = await save('util_mgr', payload({ service_identifier: key, billing_month: '2038-05', amount: 12000 }));
  expect(saved).toMatchObject({ ok: true, status: 201 });
  expect(saved.warnings).toHaveLength(1);
  expect(saved.warnings[0]).toMatchObject({ code: 'AMOUNT_ANOMALY', reason: 'HIGH', baseline: 1200, sample_count: 3 });
  expect(saved.warnings[0].message).toContain('1,200');
  expect(Number((await dbRow(saved.data.id)).amount)).toBe(12000);
  // 編輯自己時排除自己：把這筆改成 1200 後不再提醒；改成 0 提醒 ZERO
  const fixed = await save('util_mgr', { amount: 1200 }, saved.data.id, saved.data.updated_at);
  expect(fixed).toMatchObject({ ok: true, warnings: [] });
  const zero = await save('util_mgr', { amount: 0 }, saved.data.id, fixed.data.updated_at);
  expect(zero.warnings[0]).toMatchObject({ reason: 'ZERO' });
  // 不同據點、類型或識別號碼的帳單不混進基準
  const key2 = ident('X');
  await mk({ service_identifier: key2, billing_month: '2038-04', amount: 100, store_id: st.VW002.id });
  await mk({ service_identifier: key2, billing_month: '2038-04', amount: 100, expense_type: 'PHONE' });
  const mixed = await anomaly(key2, '2038-05', 9999);
  expect(mixed).toMatchObject({ warn: false, sample_count: 0 });
});

test('編輯：版本檢查（缺少 400、舊版本 409 STALE）、沒帶的欄位維持原值、最後修改者是編輯的人、換門市同步據點名稱、不能用編輯清空已繳日期', async () => {
  const b = await mk({ notes: '原備註', due_date: '2038-06-10' });
  expect(await save('util_mgr', { notes: 'x' }, b.id, null)).toMatchObject({ ok: false, status: 400, code: 'EXPECTED_REQUIRED' });
  const ok = await save('ga_all', { notes: '新備註', store_id: st.VW002.id }, b.id, b.updated_at);
  expect(ok).toMatchObject({ ok: true, status: 200 });
  const row = await dbRow(b.id);
  expect(row).toMatchObject({ notes: '新備註', store_id: st.VW002.id, due_date: '2038-06-10', updated_by: users.ga_all.id, created_by: users.util_mgr.id });
  expect(Number(row.amount)).toBe(1000);
  expect(row.location_name).toMatch(/^VW002 /);
  expect(ok.data.updated_by_name).toBeTruthy();
  expect(await save('util_mgr', { notes: '舊版本' }, b.id, b.updated_at)).toMatchObject({ ok: false, status: 409, code: 'STALE' });
  expect((await dbRow(b.id)).notes).toBe('新備註');
  expect(await save('util_mgr', { notes: 'x' }, '00000000-0000-4000-8000-000000000000', ok.data.updated_at)).toMatchObject({ ok: false, status: 404 });
  // 清空欄位（送 null）會清掉；沒帶的維持
  const cleared = await save('util_mgr', { due_date: null }, b.id, ok.data.updated_at);
  expect((await dbRow(b.id))).toMatchObject({ due_date: null, notes: '新備註' });
  expect(cleared.ok).toBe(true);
});

test('已停用門市的舊帳單：編輯時保留原門市與名稱；不能新選停用門市（臨時停用 ZT05，結束還原）', async () => {
  const flip = async (active: boolean) => { const r = await db().from('stores').update({ is_active: active }).eq('id', st.ZT05.id); expect(r.error).toBeNull(); };
  const b = await mk({ store_id: st.ZT05.id });
  const label = (await dbRow(b.id)).location_name as string;
  try {
    await flip(false);
    const keep = await save('util_mgr', { notes: '停用門市也能編輯' }, b.id, b.updated_at);
    expect(keep.ok, JSON.stringify(keep)).toBe(true);
    expect(await dbRow(b.id)).toMatchObject({ store_id: st.ZT05.id, location_name: label, notes: '停用門市也能編輯' });
    expect(await save('util_mgr', payload({ store_id: st.ZT05.id }))).toMatchObject({ ok: false, status: 400, code: 'STORE_INACTIVE' });
    const stores1 = await fn('util_mgr', 'ga_ws_ub_stores', {});
    expect(stores1.data.map((s: any) => s.id)).not.toContain(st.ZT05.id);
  } finally {
    await flip(true);
  }
  expect((await fn('util_mgr', 'ga_ws_ub_stores', {})).data.map((s: any) => s.id)).toContain(st.ZT05.id);
});

test('標記已繳：預設台北今天、可選日期；不可未來、不可早於帳單月份前 1 個月（邊界）；冪等；已繳換日期 409；版本檢查', async () => {
  const b = await mk({ billing_month: PAST.slice(0, 7), due_date: day(-3) });
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: null, p_expected_updated_at: null })).toMatchObject({ ok: false, status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: day(1), p_expected_updated_at: b.updated_at })).toMatchObject({ ok: false, status: 400, code: 'PAID_FUTURE' });
  const earliest = shiftMonth(PAST, -1);
  const dayBefore = new Date(`${earliest}T00:00:00Z`); dayBefore.setUTCDate(0);
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: dayBefore.toISOString().slice(0, 10), p_expected_updated_at: b.updated_at })).toMatchObject({ ok: false, status: 400, code: 'PAID_TOO_EARLY' });
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: '2038-13-01', p_expected_updated_at: b.updated_at })).toMatchObject({ ok: false, status: 400, code: 'DATE_FORMAT' });
  expect((await dbRow(b.id)).paid_at).toBeNull();
  // 邊界：最早那天可、今天可
  const earliestOk = await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: earliest, p_expected_updated_at: b.updated_at });
  expect(earliestOk, JSON.stringify(earliestOk)).toMatchObject({ ok: true });
  expect((await dbRow(b.id)).paid_at).toBe(earliest);
  expect(earliestOk.data).toMatchObject({ status: 'paid', paid_at: earliest, updated_by_name: expect.any(String) });
  // 冪等：同一天再標一次成功且不改版本；換日期要用編輯
  const again = await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: earliest, p_expected_updated_at: b.updated_at });
  expect(again).toMatchObject({ ok: true, noop: true });
  expect((await dbRow(b.id)).updated_at).toBe(earliestOk.data.updated_at);
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: today, p_expected_updated_at: earliestOk.data.updated_at })).toMatchObject({ ok: false, status: 409, code: 'ALREADY_PAID' });
  // 預設今天
  const c = await mk({ billing_month: PAST.slice(0, 7) });
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: c.id, p_paid_at: null, p_expected_updated_at: 'invalid' as any })).toMatchObject({ ok: false });
  const stale = await fn('util_mgr', 'ga_ws_ub_pay', { p_id: c.id, p_paid_at: null, p_expected_updated_at: '2000-01-01T00:00:00Z' });
  expect(stale).toMatchObject({ ok: false, status: 409, code: 'STALE' });
  const paid = await fn('ga_all', 'ga_ws_ub_pay', { p_id: c.id, p_paid_at: null, p_expected_updated_at: c.updated_at });
  expect(paid.ok).toBe(true);
  expect((await dbRow(c.id)).paid_at).toBe(today);
  expect((await dbRow(c.id)).updated_by).toBe(users.ga_all.id);
  // 2038 的帳單（未來月份）不能標記已繳（最早日期在未來）
  const future = await mk({ billing_month: '2038-05' });
  const f = await fn('util_mgr', 'ga_ws_ub_pay', { p_id: future.id, p_paid_at: today, p_expected_updated_at: future.updated_at });
  expect(f.ok).toBe(false);
  expect(['PAID_TOO_EARLY', 'PAID_FUTURE']).toContain(f.code);
});

test('改回待繳：要確認並回原繳費日期；確認後清除日期；本來就待繳＝冪等；版本檢查', async () => {
  const b = await mk({ billing_month: PAST.slice(0, 7) });
  const paid = await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: today, p_expected_updated_at: b.updated_at });
  const need = await fn('util_mgr', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: false, p_expected_updated_at: paid.data.updated_at });
  expect(need).toMatchObject({ ok: false, status: 409, code: 'UNPAY_CONFIRM_REQUIRED', paid_at: today });
  expect(need.error).toContain(today);
  expect((await dbRow(b.id)).paid_at).toBe(today);
  expect(await fn('util_mgr', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: null })).toMatchObject({ ok: false, status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await fn('util_mgr', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: b.updated_at })).toMatchObject({ ok: false, status: 409, code: 'STALE' });
  const done = await fn('util_mgr', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: paid.data.updated_at });
  expect(done).toMatchObject({ ok: true });
  expect((await dbRow(b.id)).paid_at).toBeNull();
  expect(await fn('util_mgr', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: done.data.updated_at })).toMatchObject({ ok: true, noop: true });
});

test('已繳帳單改金額或識別欄位要二次確認並回原值；改備註或到期日不用；可修正繳費日期；不能用編輯清空繳費日期', async () => {
  const b = await mk({ billing_month: PAST.slice(0, 7), amount: 1500 });
  const paid = (await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: today, p_expected_updated_at: b.updated_at })).data;
  const need = await save('util_mgr', { amount: 1800 }, b.id, paid.updated_at);
  expect(need).toMatchObject({ ok: false, status: 409, code: 'PAID_CHANGE_CONFIRM_REQUIRED', changed_fields: ['amount'], original: { amount: 1500, paid_at: today } });
  expect(Number((await dbRow(b.id)).amount)).toBe(1500);
  for (const [over, field] of [[{ service_identifier: ident('C') }, 'identifier'], [{ store_id: st.VW002.id }, 'location'], [{ expense_type: 'PHONE' }, 'expense_type'], [{ billing_month: shiftMonth(PAST, -1).slice(0, 7) }, 'billing_month'], [{ provider_name: ga6Name('ZZ') }, 'provider_name']] as const) {
    const r = await save('util_mgr', over as any, b.id, paid.updated_at);
    expect(r, field).toMatchObject({ ok: false, status: 409, code: 'PAID_CHANGE_CONFIRM_REQUIRED' });
    expect(r.changed_fields, field).toContain(field);
  }
  const free = await save('util_mgr', { notes: '只改備註', due_date: '2038-12-31' }, b.id, paid.updated_at);
  expect(free.ok, JSON.stringify(free)).toBe(true);
  expect(await save('util_mgr', { paid_at: null }, b.id, free.data.updated_at)).toMatchObject({ ok: false, status: 400, code: 'USE_UNPAY' });
  const fixDate = await save('util_mgr', { paid_at: shiftMonth(PAST, -1) }, b.id, free.data.updated_at);
  expect(fixDate.ok, JSON.stringify(fixDate)).toBe(true);
  expect((await dbRow(b.id)).paid_at).toBe(shiftMonth(PAST, -1));
  const confirmed = await save('util_mgr', { amount: 1800 }, b.id, fixDate.data.updated_at, true);
  expect(confirmed.ok).toBe(true);
  expect(Number((await dbRow(b.id)).amount)).toBe(1800);
  expect((await dbRow(b.id)).paid_at).toBe(shiftMonth(PAST, -1));
  // 未繳帳單改金額不用確認
  const u = await mk({ amount: 10 });
  expect((await save('util_mgr', { amount: 20 }, u.id, u.updated_at)).ok).toBe(true);
});

test('刪除：原因必填；已繳帳單要確認並回原值；軟刪除記下誰、何時、為何；預設列表看不到、已刪除檢視看得到；冪等；已刪除不能編輯或標記；版本檢查', async () => {
  const b = await mk({ amount: 777 });
  expect(await fn('util_mgr', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '  ', p_confirm_paid_change: false, p_expected_updated_at: b.updated_at })).toMatchObject({ ok: false, status: 400, code: 'REASON_REQUIRED' });
  expect(await fn('util_mgr', 'ga_ws_ub_delete', { p_id: b.id, p_reason: 'x'.repeat(501), p_confirm_paid_change: false, p_expected_updated_at: b.updated_at })).toMatchObject({ ok: false, status: 400, code: 'REASON_TOO_LONG' });
  expect(await fn('util_mgr', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '原因', p_confirm_paid_change: false, p_expected_updated_at: null })).toMatchObject({ ok: false, status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await fn('util_mgr', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '原因', p_confirm_paid_change: false, p_expected_updated_at: '2000-01-01T00:00:00Z' })).toMatchObject({ ok: false, status: 409, code: 'STALE' });
  expect((await dbRow(b.id)).deleted_at).toBeNull();
  const gone = await fn('ga_all', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '  重複登錄  ', p_confirm_paid_change: false, p_expected_updated_at: b.updated_at });
  expect(gone).toMatchObject({ ok: true, data: { status: 'deleted', deletion_reason: '重複登錄' } });
  expect(await dbRow(b.id)).toMatchObject({ deleted_by: users.ga_all.id, deletion_reason: '重複登錄' });
  expect((await dbRow(b.id)).deleted_at).toBeTruthy();
  // 預設列表看不到、已刪除檢視看得到（誰、何時、為何）
  const live = await list({ search: b.service_identifier });
  expect(live.data.rows).toHaveLength(0);
  const view = await list({ search: b.service_identifier, deleted: true });
  expect(view.data.rows).toHaveLength(1);
  expect(view.data.rows[0]).toMatchObject({ id: b.id, status: 'deleted', deletion_reason: '重複登錄', deleted_by_name: expect.any(String) });
  // 冪等與後續動作
  expect(await fn('util_mgr', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '再刪', p_confirm_paid_change: false, p_expected_updated_at: null })).toMatchObject({ ok: true, noop: true });
  expect((await dbRow(b.id)).deletion_reason).toBe('重複登錄');
  expect(await save('util_mgr', { notes: 'x' }, b.id, gone.data.updated_at)).toMatchObject({ ok: false, status: 409, code: 'DELETED' });
  expect(await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: null, p_expected_updated_at: gone.data.updated_at })).toMatchObject({ ok: false, status: 409, code: 'DELETED' });
  expect((await fn('util_view', 'ga_ws_ub_get', { p_id: b.id })).data).toMatchObject({ status: 'deleted' });
  // 已繳帳單刪除要確認
  const p = await mk({ billing_month: PAST.slice(0, 7), amount: 4242 });
  const paid = (await fn('util_mgr', 'ga_ws_ub_pay', { p_id: p.id, p_paid_at: today, p_expected_updated_at: p.updated_at })).data;
  const need = await fn('util_mgr', 'ga_ws_ub_delete', { p_id: p.id, p_reason: '刪除已繳', p_confirm_paid_change: false, p_expected_updated_at: paid.updated_at });
  expect(need).toMatchObject({ ok: false, status: 409, code: 'PAID_CHANGE_CONFIRM_REQUIRED', original: { amount: 4242, paid_at: today } });
  expect((await dbRow(p.id)).deleted_at).toBeNull();
  expect((await fn('util_mgr', 'ga_ws_ub_delete', { p_id: p.id, p_reason: '刪除已繳', p_confirm_paid_change: true, p_expected_updated_at: paid.updated_at })).ok).toBe(true);
  expect((await dbRow(p.id)).deleted_at).toBeTruthy();
  // 資料列保留（只標記，不實體刪除）
  expect(await dbRow(b.id)).toBeTruthy();
});

test('逾期與摘要：到期當天不逾期、前一天逾期、沒有到期日永不逾期、已繳與已刪除不逾期；待繳與逾期摘要不受月份、類型、據點篩選與分頁影響（與資料庫逐筆核對）', async () => {
  const key = ident('O');
  const mkO = (over: Record<string, unknown>) => mk({ service_identifier: ident('O'), billing_month: PAST.slice(0, 7), ...over });
  const dueToday = await mkO({ due_date: today });
  const dueYesterday = await mkO({ due_date: day(-1), amount: 111 });
  const noDue = await mkO({ due_date: null, amount: 222 });
  const farOld = await mkO({ due_date: day(-400), billing_month: shiftMonth(PAST, -9).slice(0, 7), store_id: st.VW002.id, expense_type: 'PHONE', amount: 333 });
  const paidOld = await mkO({ due_date: day(-30) });
  await fn('util_mgr', 'ga_ws_ub_pay', { p_id: paidOld.id, p_paid_at: today, p_expected_updated_at: paidOld.updated_at });
  const deleted = await mkO({ due_date: day(-30) });
  await fn('util_mgr', 'ga_ws_ub_delete', { p_id: deleted.id, p_reason: '測試', p_confirm_paid_change: false, p_expected_updated_at: deleted.updated_at });
  void key;
  const status = async (id: string) => (await get(id)).status;
  expect(await status(dueToday.id)).toBe('unpaid');
  expect(await status(dueYesterday.id)).toBe('overdue');
  expect(await status(noDue.id)).toBe('unpaid');
  expect(await status(farOld.id)).toBe('overdue');
  expect(await status(paidOld.id)).toBe('paid');
  expect(await status(deleted.id)).toBe('deleted');
  // 摘要與資料庫逐筆核對（全表，不是只有本次測試的帳單）
  const all = ((await db().from('ga_utility_bills').select('amount,paid_at,due_date,deleted_at').is('deleted_at', null).is('paid_at', null)).data || []) as any[];
  const pending = all.length;
  const overdue = all.filter((r) => r.due_date && r.due_date < today);
  const noDueN = all.filter((r) => !r.due_date).length;
  const base = await list({}, 1, 1);
  expect(base.data.global).toMatchObject({ today, pending_count: pending, overdue_count: overdue.length, no_due_count: noDueN });
  expect(Number(base.data.global.overdue_amount)).toBeCloseTo(overdue.reduce((s, r) => s + Number(r.amount), 0), 2);
  expect(Number(base.data.global.pending_amount)).toBeCloseTo(all.reduce((s, r) => s + Number(r.amount), 0), 2);
  // 不受月份、類型、據點與分頁影響；篩選結果合計照篩選
  for (const f of [{ month: PAST.slice(0, 7) }, { type: 'PHONE' }, { store_id: st.VW002.id }, { month: '2000-01', type: 'WATER', store_id: st.ZT01.id }, { status: 'paid' }]) {
    const r = await list(f, 1, 1);
    expect(r.data.global, JSON.stringify(f)).toMatchObject({ pending_count: pending, overdue_count: overdue.length, no_due_count: noDueN });
  }
  const phone = await list({ type: 'PHONE', search: farOld.service_identifier }, 1, 20);
  expect(phone.data.summary).toMatchObject({ count: 1, unpaid_count: 1 });
  expect(Number(phone.data.summary.total_amount)).toBe(333);
  // 逾期篩選與全表逾期筆數一致（徽章與列表同一個述詞）
  const od = await list({ overdue: true }, 1, 100);
  expect(od.data.total).toBe(overdue.length);
  expect(od.data.rows.every((r: any) => r.status === 'overdue')).toBe(true);
  expect((await list({ status: 'no_due' }, 1, 100)).data.total).toBe(noDueN);
  expect((await list({ status: 'overdue' })).data.total).toBe(overdue.length);
  expect((await list({ status: 'unpaid' })).data.total).toBe(pending);
});

test('列表：篩選、搜尋、排序與分頁精確；超過 100 筆仍完整（不受 500 筆上限）；錯誤篩選值 400', async () => {
  const month = '2038-09';
  const tag = ident('L');
  const made: string[] = [];
  const batch = Array.from({ length: 125 }, (_, i) => i);
  for (let i = 0; i < batch.length; i += 12) {
    await Promise.all(batch.slice(i, i + 12).map(async (n) => {
      const r = await save('util_mgr', payload({ billing_month: month, service_identifier: `${tag}-${n}`, amount: 10 + n, store_id: n % 2 ? st.VW002.id : st.VW001.id, expense_type: n % 5 === 0 ? 'PHONE' : 'WATER' }));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      made.push(r.data.id);
    }));
  }
  const all = await list({ month, search: tag }, 1, 100);
  expect(all.data.total).toBe(125);
  expect(all.data.rows).toHaveLength(100);
  const p2 = await list({ month, search: tag }, 2, 100);
  expect(p2.data.rows).toHaveLength(25);
  const ids = new Set([...all.data.rows, ...p2.data.rows].map((r: any) => r.id));
  expect(ids.size).toBe(125);
  expect(all.data.summary.count).toBe(125);
  expect(Number(all.data.summary.total_amount)).toBe(Array.from({ length: 125 }, (_, n) => 10 + n).reduce((a, b) => a + b, 0));
  expect((await list({ month, search: tag, type: 'PHONE' })).data.total).toBe(25);
  expect((await list({ month, search: tag, store_id: st.VW002.id }, 1, 100)).data.total).toBe(62);
  expect((await list({ month, search: tag, status: 'paid' })).data.total).toBe(0);
  expect((await list({ month: '2038-10', search: tag })).data.total).toBe(0);
  expect((await list({ search: `${tag}-12` })).data.total).toBe(6); // -12 與 -120 至 -124
  // 頁面大小上限 100
  expect((await list({ month, search: tag }, 1, 500)).data.page_size).toBe(100);
  for (const bad of [{ type: 'GAS' }, { status: 'zzz' }, { month: '2038-13' }, { store_id: 'abc' }]) expect(await list(bad), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400 });
  // 排序：帳單月份新到舊，同月到期日早到晚
  const sorted = (await list({ search: tag }, 1, 100)).data.rows.map((r: any) => String(r.billing_month));
  expect([...sorted].sort().reverse()).toEqual(sorted);
});

test('報表：全部啟用門市都列（沒帳單算 0）、其他據點名稱正規化後合併、不含已刪除、月／季／年範圍正確、錯誤參數 400', async () => {
  const y = 2039; // 報表測試要乾淨的年份（其他案例都用 2038 與過去月份），這一年只有本案例的帳單
  const rep = async (mode: string, period: string | null) => (await fn('util_view', 'ga_ws_ub_report', { p_mode: mode, p_year: y, p_period: period })) as any;
  const mkR = (over: Record<string, unknown>) => mk({ billing_month: '2039-02', ...over });
  await mkR({ expense_type: 'WATER', amount: 100 });
  await mkR({ expense_type: 'ELECTRICITY', amount: 200 });
  await mkR({ expense_type: 'PHONE', amount: 300, store_id: st.VW002.id });
  await mkR({ expense_type: 'INTERNET', amount: 400, store_id: st.VW002.id, service_identifier: null, equipment_serial: ident('N') });
  await mk({ billing_month: '2039-03', amount: 50 });
  await mk({ billing_month: '2039-05', amount: 70, store_id: st.VW001.id });
  const gone = await mkR({ amount: 99999 });
  await fn('util_mgr', 'ga_ws_ub_delete', { p_id: gone.id, p_reason: '報表測試', p_confirm_paid_change: false, p_expected_updated_at: gone.updated_at });
  // 其他據點：全半形、大小寫、前後與連續空白視為同一個
  for (const [i, name] of ['QA-GA6 Foo 倉庫', '  qa-ga6   foo  倉庫 ', 'ＱＡ-ＧＡ６ ＦＯＯ 倉庫'].entries()) await mkR({ store_id: null, location_name: name, amount: 1000 * (i + 1), service_identifier: ident('F') });
  const month = await rep('month', '2039-02');
  expect(month.ok, JSON.stringify(month)).toBe(true);
  const rows = month.data.rows as any[];
  const vw1 = rows.find((r) => r.store_code === 'VW001');
  const vw2 = rows.find((r) => r.store_code === 'VW002');
  expect(vw1).toMatchObject({ WATER: 100, ELECTRICITY: 200, PHONE: 0, INTERNET: 0, total: 300, bill_count: 2 });
  expect(vw2).toMatchObject({ PHONE: 300, INTERNET: 400, total: 700, bill_count: 2 });
  const foo = rows.filter((r) => /foo/i.test(r.location_name));
  expect(foo).toHaveLength(1);
  expect(foo[0]).toMatchObject({ total: 6000, bill_count: 3, store_id: null });
  expect(month.data).toMatchObject({ start: '2039-02-01', end: '2039-03-01' });
  // 所有啟用門市都列出
  const active = ((await db().from('stores').select('store_code').eq('is_active', true)).data || []) as any[];
  for (const s of active) expect(rows.some((r) => r.store_code === s.store_code), s.store_code).toBe(true);
  expect(rows.find((r) => r.store_code === 'ZT01')).toMatchObject({ total: 0, bill_count: 0 });
  expect(month.data.totals.total).toBe(rows.reduce((s, r) => s + Number(r.total), 0));
  expect(JSON.stringify(rows)).not.toContain('99999');
  const q1 = await rep('quarter', '1');
  expect(vw1 && q1.data.rows.find((r: any) => r.store_code === 'VW001')).toMatchObject({ total: 350, bill_count: 3 });
  expect(q1.data).toMatchObject({ start: '2039-01-01', end: '2039-04-01' });
  const q2 = await rep('quarter', '2');
  expect(q2.data.rows.find((r: any) => r.store_code === 'VW001')).toMatchObject({ total: 70 });
  const year = await rep('year', null);
  expect(year.data.rows.find((r: any) => r.store_code === 'VW001')).toMatchObject({ total: 420, bill_count: 4 });
  expect(year.data).toMatchObject({ start: '2039-01-01', end: '2040-01-01' });
  for (const [mode, period, year2] of [['month', '2037-05', 2039], ['month', null, 2039], ['quarter', '5', 2039], ['week', null, 2039], ['year', null, 1999], ['month', '2039-13', 2039]] as const)
    expect(await fn('util_view', 'ga_ws_ub_report', { p_mode: mode, p_year: year2, p_period: period }), `${mode} ${period} ${year2}`).toMatchObject({ ok: false, status: 400 });
});

test('門市清單函式只回啟用中的門市、含代號與簡稱', async () => {
  const r = await fn('util_view', 'ga_ws_ub_stores', {});
  expect(r).toMatchObject({ ok: true, today });
  expect(r.data.length).toBeGreaterThan(5);
  expect(r.data[0]).toHaveProperty('store_code');
  const inactive = ((await db().from('stores').select('id').eq('is_active', false)).data || []) as any[];
  const ids = new Set(r.data.map((s: any) => s.id));
  for (const s of inactive) expect(ids.has(s.id)).toBe(false);
});

// ---------------------------------------------------------------- 審查補強（2026-11-17 第 6 批審查）
test('審查 A1：兩人同時新增同一筆帳單（同據點、類型、月份、供應商、識別號碼）只會成功一筆，另一筆回 DUPLICATE_BILL；資料庫只有一筆', async () => {
  const same = payload({ service_identifier: ident('RACE'), amount: 777 });
  for (let round = 0; round < 3; round += 1) {
    const p = { ...same, service_identifier: `${same.service_identifier}-${round}` };
    const rs = await Promise.all([save('util_mgr', p), save('ga_all', p)]);
    const ok = rs.filter((r) => r.ok);
    const dup = rs.filter((r) => !r.ok && r.code === 'DUPLICATE_BILL');
    expect(ok.length, JSON.stringify(rs)).toBe(1);
    expect(dup.length, JSON.stringify(rs)).toBe(1);
    const rows = (await db().from('ga_utility_bills').select('id').eq('service_identifier', p.service_identifier).is('deleted_at', null)).data || [];
    expect(rows.length).toBe(1);
  }
});

test('審查 A6：已繳帳單把帳單月份改成較晚的月份（繳費日期沒動）要重驗繳費日期範圍；改成較早的月份仍走二次確認', async () => {
  const b = await mk({ billing_month: PAST.slice(0, 7), amount: 900 });
  const paid = (await fn('util_mgr', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: PAST, p_expected_updated_at: b.updated_at })).data;
  const later = shiftMonth(THIS_MONTH, 3).slice(0, 7);
  const r = await save('util_mgr', { billing_month: later }, b.id, paid.updated_at, true);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: false, status: 400, code: 'PAID_TOO_EARLY' });
  const row = await dbRow(b.id);
  expect(String(row.billing_month).slice(0, 7)).toBe(PAST.slice(0, 7));
  expect(row.paid_at).toBe(PAST);
  // 月份沒變、只改備註：不重驗，照常成功
  expect((await save('util_mgr', { notes: '月份沒變' }, b.id, paid.updated_at)).ok).toBe(true);
});
