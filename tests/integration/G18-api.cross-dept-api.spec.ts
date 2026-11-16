import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedMaintenanceCategory, stores } from '../support/m7m8-fixtures';
import { multipartBody, type MpFile } from '../support/multipart';
import { setupPoUsers, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 5 批 G18-api（G19.integration.*）：跨部門維修（總務組頁）API——POST /cross-dept-maintenance（新增舊式回報，含照片）與 /maintenance-categories（維修分類管理）。
// 另含舊式回報在工單 API 上的接力：回報 → 總務受理存進度 → 送門市確認（不再報錯）→ 回報人確認／仍有問題 → 結案後不能重新開啟；回報人刪除規則；無更新角色的管理員唯讀。
// 資料帶 [自動測試]M7M8 標記、只用 VW／ZT 測試門市；結束只清自己的。與其他整合檔一樣循序執行。
const C = '/api/workspace/general-affairs/cross-dept-maintenance';
const CAT = '/api/workspace/general-affairs/maintenance-categories';
const W = '/api/workspace/general-affairs/work-orders';
const KEYS: PoKey[] = ['wo_works', 'wo_manager', 'wo_viewall', 'wo_cross_viewall', 'wo_cross_update', 'wo_store_a', 'wo_cross_store_a', 'wo_store_b', 'wo_outsider_own', 'nobody', 'admin'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let sid: Record<string, string> = {};
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (n = 'a.png'): MpFile => ({ name: n, mimeType: 'image/png', buffer: PNG });
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).maybeSingle()).data as any;
const upd = async (id: string) => (await woRow(id)).updated_at as string;
const eventsOf = async (id: string) => ((await db().from('maintenance_ticket_events').select('*').eq('ticket_id', id).order('created_at').order('id')).data || []) as any[];
const attsOf = async (id: string) => ((await db().from('ga_resource_attachments').select('*').eq('resource_id', id)).data || []) as any[];
const act = async (who: string, w: any, path: string, data: Record<string, unknown> = {}, expected?: string) => send(who, 'post', `${W}/${w.id}/${path}`, { expected_updated_at: expected ?? (await upd(w.id)), ...data });
/** 新增舊式回報（multipart）。 */
const report = (who: string, files: MpFile[], fields: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const m = multipartBody(files, { store_id: sid.VW001, title: m7Name(`CD-${(seq += 1)}`), description: '冷氣不冷', idempotency_key: key(), ...fields });
  return apis[who].post(C, { data: m.data, headers: { ...m.headers, ...headers } });
};
const folderCount = async () => ((await db().storage.from('general-affairs-attachments').list('maintenance_request', { limit: 1000 })).data || []).length;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件、測試分類）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const left = await db().from('maintenance_requests').select('id', { count: 'exact', head: true }).like('title', '[自動測試]M7M8 T%');
  expect(left.count, '工單殘留').toBe(0);
});

test('G19.integration.create：新增舊式回報（標題、說明、最多 5 張照片）；權限矩陣、Origin、400；失敗不留檔案；同識別碼重送回原工單', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  const mp = multipartBody([png()], { store_id: sid.VW001, title: 'x', idempotency_key: key() });
  expect((await anon.post(C, { data: mp.data, headers: mp.headers })).status()).toBe(401);
  await anon.dispose();
  expect((await report('wo_cross_store_a', [png()], {}, { Origin: 'https://evil.example' })).status()).toBe(403);
  expect((await apis.wo_cross_store_a.get(C)).status()).toBe(404);
  // 沒有回報權限：只有查看全部、沒權限、管理員沒有角色
  for (const k of ['wo_viewall', 'wo_cross_viewall', 'nobody', 'admin']) expect((await report(k, [png()])).status(), k).toBe(403);
  const folders0 = await folderCount();
  // 400：標題、門市、優先順序、識別碼、照片數與格式
  const t = (over: Record<string, string>, files: MpFile[] = [png()]) => report('wo_cross_store_a', files, over);
  expect((await t({ title: '' })).status()).toBe(400);
  expect((await t({ title: 'x'.repeat(201) })).status()).toBe(400);
  expect((await t({ store_id: 'bad' })).status()).toBe(400);
  expect((await t({ priority: 'asap' })).status()).toBe(400);
  expect((await t({ idempotency_key: '' })).status()).toBe(400);
  expect((await t({ category_id: 'bad' })).status()).toBe(400);
  expect((await t({}, Array.from({ length: 6 }, (_, i) => png(`${i}.png`)))).status()).toBe(400);
  expect((await t({}, [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }])).status()).toBe(400);
  expect((await t({}, [{ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('hello world, not an image') }])).status()).toBe(400);
  // 不是該門市店長（別店）：資料庫擋下，已上傳的檔案移除
  const wrongStore = await report('wo_store_b', [png(), png('b.png')]);
  expect(wrongStore.status()).toBe(403);
  expect((await wrongStore.json()).error).toMatch(/[一-鿿]/);
  expect(await folderCount()).toBe(folders0);
  // 成功：2 張照片
  const k1 = key();
  const title = m7Name(`CD-OK-${(seq += 1)}`);
  const ok = await report('wo_cross_store_a', [png('p1.png'), png('p2.png')], { title, idempotency_key: k1, priority: 'high', contact_name: '店長甲', contact_phone: '0912' });
  expect(ok.status(), await ok.text()).toBe(201);
  const body = await ok.json();
  expect(body.replay).toBe(false);
  const w = await woRow(body.data.id);
  expect(w).toMatchObject({ title, store_id: sid.VW001, status: 'UNACCEPTED', priority: 'high', reported_by: users.wo_cross_store_a.id, contact_name: '店長甲', ga_service_request_id: null });
  const atts = await attsOf(w.id);
  expect(atts).toHaveLength(2);
  expect(atts.every((a) => a.resource_type === 'MAINTENANCE_REQUEST' && a.storage_path.startsWith(`maintenance_request/${w.id}/`) && a.deleted_at === null)).toBe(true);
  for (const a of atts) expect((await db().storage.from('general-affairs-attachments').download(a.storage_path)).error).toBeNull();
  expect((await eventsOf(w.id)).map((e) => e.event_type)).toEqual(['CREATED']);
  // 冪等：同人同識別碼重送回原工單，不多一筆、不多檔案
  const again = await report('wo_cross_store_a', [png('p3.png')], { title: m7Name('CD-OTHER'), idempotency_key: k1 });
  expect(again.status()).toBe(200);
  const ab = await again.json();
  expect(ab.replay).toBe(true);
  expect(ab.data.id).toBe(w.id);
  expect(await attsOf(w.id)).toHaveLength(2);
  expect(await folderCount()).toBe(folders0 + 1);
  // 沒有照片也可以（JSON 送出）；總務端（有更新權限）可代任何門市回報
  const noPhoto = await send('wo_cross_store_a', 'post', C, { store_id: sid.VW001, title: m7Name('CD-JSON'), idempotency_key: key() });
  expect(noPhoto.status).toBe(201);
  const byGa = await report('wo_works', [], { store_id: sid.ZT01, title: m7Name('CD-GA') });
  expect(byGa.status(), await byGa.text()).toBe(201);
  // 回報人看得到自己的單；不能看別店的
  expect((await get('wo_cross_store_a', `${W}/${w.id}`)).status).toBe(200);
  expect((await get('wo_store_b', `${W}/${w.id}`)).status).toBe(404);
  expect((await get('wo_cross_store_a', `${W}/${w.id}`)).body.data.photos).toHaveLength(2);
});

test('G19.integration.legacy-journey：舊式回報 → 總務受理存進度 → 送門市確認（不再報錯）→ 回報人「仍有問題」須原因 → 再送 → 確認；結案後沒有重新開啟', async () => {
  const created = await report('wo_cross_store_a', [png()], { title: m7Name(`CD-J-${(seq += 1)}`) });
  expect(created.status()).toBe(201);
  let w = (await created.json()).data;
  // 總務受理（存進度自動受理）→ 送門市確認
  expect((await act('wo_cross_update', w, 'progress', { notes: '已派人查看' })).status).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW' });
  // 待確認前，回報人的確認鈕被擋
  expect((await act('wo_cross_store_a', w, 'store-confirm')).status).toBe(409);
  expect((await act('wo_cross_update', w, 'request-completion', { notes: '已修復' })).status).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
  // 可按鈕：回報人；abilities 反映
  const ab = (await get('wo_cross_store_a', `${W}/${w.id}`)).body.data.abilities;
  expect(ab).toMatchObject({ can_store_confirm: true, can_report_unresolved: true, read_only: true });
  expect((await get('wo_cross_update', `${W}/${w.id}`)).body.data.abilities).toMatchObject({ can_store_confirm: false, can_report_unresolved: false });
  // 仍有問題要原因
  expect((await act('wo_cross_store_a', w, 'report-unresolved', {})).status).toBe(400);
  expect((await act('wo_cross_store_a', w, 'report-unresolved', { reason: '還是不冷' })).status).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'REOPENED', unresolved_reason: '還是不冷' });
  expect((await act('wo_cross_update', w, 'request-completion', { notes: '更換壓縮機' })).status).toBe(200);
  const done = await act('wo_cross_store_a', w, 'store-confirm', { note: '已正常' });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED' });
  const final = (await get('wo_cross_store_a', `${W}/${w.id}`)).body.data;
  expect(final.abilities).toMatchObject({ can_reopen: false });
  expect(final.abilities.reopen_note).toContain('不能重新開啟');
  expect((await act('wo_cross_update', w, 'progress', { notes: '想重開' })).status).toBe(409);
  const types = (await eventsOf(w.id)).map((e) => e.event_type);
  expect(types).toEqual(expect.arrayContaining(['CREATED', 'SAVE_PROGRESS', 'REQUEST_COMPLETION', 'REPORT_UNRESOLVED', 'STORE_CONFIRM_COMPLETE']));
});

test('G19.integration.delete-rules：回報人只能刪自己未受理且沒連需求單的單；已受理刪不掉；別人的單不能刪；只有查看全部不能刪；總務（管理）可刪未受理的單', async () => {
  const mk = async (who: string, store = 'VW001') => (await (await report(who, [png()], { store_id: sid[store] })).json()).data;
  const mine = await mk('wo_cross_store_a');
  expect((await send('wo_store_b', 'delete', `${W}/${mine.id}`, { expected_updated_at: mine.updated_at })).status).toBe(404);
  expect((await send('wo_cross_viewall', 'delete', `${W}/${mine.id}`, { expected_updated_at: mine.updated_at })).status).toBe(403);
  expect((await send('wo_viewall', 'delete', `${W}/${mine.id}`, { expected_updated_at: mine.updated_at })).status).toBe(403);
  expect((await send('wo_store_a', 'delete', `${W}/${mine.id}`, { expected_updated_at: mine.updated_at })).status, '同店店長不是回報人不能刪').toBe(403);
  expect(await woRow(mine.id)).not.toBeNull();
  const del = await send('wo_cross_store_a', 'delete', `${W}/${mine.id}`, { expected_updated_at: mine.updated_at });
  expect(del.status, JSON.stringify(del.body)).toBe(200);
  expect(await woRow(mine.id)).toBeNull();
  expect((await attsOf(mine.id)).every((a) => a.deleted_at !== null)).toBe(true);
  // 已受理
  const acc = await mk('wo_cross_store_a');
  expect((await act('wo_cross_update', acc, 'progress', { notes: '受理' })).status).toBe(200);
  const r = await send('wo_cross_store_a', 'delete', `${W}/${acc.id}`, { expected_updated_at: await upd(acc.id) });
  expect(r.status).toBe(409);
  expect(r.body.error).toContain('不處理，強制結案');
  expect(await woRow(acc.id)).not.toBeNull();
  // 總務（工單管理）刪別人的未受理單
  const other = await mk('wo_cross_store_a');
  expect((await send('wo_manager', 'delete', `${W}/${other.id}`, { expected_updated_at: other.updated_at })).status).toBe(200);
  expect(await woRow(other.id)).toBeNull();
});

test('G19.integration.admin-readonly：profiles.role=admin 沒有任何有效角色：看不到也不能改（白話說明）；只有工單查看自己門市的帳號可看自己門市但不能改', async () => {
  const w = await (async () => (await (await report('wo_cross_store_a', [png()])).json()).data)();
  const r = await get('admin', W);
  expect(r.status).toBe(403);
  expect(r.body.error).toMatch(/[一-鿿]/);
  const wr = await act('admin', w, 'progress', { notes: 'x' });
  expect(wr.status).toBe(403);
  expect(await woRow(w.id)).toMatchObject({ status: 'UNACCEPTED', updated_at: w.updated_at });
  // 工單查看自己門市（只讀）的店長可看自己的、不能改
  const own = await get('wo_store_a', `${W}/${w.id}`);
  expect(own.status).toBe(200);
  expect(own.body.data.abilities).toMatchObject({ read_only: true });
  expect(own.body.data.abilities.read_only_reason).toBeTruthy();
  expect((await act('wo_store_a', w, 'progress', { notes: 'x' })).status).toBe(403);
  // 不在名單的 own 權限：空清單
  expect((await get('wo_outsider_own', W)).body.total).toBe(0);
});

test('G19.integration.categories：維修分類——看需要任一維修查看碼；新增、改名、停用、排序需要 category.edit；重名白話 409；版本衝突；參數 400', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  expect((await anon.get(CAT)).status()).toBe(401);
  expect((await anon.post(CAT, { data: { name: 'x' } })).status()).toBe(401);
  await anon.dispose();
  for (const k of ['nobody', 'admin']) expect((await get(k, CAT)).status, k).toBe(403);
  for (const k of ['wo_works', 'wo_viewall', 'wo_cross_store_a', 'wo_store_a', 'wo_manager']) expect((await get(k, CAT)).status, k).toBe(200);
  // 編輯權限只有 category.edit（wo_manager）；工務、只看全部、店長都不行
  const name = m7Name(`CATX${(seq += 1)}`);
  for (const k of ['wo_works', 'wo_viewall', 'wo_cross_update', 'wo_cross_store_a', 'nobody', 'admin']) expect((await send(k, 'post', CAT, { name })).status, k).toBe(403);
  const bad = await apis.wo_manager.post(CAT, { data: { name }, headers: { Origin: 'https://evil.example' } });
  expect(bad.status()).toBe(403);
  expect((await send('wo_manager', 'post', CAT, { name: '' })).status).toBe(400);
  expect((await send('wo_manager', 'post', CAT, { name: 'x'.repeat(51) })).status).toBe(400);
  const made = await send('wo_manager', 'post', CAT, { name });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const cat = made.body.data;
  expect(cat).toMatchObject({ name, is_active: true });
  expect(Number(cat.sort_order)).toBeGreaterThan(0);
  // 重名：舊版回英文資料庫錯誤，新版白話 409
  const dup = await send('wo_manager', 'post', CAT, { name: ` ${name.toUpperCase()} ` });
  expect(dup.status).toBe(409);
  expect(dup.body.error).toContain('相同名稱');
  // 改名、排序、停用
  const name2 = m7Name(`CATY${(seq += 1)}`);
  const other = await seedMaintenanceCategory(`CATZ${seq}`);
  expect((await send('wo_manager', 'patch', `${CAT}/${cat.id}`, { name: other.name })).status).toBe(409);
  expect((await send('wo_manager', 'patch', `${CAT}/${cat.id}`, {})).status).toBe(400);
  expect((await send('wo_manager', 'patch', `${CAT}/${cat.id}`, { name: '' })).status).toBe(400);
  expect((await send('wo_manager', 'patch', `${CAT}/${cat.id}`, { sort_order: 'abc' })).status).toBe(400);
  expect((await send('wo_manager', 'patch', `${CAT}/not-a-uuid`, { name: name2 })).status).toBe(400);
  expect((await send('wo_manager', 'patch', `${CAT}/${crypto.randomUUID()}`, { name: name2 })).status).toBe(404);
  expect((await send('wo_manager', 'patch', `${CAT}/${cat.id}`, { name: name2, expected_updated_at: '2001-01-01T00:00:00+00:00' })).status).toBe(409);
  const ren = await send('wo_manager', 'patch', `${CAT}/${cat.id}`, { name: name2, sort_order: 955 });
  expect(ren.status, JSON.stringify(ren.body)).toBe(200);
  expect(ren.body.data).toMatchObject({ name: name2, sort_order: 955 });
  expect((await send('wo_viewall', 'patch', `${CAT}/${cat.id}`, { name: 'x' })).status).toBe(403);
  // 停用：一般查看者看不到、編輯者帶 include_inactive 才看得到；已用過的工單分類不受影響
  const w = await (async () => (await (await report('wo_cross_store_a', [png()], { category_id: cat.id })).json()).data)();
  expect((await woRow(w.id)).category_id).toBe(cat.id);
  expect((await send('wo_manager', 'delete', `${CAT}/${cat.id}`)).status).toBe(200);
  expect((await db().from('maintenance_categories').select('is_active').eq('id', cat.id).single()).data).toMatchObject({ is_active: false });
  const visible = async (k: string, q = '') => ((await get(k, `${CAT}${q}`)).body.data as any[]).map((c) => c.id);
  expect(await visible('wo_works')).not.toContain(cat.id);
  expect(await visible('wo_works', '?include_inactive=1')).not.toContain(cat.id);
  expect(await visible('wo_manager')).not.toContain(cat.id);
  expect(await visible('wo_manager', '?include_inactive=1')).toContain(cat.id);
  expect((await woRow(w.id)).category_id).toBe(cat.id);
  expect((await send('wo_manager', 'patch', `${CAT}/${cat.id}`, { is_active: true })).body.data.is_active).toBe(true);
  expect((await send('wo_manager', 'delete', `${CAT}/${crypto.randomUUID()}`)).status).toBe(404);
  expect((await send('wo_works', 'delete', `${CAT}/${cat.id}`)).status).toBe(403);
  expect((await send('wo_manager', 'post', `${CAT}/${cat.id}`, { name: 'x' })).status).toBe(404);
});
