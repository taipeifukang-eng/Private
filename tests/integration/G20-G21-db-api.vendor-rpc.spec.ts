import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, seedWorkOrder } from '../support/m7m8-fixtures';
import { anonClient } from '../support/m7m8-po-fixtures';
import { freshInvalidTaxId, freshValidTaxId, ga6Code, ga6Name, SECRET_FIELDS, seedGa6Vendor, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G20／G21（資料庫層）整合：ga_ws_vendor_list／get／save／set_status／options 與 ga_ws_svc_category_*、ga_ws_svc_region_* 函式，
// 以及 BEGIN…ROLLBACK 的資料庫層測試與 supabase/test_general_affairs_vendor_permissions_rls.sql（DEV 實跑）。
// 涵蓋：權限矩陣（未登入、廠商管理／檢視、只有分類區域、只有合作紀錄、採購、工務、需求單管理、核准人、無關權限、舊式管理員不繞過、店長）、輸入驗證 400、統編標準化與唯一（含停用、全形）、檢查碼只提醒、名稱相近只提醒、
//      版本檢查（缺少 400、不符 409 STALE）、部分欄位更新、停用提醒（未結工單）、下拉遮蔽（帳務欄位完全不存在）與 includeIds、分類與區域（代碼鎖定、循環、停用不影響顯示、縣市行政區固定資料）。
// 測試資料：廠商、分類、區域名稱與代碼帶 QA-GA6- 標記、只用 VW／ZT 測試門市；結束只清自己的（cleanupM7M8）。與其他整合檔一樣循序執行。
test.describe.configure({ mode: 'serial' });

const root = path.resolve(__dirname, '..', '..');
const KEYS: Ga6Key[] = ['vendor_mgr', 'vendor_view', 'cat_only', 'coop_only', 'ga_all', 'purchaser', 'wo_works', 'rq_manager', 'approver', 'svc_mgr', 'vendor_manage_only', 'nobody', 'admin', 'store_mgr'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let seq = 0;
const db = () => adminDb();
const fn = (who: Ga6Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const vname = (s = 'N') => ga6Name(`${s}${String((seq += 1)).padStart(3, '0')}`);
const row = async (id: string) => (await db().from('ga_vendors').select('*').eq('id', id).maybeSingle()).data as any;
const save = (who: Ga6Key, payload: Record<string, unknown>, id: string | null = null, expected: string | null = null) =>
  fn(who, 'ga_ws_vendor_save', { p_id: id, p_payload: payload, p_expected_updated_at: expected });
/** 新增一個通過所有檢查的廠商（vendor_mgr）。 */
async function mk(over: Record<string, unknown> = {}) {
  const r = await save('vendor_mgr', { name: vname('M'), vendor_type: 'company', tax_id: await freshValidTaxId(), ...over });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
}

function runSqlDo(body: string, tag: string): string {
  const file = path.join(os.tmpdir(), `g20g21-${tag}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, `DO $$\n${body}\nEND $$;`);
  try {
    const run = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', shell: true });
    return `${run.stdout}\n${run.stderr}`.replace(/\\"/g, '"');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
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

// ----------------------------------------------------------------------------- 權限矩陣
test('未登入（anon）不能執行任何第 6 批廠商與分類區域函式', async () => {
  const anon = anonClient();
  for (const [name, args] of [
    ['ga_ws_vendor_list', { p_filters: {}, p_page: 1, p_page_size: 5 }], ['ga_ws_vendor_get', { p_id: '00000000-0000-4000-8000-000000000000' }],
    ['ga_ws_vendor_save', { p_id: null, p_payload: { name: 'x' }, p_expected_updated_at: null }], ['ga_ws_vendor_set_status', { p_id: '00000000-0000-4000-8000-000000000000', p_status: 'paused', p_expected_updated_at: null }],
    ['ga_ws_vendor_options', {}], ['ga_ws_svc_category_list', {}], ['ga_ws_svc_region_list', {}],
    ['ga_ws_svc_category_save', { p_id: null, p_payload: { name: 'x', code: 'X' }, p_expected_updated_at: null }], ['ga_ws_svc_region_save', { p_id: null, p_payload: { name: 'x', code: 'X' }, p_expected_updated_at: null }],
  ] as const) {
    const r = await callFn(anon, name, args as any);
    expect(r.ok, name).toBe(false);
    expect(r.status === 0 || r.status === 401, `${name} ${JSON.stringify(r)}`).toBe(true);
  }
});

test('廠商列表與詳情權限矩陣：只有廠商檢視／管理可看，其餘 403（含只有分類區域、只有合作紀錄、舊式管理員、店長）', async () => {
  const v = await seedGa6Vendor('MAT');
  const allowed: Ga6Key[] = ['vendor_mgr', 'vendor_view', 'ga_all', 'vendor_manage_only'];
  const denied: Ga6Key[] = ['cat_only', 'coop_only', 'purchaser', 'wo_works', 'rq_manager', 'approver', 'svc_mgr', 'nobody', 'admin', 'store_mgr'];
  for (const k of allowed) {
    const l = await fn(k, 'ga_ws_vendor_list', { p_filters: { search: v.name }, p_page: 1, p_page_size: 5 });
    expect(l.ok, `${k} list`).toBe(true);
    expect(l.data.total, k).toBe(1);
    const g = await fn(k, 'ga_ws_vendor_get', { p_id: v.id });
    expect(g.ok, `${k} get`).toBe(true);
    expect(g.can_manage, k).toBe(k !== 'vendor_view');
  }
  for (const k of denied) {
    const l = await fn(k, 'ga_ws_vendor_list', { p_filters: {}, p_page: 1, p_page_size: 5 });
    expect(l.status, `${k} list`).toBe(403);
    expect(JSON.stringify(l), k).not.toMatch(/tax_id|payment_terms|billing_/);
    const g = await fn(k, 'ga_ws_vendor_get', { p_id: v.id });
    expect(g.status, `${k} get`).toBe(403);
  }
  expect((await fn('vendor_mgr', 'ga_ws_vendor_get', { p_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
});

test('廠商寫入權限矩陣：只有廠商管理可新增、編輯、停用；廠商檢視也不行；資料不變', async () => {
  const v = await mk();
  const before = await row(v.id);
  const denied: Ga6Key[] = ['vendor_view', 'cat_only', 'coop_only', 'purchaser', 'wo_works', 'rq_manager', 'approver', 'svc_mgr', 'nobody', 'admin', 'store_mgr'];
  for (const k of denied) {
    const s1 = await save(k, { name: vname('X'), tax_id: await freshValidTaxId() });
    expect(s1.status, `${k} create`).toBe(403);
    const s2 = await save(k, { description: 'hack' }, v.id, before.updated_at);
    expect(s2.status, `${k} update`).toBe(403);
    const s3 = await fn(k, 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'inactive', p_expected_updated_at: before.updated_at });
    expect(s3.status, `${k} status`).toBe(403);
  }
  const after = await row(v.id);
  expect(after).toEqual(before);
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA6-%X%')).count).toBe(0);
  // 管理隱含查看；ga_all 也可寫
  expect((await save('vendor_manage_only', { description: 'ok' }, v.id, before.updated_at)).ok).toBe(true);
  const ga = await save('ga_all', { name: vname('G'), tax_id: await freshValidTaxId() });
  expect(ga.ok).toBe(true);
});

// ----------------------------------------------------------------------------- 新增、驗證
test('新增：回完整欄位、寫入修改者、預設不需簽合約（V4）、狀態合作中、附件檔名欄位不可由新增寫入', async () => {
  const tax = await freshValidTaxId();
  const r = await save('vendor_mgr', {
    name: vname('C'), alias: '別名甲', vendor_type: 'company', tax_id: ` ${tax.split('').join(' ')} `, contact_name: '王小明', contact_phone: '02-1234', email: 'a@b.co', tags: ['冷氣', ' 冷氣 ', '水電'], brands: ['X'],
    billing_title: '抬頭', payment_terms: '月結 30 天', payment_methods: ['匯款'], invoice_type: '三聯式', attachment_names: ['hack.pdf'], status: 'inactive', rating: 5, total_amount: 999,
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.status).toBe(201);
  const d = r.data;
  for (const f of SECRET_FIELDS) expect(d, f).toHaveProperty(f);
  expect(d.tax_id).toBe(tax);
  expect(d.tags).toEqual(['冷氣', '水電']);
  expect(d.contract_required).toBe(false);
  expect(d.preferred_vendor).toBe(false);
  expect(d.updated_by).toBe(users.vendor_mgr.id);
  const dbRow = await row(d.id);
  expect(dbRow).toMatchObject({ status: 'inactive', attachment_names: [], total_amount: 0, rating: 0, updated_by: users.vendor_mgr.id, tax_id: tax, payment_methods: ['匯款'] });
  const act = await save('vendor_mgr', { name: vname('C'), tax_id: await freshValidTaxId() });
  expect((await row(act.data.id)).status).toBe('active');
});

test('輸入驗證 400：名稱、類型、統編格式、公司需統編（個人可空）、Email、日期、合約日期順序、長度、欄位型態、分類區域不存在或停用', async () => {
  const tax = await freshValidTaxId();
  const bad = async (payload: Record<string, unknown>, code: string) => {
    const r = await save('vendor_mgr', { name: vname('B'), tax_id: tax, ...payload });
    expect(r.ok, JSON.stringify(payload)).toBe(false);
    expect(r.status, JSON.stringify(payload)).toBe(400);
    expect(r.code, JSON.stringify(payload)).toBe(code);
    expect(r.error).toMatch(/[㐀-鿿]/);
  };
  expect((await save('vendor_mgr', { alias: 'x' })).code).toBe('NAME_REQUIRED');
  expect((await save('vendor_mgr', { name: '   ' })).code).toBe('NAME_REQUIRED');
  expect((await save('vendor_mgr', null as any)).code).toBe('BAD_PAYLOAD');
  await bad({ vendor_type: 'x' }, 'VENDOR_TYPE');
  await bad({ tax_id: '1234567' }, 'TAX_ID_FORMAT');
  await bad({ tax_id: 'abcdefgh' }, 'TAX_ID_FORMAT');
  await bad({ tax_id: '123456789' }, 'TAX_ID_FORMAT');
  await bad({ tax_id: null }, 'TAX_ID_REQUIRED');
  await bad({ vendor_type: 'studio', tax_id: '' }, 'TAX_ID_REQUIRED');
  await bad({ email: 'not-an-email' }, 'EMAIL_FORMAT');
  await bad({ founded_date: '2038/01/01' }, 'DATE_FORMAT');
  await bad({ cooperation_start_date: '2038-02-30' }, 'DATE_FORMAT');
  await bad({ cooperation_start_date: '2038-06-01', contract_end_date: '2038-05-01' }, 'CONTRACT_DATES');
  await bad({ name: 'x'.repeat(101) }, 'FIELD_TOO_LONG');
  await bad({ tags: 'a' }, 'FIELD_TYPE');
  await bad({ tags: [1] }, 'FIELD_TYPE');
  await bad({ tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }, 'FIELD_TOO_MANY');
  await bad({ contract_required: 'yes' }, 'FIELD_TYPE');
  await bad({ same_service_address: null }, 'FIELD_TYPE');
  await bad({ service_category_ids: ['not-a-uuid'] }, 'FIELD_TYPE');
  await bad({ service_category_ids: ['00000000-0000-4000-8000-000000000000'] }, 'CATEGORY_NOT_FOUND');
  await bad({ service_region_ids: ['00000000-0000-4000-8000-000000000000'] }, 'REGION_NOT_FOUND');
  // 個人類型可空統編
  const p = await save('vendor_mgr', { name: vname('P'), vendor_type: 'personal' });
  expect(p.ok, JSON.stringify(p)).toBe(true);
  expect(p.data.tax_id).toBeNull();
  // 失敗不留半套資料
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA6-%-B%')).count).toBe(0);
});

test('停用的分類與區域不能新勾選，已勾選者保留並可繼續儲存；停用後廠商仍帶得出名稱', async () => {
  const c1 = await fn('ga_all', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('C-ON'), code: ga6Code('A1') }, p_expected_updated_at: null });
  const c2 = await fn('ga_all', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('C-OFF'), code: ga6Code('A2'), status: 'inactive' }, p_expected_updated_at: null });
  const r1 = await fn('ga_all', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: ga6Name('R-ON'), code: ga6Code('A1') }, p_expected_updated_at: null });
  const r2 = await fn('ga_all', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: ga6Name('R-ARC'), code: ga6Code('A2'), status: 'archived' }, p_expected_updated_at: null });
  for (const x of [c1, c2, r1, r2]) expect(x.ok, JSON.stringify(x)).toBe(true);
  const tax = await freshValidTaxId();
  expect((await save('vendor_mgr', { name: vname('K'), tax_id: tax, service_category_ids: [c2.data.id] })).code).toBe('CATEGORY_INACTIVE');
  expect((await save('vendor_mgr', { name: vname('K'), tax_id: tax, service_region_ids: [r2.data.id] })).code).toBe('REGION_INACTIVE');
  const ok = await save('vendor_mgr', { name: vname('K'), tax_id: tax, service_category_ids: [c1.data.id], service_region_ids: [r1.data.id] });
  expect(ok.ok, JSON.stringify(ok)).toBe(true);
  // 分類與區域事後停用：廠商仍保留勾選、仍顯示名稱、再儲存其他欄位不被擋
  const off = await fn('ga_all', 'ga_ws_svc_category_save', { p_id: c1.data.id, p_payload: { status: 'inactive' }, p_expected_updated_at: c1.data.updated_at });
  expect(off.ok).toBe(true);
  const g = await fn('vendor_view', 'ga_ws_vendor_get', { p_id: ok.data.id });
  expect(g.data.service_categories).toEqual([{ id: c1.data.id, name: ga6Name('C-ON'), status: 'inactive' }]);
  const again = await save('vendor_mgr', { description: '改備註', service_category_ids: [c1.data.id] }, ok.data.id, g.data.updated_at);
  expect(again.ok, JSON.stringify(again)).toBe(true);
  expect((await row(ok.data.id)).service_category_ids).toEqual([c1.data.id]);
});

// ----------------------------------------------------------------------------- 統編
test('統編唯一（409 TAX_ID_DUPLICATE 指出既有廠商）：全形與空白標準化後相同也擋、含停用廠商、換成自己的不算重複、失敗不新增', async () => {
  const tax = await freshValidTaxId();
  const a = await mk({ tax_id: tax });
  const fw = tax.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  for (const form of [tax, ` ${tax} `, fw, `${tax.slice(0, 4)} ${tax.slice(4)}`]) {
    const r = await save('vendor_mgr', { name: vname('D'), tax_id: form });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe('TAX_ID_DUPLICATE');
    expect(r.existing).toMatchObject({ id: a.id, name: a.name, status: 'active' });
    expect(r.error).toContain(a.name);
  }
  // 停用廠商的統編也不能再用，訊息標示狀態
  const off = await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: a.id, p_status: 'inactive', p_expected_updated_at: a.updated_at });
  expect(off.ok).toBe(true);
  const r2 = await save('vendor_mgr', { name: vname('D'), tax_id: tax });
  expect(r2.code).toBe('TAX_ID_DUPLICATE');
  expect(r2.existing.status).toBe('inactive');
  expect(r2.error).toContain('停用');
  // 編輯既有廠商把統編改成別家的 → 擋；改成自己的原值 → 通過
  const b = await mk();
  const clash = await save('vendor_mgr', { tax_id: tax }, b.id, b.updated_at);
  expect(clash.code).toBe('TAX_ID_DUPLICATE');
  expect((await row(b.id)).tax_id).toBe(b.tax_id);
  const self = await save('vendor_mgr', { tax_id: b.tax_id, description: 'same' }, b.id, b.updated_at);
  expect(self.ok, JSON.stringify(self)).toBe(true);
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', tax)).count).toBe(1);
});

test('統編重複擋下時並行送出只會成功一筆（advisory lock 序列化）', async () => {
  const tax = await freshValidTaxId();
  const results = await Promise.all([1, 2, 3, 4].map((i) => save(i % 2 ? 'vendor_mgr' : 'ga_all', { name: vname('Q'), tax_id: tax })));
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok).every((r) => r.code === 'TAX_ID_DUPLICATE' || r.code === 'BUSY')).toBe(true);
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', tax)).count).toBe(1);
});

test('統編唯一索引（決定 1，2026-11-18）：直接 insert 正規化後重複的統編被索引擋下、空值不算、ga_ws_vendor_save 遇索引衝突轉成 409 TAX_ID_DUPLICATE', async () => {
  const tax = await freshValidTaxId();
  const a = await mk({ tax_id: tax });
  // 直接 insert（service role，繞過 RPC）：全形、含空白的同一統編都被唯一索引擋下（23505）
  const fw = tax.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  for (const form of [tax, ` ${tax} `, fw]) {
    const ins = await db().from('ga_vendors').insert({ name: vname('IX'), vendor_type: 'company', tax_id: form });
    expect(ins.error?.code, form).toBe('23505');
    expect(ins.error?.message).toContain('ga_vendors_tax_id_norm_uidx');
  }
  // 使用者身分（舊頁直接寫表的路徑）：索引運算式要能執行（不是 permission denied），重複則 23505
  const asUser = await users.ga_all.client.from('ga_vendors').insert({ name: vname('IX'), vendor_type: 'company', tax_id: tax });
  expect(asUser.error?.code, asUser.error?.message).toBe('23505');
  // 停用廠商的統編也受索引保護
  await db().from('ga_vendors').update({ status: 'inactive' }).eq('id', a.id);
  const ins2 = await db().from('ga_vendors').insert({ name: vname('IX'), vendor_type: 'company', tax_id: tax });
  expect(ins2.error?.code).toBe('23505');
  // 空值與空字串不算：可以有多筆沒有統編的廠商
  for (let i = 0; i < 2; i += 1) {
    const nul = await db().from('ga_vendors').insert({ name: vname('NU'), vendor_type: 'personal', tax_id: null });
    expect(nul.error, JSON.stringify(nul.error)).toBeNull();
  }
  const blank = await db().from('ga_vendors').insert({ name: vname('NU'), vendor_type: 'personal', tax_id: '  ' });
  expect(blank.error, JSON.stringify(blank.error)).toBeNull();
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', tax)).count).toBe(1);
});

test('統編唯一索引：ga_ws_vendor_save 並行儲存同統編，一筆成功、其餘為白話 409 TAX_ID_DUPLICATE（不是 500）並指出既有廠商', async () => {
  const tax = await freshValidTaxId();
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => save(i % 2 ? 'vendor_mgr' : 'ga_all', { name: vname('PQ'), tax_id: tax })));
  const okRows = results.filter((r) => r.ok);
  expect(okRows).toHaveLength(1);
  const fails = results.filter((r) => !r.ok);
  expect(fails).toHaveLength(5);
  for (const f of fails) {
    expect(f.status).toBe(409);
    expect(f.code).toBe('TAX_ID_DUPLICATE');
    expect(f.existing).toMatchObject({ id: okRows[0].data.id });
    expect(f.error).toContain('同一個統編不能重複建立');
  }
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', tax)).count).toBe(1);
});

test('歷史格式的統編（前後有空白、全形）的舊廠商：編輯其他欄位不被擋（統編沒變就不檢查）；有唯一索引後，歷史重複統編不可能存在（決定 1）', async () => {
  const tax = await freshValidTaxId();
  const a = await seedGa6Vendor('LEG1', { tax_id: ` ${tax} ` });
  const r = await save('vendor_mgr', { description: '只改簡介' }, a.id, a.updated_at);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  // 索引存在後，同一統編（正規化後）再寫第二筆會被擋下，所以不會再有「歷史重複」的舊廠商
  const dup = await db().from('ga_vendors').insert({ name: vname('LEG'), vendor_type: 'company', tax_id: tax });
  expect(dup.error?.code).toBe('23505');
});

test('檢查碼不符只提醒（仍可儲存）；檢查碼正確不提醒', async () => {
  const bad = await freshInvalidTaxId();
  const r = await save('vendor_mgr', { name: vname('W'), tax_id: bad });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.warnings.map((w: any) => w.code)).toContain('TAX_CHECKSUM');
  expect((await row(r.data.id)).tax_id).toBe(bad);
  const good = await save('vendor_mgr', { name: vname('W'), tax_id: await freshValidTaxId() });
  expect(good.warnings.map((w: any) => w.code)).not.toContain('TAX_CHECKSUM');
});

// ----------------------------------------------------------------------------- 名稱相近
test('名稱相近只提醒：正規化後相同、互相包含、別名也比；可儲存；不相近不提醒；編輯沒改名稱不再提醒', async () => {
  const base = ga6Name(`SIM${String((seq += 1)).padStart(3, '0')}`);
  const a = await save('vendor_mgr', { name: `${base} 有限公司`, tax_id: await freshValidTaxId() });
  expect(a.ok).toBe(true);
  expect(a.warnings.filter((w: any) => w.code === 'NAME_SIMILAR' && w.vendors.some((x: any) => x.name.startsWith('QA-GA6-')))).toEqual([]);
  const same = await save('vendor_mgr', { name: `${base}企業社`, tax_id: await freshValidTaxId() });
  expect(same.ok, JSON.stringify(same)).toBe(true);
  const w = same.warnings.find((x: any) => x.code === 'NAME_SIMILAR');
  expect(w.vendors.map((x: any) => x.id)).toContain(a.data.id);
  expect(w.message).toContain('名稱相近');
  const inc = await save('vendor_mgr', { name: `${base}工程行`, tax_id: await freshValidTaxId() });
  expect(inc.warnings.find((x: any) => x.code === 'NAME_SIMILAR').vendors.map((x: any) => x.id)).toEqual(expect.arrayContaining([a.data.id, same.data.id]));
  const viaAlias = await save('vendor_mgr', { name: vname('Z'), alias: base, tax_id: await freshValidTaxId() });
  expect(viaAlias.warnings.find((x: any) => x.code === 'NAME_SIMILAR').vendors.map((x: any) => x.id)).toContain(a.data.id);
  const unrelated = await save('vendor_mgr', { name: vname('U'), tax_id: await freshValidTaxId() });
  expect(unrelated.warnings.filter((x: any) => x.code === 'NAME_SIMILAR' && x.vendors.some((v: any) => [a.data.id, same.data.id].includes(v.id)))).toEqual([]);
  const edit = await save('vendor_mgr', { description: '只改簡介' }, same.data.id, same.data.updated_at);
  expect(edit.warnings.filter((x: any) => x.code === 'NAME_SIMILAR')).toEqual([]);
  const rename = await save('vendor_mgr', { name: `${base}企業行` }, same.data.id, edit.data.updated_at);
  expect(rename.warnings.some((x: any) => x.code === 'NAME_SIMILAR')).toBe(true);
});

// ----------------------------------------------------------------------------- 編輯、版本
test('編輯：缺少版本 400、舊版本 409 STALE（資料不變）、部分欄位更新不動其他欄位、留修改者與時間、可清空欄位', async () => {
  const v = await mk({ description: '原簡介', phone: '02-0000', contract_required: true, contract_end_date: '2038-12-31' });
  const noExp = await save('vendor_mgr', { description: 'x' }, v.id, null);
  expect([noExp.status, noExp.code]).toEqual([400, 'EXPECTED_REQUIRED']);
  const upd = await save('ga_all', { description: '新簡介', phone: null }, v.id, v.updated_at);
  expect(upd.ok, JSON.stringify(upd)).toBe(true);
  expect(upd.status).toBe(200);
  expect(upd.data.description).toBe('新簡介');
  expect(upd.data.phone).toBeNull();
  expect(upd.data.name).toBe(v.name);
  expect(upd.data.tax_id).toBe(v.tax_id);
  expect(upd.data.contract_required).toBe(true);
  expect(upd.data.contract_end_date).toBe('2038-12-31');
  expect(upd.data.updated_by).toBe(users.ga_all.id);
  expect(upd.data.updated_at).not.toBe(v.updated_at);
  const stale = await save('vendor_mgr', { description: '舊版本覆蓋' }, v.id, v.updated_at);
  expect([stale.status, stale.code]).toEqual([409, 'STALE']);
  expect((await row(v.id)).description).toBe('新簡介');
  expect((await save('vendor_mgr', { description: 'x' }, '00000000-0000-4000-8000-000000000000', v.updated_at)).status).toBe(404);
  // 唯讀欄位（累計金額、評價、狀態）不能由編輯寫入
  const sneaky = await save('vendor_mgr', { total_amount: 5, rating: 5, status: 'inactive', attachment_names: ['a'] }, v.id, upd.data.updated_at);
  expect(sneaky.ok).toBe(true);
  expect(await row(v.id)).toMatchObject({ total_amount: 0, rating: 0, status: 'active', attachment_names: [] });
});

test('並行編輯同一廠商：用同一個版本送出，只有一個成功，另一個 409 STALE', async () => {
  const v = await mk();
  const [a, b] = await Promise.all([save('vendor_mgr', { description: 'A 寫入' }, v.id, v.updated_at), save('ga_all', { description: 'B 寫入' }, v.id, v.updated_at)]);
  expect([a, b].filter((r) => r.ok)).toHaveLength(1);
  expect([a, b].find((r) => !r.ok)!.code).toBe('STALE');
});

// ----------------------------------------------------------------------------- 狀態與停用提醒
test('停用與暫停：沒有刪除；版本必填；同狀態冪等；有進行中工單時回 OPEN_DOCS 提醒筆數但不擋；改回合作中不提醒', async () => {
  const v = await mk();
  const w1 = await seedWorkOrder('VW001', `GA6-WO-${(seq += 1)}`, users.store_mgr.id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', vendor_id: v.id, accepted_at: new Date().toISOString() });
  const w2 = await seedWorkOrder('ZT01', `GA6-WO-${(seq += 1)}`, users.store_mgr.id, { status: 'COMPLETED', vendor_id: v.id });
  expect([w1.id, w2.id]).toHaveLength(2);
  expect((await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'bogus', p_expected_updated_at: v.updated_at })).code).toBe('STATUS');
  expect((await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'paused', p_expected_updated_at: null })).code).toBe('EXPECTED_REQUIRED');
  const stale = await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'paused', p_expected_updated_at: '2000-01-01T00:00:00Z' });
  expect([stale.status, stale.code]).toEqual([409, 'STALE']);
  expect((await row(v.id)).status).toBe('active');
  const paused = await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'paused', p_expected_updated_at: v.updated_at });
  expect(paused.ok, JSON.stringify(paused)).toBe(true);
  expect(paused.data.status).toBe('paused');
  expect(paused.data.updated_by).toBe(users.vendor_mgr.id);
  expect(paused.warnings).toHaveLength(1);
  expect(paused.warnings[0]).toMatchObject({ code: 'OPEN_DOCS', open_work_orders: 1, open_purchase_orders: 0 });
  expect(paused.warnings[0].message).toContain('1 張進行中工單');
  // 同狀態：不寫入（updated_at 不變）、仍回提醒
  const same = await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'paused', p_expected_updated_at: paused.data.updated_at });
  expect(same.ok).toBe(true);
  expect(same.data.updated_at).toBe(paused.data.updated_at);
  const back = await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: v.id, p_status: 'active', p_expected_updated_at: same.data.updated_at });
  expect(back.ok).toBe(true);
  expect(back.warnings).toEqual([]);
  // 沒有刪除函式
  const del = await callFn(users.vendor_mgr.client, 'ga_ws_vendor_delete', { p_id: v.id });
  expect(del.ok).toBe(false);
  expect(await row(v.id)).toBeTruthy();
});

// ----------------------------------------------------------------------------- 列表
test('列表：搜尋（名稱、別名、聯絡人、電話、標籤）、狀態與類型與分類區域篩選、合約到期篩選、分頁精確筆數、搜尋跳脫、統計卡', async () => {
  const cat = await fn('ga_all', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('LC'), code: ga6Code('L1') }, p_expected_updated_at: null });
  const reg = await fn('ga_all', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: ga6Name('LR'), code: ga6Code('L1') }, p_expected_updated_at: null });
  const key = `LST${String((seq += 1)).padStart(3, '0')}`;
  const a = await mk({ name: ga6Name(`${key}-A`), alias: `別名${key}`, contact_name: `聯絡${key}`, contact_phone: '0911', tags: [`標籤${key}`], service_category_ids: [cat.data.id], service_region_ids: [reg.data.id] });
  const b = await mk({ name: ga6Name(`${key}-B`), vendor_type: 'studio' });
  const c = await mk({ name: ga6Name(`${key}-C`) });
  await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: c.id, p_status: 'paused', p_expected_updated_at: c.updated_at });
  const list = (filters: Record<string, unknown>, size = 20, page = 1) => fn('vendor_view', 'ga_ws_vendor_list', { p_filters: filters, p_page: page, p_page_size: size });
  expect((await list({ search: key })).data.total).toBe(3);
  expect((await list({ search: `別名${key}` })).data.rows.map((r: any) => r.id)).toEqual([a.id]);
  expect((await list({ search: `聯絡${key}` })).data.total).toBe(1);
  expect((await list({ search: `標籤${key}` })).data.total).toBe(1);
  expect((await list({ search: key, status: 'paused' })).data.rows.map((r: any) => r.id)).toEqual([c.id]);
  expect((await list({ search: key, vendor_type: 'studio' })).data.rows.map((r: any) => r.id)).toEqual([b.id]);
  expect((await list({ category_id: cat.data.id })).data.rows.map((r: any) => r.id)).toEqual([a.id]);
  expect((await list({ region_id: reg.data.id })).data.rows.map((r: any) => r.id)).toEqual([a.id]);
  // 萬用字元跳脫：% 與 _ 不當萬用字元
  expect((await list({ search: '%' })).data.total).toBe(0);
  expect((await list({ search: `${key}_A` })).data.total).toBe(0);
  expect((await list({ search: "'; drop table ga_vendors; --" })).ok).toBe(true);
  // 分頁：總筆數精確、單頁上限 100
  const p1 = await list({ search: key }, 2, 1);
  const p2 = await list({ search: key }, 2, 2);
  expect([p1.data.rows.length, p2.data.rows.length, p1.data.total, p2.data.total]).toEqual([2, 1, 3, 3]);
  expect((await list({ search: key }, 1000)).data.page_size).toBe(100);
  expect((await list({ status: 'x' })).code).toBe('BAD_FILTER');
  expect((await list({ vendor_type: 'x' })).code).toBe('BAD_FILTER');
  // 統計卡（全表）：包含三種狀態
  const s = (await list({})).data.stats;
  expect(s.total).toBe(s.active + s.paused + s.inactive);
  expect(s.paused).toBeGreaterThanOrEqual(1);
  // 合約到期篩選（V4）：需簽約＋合作中＋到期日 30 天內或已過期
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const due1 = await mk({ name: ga6Name(`${key}-D1`), contract_required: true, contract_end_date: plus(30) });
  const due2 = await mk({ name: ga6Name(`${key}-D2`), contract_required: true, contract_end_date: plus(-5) });
  await mk({ name: ga6Name(`${key}-D3`), contract_required: true, contract_end_date: plus(31) });
  await mk({ name: ga6Name(`${key}-D4`), contract_required: false, contract_end_date: plus(1) });
  await mk({ name: ga6Name(`${key}-D5`), contract_required: true });
  const d6 = await mk({ name: ga6Name(`${key}-D6`), contract_required: true, contract_end_date: plus(1) });
  await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: d6.id, p_status: 'inactive', p_expected_updated_at: d6.updated_at });
  const due = await list({ contract_due: true, search: key });
  expect(due.data.rows.map((r: any) => r.id).sort()).toEqual([due1.id, due2.id].sort());
  expect(due.data.rows.every((r: any) => r.contract_due)).toBe(true);
  expect(due.data.total).toBe(2);
  expect(due.data.stats.contract_due).toBeGreaterThanOrEqual(2);
});

// ----------------------------------------------------------------------------- 下拉
test('廠商下拉（V2、V1）：可用權限矩陣、只列合作中、含聯絡人與電話；統編與付款條件只給廠商檢視／管理，其餘回應完全沒有帳務欄位；includeIds 帶出已停用', async () => {
  const key = `OPT${String((seq += 1)).padStart(3, '0')}`;
  const act = await mk({ name: ga6Name(`${key}-A`), contact_name: '王經理', contact_phone: '02-9999', payment_terms: '月結 30 天', billing_title: '機密抬頭', accounting_notes: '機密備註' });
  const pau = await mk({ name: ga6Name(`${key}-P`) });
  const ina = await mk({ name: ga6Name(`${key}-I`) });
  await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: pau.id, p_status: 'paused', p_expected_updated_at: pau.updated_at });
  await fn('vendor_mgr', 'ga_ws_vendor_set_status', { p_id: ina.id, p_status: 'inactive', p_expected_updated_at: ina.updated_at });
  const opt = (who: Ga6Key, extra: Record<string, unknown> = {}) => fn(who, 'ga_ws_vendor_options', { p_q: key, p_page: 1, p_page_size: 50, ...extra });
  for (const k of ['purchaser', 'wo_works', 'rq_manager', 'approver'] as Ga6Key[]) {
    const r = await opt(k);
    expect(r.ok, `${k} ${JSON.stringify(r)}`).toBe(true);
    expect(r.billing_visible, k).toBe(false);
    expect(r.data.map((x: any) => x.id), k).toEqual([act.id]);
    expect(r.data[0], k).toMatchObject({ name: act.name, contact_name: '王經理', contact_phone: '02-9999', status: 'active' });
    const txt = JSON.stringify(r);
    for (const f of SECRET_FIELDS) expect(txt, `${k} ${f}`).not.toContain(`"${f}"`);
    expect(txt, k).not.toMatch(/月結|機密/);
  }
  for (const k of ['vendor_mgr', 'vendor_view', 'ga_all'] as Ga6Key[]) {
    const r = await opt(k);
    expect(r.billing_visible, k).toBe(true);
    expect(r.data[0], k).toMatchObject({ tax_id: act.tax_id, payment_terms: '月結 30 天' });
    expect(JSON.stringify(r)).not.toContain('billing_title');
  }
  for (const k of ['cat_only', 'coop_only', 'svc_mgr', 'nobody', 'admin', 'store_mgr'] as Ga6Key[]) expect((await opt(k)).status, k).toBe(403);
  const inc = await opt('wo_works', { p_include_ids: [ina.id, pau.id] });
  expect(inc.data.map((x: any) => `${x.id}:${x.status}`).sort()).toEqual([`${act.id}:active`, `${ina.id}:inactive`, `${pau.id}:paused`].sort());
  expect(inc.total).toBe(3);
  expect((await opt('wo_works', { p_include_ids: Array.from({ length: 101 }, () => ina.id) })).code).toBe('TOO_MANY');
  // 搜尋跳脫與分頁上限
  expect((await opt('wo_works', { p_q: '%' })).total).toBe(0);
  expect((await opt('wo_works', { p_q: key, p_page_size: 1000 })).page_size).toBe(100);
});

// ----------------------------------------------------------------------------- 服務分類
test('服務分類：權限矩陣（看＝分類檢視／管理或廠商檢視／管理；寫＝分類管理）、只有廠商權限者只看啟用、沒有合作紀錄權限', async () => {
  const c = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CM-A'), code: ga6Code('M1') }, p_expected_updated_at: null });
  const off = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CM-B'), code: ga6Code('M2'), status: 'inactive' }, p_expected_updated_at: null });
  expect([c.ok, off.ok]).toEqual([true, true]);
  const list = (who: Ga6Key) => fn(who, 'ga_ws_svc_category_list', { p_filters: { search: ga6Name('CM-') }, p_page: 1, p_page_size: 50 });
  for (const k of ['cat_only', 'svc_mgr', 'ga_all'] as Ga6Key[]) expect((await list(k)).data.total, k).toBe(2);
  expect((await list('cat_only')).data.can_manage).toBe(false);
  expect((await list('svc_mgr')).data.can_manage).toBe(true);
  for (const k of ['vendor_view', 'vendor_mgr'] as Ga6Key[]) {
    const r = await list(k);
    expect(r.data.total, k).toBe(1); // 只讀得到啟用的
    expect(r.data.can_manage, k).toBe(false);
  }
  for (const k of ['coop_only', 'purchaser', 'wo_works', 'nobody', 'admin', 'store_mgr'] as Ga6Key[]) expect((await list(k)).status, k).toBe(403);
  expect((await fn('cat_only', 'ga_ws_svc_category_get', { p_id: c.data.id })).ok).toBe(true);
  expect((await fn('coop_only', 'ga_ws_svc_category_get', { p_id: c.data.id })).status).toBe(403);
  for (const k of ['cat_only', 'vendor_mgr', 'coop_only', 'purchaser', 'nobody', 'admin', 'store_mgr'] as Ga6Key[]) {
    const r = await fn(k, 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CM-X'), code: ga6Code('MX') }, p_expected_updated_at: null });
    expect(r.status, k).toBe(403);
    const u = await fn(k, 'ga_ws_svc_category_save', { p_id: c.data.id, p_payload: { name: '駭' }, p_expected_updated_at: c.data.updated_at });
    expect(u.status, k).toBe(403);
  }
  expect((await db().from('ga_service_categories').select('name').eq('id', c.data.id).single()).data!.name).toBe(ga6Name('CM-A'));
});

test('服務分類編輯：代碼轉大寫與唯一與鎖定、格式、上層循環防止、STALE、停用後仍列出名稱、排序與常用項目、options 模式', async () => {
  const code = ga6Code('E1');
  const a = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CE-A'), code: code.toLowerCase(), description: '說明', sort_order: 5, common_items: ['冷氣維修', ' 冷氣維修 ', '保養'], icon_key: 'zap' }, p_expected_updated_at: null });
  expect(a.ok, JSON.stringify(a)).toBe(true);
  expect(a.status).toBe(201);
  expect(a.data).toMatchObject({ code, sort_order: 5, common_items: ['冷氣維修', '保養'], icon_key: 'zap', status: 'active' });
  expect((await db().from('ga_service_categories').select('updated_by').eq('id', a.data.id).single()).data!.updated_by).toBe(users.svc_mgr.id);
  const dup = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CE-DUP'), code }, p_expected_updated_at: null });
  expect([dup.status, dup.code]).toEqual([409, 'CODE_DUPLICATE']);
  expect(dup.error).toContain(ga6Name('CE-A'));
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CE-BAD'), code: 'X'.repeat(31) }, p_expected_updated_at: null })).code).toBe('FIELD_TOO_LONG');
  for (const bad of ['a b', '-X', '', '中文']) {
    const r = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CE-BAD'), code: bad }, p_expected_updated_at: null });
    expect([r.status, r.code], bad).toEqual([400, 'CODE_FORMAT']);
  }
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { code: ga6Code('E2') }, p_expected_updated_at: null })).code).toBe('NAME_REQUIRED');
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: 'n', code: ga6Code('E3'), status: 'archived' }, p_expected_updated_at: null })).code).toBe('STATUS');
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: 'n', code: ga6Code('E3'), sort_order: 1.5 }, p_expected_updated_at: null })).code).toBe('FIELD_TYPE');
  // 鎖定與版本
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { code: ga6Code('E9') }, p_expected_updated_at: a.data.updated_at })).code).toBe('CODE_LOCKED');
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { name: 'x' }, p_expected_updated_at: null })).code).toBe('EXPECTED_REQUIRED');
  const same = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { code: code.toLowerCase(), name: ga6Name('CE-A2') }, p_expected_updated_at: a.data.updated_at });
  expect(same.ok, JSON.stringify(same)).toBe(true);
  expect(same.data.name).toBe(ga6Name('CE-A2'));
  const stale = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { name: '舊' }, p_expected_updated_at: a.data.updated_at });
  expect([stale.status, stale.code]).toEqual([409, 'STALE']);
  // 上層與循環
  const b = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CE-B'), code: ga6Code('E4'), parent_id: a.data.id }, p_expected_updated_at: null });
  const c = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: null, p_payload: { name: ga6Name('CE-C'), code: ga6Code('E5'), parent_id: b.data.id }, p_expected_updated_at: null });
  expect([b.ok, c.ok]).toEqual([true, true]);
  const self = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { parent_id: a.data.id }, p_expected_updated_at: same.data.updated_at });
  expect(self.code).toBe('PARENT_CYCLE');
  const grand = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { parent_id: c.data.id }, p_expected_updated_at: same.data.updated_at });
  expect([grand.status, grand.code]).toEqual([400, 'PARENT_CYCLE']);
  expect((await db().from('ga_service_categories').select('parent_id').eq('id', a.data.id).single()).data!.parent_id).toBeNull();
  expect((await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: c.data.id, p_payload: { parent_id: '00000000-0000-4000-8000-000000000000' }, p_expected_updated_at: c.data.updated_at })).code).toBe('PARENT_NOT_FOUND');
  const moved = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: c.data.id, p_payload: { parent_id: a.data.id }, p_expected_updated_at: c.data.updated_at });
  expect(moved.ok).toBe(true);
  const root0 = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: c.data.id, p_payload: { parent_id: null }, p_expected_updated_at: moved.data.updated_at });
  expect(root0.data.parent_id).toBeNull();
  // 停用後仍列出名稱（分類檢視者看得到，狀態 inactive）；子分類數與廠商使用數
  const v = await mk({ service_category_ids: [a.data.id] });
  const off = await fn('svc_mgr', 'ga_ws_svc_category_save', { p_id: a.data.id, p_payload: { status: 'inactive' }, p_expected_updated_at: same.data.updated_at });
  expect(off.ok).toBe(true);
  const got = await fn('cat_only', 'ga_ws_svc_category_get', { p_id: a.data.id });
  expect(got.data).toMatchObject({ status: 'inactive', name: ga6Name('CE-A2'), vendor_count: 1, child_count: 1 });
  expect(v.id).toBeTruthy();
  const opts = await fn('cat_only', 'ga_ws_svc_category_list', { p_filters: { options: true }, p_page: 1, p_page_size: 5 });
  expect(opts.data.rows.length).toBe(opts.data.total);
  expect(opts.data.rows.some((r: any) => r.id === a.data.id)).toBe(true);
  // 沒有刪除函式
  expect((await callFn(users.svc_mgr.client, 'ga_ws_svc_category_delete', { p_id: a.data.id })).ok).toBe(false);
});

// ----------------------------------------------------------------------------- 服務區域
test('服務區域：權限矩陣、類型與狀態（含封存）、代碼鎖定、循環防止、縣市行政區固定資料已放入且可選用', async () => {
  const list = (who: Ga6Key, filters: Record<string, unknown> = {}) => fn(who, 'ga_ws_svc_region_list', { p_filters: filters, p_page: 1, p_page_size: 50 });
  for (const k of ['cat_only', 'svc_mgr', 'ga_all', 'vendor_view'] as Ga6Key[]) expect((await list(k)).ok, k).toBe(true);
  for (const k of ['coop_only', 'purchaser', 'nobody', 'admin', 'store_mgr'] as Ga6Key[]) expect((await list(k)).status, k).toBe(403);
  // 固定資料：22 縣市、約 350 行政區、台灣與大區
  const dbCnt = async (type: string) => (await db().from('ga_service_regions').select('id', { count: 'exact', head: true }).eq('region_type', type).not('code', 'like', 'QA-GA6-%').neq('code', 'TEST')).count || 0;
  expect(await dbCnt('city')).toBeGreaterThanOrEqual(22);
  expect(await dbCnt('district')).toBeGreaterThanOrEqual(330);
  const tw = await db().from('ga_service_regions').select('code,region_type').in('code', ['TW', 'TW-N', 'TW-C', 'TW-S', 'TW-E', 'TW-O']);
  expect(tw.data!.length).toBe(6);
  const tpe = (await list('cat_only', { search: '大安區', region_type: 'district' })).data;
  expect(tpe.total).toBeGreaterThanOrEqual(2);
  const opts = await fn('vendor_view', 'ga_ws_svc_region_list', { p_filters: { options: true }, p_page: 1, p_page_size: 5 });
  expect(opts.data.rows.length).toBeGreaterThanOrEqual(350);
  expect(opts.data.rows.every((r: any) => r.status === 'active')).toBe(true);
  // 固定資料的行政區可被廠商勾選
  const kee = (await db().from('ga_service_regions').select('id').eq('code', 'TPE-05').single()).data!.id;
  const v = await mk({ service_region_ids: [kee] });
  expect(v.service_regions[0]).toMatchObject({ id: kee, name: '大安區', region_type: 'district' });
  // 新增、編輯、鎖定、循環、停用與封存
  const a = await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: ga6Name('RE-A'), code: ga6Code('R1'), region_type: 'region', included_locations: ['甲', '甲', '乙'], sort_order: 3 }, p_expected_updated_at: null });
  expect(a.ok, JSON.stringify(a)).toBe(true);
  expect(a.data).toMatchObject({ region_type: 'region', included_locations: ['甲', '乙'], status: 'active', sort_order: 3 });
  expect((await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: 'x', code: ga6Code('R1') }, p_expected_updated_at: null })).code).toBe('CODE_DUPLICATE');
  expect((await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: 'x', code: ga6Code('R2'), region_type: 'planet' }, p_expected_updated_at: null })).code).toBe('REGION_TYPE');
  expect((await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: a.data.id, p_payload: { code: ga6Code('R7') }, p_expected_updated_at: a.data.updated_at })).code).toBe('CODE_LOCKED');
  const b = await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: ga6Name('RE-B'), code: ga6Code('R3'), parent_id: a.data.id, region_type: 'city' }, p_expected_updated_at: null });
  expect((await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: a.data.id, p_payload: { parent_id: b.data.id }, p_expected_updated_at: a.data.updated_at })).code).toBe('PARENT_CYCLE');
  expect((await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: a.data.id, p_payload: { parent_id: a.data.id }, p_expected_updated_at: a.data.updated_at })).code).toBe('PARENT_CYCLE');
  const arch = await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: b.data.id, p_payload: { status: 'archived' }, p_expected_updated_at: b.data.updated_at });
  expect(arch.data.status).toBe('archived');
  expect((await fn('svc_mgr', 'ga_ws_svc_region_save', { p_id: b.data.id, p_payload: { name: '舊' }, p_expected_updated_at: b.data.updated_at })).code).toBe('STALE');
  expect((await list('cat_only', { status: 'archived', search: ga6Name('RE-') })).data.total).toBe(1);
  expect((await list('vendor_view', { search: ga6Name('RE-') })).data.total).toBe(1); // 只有廠商權限者只看啟用
  for (const k of ['cat_only', 'vendor_mgr', 'purchaser', 'nobody', 'admin', 'store_mgr'] as Ga6Key[]) {
    expect((await fn(k, 'ga_ws_svc_region_save', { p_id: null, p_payload: { name: 'x', code: ga6Code('RX') }, p_expected_updated_at: null })).status, k).toBe(403);
  }
  expect((await callFn(users.svc_mgr.client, 'ga_ws_svc_region_delete', { p_id: a.data.id })).ok).toBe(false);
});

// ----------------------------------------------------------------------------- 資料庫層（BEGIN…ROLLBACK）
test('資料庫層（交易內執行、結束一律回復）：名稱與統編正規化函式、檢查碼、樹狀循環、合約到期邊界、欄位預設值、廠商不能硬刪（無 DELETE 政策）', async () => {
  test.setTimeout(180_000);
  const out = runSqlDo(`
DECLARE
  r_norm text; r_norm2 text; r_tax text; r_chk1 boolean; r_chk2 boolean; r_chk3 boolean; r_cyc1 boolean; r_cyc2 boolean; r_due text; r_def text; r_idx int; r_uq int;
  v_a uuid; v_b uuid; v_c uuid; v_today date := public.ga_po_today();
BEGIN
  r_norm := public.ga_vd_norm_name('  ＡＢＣ　空調 (股份)有限公司 ');
  r_norm2 := public.ga_vd_norm_name('甲乙股份有限公司');
  r_tax := public.ga_vd_norm_tax(' ０４５９ ５２５７ ');
  r_chk1 := public.ga_vd_tax_checksum_ok('04595257');
  r_chk2 := public.ga_vd_tax_checksum_ok('12345678');
  r_chk3 := public.ga_vd_tax_checksum_ok('10458574');
  INSERT INTO public.ga_service_categories (name, code) VALUES ('${ga6Name('SQL-A')}', '${ga6Code('Q1')}') RETURNING id INTO v_a;
  INSERT INTO public.ga_service_categories (name, code, parent_id) VALUES ('${ga6Name('SQL-B')}', '${ga6Code('Q2')}', v_a) RETURNING id INTO v_b;
  INSERT INTO public.ga_service_categories (name, code, parent_id) VALUES ('${ga6Name('SQL-C')}', '${ga6Code('Q3')}', v_b) RETURNING id INTO v_c;
  r_cyc1 := public.ga_vd_tree_cycle('ga_service_categories', v_a, v_c);
  r_cyc2 := public.ga_vd_tree_cycle('ga_service_categories', v_c, v_a);
  r_due := public.ga_vd_contract_due('active', true, v_today + 30)::text || public.ga_vd_contract_due('active', true, v_today + 31)::text || public.ga_vd_contract_due('active', true, v_today - 1)::text
        || public.ga_vd_contract_due('active', false, v_today)::text || public.ga_vd_contract_due('paused', true, v_today)::text || public.ga_vd_contract_due('active', true, NULL)::text;
  INSERT INTO public.ga_vendors (name) VALUES ('${ga6Name('SQL-V')}') RETURNING id INTO v_a;
  SELECT contract_required::text || preferred_vendor::text || vendor_type || status || total_amount::text INTO r_def FROM public.ga_vendors WHERE id = v_a;
  SELECT count(*) INTO r_idx FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('ga_vendors', 'ga_service_categories', 'ga_service_regions') AND cmd IN ('DELETE', 'ALL');
  SELECT count(*) INTO r_uq FROM pg_indexes WHERE tablename IN ('ga_service_categories', 'ga_service_regions') AND indexname IN ('uq_ga_service_categories_code', 'uq_ga_service_regions_code');
  RAISE EXCEPTION 'G20DB:norm=%,norm2=%,tax=%,chk=%/%/%,cyc=%/%,due=%,def=%,delpol=%,uq=%:END', r_norm, r_norm2, r_tax, r_chk1, r_chk2, r_chk3, r_cyc1, r_cyc2, r_due, r_def, r_idx, r_uq;`, 'catalog');
  const m = /G20DB:(.*?):END/s.exec(out);
  expect(m, out.slice(0, 1500)).not.toBeNull();
  expect(m![1]).toBe('norm=abc空調,norm2=甲乙,tax=04595257,chk=t/f/t,cyc=t/f,due=truefalsetruefalsefalsefalse,def=falsefalsecompanyactive0,delpol=0,uq=2');
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', `${ga6Name('SQL-')}%`)).count).toBe(0);
  expect((await db().from('ga_service_categories').select('id', { count: 'exact', head: true }).like('name', `${ga6Name('SQL-')}%`)).count).toBe(0);
});

test('函式目錄：第 6 批廠商與分類區域函式都是 SECURITY DEFINER 並固定 search_path；匿名不能執行；內部輔助 ga_vd_* 登入者不能執行（唯一例外 ga_vd_norm_tax：統編唯一索引運算式）；對外函式登入者可執行', async () => {
  test.setTimeout(120_000);
  const out = runSqlDo(`
DECLARE
  r record;
  n_ws int := 0; n_int int := 0; bad_def text := ''; bad_anon text := ''; bad_auth text := ''; bad_int text := ''; bad_path text := '';
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND (p.proname LIKE 'ga\\_ws\\_vendor\\_%' OR p.proname LIKE 'ga\\_ws\\_svc\\_%' OR p.proname LIKE 'ga\\_vd\\_%') LOOP
    IF r.proname LIKE 'ga\\_ws\\_%' THEN n_ws := n_ws + 1; ELSE n_int := n_int + 1; END IF;
    IF NOT coalesce(r.proconfig::text LIKE '%search_path%', false) THEN bad_path := bad_path || r.proname || ' '; END IF;
    IF r.proname LIKE 'ga\\_ws\\_%' AND NOT r.prosecdef THEN bad_def := bad_def || r.proname || ' '; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN bad_anon := bad_anon || r.proname || ' '; END IF;
    IF r.proname LIKE 'ga\\_ws\\_%' AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN bad_auth := bad_auth || r.proname || ' '; END IF;
    -- 唯一例外：ga_vd_norm_tax 是統編唯一索引的運算式，索引由寫入者身分執行，必須開給登入者（純函式、IMMUTABLE、非 SECURITY DEFINER；決定 1）
    IF r.proname LIKE 'ga\\_vd\\_%' AND r.proname <> 'ga_vd_norm_tax' AND has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN bad_int := bad_int || r.proname || ' '; END IF;
  END LOOP;
  RAISE EXCEPTION 'G20DB:ws=%,int=%,def=[%],path=[%],anon=[%],auth=[%],internal=[%]:END', n_ws, n_int, bad_def, bad_path, bad_anon, bad_auth, bad_int;`, 'fnlist');
  const m = /G20DB:(.*?):END/s.exec(out);
  expect(m, out.slice(0, 1500)).not.toBeNull();
  // ws=12：11 支廠商與分類區域函式 + 第 6 批 G22 的 ga_ws_vendor_perf（名稱同前綴）
  expect(m![1]).toBe('ws=12,int=15,def=[],path=[],anon=[],auth=[],internal=[]');
});

test('supabase/test_general_affairs_vendor_permissions_rls.sql 在 DEV 實跑：全部 PASS', async () => {
  test.setTimeout(120_000);
  const run = spawnSync('supabase', ['db', 'query', '--linked', '--file', 'supabase/test_general_affairs_vendor_permissions_rls.sql'], { cwd: root, encoding: 'utf8', shell: true });
  const text = `${run.stdout}`;
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const rows = json.rows as Array<{ check_name: string; result: string; details: string }>;
  expect(rows.length).toBe(8);
  expect(rows.filter((r) => r.result !== 'PASS'), JSON.stringify(rows.filter((r) => r.result !== 'PASS'))).toEqual([]);
});
