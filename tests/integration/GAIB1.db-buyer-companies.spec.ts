import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline } from '../support/m7m8-fixtures';
import { setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { call, cleanupGaib1, cleanupM7Users, expectErr, fakeCompany, key, mkPo, okData, poGet, prAct, prGetRaw, receive, seedGaib1Vendor } from '../support/gaib1-fixtures';

// ga-improve-b1 階段 2（資料庫層）：G11 多家買受人公司。
// 涵蓋：公司清單讀寫權限（讀＝請款或採購檢視／管理，寫＝請款管理）、統編格式與啟用中不重複、預設至多一家、設定讀寫相容（settings_get 回預設公司、settings_set 雙寫並更新預設公司）、
//      採購單草稿選抬頭（沒選取預設公司）與下訂後鎖定、請款單抬頭（預設取第一條明細的採購單公司、可改選）、送出凍結快照且改名後不變、停用規則（預設不可直接停用、停用不影響既有單據、不能再選）、
//      三聯式發票買受人統編可為任一啟用公司的統編。
// 設定鍵 pay_buyer_title／pay_buyer_tax_id 會被雙寫：測試前記錄、結束時還原成原狀。測試資料帶 QA-GAIB1- 標記，只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'payonly', 'nobody', 'purchaser'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let vendor: any;
let savedSettings: Record<string, any> = {};
const SETTING_KEYS = ['pay_buyer_title', 'pay_buyer_tax_id'];
let startedAt = '';

test.beforeAll(async () => {
  await assertGaBaseline();
  const left = await cleanupGaib1();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const db = adminDb();
  const existing = await db.from('ga_buyer_companies').select('id', { count: 'exact', head: true }).eq('is_active', true);
  if (existing.error) throw new Error(existing.error.message);
  expect(existing.count, 'DEV 不應有非測試的買受人公司（測試會改預設公司與設定鍵）').toBe(0);
  const s = await db.from('ga_workflow_settings').select('*').in('key', SETTING_KEYS);
  for (const r of s.data || []) savedSettings[r.key] = r;
  startedAt = new Date().toISOString();
  const su = await setupGa45Users(KEYS);
  users = su.users;
  teardownUsers = su.teardown;
  vendor = await seedGaib1Vendor('BUY');
});
test.afterAll(async () => {
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  const db = adminDb();
  // 還原設定鍵與測試期間寫入的設定事件
  for (const k of SETTING_KEYS) {
    if (savedSettings[k]) await db.from('ga_workflow_settings').update({ value_text: savedSettings[k].value_text, updated_at: savedSettings[k].updated_at, updated_by: savedSettings[k].updated_by }).eq('key', k);
    else await db.from('ga_workflow_settings').delete().eq('key', k);
  }
  await db.from('ga_workflow_setting_events').delete().in('setting_key', SETTING_KEYS).gte('created_at', startedAt);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
  expect(await cleanupM7Users(), '清除測試帳號（殘留）').toEqual([]);
});

const clerk = () => users.clerk;
const list = async (u = clerk()) => okData(await call(u, 'ga_ws_buyer_company_list'));
const save = (payload: Record<string, unknown>, expected: string | null = null, u = clerk()) => call(u, 'ga_ws_buyer_company_save', { p_payload: payload, p_key: key(), p_expected_updated_at: expected });
let A: any;
let B: any;

test('權限：讀取要請款或採購檢視、寫入要請款管理', async () => {
  expectErr(await call(users.nobody, 'ga_ws_buyer_company_list'), 403, 'PERMISSION_DENIED');
  const d = await list(users.payonly);
  expect(d.can_edit).toBe(false);
  expect((await list(users.purchaser)).can_edit).toBe(false); // 採購角色看得到清單（下拉選單用）
  expect((await list(clerk())).can_edit).toBe(true);
  expectErr(await save({ name: '不行', tax_id: '12345678' }, null, users.payonly), 403, 'PERMISSION_DENIED');
  expectErr(await save({ name: '不行', tax_id: '12345678' }, null, users.nobody), 403, 'PERMISSION_DENIED');
  expectErr(await call(users.payonly, 'ga_ws_buyer_company_set_default', { p_id: crypto.randomUUID() }), 403, 'PERMISSION_DENIED');
  expectErr(await call(users.purchaser, 'ga_ws_buyer_company_deactivate', { p_id: crypto.randomUUID() }), 403, 'PERMISSION_DENIED');
});

test('新增公司：第一家自動成為預設、統編格式與重複被擋、防重複送出', async () => {
  const a = fakeCompany('甲');
  const k = key();
  const r1 = await call(clerk(), 'ga_ws_buyer_company_save', { p_payload: a, p_key: k, p_expected_updated_at: null });
  expect(r1.status).toBe(201);
  const rows1 = okData(r1).rows as any[];
  A = rows1.find((x) => x.tax_id === a.tax_id);
  expect(A).toMatchObject({ name: a.name, is_default: true, is_active: true });
  // 同識別同內容重送：回原結果、不重複建立
  const r1b = await call(clerk(), 'ga_ws_buyer_company_save', { p_payload: a, p_key: k, p_expected_updated_at: null });
  expect(r1b.replay).toBe(true);
  expect((await list()).rows.filter((x: any) => x.tax_id === a.tax_id)).toHaveLength(1);
  expectErr(await save({ name: '格式錯', tax_id: '1234' }), 400, 'TAX_ID_FORMAT');
  expectErr(await save({ name: '格式錯', tax_id: 'ABCDEFGH' }), 400, 'TAX_ID_FORMAT');
  expectErr(await save({ name: '', tax_id: '12345678' }), 400, 'FIELD_REQUIRED');
  expectErr(await save({ name: '重複', tax_id: a.tax_id }), 409, 'DUPLICATE_TAX_ID');
  const b = fakeCompany('乙');
  const rows2 = okData(await save(b)).rows as any[];
  B = rows2.find((x) => x.tax_id === b.tax_id);
  expect(B.is_default).toBe(false);
  expect(rows2.filter((x) => x.is_default)).toHaveLength(1);
});

test('預設公司至多一家、設定讀取回預設公司（相容舊畫面）、設定寫入會更新預設公司', async () => {
  const s0 = okData(await call(clerk(), 'ga_ws_pay_settings_get'));
  expect(s0.buyer_title).toBe(A.name);
  expect(s0.buyer_tax_id).toBe(A.tax_id);
  // 舊設定鍵雙寫
  const raw = await adminDb().from('ga_workflow_settings').select('key,value_text').in('key', SETTING_KEYS);
  expect(Object.fromEntries((raw.data || []).map((r: any) => [r.key, r.value_text]))).toEqual({ pay_buyer_title: A.name, pay_buyer_tax_id: A.tax_id });
  // 改預設
  const rows = okData(await call(clerk(), 'ga_ws_buyer_company_set_default', { p_id: B.id })).rows as any[];
  expect(rows.find((x) => x.id === B.id).is_default).toBe(true);
  expect(rows.find((x) => x.id === A.id).is_default).toBe(false);
  expect(okData(await call(clerk(), 'ga_ws_pay_settings_get')).buyer_tax_id).toBe(B.tax_id);
  // 舊畫面改抬頭：更新預設公司
  const s1 = okData(await call(clerk(), 'ga_ws_pay_settings_get'));
  const newName = `${B.name}-改`;
  okData(await call(clerk(), 'ga_ws_pay_settings_set', { p_values: { buyer_title: newName, buyer_tax_id: B.tax_id }, p_expected_updated_at: s1.updated_at }));
  const rows3 = (await list()).rows as any[];
  expect(rows3.find((x) => x.id === B.id).name).toBe(newName);
  B.name = newName;
  // 預設還原為 A，後面的測試以 A 為預設
  okData(await call(clerk(), 'ga_ws_buyer_company_set_default', { p_id: A.id }));
  expectErr(await call(clerk(), 'ga_ws_buyer_company_set_default', { p_id: crypto.randomUUID() }), 404, 'NOT_FOUND');
});

test('採購單：沒選取預設公司、草稿可改選、下訂後鎖定', async () => {
  const d = await mkPo(clerk(), vendor, { notes: 'buyer1', place: false });
  expect(d.buyer_company_id).toBe(A.id);
  expect(d.buyer_company_name).toBe(A.name);
  const u = okData(await call(clerk(), 'ga_ws_po_update', { p_id: d.id, p_header: { buyer_company_id: B.id }, p_items: null, p_expected_updated_at: d.updated_at }));
  expect(u.buyer_company_id).toBe(B.id);
  expect(u.buyer_company_tax_id).toBe(B.tax_id);
  expectErr(await call(clerk(), 'ga_ws_po_update', { p_id: d.id, p_header: { buyer_company_id: crypto.randomUUID() }, p_items: null, p_expected_updated_at: u.updated_at }), 404, 'BUYER_NOT_FOUND');
  expectErr(await call(clerk(), 'ga_ws_po_update', { p_id: d.id, p_header: { buyer_company_id: 'bad' }, p_items: null, p_expected_updated_at: u.updated_at }), 400, 'INVALID_BUYER');
  const placed = okData(await call(clerk(), 'ga_ws_po_action', { p_id: d.id, p_action: 'place_order', p_expected_updated_at: u.updated_at, p_note: null }));
  expect(placed.buyer_company_id).toBe(B.id);
  expectErr(await call(clerk(), 'ga_ws_po_update', { p_id: d.id, p_header: { buyer_company_id: A.id }, p_items: null, p_expected_updated_at: placed.updated_at }), 409, 'PO_LOCKED');
});

test('請款單：抬頭預設取採購單公司、可改選、送出凍結快照、公司改名後快照不變', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'buyer2', header: { buyer_company_id: B.id } });
  const rc = await receive(clerk(), po);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }] }, p_key: key() }));
  expect(pr.buyer_company_id).toBe(B.id);
  expect(pr.buyer_title_snapshot).toBeNull();
  expect((await prGetRaw(clerk(), pr.id)).buyer).toMatchObject({ title: B.name, tax_id: B.tax_id, source: 'COMPANY' });
  // 草稿改選 A
  const up = okData(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { buyer_company_id: A.id }, p_expected_updated_at: pr.updated_at }));
  expect(up.buyer_company_id).toBe(A.id);
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { buyer_company_id: crypto.randomUUID() }, p_expected_updated_at: up.updated_at }), 404, 'BUYER_NOT_FOUND');
  // 送出：凍結快照
  const sub = okData(await prAct(clerk(), up, 'submit'));
  expect(sub.buyer_title_snapshot).toBe(A.name);
  expect(sub.buyer_tax_id_snapshot).toBe(A.tax_id);
  // 公司改名後，已送出的請款單抬頭不變
  const cur = await list();
  const renamed = `${A.name}-新名`;
  okData(await save({ id: A.id, name: renamed, tax_id: A.tax_id }, cur.rows.find((x: any) => x.id === A.id).updated_at));
  const gotRaw = await prGetRaw(clerk(), pr.id);
  const got = gotRaw.data;
  expect(gotRaw.buyer).toMatchObject({ title: A.name, tax_id: A.tax_id, source: 'SNAPSHOT' });
  A.name = renamed;
  // 送出後不能再改抬頭（草稿專用）
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { buyer_company_id: B.id }, p_expected_updated_at: sub.updated_at }), 409, 'INVALID_STATE');
  // 直接寫資料表也不行（守門觸發器）
  const direct = await adminDb().from('ga_payment_requests').update({ buyer_title_snapshot: '偷改' }).eq('id', pr.id);
  expect(direct.error?.message || '').toContain('買受人抬頭不能修改');
  // 退回草稿：快照清空，重新送出再凍結
  const back = okData(await prAct(clerk(), sub, 'return', { reason: '測試退回' }));
  expect(back.buyer_title_snapshot).toBeNull();
});

test('停用規則：預設公司不能直接停用、停用不影響既有單據、不能再被選', async () => {
  expectErr(await call(clerk(), 'ga_ws_buyer_company_deactivate', { p_id: A.id }), 409, 'DEFAULT_REQUIRED');
  const rows = okData(await call(clerk(), 'ga_ws_buyer_company_deactivate', { p_id: B.id })).rows as any[];
  expect(rows.find((x) => x.id === B.id)).toMatchObject({ is_active: false, is_default: false });
  expect(rows.find((x) => x.id === B.id).usage_count).toBeGreaterThan(0);
  expectErr(await call(clerk(), 'ga_ws_buyer_company_deactivate', { p_id: B.id }), 409, 'INVALID_STATE');
  const d = await mkPo(clerk(), vendor, { notes: 'buyer3', place: false });
  expectErr(await call(clerk(), 'ga_ws_po_update', { p_id: d.id, p_header: { buyer_company_id: B.id }, p_items: null, p_expected_updated_at: d.updated_at }), 404, 'BUYER_NOT_FOUND');
  expectErr(await call(clerk(), 'ga_ws_buyer_company_set_default', { p_id: B.id }), 409, 'INVALID_STATE');
  // 既有採購單仍顯示停用公司
  const all = await list();
  const used = await adminDb().from('ga_purchase_orders').select('id').eq('buyer_company_id', B.id).limit(1);
  const shown = await poGet(clerk(), used.data![0].id);
  expect(shown.buyer_company_name).toBe(B.name);
  expect(all.rows.find((x: any) => x.id === B.id).is_active).toBe(false);
  // 停用後可重新啟用（統編沒被別人佔用）
  const cur = all.rows.find((x: any) => x.id === B.id);
  const re = okData(await save({ id: B.id, name: B.name, tax_id: B.tax_id, is_active: true }, cur.updated_at)).rows as any[];
  expect(re.find((x) => x.id === B.id).is_active).toBe(true);
  // 啟用的統編不重複：用 A 的統編改 B 會被擋
  const cur2 = (await list()).rows.find((x: any) => x.id === B.id);
  expectErr(await save({ id: B.id, name: B.name, tax_id: A.tax_id }, cur2.updated_at), 409, 'DUPLICATE_TAX_ID');
  expectErr(await save({ id: B.id, name: B.name, tax_id: B.tax_id }, '2000-01-01T00:00:00Z'), 409, 'STALE');
});

test('三聯式發票買受人統編：任一啟用公司的統編都算相符，其他統編要填原因', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'buyer4' });
  const rc = await receive(clerk(), po);
  const mk = (buyer: string, extra: Record<string, unknown> = {}) => call(clerk(), 'ga_ws_pay_invoice_save', { p_id: null, p_payload: {
    invoice_type: 'TRIPLE', invoice_no: `QB${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`, invoice_date: new Date().toISOString().slice(0, 10), vendor_id: vendor.id,
    amount_untaxed: 1000, buyer_tax_id: buyer, receipts: [{ receipt_id: rc.id }], ...extra }, p_key: key() });
  // B 不是預設公司，但是啟用中的公司：不要求原因
  const okB = await mk(B.tax_id);
  expect(okB.ok, JSON.stringify(okB)).toBe(true);
  // 不屬於任何公司的統編：要填原因
  const other = fakeCompany('他').tax_id;
  const bad = await mk(other);
  expectErr(bad, 400, 'TAX_MISMATCH_REASON_REQUIRED');
  const withReason = await mk(other, { tax_mismatch_reason: '測試：客戶要求開別家' });
  expect(withReason.ok, JSON.stringify(withReason)).toBe(true);
  // 停用公司的統編不再算相符
  okData(await call(clerk(), 'ga_ws_buyer_company_deactivate', { p_id: B.id }));
  expectErr(await mk(B.tax_id), 400, 'TAX_MISMATCH_REASON_REQUIRED');
});

test('舊畫面把抬頭與統編清空：停用預設公司，設定讀回空值（與改版前行為相同）；填回去再建立預設公司', async () => {
  const c = fakeCompany('舊畫面');
  const rows = okData(await save(c)).rows as any[];
  const row = rows.find((x) => x.tax_id === c.tax_id);
  okData(await call(clerk(), 'ga_ws_buyer_company_set_default', { p_id: row.id }));
  const s1 = okData(await call(clerk(), 'ga_ws_pay_settings_get'));
  expect(s1.buyer_tax_id).toBe(c.tax_id);
  const s2 = okData(await call(clerk(), 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 5, buyer_title: null, buyer_tax_id: null }, p_expected_updated_at: s1.updated_at }));
  expect(s2.buyer_title).toBeNull();
  expect(s2.buyer_tax_id).toBeNull();
  const after = (await list()).rows.find((x: any) => x.id === row.id);
  expect(after).toMatchObject({ is_active: false, is_default: false });
  // 只改尾差不碰抬頭：不影響公司
  const s3 = okData(await call(clerk(), 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 5 }, p_expected_updated_at: s2.updated_at }));
  expect(s3.buyer_tax_id).toBeNull();
  // 舊畫面重新填抬頭與統編：建立（或更新）預設公司
  const t = fakeCompany('舊畫面2');
  const s4 = okData(await call(clerk(), 'ga_ws_pay_settings_set', { p_values: { buyer_title: t.name, buyer_tax_id: t.tax_id }, p_expected_updated_at: s3.updated_at }));
  expect(s4.buyer_tax_id).toBe(t.tax_id);
  const made = (await list()).rows.find((x: any) => x.tax_id === t.tax_id && x.is_active);
  expect(made).toMatchObject({ is_default: true, name: t.name });
});
