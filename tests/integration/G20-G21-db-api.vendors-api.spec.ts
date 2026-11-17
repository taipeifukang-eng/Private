import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, seedCategory, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedReview } from '../support/m7m8-po-fixtures';
import { freshValidTaxId, ga6Code, ga6Name, SECRET_FIELDS, seedGa6Vendor, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G20／G21（API 層）：/api/workspace/general-affairs/vendors、vendor-options、service-categories、service-regions。
// 每支寫入都驗：未登入 401、Origin 不符 403、權限矩陣、400 輸入驗證、409（STALE、統編重複並指出既有廠商、代碼重複）、無 DELETE（405）、分頁上限 100 與 {data,total}，並用 service role 回讀資料庫；
// 非廠商檢視／管理權限者的回應完全沒有八個帳務機密欄位（V1）；第 4 批需求單採購評估頁廠商下拉改走伺服端函式後，沒有廠商權限的採購人員仍看得到下拉且沒有統編（連鎖點）。
// 測試資料：廠商、分類、區域名稱與代碼帶 QA-GA6- 標記、只用 VW／ZT 測試門市；結束只清自己的（cleanupM7M8）。與其他整合檔一樣循序執行。
const V = '/api/workspace/general-affairs/vendors';
const O = '/api/workspace/general-affairs/vendor-options';
const C = '/api/workspace/general-affairs/service-categories';
const R = '/api/workspace/general-affairs/service-regions';
const KEYS: Ga6Key[] = ['vendor_mgr', 'vendor_view', 'cat_only', 'coop_only', 'ga_all', 'purchaser', 'wo_works', 'rq_manager', 'svc_mgr', 'nobody', 'admin', 'store_mgr'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let seq = 0;
const db = () => adminDb();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})), text: await r.text().catch(() => '') });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const vname = (s = 'N') => ga6Name(`${s}${String((seq += 1)).padStart(3, '0')}`);
const vrow = async (id: string) => (await db().from('ga_vendors').select('*').eq('id', id).maybeSingle()).data as any;
async function mk(over: Record<string, unknown> = {}) {
  const r = await send('vendor_mgr', 'post', V, { name: vname('A'), vendor_type: 'company', tax_id: await freshValidTaxId(), ...over });
  expect(r.status, r.text).toBe(201);
  return r.body.data as any;
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  for (const a of Object.values(apis)) await a.dispose();
  const a = await cleanupM7M8();
  const b = await teardownUsers();
  const rest = [...a, ...b];
  if (rest.length) throw new Error(`清除殘留：${rest.join('; ')}`);
});

test('未登入一律 401；Origin 不符的寫入 403（資料不變）', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of [V, `${V}/00000000-0000-4000-8000-000000000000`, O, C, R]) expect((await anon.get(p)).status(), p).toBe(401);
  await anon.dispose();
  const evil = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: 'https://evil.example' } });
  const login = await evil.post('/api/workspace/login', { data: { email: users.vendor_mgr.email, password: users.vendor_mgr.password } });
  expect(login.status()).toBe(403);
  await evil.dispose();
  // 已登入但 Origin 改掉
  const bad = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.vendor_mgr.storageState(), extraHTTPHeaders: { Origin: 'https://evil.example' } });
  const v = await mk();
  const name = vname('EVIL');
  for (const [m, p, d] of [['post', V, { name, tax_id: await freshValidTaxId() }], ['patch', `${V}/${v.id}`, { description: 'x', expected_updated_at: v.updated_at }], ['post', `${V}/${v.id}/status`, { status: 'inactive', expected_updated_at: v.updated_at }],
    ['post', C, { name, code: ga6Code('O1') }], ['post', R, { name, code: ga6Code('O1') }]] as const) {
    const r = await (bad as any)[m](p, { data: d });
    expect(r.status(), `${m} ${p}`).toBe(403);
  }
  await bad.dispose();
  expect((await vrow(v.id)).description).toBeNull();
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('name', name)).count).toBe(0);
  expect((await db().from('ga_service_categories').select('id', { count: 'exact', head: true }).eq('code', ga6Code('O1'))).count).toBe(0);
});

test('廠商 API 權限矩陣：列表與詳情只給廠商檢視／管理（403 其餘，含只有分類區域、合作紀錄、舊式管理員、店長）；寫入只給廠商管理', async () => {
  const v = await mk({ billing_title: '機密抬頭', payment_terms: '月結 30 天' });
  for (const k of ['vendor_mgr', 'vendor_view', 'ga_all']) {
    const l = await get(k, `${V}?search=${encodeURIComponent(v.name)}`);
    expect(l.status, k).toBe(200);
    expect(l.body.total, k).toBe(1);
    expect(l.body.permissions.canView, k).toBe(true);
    expect(l.body.permissions.canManage, k).toBe(k !== 'vendor_view');
    const d = await get(k, `${V}/${v.id}`);
    expect(d.status, k).toBe(200);
    for (const f of SECRET_FIELDS) expect(d.body.data, `${k} ${f}`).toHaveProperty(f);
    expect(d.body.data.billing_title).toBe('機密抬頭');
  }
  for (const k of ['cat_only', 'coop_only', 'purchaser', 'wo_works', 'rq_manager', 'svc_mgr', 'nobody', 'admin', 'store_mgr']) {
    for (const p of [V, `${V}/${v.id}`]) {
      const r = await get(k, p);
      expect(r.status, `${k} ${p}`).toBe(403);
      for (const f of SECRET_FIELDS) expect(r.text, `${k} ${f}`).not.toContain(`"${f}"`);
      expect(r.text).not.toMatch(/機密|月結/);
    }
    expect((await send(k, 'post', V, { name: vname('H'), tax_id: await freshValidTaxId() })).status, `${k} create`).toBe(403);
    expect((await send(k, 'patch', `${V}/${v.id}`, { description: 'hack', expected_updated_at: v.updated_at })).status, `${k} patch`).toBe(403);
    expect((await send(k, 'post', `${V}/${v.id}/status`, { status: 'inactive', expected_updated_at: v.updated_at })).status, `${k} status`).toBe(403);
  }
  expect((await send('vendor_view', 'post', V, { name: vname('H'), tax_id: await freshValidTaxId() })).status).toBe(403);
  expect((await send('vendor_view', 'patch', `${V}/${v.id}`, { description: 'hack', expected_updated_at: v.updated_at })).status).toBe(403);
  const after = await vrow(v.id);
  expect(after.description).toBeNull();
  expect(after.status).toBe('active');
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA6-%-H%')).count).toBe(0);
});

test('廠商新增與編輯：回 201／200 與 warnings、寫入修改者、DB 回讀；400：缺名稱、壞 id、壞 JSON、缺版本、壞狀態、壞篩選；404；無 DELETE（405）', async () => {
  const tax = await freshValidTaxId();
  const c = await send('vendor_mgr', 'post', V, { name: vname('Cr'), vendor_type: 'studio', tax_id: tax, contact_name: '陳', contact_phone: '03-1', tags: ['a'] });
  expect(c.status, c.text).toBe(201);
  expect(c.body.warnings).toEqual(expect.any(Array));
  const id = c.body.data.id;
  expect(await vrow(id)).toMatchObject({ vendor_type: 'studio', tax_id: tax, contact_name: '陳', updated_by: users.vendor_mgr.id, contract_required: false });
  const p = await send('ga_all', 'patch', `${V}/${id}`, { description: '改了', expected_updated_at: c.body.data.updated_at });
  expect(p.status, p.text).toBe(200);
  expect(p.body.data).toMatchObject({ description: '改了', updated_by: users.ga_all.id });
  expect(await vrow(id)).toMatchObject({ description: '改了', contact_name: '陳', updated_by: users.ga_all.id });
  // 400
  expect((await send('vendor_mgr', 'post', V, { tax_id: await freshValidTaxId() })).status).toBe(400);
  expect((await send('vendor_mgr', 'post', V, { name: vname('X'), tax_id: '12' })).status).toBe(400);
  const rawBad = await apis.vendor_mgr.post(V, { data: '{not json', headers: { 'content-type': 'application/json' } });
  expect(rawBad.status()).toBe(400);
  expect((await send('vendor_mgr', 'patch', `${V}/not-a-uuid`, { description: 'x', expected_updated_at: p.body.data.updated_at })).status).toBe(400);
  expect((await send('vendor_mgr', 'patch', `${V}/${id}`, { description: 'x' })).status).toBe(400);
  expect((await send('vendor_mgr', 'patch', `${V}/${id}`, { description: 'x', expected_updated_at: 'nope' })).status).toBe(400);
  expect((await send('vendor_mgr', 'post', `${V}/${id}/status`, { status: 'dead', expected_updated_at: p.body.data.updated_at })).status).toBe(400);
  expect((await send('vendor_mgr', 'post', `${V}/${id}/status`, { status: 'paused' })).status).toBe(400);
  expect((await get('vendor_mgr', `${V}?status=bogus`)).status).toBe(400);
  expect((await get('vendor_mgr', `${V}?categoryId=bad`)).status).toBe(400);
  expect((await get('vendor_mgr', `${V}/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  expect((await send('vendor_mgr', 'patch', `${V}/00000000-0000-4000-8000-000000000000`, { description: 'x', expected_updated_at: p.body.data.updated_at })).status).toBe(404);
  // 無 DELETE
  for (const path of [`${V}/${id}`, `${C}/${id}`, `${R}/${id}`]) {
    const d = await send('ga_all', 'delete', path);
    expect(d.status, path).toBe(405);
  }
  expect(await vrow(id)).toBeTruthy();
  expect((await get('vendor_mgr', `${V}/${id}/unknown`)).status).toBe(404);
  expect((await get('vendor_mgr', '/api/workspace/general-affairs/vendors-nope')).status).toBe(404);
});

test('統編重複 409 TAX_ID_DUPLICATE 指出既有廠商、STALE 409、名稱相近與檢查碼提醒隨回應帶出', async () => {
  const a = await mk();
  const dup = await send('vendor_mgr', 'post', V, { name: vname('D'), tax_id: ` ${a.tax_id} ` });
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('TAX_ID_DUPLICATE');
  expect(dup.body.existing).toMatchObject({ id: a.id, name: a.name });
  expect(dup.body.error).toContain(a.name);
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', a.tax_id)).count).toBe(1);
  const stale = await send('vendor_mgr', 'patch', `${V}/${a.id}`, { description: '舊', expected_updated_at: '2000-01-01T00:00:00Z' });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await vrow(a.id)).description).toBeNull();
  const sim = await send('vendor_mgr', 'post', V, { name: `${a.name}有限公司`, tax_id: await freshValidTaxId() });
  expect(sim.status).toBe(201);
  expect(sim.body.warnings.find((w: any) => w.code === 'NAME_SIMILAR').vendors.map((v: any) => v.id)).toContain(a.id);
  const chk = await send('vendor_mgr', 'post', V, { name: vname('K'), tax_id: '12345678' }).catch(() => null);
  // 12345678 可能已被他人使用（409）；只在新增成功時才斷言提醒
  if (chk && chk.status === 201) expect(chk.body.warnings.some((w: any) => w.code === 'TAX_CHECKSUM')).toBe(true);
});

test('停用：POST status 帶版本；回 warnings 與未結單據筆數；列表篩選與分頁 {data,total}、pageSize 上限 100、合約到期篩選', async () => {
  const a = await mk({ contract_required: true, contract_end_date: '2020-01-01' });
  const off = await send('vendor_mgr', 'post', `${V}/${a.id}/status`, { status: 'inactive', expected_updated_at: a.updated_at });
  expect(off.status, off.text).toBe(200);
  expect(off.body.data.status).toBe('inactive');
  expect(off.body.warnings).toEqual([]);
  expect((await vrow(a.id)).status).toBe('inactive');
  const again = await send('vendor_mgr', 'post', `${V}/${a.id}/status`, { status: 'paused', expected_updated_at: a.updated_at });
  expect([again.status, again.body.code]).toEqual([409, 'STALE']);
  const l = await get('vendor_view', `${V}?status=inactive&search=${encodeURIComponent(a.name)}&pageSize=1000`);
  expect(l.body.data.map((x: any) => x.id)).toEqual([a.id]);
  expect(l.body.meta).toMatchObject({ pageSize: 100, total: 1, page: 1 });
  expect(l.body.stats.total).toBeGreaterThanOrEqual(1);
  // 合作中才算合約到期：停用後不在 contract_due 篩選
  expect((await get('vendor_view', `${V}?contract_due=1&search=${encodeURIComponent(a.name)}`)).body.total).toBe(0);
  const b = await mk({ contract_required: true, contract_end_date: '2020-01-01' });
  expect((await get('vendor_view', `${V}?contract_due=1&search=${encodeURIComponent(b.name)}`)).body.data.map((x: any) => x.id)).toEqual([b.id]);
  const page2 = await get('vendor_view', `${V}?page=2&pageSize=1`);
  expect(page2.body.meta.page).toBe(2);
  expect(page2.body.total).toBe(page2.body.meta.total);
});

test('vendor-options：可用權限矩陣、只列合作中、含聯絡人與電話；沒有廠商檢視／管理者回應完全沒有帳務機密欄位；includeIds 帶出已停用；400', async () => {
  const key = `AOP${String((seq += 1)).padStart(3, '0')}`;
  const act = await mk({ name: ga6Name(`${key}-A`), contact_name: '李經理', contact_phone: '02-8888', payment_terms: '月結 45 天', billing_title: '機密抬頭甲', accounting_notes: '機密備註乙' });
  const ina = await mk({ name: ga6Name(`${key}-I`) });
  expect((await send('vendor_mgr', 'post', `${V}/${ina.id}/status`, { status: 'inactive', expected_updated_at: ina.updated_at })).status).toBe(200);
  for (const k of ['purchaser', 'wo_works', 'rq_manager']) {
    const r = await get(k, `${O}?q=${key}`);
    expect(r.status, k).toBe(200);
    expect(r.body.billing_visible, k).toBe(false);
    expect(r.body.data.map((x: any) => x.id), k).toEqual([act.id]);
    expect(r.body.data[0], k).toMatchObject({ contact_name: '李經理', contact_phone: '02-8888', status: 'active' });
    for (const f of SECRET_FIELDS) expect(r.text, `${k} ${f}`).not.toContain(`"${f}"`);
    expect(r.text, k).not.toMatch(/機密|月結/);
  }
  for (const k of ['vendor_mgr', 'vendor_view']) {
    const r = await get(k, `${O}?q=${key}`);
    expect(r.body.billing_visible, k).toBe(true);
    expect(r.body.data[0], k).toMatchObject({ tax_id: act.tax_id, payment_terms: '月結 45 天' });
  }
  for (const k of ['cat_only', 'coop_only', 'svc_mgr', 'nobody', 'admin', 'store_mgr']) expect((await get(k, `${O}?q=${key}`)).status, k).toBe(403);
  const inc = await get('wo_works', `${O}?q=${key}&includeIds=${ina.id}`);
  expect(inc.body.data.map((x: any) => `${x.id}:${x.status}`).sort()).toEqual([`${act.id}:active`, `${ina.id}:inactive`].sort());
  expect((await get('wo_works', `${O}?includeIds=bad`)).status).toBe(400);
  expect((await get('wo_works', `${O}?pageSize=1000`)).body.meta.pageSize).toBe(100);
  expect((await send('wo_works', 'post', O, {})).status).toBe(405);
});

test('服務分類 API：權限矩陣、新增 201（代碼轉大寫）、重複 409、代碼鎖定 400、循環 400、STALE 409、無 DELETE、options 模式、DB 回讀', async () => {
  for (const k of ['cat_only', 'svc_mgr', 'ga_all', 'vendor_view']) expect((await get(k, C)).status, k).toBe(200);
  for (const k of ['coop_only', 'purchaser', 'nobody', 'admin', 'store_mgr']) expect((await get(k, C)).status, k).toBe(403);
  for (const k of ['cat_only', 'vendor_mgr', 'purchaser', 'nobody', 'admin', 'store_mgr']) expect((await send(k, 'post', C, { name: vname('CX'), code: ga6Code('X1') })).status, k).toBe(403);
  const code = ga6Code('C1');
  const a = await send('svc_mgr', 'post', C, { name: ga6Name('API-C1'), code: code.toLowerCase(), description: '說明' });
  expect(a.status, a.text).toBe(201);
  expect(a.body.data.code).toBe(code);
  expect(await db().from('ga_service_categories').select('*').eq('id', a.body.data.id).single().then((r) => r.data)).toMatchObject({ code, updated_by: users.svc_mgr.id, status: 'active' });
  expect((await send('svc_mgr', 'post', C, { name: ga6Name('API-C1b'), code })).status).toBe(409);
  expect((await send('svc_mgr', 'post', C, { name: ga6Name('API-C1c') })).status).toBe(400);
  expect((await send('svc_mgr', 'patch', `${C}/${a.body.data.id}`, { name: 'x' })).status).toBe(400);
  expect((await send('svc_mgr', 'patch', `${C}/${a.body.data.id}`, { code: ga6Code('C9'), expected_updated_at: a.body.data.updated_at })).body.code).toBe('CODE_LOCKED');
  expect((await send('cat_only', 'patch', `${C}/${a.body.data.id}`, { name: '駭', expected_updated_at: a.body.data.updated_at })).status).toBe(403);
  const p = await send('svc_mgr', 'patch', `${C}/${a.body.data.id}`, { name: ga6Name('API-C1x'), status: 'inactive', expected_updated_at: a.body.data.updated_at });
  expect(p.status, p.text).toBe(200);
  expect(p.body.data).toMatchObject({ name: ga6Name('API-C1x'), status: 'inactive' });
  expect((await send('svc_mgr', 'patch', `${C}/${a.body.data.id}`, { name: '舊', expected_updated_at: a.body.data.updated_at })).body.code).toBe('STALE');
  const child = await send('svc_mgr', 'post', C, { name: ga6Name('API-C2'), code: ga6Code('C2'), parent_id: a.body.data.id });
  expect(child.status).toBe(201);
  const cyc = await send('svc_mgr', 'patch', `${C}/${a.body.data.id}`, { parent_id: child.body.data.id, expected_updated_at: p.body.data.updated_at });
  expect([cyc.status, cyc.body.code]).toEqual([400, 'PARENT_CYCLE']);
  const got = await get('cat_only', `${C}/${a.body.data.id}`);
  expect(got.body.data).toMatchObject({ status: 'inactive', child_count: 1 });
  expect(got.body.permissions.manage).toBe(false);
  expect((await get('cat_only', `${C}/not-a-uuid`)).status).toBe(400);
  expect((await get('cat_only', `${C}?status=archived`)).status).toBe(400);
  const opts = await get('vendor_view', `${C}?options=1`);
  expect(opts.body.data.length).toBe(opts.body.total);
  expect(opts.body.data.some((x: any) => x.id === a.body.data.id)).toBe(false); // 只有廠商權限者只看啟用
  const full = await get('cat_only', `${C}?options=1`);
  expect(full.body.data.some((x: any) => x.id === a.body.data.id && x.status === 'inactive')).toBe(true);
  expect(opts.text).not.toMatch(/tax_id/);
});

test('服務區域 API：權限矩陣、固定資料可讀（縣市與行政區）、新增與編輯、封存、鎖定、循環、STALE、無 DELETE', async () => {
  for (const k of ['cat_only', 'svc_mgr', 'ga_all', 'vendor_view']) expect((await get(k, R)).status, k).toBe(200);
  for (const k of ['coop_only', 'purchaser', 'nobody', 'admin', 'store_mgr']) expect((await get(k, R)).status, k).toBe(403);
  const all = await get('cat_only', `${R}?options=1`);
  expect(all.body.total).toBeGreaterThanOrEqual(396);
  expect(all.body.data.filter((x: any) => x.region_type === 'city').length).toBeGreaterThanOrEqual(22);
  const dist = await get('cat_only', `${R}?regionType=district&search=${encodeURIComponent('信義區')}`);
  expect(dist.body.total).toBeGreaterThanOrEqual(2);
  const code = ga6Code('G1');
  const a = await send('svc_mgr', 'post', R, { name: ga6Name('API-R1'), code, region_type: 'region', included_locations: ['甲', '乙'] });
  expect(a.status, a.text).toBe(201);
  expect((await send('svc_mgr', 'post', R, { name: ga6Name('API-R1b'), code })).status).toBe(409);
  expect((await send('svc_mgr', 'post', R, { name: ga6Name('API-R1c'), code: ga6Code('G2'), region_type: 'moon' })).status).toBe(400);
  for (const k of ['cat_only', 'vendor_mgr', 'nobody', 'admin', 'store_mgr']) expect((await send(k, 'post', R, { name: vname('RX'), code: ga6Code('GX') })).status, k).toBe(403);
  const b = await send('svc_mgr', 'post', R, { name: ga6Name('API-R2'), code: ga6Code('G3'), parent_id: a.body.data.id, region_type: 'city' });
  expect(b.status).toBe(201);
  expect((await send('svc_mgr', 'patch', `${R}/${a.body.data.id}`, { parent_id: b.body.data.id, expected_updated_at: a.body.data.updated_at })).body.code).toBe('PARENT_CYCLE');
  expect((await send('svc_mgr', 'patch', `${R}/${a.body.data.id}`, { code: ga6Code('G8'), expected_updated_at: a.body.data.updated_at })).body.code).toBe('CODE_LOCKED');
  const arch = await send('svc_mgr', 'patch', `${R}/${b.body.data.id}`, { status: 'archived', expected_updated_at: b.body.data.updated_at });
  expect(arch.status).toBe(200);
  expect((await db().from('ga_service_regions').select('status,updated_by').eq('id', b.body.data.id).single()).data).toEqual({ status: 'archived', updated_by: users.svc_mgr.id });
  expect((await send('svc_mgr', 'patch', `${R}/${b.body.data.id}`, { name: '舊', expected_updated_at: b.body.data.updated_at })).body.code).toBe('STALE');
  expect((await get('vendor_view', `${R}?search=${encodeURIComponent(ga6Name('API-R'))}`)).body.total).toBe(1); // 只看啟用
  expect((await get('cat_only', `${R}?search=${encodeURIComponent(ga6Name('API-R'))}`)).body.total).toBe(2);
});

test('連鎖：需求單採購評估頁廠商下拉改走伺服端函式——沒有廠商權限的採購人員仍有下拉、沒有統編；已停用的已選廠商仍帶出', async () => {
  const s = await stores();
  const cat = await seedCategory('part', 'GA6R');
  const part = await seedPart(cat.id, 'GA6R-P1');
  const act = await mk({ name: ga6Name(`REV${String((seq += 1)).padStart(3, '0')}-A`), payment_terms: '月結 30 天' });
  const ina = await mk({ name: ga6Name(`REV${String((seq += 1)).padStart(3, '0')}-I`) });
  expect((await send('vendor_mgr', 'post', `${V}/${ina.id}/status`, { status: 'inactive', expected_updated_at: ina.updated_at })).status).toBe(200);
  const req = await seedRequest(s.VW001.id, users.store_mgr.id, `GA6R-${(seq += 1)}`, { part_id: part.id, desired_unit: part.base_unit });
  const url = `/api/workspace/general-affairs/requests/${req.id}/purchase-review`;
  // 先前（RLS 收緊前）用使用者身分直接讀 ga_vendors；現在採購人員（沒有任何廠商權限）要拿得到下拉
  const noReview = await get('purchaser', url);
  expect(noReview.status, noReview.text).toBe(200);
  expect(noReview.body.data.vendors.map((v: any) => v.id)).toContain(act.id);
  expect(noReview.body.data.vendors.map((v: any) => v.id)).not.toContain(ina.id);
  expect(noReview.body.data.vendors.length).toBeGreaterThanOrEqual(1);
  for (const f of SECRET_FIELDS) expect(noReview.text, f).not.toContain(`"${f}"`);
  expect(noReview.text).not.toContain('月結');
  // 評估單選了已停用的廠商：仍帶出 vendor（含狀態）供畫面加「（已停用）」
  await seedReview(req.id, users.purchaser.id, { vendor_id: ina.id, vendor_name: ina.name });
  const withReview = await get('purchaser', url);
  expect(withReview.status).toBe(200);
  expect(withReview.body.data.review.vendor).toMatchObject({ id: ina.id, name: ina.name, status: 'inactive' });
  // 只有分類區域權限者不能進採購評估
  expect((await get('cat_only', url)).status).toBe(403);
  void db;
});
