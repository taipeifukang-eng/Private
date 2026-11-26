import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

// M7/M8 第 6 批 G23.parity：同一個登入者（水電話網費管理）、同一份輸入，舊版 /api/general-affairs/utility-bills*（列表、新增、PATCH 標記已繳、DELETE、報表）
// 與新版 /api/workspace/general-affairs/utility-bills* 逐項比對（讀取比對共同欄位與筆數；寫入以 service role 回讀資料列逐欄比對）。
// 差異都登記在 tests/parity/allowlist.json（page: ga-utility-bills，id 以 m7m8-b6-ub- 開頭）；未登記的差異一律失敗。
const map = loadMap('ga-utility-bills');
const rec = new ParityRecorder('ga-utility-bills');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs/utility-bills';
const N = '/api/workspace/general-affairs/utility-bills';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let api: APIRequestContext;
let st: Awaited<ReturnType<typeof stores>>;
let seq = 0;
const today = taipeiToday();
const PAST = shiftMonth(`${today.slice(0, 7)}-01`, -3).slice(0, 7);
const db = () => adminDb();
const j = async (r: any) => r.json().catch(() => ({}));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const TIME = /(_at)$/;
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME.test(key)) return !!a === !!b;
  if (['amount', 'electricity_kwh'].includes(key)) return num(a) === num(b);
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
};
const cmp = (diffs: Diff[], label: string, l: any, n: any, cols: string[]) => {
  for (const c of cols) if (!same(l?.[c], n?.[c], c)) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: l?.[c], native: n?.[c] });
};
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });
const ident = (s = 'I') => `QA-GA6-PAR-${String((seq += 1)).padStart(4, '0')}-${s}`;
const dbRow = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).maybeSingle()).data as any;
const BILL_COLS = ['store_id', 'location_name', 'expense_type', 'billing_month', 'provider_name', 'service_label', 'service_identifier', 'account_number', 'equipment_serial', 'amount', 'electricity_kwh',
  'due_date', 'paid_at', 'reference_no', 'notes', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'];
const label = (code: string) => `${code} `; // 舊版畫面把「門市代號 簡稱」放進 location_name；兩邊送同一個字串

test.describe.configure({ mode: 'default' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['util_mgr']);
  users = made.users;
  teardown = made.teardown;
  api = await apiForUser(users.util_mgr as any);
});
test.afterAll(async () => {
  await api?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

/** 兩邊各新增一筆同樣內容的帳單（識別號碼不同）；回傳 [舊版列, 新版列]。 */
async function pair(over: Record<string, unknown> = {}, nativeOver: Record<string, unknown> = {}) {
  const siteLabel = ((await db().from('stores').select('store_code,short_name,store_name').eq('id', st.VW001.id).single()).data as any);
  const loc = `${siteLabel.store_code} ${siteLabel.short_name || siteLabel.store_name}`;
  const base = { store_id: st.VW001.id, location_name: loc, expense_type: 'WATER', billing_month: '2038-10', provider_name: ga6Name('PP'), amount: 1234.5, due_date: '2038-11-20', reference_no: 'R-1', notes: '對等測試', ...over };
  const lr = await api.post(L, { data: { ...base, service_identifier: ident('L') } });
  const nr = await api.post(N, { data: { ...base, ...nativeOver, service_identifier: ident('N') } });
  expect(lr.status(), JSON.stringify(await j(lr))).toBe(201);
  expect(nr.status(), JSON.stringify(await j(nr))).toBe(201);
  const lid = (await j(lr)).data.id as string;
  const nid = (await j(nr)).data.id as string;
  return { l: await dbRow(lid), n: await dbRow(nid), lid, nid };
}

test('帳單列表：同一個月份篩選，舊版與新版共同欄位逐列相同；新版多回狀態、逾期、建立與修改者名稱與摘要，少回建立者等 uuid 欄位；新版分頁（舊版上限 500）', async () => {
  const e = entry('bill-list-read');
  const diffs: Diff[] = [];
  const a = await pair({ billing_month: '2038-12' });
  const b = await pair({ billing_month: '2038-12', expense_type: 'ELECTRICITY', electricity_kwh: 321 });
  const c = await pair({ billing_month: '2038-12', expense_type: 'INTERNET', service_identifier: undefined, equipment_serial: ident('SN') }, {});
  void c;
  const lr = await api.get(`${L}?month=2038-12`);
  const nr = await api.get(`${N}?month=2038-12&pageSize=100`);
  statusDiff(diffs, 'list-status', lr.status(), nr.status());
  expect(lr.status()).toBe(200);
  expect(nr.status()).toBe(200);
  const lb = await j(lr);
  const nb = await j(nr);
  const legacy = (lb.data as any[]).filter((r) => String(r.provider_name).startsWith('QA-GA6-'));
  const native = (nb.data as any[]).filter((r) => String(r.provider_name).startsWith('QA-GA6-'));
  if (legacy.length !== native.length) diffs.push({ kind: 'count', key: 'rows', legacy: legacy.length, native: native.length });
  expect(native.length).toBeGreaterThanOrEqual(4);
  const cols = ['store_id', 'location_name', 'expense_type', 'billing_month', 'provider_name', 'service_label', 'service_identifier', 'account_number', 'equipment_serial', 'amount', 'electricity_kwh', 'due_date', 'paid_at', 'reference_no', 'notes'];
  for (const l of legacy) {
    const n = native.find((x) => x.id === l.id);
    if (!n) { diffs.push({ kind: 'only-legacy', key: l.id }); continue; }
    cmp(diffs, l.id, l, n, cols);
  }
  // 欄位集合差異（舊版回建立者等 uuid、新版回名稱與狀態）
  const lKeys = new Set(Object.keys(legacy[0] || {}));
  const nKeys = new Set(Object.keys(native[0] || {}));
  for (const k of nKeys) if (!lKeys.has(k)) diffs.push({ kind: 'only-native', key: `row#${k}` });
  for (const k of lKeys) if (!nKeys.has(k)) diffs.push({ kind: 'only-legacy', key: `row#${k}` });
  for (const k of Object.keys(nb)) if (!(k in lb)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(lb)) if (!(k in nb)) diffs.push({ kind: 'only-legacy', key: `top#${k}` });
  // 舊版摘要在瀏覽器端用目前篩選結果算（待繳與逾期都只算這個月）；新版待繳與逾期是全部月份
  diffs.push({ kind: 'changed', key: 'summary#scope', legacy: '目前篩選結果', native: '待繳與逾期＝全部月份、完整計算' });
  void a; void b;
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '帳單列表', legacy: { endpoint: `GET ${L}?month=2038-12`, status: lr.status() }, native: { endpoint: `GET ${N}?month=2038-12`, status: 200 }, compared: { rows: native.length }, diffs }));
});

test('新增帳單：同一份輸入，兩邊寫入後的資料列逐欄相同；重複帳單舊版英文資料庫錯誤、新版 409 白話並指出既有那一筆；舊版可存未來繳費日期、新版擋下；新版回金額異常提醒', async () => {
  const e = entry('bill-create-write-readback');
  const diffs: Diff[] = [];
  const { l, n, lid, nid } = await pair({ billing_month: '2038-10', expense_type: 'ELECTRICITY', electricity_kwh: 250.5, service_label: '主電表', account_number: 'ACC-1' });
  cmp(diffs, 'bill', l, n, BILL_COLS.filter((c) => c !== 'created_by' && c !== 'updated_by' && c !== 'service_identifier')); // 識別號碼兩邊刻意不同（避免撞到唯一鍵）
  cmp(diffs, 'bill', { created_by: l.created_by === users.util_mgr.id, updated_by: l.updated_by === users.util_mgr.id }, { created_by: n.created_by === users.util_mgr.id, updated_by: n.updated_by === users.util_mgr.id }, ['created_by', 'updated_by']);
  // 重複帳單
  const dupBody = { store_id: st.VW001.id, location_name: l.location_name, expense_type: 'ELECTRICITY', billing_month: '2038-10', provider_name: l.provider_name, amount: 1, service_identifier: l.service_identifier };
  const dupL = await api.post(L, { data: dupBody });
  const dupN = await api.post(N, { data: { ...dupBody, service_identifier: n.service_identifier } });
  statusDiff(diffs, 'duplicate-status', dupL.status(), dupN.status());
  expect(dupN.status()).toBe(409);
  const dupLb = await j(dupL);
  const dupNb = await j(dupN);
  expect(dupNb.existing?.id).toBe(nid);
  if (/duplicate key|unique/i.test(String(dupLb.error))) diffs.push({ kind: 'changed', key: 'duplicate#message', legacy: String(dupLb.error).slice(0, 80), native: dupNb.error });
  // 未來的繳費日期
  const fut = { ...dupBody, billing_month: '2038-09', service_identifier: ident('F'), paid_at: '2999-01-01' };
  const futL = await api.post(L, { data: fut });
  const futN = await api.post(N, { data: { ...fut, service_identifier: ident('F') } });
  statusDiff(diffs, 'future-paid-status', futL.status(), futN.status());
  expect(futN.status()).toBe(400);
  // 金額異常：兩邊都先建立三筆歷史再送一筆 12 倍
  const key = ident('AN');
  for (const [m, a] of [['2038-01', 1000], ['2038-02', 1000], ['2038-03', 1000]] as const) await api.post(N, { data: { ...dupBody, billing_month: m, amount: a, service_identifier: key } });
  const anL = await api.post(L, { data: { ...dupBody, billing_month: '2038-04', amount: 12000, service_identifier: key } });
  const anN = await api.post(N, { data: { ...dupBody, billing_month: '2038-04', amount: 12000, service_identifier: ident('AN2') } });
  const anNk = await api.post(N, { data: { ...dupBody, billing_month: '2038-05', amount: 12000, service_identifier: key } });
  expect(anL.status()).toBe(201);
  expect(anN.status()).toBe(201);
  const anNb = await j(anNk);
  expect(anNb.warnings?.[0]?.reason).toBe('HIGH');
  // 新版回傳多了 anomaly 與 warnings（舊版只回資料列）
  const lb = await j(await api.post(L, { data: { ...dupBody, billing_month: '2038-06', service_identifier: ident('T') } }));
  const nb = await j(await api.post(N, { data: { ...dupBody, billing_month: '2038-06', service_identifier: ident('T') } }));
  for (const k of Object.keys(nb)) if (!(k in lb)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(lb)) if (!(k in nb)) diffs.push({ kind: 'only-legacy', key: `top#${k}` });
  void lid;
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '新增帳單', legacy: { endpoint: `POST ${L}` }, native: { endpoint: `POST ${N}`, status: 201 }, compared: { columns: BILL_COLS.length }, diffs }));
});

test('標記已繳與改回待繳：兩邊寫入後 paid_at 相同；新版擋未來與過早的日期、改回待繳需確認、可完整編輯並留修改者', async () => {
  const e = entry('bill-pay-write-readback');
  const diffs: Diff[] = [];
  const { lid, nid } = await pair({ billing_month: PAST });
  const lp = await api.patch(`${L}/${lid}`, { data: { paid_at: today } });
  const np = await api.post(`${N}/${nid}/pay`, { data: { paid_at: today, expected_updated_at: (await dbRow(nid)).updated_at } });
  statusDiff(diffs, 'pay-status', lp.status(), np.status());
  expect(np.status(), JSON.stringify(await j(np))).toBe(200);
  cmp(diffs, 'paid', await dbRow(lid), await dbRow(nid), ['paid_at', 'amount', 'deleted_at']);
  // 未來日期
  const f = await pair({ billing_month: PAST });
  const lf = await api.patch(`${L}/${f.lid}`, { data: { paid_at: '2999-01-01' } });
  const nf = await api.post(`${N}/${f.nid}/pay`, { data: { paid_at: '2999-01-01', expected_updated_at: f.n.updated_at } });
  statusDiff(diffs, 'future-status', lf.status(), nf.status());
  expect(nf.status()).toBe(400);
  // 太早的日期
  const lo = await api.patch(`${L}/${f.lid}`, { data: { paid_at: '2001-01-01' } });
  const no = await api.post(`${N}/${f.nid}/pay`, { data: { paid_at: '2001-01-01', expected_updated_at: f.n.updated_at } });
  statusDiff(diffs, 'too-early-status', lo.status(), no.status());
  expect(no.status()).toBe(400);
  // 改回待繳：舊版 PATCH paid_at null 直接清除；新版要確認
  const lu = await api.patch(`${L}/${lid}`, { data: { paid_at: null } });
  const nuNoConfirm = await api.post(`${N}/${nid}/unpay`, { data: { expected_updated_at: (await dbRow(nid)).updated_at } });
  statusDiff(diffs, 'unpay-no-confirm-status', lu.status(), nuNoConfirm.status());
  expect(nuNoConfirm.status()).toBe(409);
  const nu = await api.post(`${N}/${nid}/unpay`, { data: { confirm: true, expected_updated_at: (await dbRow(nid)).updated_at } });
  expect(nu.status()).toBe(200);
  cmp(diffs, 'unpaid', await dbRow(lid), await dbRow(nid), ['paid_at']);
  // 舊版 PATCH 只認 paid_at，其他欄位被忽略；新版可編輯全部欄位
  const lEdit = await api.patch(`${L}/${lid}`, { data: { amount: 99999, notes: '舊版不能改' } });
  const before = await dbRow(lid);
  const nEdit = await api.patch(`${N}/${nid}`, { data: { amount: 888, notes: '新版可改', expected_updated_at: (await dbRow(nid)).updated_at } });
  expect(nEdit.status()).toBe(200);
  const after = await dbRow(nid);
  if (Number(before.amount) === 1234.5 && lEdit.status() === 200) diffs.push({ kind: 'changed', key: 'edit#fields', legacy: '只改 paid_at（其他欄位被忽略）', native: '可編輯全部欄位並留修改者' });
  expect(after.updated_by).toBe(users.util_mgr.id);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '標記已繳', legacy: { endpoint: `PATCH ${L}/:id` }, native: { endpoint: `POST ${N}/:id/pay`, status: 200 }, compared: { columns: 4 }, diffs }));
});

test('刪除：兩邊都是軟刪除（deleted_at、deleted_by 相同）；舊版不問原因，新版必填原因並記錄；已繳帳單新版要二次確認', async () => {
  const e = entry('bill-delete-write-readback');
  const diffs: Diff[] = [];
  const { lid, nid } = await pair({ billing_month: '2038-10' });
  const ld = await api.delete(`${L}/${lid}`);
  const nNoReason = await api.post(`${N}/${nid}/delete`, { data: { expected_updated_at: (await dbRow(nid)).updated_at } });
  statusDiff(diffs, 'delete-no-reason-status', ld.status(), nNoReason.status());
  expect(nNoReason.status()).toBe(400);
  const nd = await api.post(`${N}/${nid}/delete`, { data: { reason: '對等測試刪除', expected_updated_at: (await dbRow(nid)).updated_at } });
  expect(nd.status(), JSON.stringify(await j(nd))).toBe(200);
  const l = await dbRow(lid);
  const n = await dbRow(nid);
  const ldb = await j(ld);
  if (!l.deleted_at) diffs.push({ kind: 'changed', key: 'delete#legacy-effective', legacy: `HTTP ${ld.status()} ${JSON.stringify(ldb).slice(0, 160)}；資料列沒有被標記刪除`, native: '已軟刪除' });
  expect(n.deleted_at).toBeTruthy();
  // 舊版刪除在 DEV 實測被資料庫擋下（回 400「刪除失敗」：更新後的列不符讀取政策 deleted_at IS NULL），這時沒有可比對的刪除欄位，只比對原因欄位
  const cols = l.deleted_at ? ['deleted_at', 'deleted_by', 'deletion_reason'] : ['deletion_reason'];
  cmp(diffs, 'deleted', { ...l, deleted_by: l.deleted_by === users.util_mgr.id }, { ...n, deleted_by: n.deleted_by === users.util_mgr.id }, cols);
  // 已繳帳單：舊版一樣直接刪除；新版要確認
  const p = await pair({ billing_month: PAST });
  await api.patch(`${L}/${p.lid}`, { data: { paid_at: today } });
  await api.post(`${N}/${p.nid}/pay`, { data: { paid_at: today, expected_updated_at: p.n.updated_at } });
  const lpd = await api.delete(`${L}/${p.lid}`);
  const npd = await api.post(`${N}/${p.nid}/delete`, { data: { reason: '已繳刪除', expected_updated_at: (await dbRow(p.nid)).updated_at } });
  statusDiff(diffs, 'delete-paid-status', lpd.status(), npd.status());
  expect(npd.status()).toBe(409);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '刪除帳單', legacy: { endpoint: `DELETE ${L}/:id` }, native: { endpoint: `POST ${N}/:id/delete`, status: 200 }, compared: { columns: 3 }, diffs }));
});

test('費用報表：同一個月份，啟用門市與四類費用、合計、筆數逐據點相同；其他據點名稱舊版只去前後空白、新版再正規化（全半形、大小寫、連續空白）後合併', async () => {
  const e = entry('bill-report-read');
  const diffs: Diff[] = [];
  const month = '2038-11';
  await pair({ billing_month: month, amount: 100 });
  await pair({ billing_month: month, expense_type: 'PHONE', amount: 250 });
  const names = ['QA-GA6 Foo 倉庫', '  qa-ga6   foo  倉庫 ', 'ＱＡ-ＧＡ６ ＦＯＯ 倉庫'];
  for (const [i, name] of names.entries()) for (const [url, tag] of [[L, 'L'], [N, 'N']] as const) {
    const r = await api.post(url, { data: { store_id: null, location_name: name, expense_type: 'WATER', billing_month: month, provider_name: ga6Name('PP'), service_identifier: ident(tag), amount: 1000 * (i + 1) } });
    expect(r.status(), JSON.stringify(await j(r))).toBe(201);
  }
  const lr = await api.get(`${L}/report?mode=month&year=2038&period=${month}`);
  const nr = await api.get(`${N}/report?mode=month&year=2038&period=${month}`);
  statusDiff(diffs, 'report-status', lr.status(), nr.status());
  expect(lr.status()).toBe(200);
  expect(nr.status()).toBe(200);
  const lrows = (await j(lr)).data.rows as any[];
  const nrows = (await j(nr)).data.rows as any[];
  const isOther = (r: any) => !r.store_id;
  const lStore = lrows.filter((r) => !isOther(r));
  const nStore = nrows.filter((r) => !isOther(r));
  if (lStore.length !== nStore.length) diffs.push({ kind: 'count', key: 'rows#stores', legacy: lStore.length, native: nStore.length });
  for (const l of lStore) {
    const n = nStore.find((x) => x.store_id === l.store_id);
    if (!n) { diffs.push({ kind: 'only-legacy', key: String(l.location_name) }); continue; }
    cmp(diffs, String(l.location_name), l, n, ['location_name', 'store_code', 'WATER', 'ELECTRICITY', 'PHONE', 'INTERNET', 'total', 'bill_count']);
  }
  const lOther = lrows.filter(isOther).filter((r) => /foo|ＦＯＯ/i.test(r.location_name));
  const nOther = nrows.filter(isOther).filter((r) => /foo|ＦＯＯ/i.test(r.location_name));
  if (lOther.length !== nOther.length) diffs.push({ kind: 'count', key: 'rows#other-locations', legacy: lOther.length, native: nOther.length });
  expect(nOther).toHaveLength(1);
  expect(nOther[0].bill_count).toBe(6);
  const lTotals = (await j(lr)).data.totals;
  const nTotals = (await j(nr)).data.totals;
  cmp(diffs, 'totals', lTotals, nTotals, ['WATER', 'ELECTRICITY', 'PHONE', 'INTERNET', 'total', 'bill_count']);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '費用報表', legacy: { endpoint: `GET ${L}/report`, status: lr.status() }, native: { endpoint: `GET ${N}/report`, status: 200 }, compared: { rows: nStore.length }, diffs }));
});
