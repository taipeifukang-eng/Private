import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { multipartBody } from '../support/multipart';
import { makePng } from '../support/png';
import { shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

// M7/M8 第 6 批 G23（API 層）：/api/workspace/general-affairs/utility-bills（列表、詳情、新增、編輯、pay、unpay、delete、report、meta、anomaly-check）。
// 每支寫入都驗：未登入 401、Origin 不符 403、權限矩陣（水電管理／總務全套可寫；水電檢視只能讀；店長、只有分類區域、廠商管理、舊式管理員、無關權限一律 403）、400 輸入驗證、
// 409（STALE、重複帳單並指出既有那一筆、已繳改關鍵欄位需確認、改回待繳需確認）、冪等、無 DELETE（405）、分頁上限 100 與 {data,total}，並用 service role 回讀資料庫；
// 前端不能指定 id、建立者、刪除欄位；附件沿用共用 API（UTILITY_BILL）：水電檢視可看、店長 403、刪除只標記保留實體檔。
// 測試資料：供應商名稱帶 QA-GA6- 標記、只用 VW／ZT 測試門市；結束只清自己的。與其他整合檔一樣循序執行。
const U = '/api/workspace/general-affairs/utility-bills';
const KEYS: Ga6Key[] = ['util_mgr', 'util_view', 'ga_all', 'store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let st: Awaited<ReturnType<typeof stores>>;
const apis: Record<string, APIRequestContext> = {};
let seq = 0;
const today = taipeiToday();
const PAST = shiftMonth(`${today.slice(0, 7)}-01`, -4).slice(0, 7);
const db = () => adminDb();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})), text: await r.text().catch(() => '') });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const ident = (s = 'I') => `QA-GA6-API-${String((seq += 1)).padStart(4, '0')}-${s}`;
const body = (over: Record<string, unknown> = {}) => ({ store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-07', provider_name: ga6Name('P'), service_identifier: ident(), amount: 1500, ...over });
const dbRow = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).maybeSingle()).data as any;
async function mk(over: Record<string, unknown> = {}) {
  const r = await send('util_mgr', 'post', U, body(over));
  expect(r.status, r.text).toBe(201);
  return r.body.data as any;
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
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
  const b = await mk();
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of [U, `${U}/${b.id}`, `${U}/meta`, `${U}/report?mode=year&year=2038`]) expect((await anon.get(p)).status(), p).toBe(401);
  await anon.dispose();
  const bad = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.util_mgr.storageState(), extraHTTPHeaders: { Origin: 'https://evil.example' } });
  const name = ident('EVIL');
  for (const [m, p, d] of [['post', U, body({ service_identifier: name })], ['patch', `${U}/${b.id}`, { notes: 'x', expected_updated_at: b.updated_at }], ['post', `${U}/${b.id}/pay`, { expected_updated_at: b.updated_at }],
    ['post', `${U}/${b.id}/unpay`, { confirm: true, expected_updated_at: b.updated_at }], ['post', `${U}/${b.id}/delete`, { reason: 'x', expected_updated_at: b.updated_at }], ['post', `${U}/anomaly-check`, body()]] as const) {
    const r = await (bad as any)[m](p, { data: d });
    expect(r.status(), `${m} ${p}`).toBe(403);
  }
  await bad.dispose();
  expect(await dbRow(b.id)).toMatchObject({ notes: null, paid_at: null, deleted_at: null });
  expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', name)).count).toBe(0);
});

test('權限矩陣：水電管理與總務全套可讀寫；水電檢視只能讀（寫入 403）；其餘角色讀寫都 403', async () => {
  const b = await mk();
  const reads = [U, `${U}/${b.id}`, `${U}/meta`, `${U}/report?mode=year&year=2038`];
  const writes: Array<[('post' | 'patch'), string, unknown]> = [
    ['post', U, body()], ['patch', `${U}/${b.id}`, { notes: 'x', expected_updated_at: b.updated_at }], ['post', `${U}/${b.id}/pay`, { expected_updated_at: b.updated_at }],
    ['post', `${U}/${b.id}/unpay`, { confirm: true, expected_updated_at: b.updated_at }], ['post', `${U}/${b.id}/delete`, { reason: 'x', expected_updated_at: b.updated_at }], ['post', `${U}/anomaly-check`, body()],
  ];
  for (const k of ['util_mgr', 'util_view', 'ga_all']) for (const p of reads) expect((await get(k, p)).status, `${k} ${p}`).toBe(200);
  for (const [m, p, d] of writes) {
    const r = await send('util_view', m, p, d);
    expect(r.status, `util_view ${m} ${p}`).toBe(403);
    expect(r.body.error, `util_view ${p}`).toContain('權限');
  }
  for (const k of ['store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody']) {
    for (const p of reads) expect((await get(k, p)).status, `${k} ${p}`).toBe(403);
    for (const [m, p, d] of writes) expect((await send(k, m, p, d)).status, `${k} ${m} ${p}`).toBe(403);
  }
  expect((await send('ga_all', 'post', U, body())).status).toBe(201);
  // 權限旗標回給畫面
  expect((await get('util_view', U)).body.permissions).toEqual({ canView: true, canManage: false });
  expect((await get('util_mgr', U)).body.permissions).toEqual({ canView: true, canManage: true });
  expect(await dbRow(b.id)).toMatchObject({ notes: null, paid_at: null, deleted_at: null });
});

test('新增與編輯：回傳 201／200、回讀資料庫；前端不能指定 id、建立者、刪除欄位；編輯必帶版本（缺少 400、舊版本 409）；沒有 DELETE（405）', async () => {
  const r = await send('util_mgr', 'post', U, body({ id: '11111111-1111-4111-8111-111111111111', created_by: users.nobody.id, deleted_at: '2000-01-01T00:00:00Z', deletion_reason: '偷塞', updated_by: users.nobody.id }));
  expect(r.status, r.text).toBe(201);
  expect(r.body).toHaveProperty('warnings');
  const id = r.body.data.id as string;
  expect(id).not.toBe('11111111-1111-4111-8111-111111111111');
  expect(await dbRow(id)).toMatchObject({ created_by: users.util_mgr.id, updated_by: users.util_mgr.id, deleted_at: null, deletion_reason: null });
  const noVer = await send('util_mgr', 'patch', `${U}/${id}`, { notes: 'x' });
  expect(noVer.status).toBe(400);
  expect(noVer.body.error).toContain('版本');
  const ok = await send('ga_all', 'patch', `${U}/${id}`, { notes: '改過', expected_updated_at: r.body.data.updated_at });
  expect(ok.status, ok.text).toBe(200);
  expect(await dbRow(id)).toMatchObject({ notes: '改過', updated_by: users.ga_all.id, created_by: users.util_mgr.id });
  expect(ok.body.data.updated_by_name).toBeTruthy();
  const stale = await send('util_mgr', 'patch', `${U}/${id}`, { notes: '過期', expected_updated_at: r.body.data.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await dbRow(id)).notes).toBe('改過');
  expect((await send('util_mgr', 'delete', `${U}/${id}`)).status).toBe(405);
  expect((await send('util_mgr', 'delete', U)).status).toBe(405);
  expect((await get('util_mgr', `${U}/${id}/nothing`)).status).toBe(405);
  expect((await send('util_mgr', 'post', `${U}/${id}/nothing`)).status).toBe(404);
  expect((await dbRow(id)).deleted_at).toBeNull();
});

test('輸入驗證 400：格式錯誤的 id、費用類型、月份、金額、日期、據點；壞掉的 JSON；沒有任何資料被寫入', async () => {
  const before = (await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).like('provider_name', 'QA-GA6-%')).count;
  for (const [label, d, text] of [
    ['類型', body({ expense_type: 'GAS' }), '費用類型'], ['月份', body({ billing_month: '2038-13' }), '月份'], ['金額負數', body({ amount: -5 }), '金額'], ['金額文字', body({ amount: 'abc' }), '金額'],
    ['沒有金額', body({ amount: null }), '金額'], ['日期', body({ due_date: '2038/07/01' }), '格式'], ['據點格式', body({ store_id: 'xyz' }), '據點'], ['沒有識別號碼', body({ service_identifier: null }), '識別號碼'],
  ] as const) {
    const r = await send('util_mgr', 'post', U, d);
    expect(r.status, label).toBe(400);
    expect(String(r.body.error), label).toContain(text);
  }
  const broken = await apis.util_mgr.post(U, { data: '{"amount":', headers: { 'Content-Type': 'application/json' } });
  expect(broken.status()).toBe(400);
  expect((await get('util_mgr', `${U}/not-a-uuid`)).status).toBe(400);
  expect((await send('util_mgr', 'patch', `${U}/not-a-uuid`, { expected_updated_at: 'x' })).status).toBe(400);
  expect((await send('util_mgr', 'patch', `${U}/00000000-0000-4000-8000-000000000000`, { notes: 'x', expected_updated_at: new Date().toISOString() })).status).toBe(404);
  expect((await get('util_mgr', `${U}/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  for (const q of ['month=2038-13', 'type=GAS', 'storeId=abc', 'status=zzz']) expect((await get('util_mgr', `${U}?${q}`)).status, q).toBe(400);
  for (const q of ['mode=week&year=2038', 'mode=month&year=2038&period=2037-01', 'mode=quarter&year=2038&period=9', 'mode=year&year=1900', 'year=2038']) expect((await get('util_mgr', `${U}/report?${q}`)).status, q).toBe(400);
  expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).like('provider_name', 'QA-GA6-%')).count).toBe(before);
});

test('重複帳單 409：訊息指出既有那一筆（含金額與期限）並回既有 id；編輯成重複也擋', async () => {
  const id = ident('D');
  const a = await mk({ service_identifier: id, amount: 8888, due_date: '2038-08-10' });
  const r = await send('util_mgr', 'post', U, body({ service_identifier: id.toLowerCase(), amount: 1 }));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('DUPLICATE_BILL');
  expect(r.body.existing).toMatchObject({ id: a.id, amount: 8888 });
  expect(r.body.error).toContain('8,888');
  expect(r.body.error).toContain('2038-08-10');
  const other = await mk();
  const e = await send('util_mgr', 'patch', `${U}/${other.id}`, { service_identifier: id, expected_updated_at: other.updated_at });
  expect(e.status).toBe(409);
  expect(e.body.existing.id).toBe(a.id);
  expect((await dbRow(other.id)).service_identifier).toBe(other.service_identifier);
});

test('金額異常：anomaly-check 回基準與明細（不寫入）；儲存時回提醒但仍已儲存', async () => {
  const key = ident('AN');
  for (const [m, a] of [['2038-02', 1200], ['2038-03', 1300], ['2038-04', 1100]] as const) await mk({ service_identifier: key, billing_month: m, amount: a });
  const before = (await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', key)).count;
  const chk = await send('util_mgr', 'post', `${U}/anomaly-check`, body({ service_identifier: key, billing_month: '2038-05', amount: 12000 }));
  expect(chk.status, chk.text).toBe(200);
  expect(chk.body.data).toMatchObject({ warn: true, reason: 'HIGH', baseline: 1200, sample_count: 3, partial: false });
  expect(chk.body.data.samples).toHaveLength(3);
  expect(chk.body.data.message).toContain('1,200');
  expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', key)).count).toBe(before);
  const none = await send('util_mgr', 'post', `${U}/anomaly-check`, body({ service_identifier: key, billing_month: '2038-05', amount: 1250 }));
  expect(none.body.data.warn).toBe(false);
  const saved = await send('util_mgr', 'post', U, body({ service_identifier: key, billing_month: '2038-05', amount: 12000 }));
  expect(saved.status).toBe(201);
  expect(saved.body.warnings[0]).toMatchObject({ reason: 'HIGH', baseline: 1200 });
  expect(Number((await dbRow(saved.body.data.id)).amount)).toBe(12000);
  expect((await send('util_view', 'post', `${U}/anomaly-check`, body())).status).toBe(403);
});

test('標記已繳與改回待繳：日期範圍、冪等、版本檢查、確認流程（API 狀態碼與回傳內容）', async () => {
  const b = await mk({ billing_month: PAST });
  const fut = await send('util_mgr', 'post', `${U}/${b.id}/pay`, { paid_at: '2999-01-01', expected_updated_at: b.updated_at });
  expect(fut.status).toBe(400);
  expect(fut.body.code).toBe('PAID_FUTURE');
  const early = await send('util_mgr', 'post', `${U}/${b.id}/pay`, { paid_at: '2001-01-01', expected_updated_at: b.updated_at });
  expect(early.status).toBe(400);
  expect(early.body.code).toBe('PAID_TOO_EARLY');
  expect((await send('util_mgr', 'post', `${U}/${b.id}/pay`, {})).status).toBe(400);
  expect((await send('util_mgr', 'post', `${U}/${b.id}/pay`, { expected_updated_at: '1999-01-01T00:00:00Z' })).status).toBe(409);
  expect((await send('util_mgr', 'post', `${U}/${b.id}/pay`, { expected_updated_at: 'garbage' })).status).toBe(400);
  expect((await dbRow(b.id)).paid_at).toBeNull();
  const paid = await send('util_mgr', 'post', `${U}/${b.id}/pay`, { expected_updated_at: b.updated_at });
  expect(paid.status, paid.text).toBe(200);
  expect(paid.body.data).toMatchObject({ status: 'paid', paid_at: today });
  expect((await dbRow(b.id)).paid_at).toBe(today);
  // 冪等：同一天再標一次成功、不改版本；換日期 409
  const again = await send('util_mgr', 'post', `${U}/${b.id}/pay`, { paid_at: today });
  expect(again.status).toBe(200);
  expect(again.body.noop).toBe(true);
  expect((await send('util_mgr', 'post', `${U}/${b.id}/pay`, { paid_at: shiftMonth(`${PAST}-01`, -1), expected_updated_at: paid.body.data.updated_at })).body.code).toBe('ALREADY_PAID');
  // 改回待繳
  const need = await send('util_mgr', 'post', `${U}/${b.id}/unpay`, { expected_updated_at: paid.body.data.updated_at });
  expect(need.status).toBe(409);
  expect(need.body.code).toBe('UNPAY_CONFIRM_REQUIRED');
  expect(need.body.paid_at).toBe(today);
  expect((await dbRow(b.id)).paid_at).toBe(today);
  const done = await send('util_mgr', 'post', `${U}/${b.id}/unpay`, { confirm: true, expected_updated_at: paid.body.data.updated_at });
  expect(done.status, done.text).toBe(200);
  expect((await dbRow(b.id)).paid_at).toBeNull();
  const idem = await send('util_mgr', 'post', `${U}/${b.id}/unpay`, { confirm: true });
  expect(idem.status).toBe(200);
  expect(idem.body.noop).toBe(true);
});

test('已繳帳單改金額與刪除：需要 confirm_paid_change，回 409 與原值；確認後才寫入', async () => {
  const b = await mk({ billing_month: PAST, amount: 2000 });
  const paid = (await send('util_mgr', 'post', `${U}/${b.id}/pay`, { expected_updated_at: b.updated_at })).body.data;
  const need = await send('util_mgr', 'patch', `${U}/${b.id}`, { amount: 2600, expected_updated_at: paid.updated_at });
  expect(need.status).toBe(409);
  expect(need.body).toMatchObject({ code: 'PAID_CHANGE_CONFIRM_REQUIRED', changed_fields: ['amount'], original: { amount: 2000, paid_at: today } });
  expect(Number((await dbRow(b.id)).amount)).toBe(2000);
  const free = await send('util_mgr', 'patch', `${U}/${b.id}`, { notes: '只改備註', expected_updated_at: paid.updated_at });
  expect(free.status).toBe(200);
  const ok = await send('util_mgr', 'patch', `${U}/${b.id}`, { amount: 2600, confirm_paid_change: true, expected_updated_at: free.body.data.updated_at });
  expect(ok.status, ok.text).toBe(200);
  expect(Number((await dbRow(b.id)).amount)).toBe(2600);
  const needDel = await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '已繳刪除', expected_updated_at: ok.body.data.updated_at });
  expect(needDel.status).toBe(409);
  expect(needDel.body).toMatchObject({ code: 'PAID_CHANGE_CONFIRM_REQUIRED', original: { amount: 2600 } });
  expect((await dbRow(b.id)).deleted_at).toBeNull();
  expect((await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '已繳刪除', confirm_paid_change: true, expected_updated_at: ok.body.data.updated_at })).status).toBe(200);
  expect(await dbRow(b.id)).toMatchObject({ deletion_reason: '已繳刪除', deleted_by: users.util_mgr.id });
});

test('刪除：原因必填（400）、版本檢查、軟刪除只標記、已刪除檢視看得到誰與原因、冪等、已刪除不能編輯（409）', async () => {
  const b = await mk({ service_identifier: ident('DEL') });
  expect((await send('util_mgr', 'post', `${U}/${b.id}/delete`, { expected_updated_at: b.updated_at })).status).toBe(400);
  expect((await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '   ', expected_updated_at: b.updated_at })).body.code).toBe('REASON_REQUIRED');
  expect((await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: 'x'.repeat(501), expected_updated_at: b.updated_at })).status).toBe(400);
  expect((await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '原因', expected_updated_at: '2000-01-01T00:00:00Z' })).status).toBe(409);
  expect((await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '原因' })).status).toBe(400);
  expect((await dbRow(b.id)).deleted_at).toBeNull();
  const gone = await send('ga_all', 'post', `${U}/${b.id}/delete`, { reason: '重複登錄', expected_updated_at: b.updated_at });
  expect(gone.status, gone.text).toBe(200);
  expect(await dbRow(b.id)).toMatchObject({ deletion_reason: '重複登錄', deleted_by: users.ga_all.id });
  expect((await get('util_mgr', `${U}?search=${b.service_identifier}`)).body.total).toBe(0);
  const view = await get('util_view', `${U}?deleted=1&search=${b.service_identifier}`);
  expect(view.body.total).toBe(1);
  expect(view.body.deleted_view).toBe(true);
  expect(view.body.data[0]).toMatchObject({ status: 'deleted', deletion_reason: '重複登錄' });
  expect(view.body.data[0].deleted_by_name).toBeTruthy();
  const again = await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '再刪一次' });
  expect(again.status).toBe(200);
  expect(again.body.noop).toBe(true);
  expect((await dbRow(b.id)).deletion_reason).toBe('重複登錄');
  expect((await send('util_mgr', 'patch', `${U}/${b.id}`, { notes: 'x', expected_updated_at: gone.body.data.updated_at })).status).toBe(409);
});

test('列表：{data,total,meta,summary,global,permissions}、pageSize 上限 100、篩選與逾期、待繳與逾期摘要不受篩選影響；meta 門市清單', async () => {
  const od = await mk({ billing_month: PAST, due_date: '2020-01-02', amount: 321, service_identifier: ident('OD') });
  const r = await get('util_mgr', `${U}?pageSize=500&status=overdue`);
  expect(r.status).toBe(200);
  expect(r.body.meta.pageSize).toBe(100);
  expect(r.body.data.length).toBeLessThanOrEqual(100);
  expect(r.body.data.every((x: any) => x.status === 'overdue')).toBe(true);
  expect(r.body.data.map((x: any) => x.id)).toContain(od.id);
  const filtered = await get('util_mgr', `${U}?month=2000-01&type=PHONE&storeId=${st.ZT01.id}`);
  expect(filtered.body.total).toBe(0);
  expect(filtered.body.global.overdue_count).toBe(r.body.global.overdue_count);
  expect(filtered.body.global.pending_count).toBe(r.body.global.pending_count);
  expect(r.body.global.overdue_count).toBe(r.body.total);
  expect((await get('util_mgr', `${U}?overdue=1`)).body.total).toBe(r.body.total);
  expect(r.body.summary).toHaveProperty('total_amount');
  const meta = await get('util_view', `${U}/meta`);
  expect(meta.body.today).toBe(today);
  expect(meta.body.stores.map((s: any) => s.store_code)).toEqual(expect.arrayContaining(['VW001', 'VW002', 'ZT01']));
  const rep = await get('util_view', `${U}/report?mode=year&year=2038`);
  expect(rep.status).toBe(200);
  expect(rep.body.data.rows.length).toBeGreaterThan(5);
  expect(rep.body.data.totals.total).toBe(rep.body.data.rows.reduce((s: number, x: any) => s + Number(x.total), 0));
});

test('附件（共用附件 API，UTILITY_BILL）：水電管理可上傳、水電檢視可看不能傳或刪、店長 403；刪除只標記並保留實體檔；帳單刪除後附件讀不到', async () => {
  const b = await mk({ service_identifier: ident('ATT') });
  const A = '/api/workspace/general-affairs/attachments';
  const mp = multipartBody([{ name: 'bill.png', mimeType: 'image/png', buffer: makePng({ width: 40, height: 40, colorful: true }) }], { resource_type: 'UTILITY_BILL', resource_id: b.id, purpose: 'BILL_DOCUMENT' });
  const bad = await apis.util_view.post(A, { data: mp.data, headers: mp.headers });
  expect(bad.status()).toBe(403);
  const mp2 = multipartBody([{ name: 'bill.png', mimeType: 'image/png', buffer: makePng({ width: 40, height: 40, colorful: true }) }], { resource_type: 'UTILITY_BILL', resource_id: b.id, purpose: 'BILL_DOCUMENT' });
  const up = await apis.util_mgr.post(A, { data: mp2.data, headers: mp2.headers });
  expect(up.status(), await up.text()).toBeLessThan(300);
  const q = `${A}?resourceType=UTILITY_BILL&resourceId=${b.id}&purpose=BILL_DOCUMENT`;
  const mine = await get('util_view', q);
  expect(mine.status).toBe(200);
  expect(mine.body.data).toHaveLength(1);
  expect((await get('store_mgr', q)).status).toBe(403);
  const att = mine.body.data[0];
  const noReason = await apis.util_mgr.delete(`${A}/${att.id}`, { data: {} });
  expect(noReason.status()).toBe(400);
  expect((await apis.util_view.delete(`${A}/${att.id}`, { data: { deletion_reason: '看不到' } })).status()).toBe(403);
  const row = (await db().from('ga_resource_attachments').select('id,storage_path,deleted_at').eq('id', att.id).maybeSingle()).data as any;
  expect(row.deleted_at).toBeNull();
  expect((await apis.util_mgr.delete(`${A}/${att.id}`, { data: { deletion_reason: '傳錯檔' } })).status()).toBe(200);
  const after = (await db().from('ga_resource_attachments').select('deleted_at,deletion_reason,storage_path').eq('id', att.id).maybeSingle()).data as any;
  expect(after).toMatchObject({ deletion_reason: '傳錯檔' });
  expect(after.deleted_at).toBeTruthy();
  const still = await db().storage.from('general-affairs-attachments').download(after.storage_path);
  expect(still.error).toBeNull();
  // 帳單刪除後附件讀不到（資源不存在）
  await send('util_mgr', 'post', `${U}/${b.id}/delete`, { reason: '附件測試', expected_updated_at: b.updated_at });
  expect((await get('util_mgr', q)).status).toBe(404);
});
