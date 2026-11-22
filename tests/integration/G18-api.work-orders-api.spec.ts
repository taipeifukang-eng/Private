import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, M7_FILE_PREFIX, seedBalance, seedCategory, seedLocation, seedLocationPart, seedMaintenanceCategory, seedPart, seedWorkOrder, stores } from '../support/m7m8-fixtures';
import { multipartBody, type MpFile } from '../support/multipart';
import { setupPoUsers, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 5 批 G18-api（G18.integration.*）：工單中心 API /api/workspace/general-affairs/work-orders/**。
// 每支寫入都驗：未登入 401、Origin 不符 403、權限矩陣（缺哪個權限講清楚）、400 輸入驗證、409（STALE、非法流轉）、固定識別冪等，並用 service role 回讀資料庫；
// 失敗全回復（沒有半套資料）；只有 view_all 不能改不能刪；需求單已完成／退回／取消時不翻回；INTERNAL 不洩漏；強制結案原因店長不可見。
// 測試資料：標題帶 [自動測試]M7M8 標記、只用 VW／ZT 測試門市；結束只清自己的（cleanupM7M8）。與其他整合檔一樣循序執行。
const W = '/api/workspace/general-affairs/work-orders';
const KEYS: PoKey[] = ['wo_works', 'wo_works_notxn', 'wo_works_nopart', 'wo_manager', 'wo_update_noforce', 'wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_mr_update', 'wo_cross_update',
  'wo_store_a', 'wo_store_a2', 'wo_store_b', 'wo_store_a_viewonly', 'wo_outsider_own', 'nobody', 'admin'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let part: any;
let loc: any;
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));

const upload = (who: string, id: string, files: MpFile[], fields: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const m = multipartBody(files, fields);
  return apis[who].post(`${W}/${id}/attachments`, { data: m.data, headers: { ...m.headers, ...headers } });
};
const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).maybeSingle()).data as any;
const upd = async (id: string) => (await woRow(id)).updated_at as string;
const reqRow = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const updatesOf = async (id: string) => ((await db().from('maintenance_updates').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
const eventsOf = async (id: string) => ((await db().from('maintenance_ticket_events').select('*').eq('ticket_id', id).order('created_at').order('id')).data || []) as any[];
const dbBal = async (l: string, p: string) => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', l).eq('part_id', p).maybeSingle()).data as any)?.quantity_base ?? 0);
const wo = (suffix: string, over: Record<string, unknown> = {}, store = 'VW001', reporter = 'wo_store_a') => seedWorkOrder(store, `${suffix}-${(seq += 1)}`, users[reporter].id, over);
const open = (suffix: string, over: Record<string, unknown> = {}, store = 'VW001') => wo(suffix, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString(), ...over }, store);
async function linked(suffix: string, reqStatus = 'IN_PROGRESS', woOver: Record<string, unknown> = {}, reqOver: Record<string, unknown> = {}) {
  const s = await stores();
  const r = (await db().from('ga_service_requests').insert({ store_id: s.VW001.id, created_by: users.wo_store_a.id, request_type: 'REPAIR', title: m7Name(`REQ-${suffix}-${(seq += 1)}`), description: 'm7m8 工單 API 測試',
    main_status: reqStatus, intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS', ...reqOver }).select('*').single()).data as any;
  const w = await open(`WO-${suffix}`, { ga_service_request_id: r.id, ...woOver });
  await db().from('ga_service_requests').update({ maintenance_request_id: w.id }).eq('id', r.id);
  return { r: await reqRow(r.id), w: await woRow(w.id) };
}
const progress = async (who: string, w: any, data: Record<string, unknown> = {}, expected?: string) =>
  send(who, 'post', `${W}/${w.id}/progress`, { notes: '現場評估中', expected_updated_at: expected ?? (await upd(w.id)), ...data });
const act = async (who: string, w: any, path: string, data: Record<string, unknown> = {}, expected?: string) =>
  send(who, 'post', `${W}/${w.id}/${path}`, { expected_updated_at: expected ?? (await upd(w.id)), ...data });

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
  const cat = await seedCategory('part', 'WOA');
  part = await seedPart(cat.id, 'WOA-P1');
  loc = await seedLocation(null, 'WOA-W');
  await seedLocationPart(loc.id, part.id);
  await seedBalance(loc.id, part.id, 10);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件、舊照片檔、測試分類）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const left = await db().from('maintenance_requests').select('id', { count: 'exact', head: true }).like('title', '[自動測試]M7M8 T%');
  expect(left.count, '工單殘留').toBe(0);
});

// ----------------------------------------------------------------------------- 讀取與權限
test('G18.integration.read-auth：未登入 401；沒有權限 403；只有 view_all 與更新碼看全部；店長只看自己門市；管理員沒有角色看不到', async () => {
  const a = await wo('READ-A');
  const b = await wo('READ-B', {}, 'ZT01', 'wo_store_b');
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of [W, `${W}/summary`, `${W}/${a.id}`, `${W}/${a.id}/print`]) expect((await anon.get(p)).status(), p).toBe(401);
  await anon.dispose();
  for (const k of ['nobody', 'admin']) {
    for (const p of [W, `${W}/summary`, `${W}/${a.id}`, `${W}/${a.id}/print`]) expect((await get(k, p)).status, `${k} ${p}`).toBe(403);
  }
  const ids = async (k: string) => ((await get(k, `${W}?q=READ-&pageSize=100`)).body.data as any[]).map((r) => r.id);
  for (const k of ['wo_works', 'wo_manager', 'wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_mr_update', 'wo_cross_update']) {
    const got = await ids(k);
    expect(got, `${k} 看全部門市`).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await get(k, `${W}/${b.id}`)).status, `${k} 詳情`).toBe(200);
  }
  for (const k of ['wo_store_a', 'wo_store_a2', 'wo_store_a_viewonly']) {
    const got = await ids(k);
    expect(got, `${k} 只看自己門市`).toContain(a.id);
    expect(got, `${k} 看不到別間`).not.toContain(b.id);
    expect((await get(k, `${W}/${b.id}`)).status, `${k} 別間詳情`).toBe(404);
  }
  expect((await get('wo_store_b', `${W}/${a.id}`)).status).toBe(404);
  const out = await get('wo_outsider_own', `${W}?q=READ-`);
  expect(out.status).toBe(200);
  expect(out.body.total).toBe(0);
  expect((await get('wo_works', `${W}/${crypto.randomUUID()}`)).status).toBe(404);
  expect((await get('wo_works', `${W}/not-a-uuid`)).status).toBe(400);
  // 頁面層級能力（缺哪個權限講清楚）
  const vp = (await get('wo_viewall', W)).body.permissions;
  expect(vp).toMatchObject({ canEnter: true, canUpdate: false, readOnly: true, canIssuePart: false });
  expect(vp.readOnlyReason).toContain('只有查看工單的權限');
  const np = (await get('wo_works_notxn', W)).body.permissions;
  expect(np.issuePartMissing).toEqual(['庫存交易管理']);
  expect((await get('wo_manager', W)).body.permissions).toMatchObject({ canUpdate: true, canForceClose: true, canDeleteAny: true });
  expect((await get('wo_update_noforce', W)).body.permissions).toMatchObject({ canUpdate: true, canForceClose: false, forceCloseMissing: '強制結案' });
});

test('G18.integration.list：精確筆數與分頁、第 51 筆之後可搜到、篩選驗證 400、搜尋跳脫、焦點卡全量計數、摘要', async () => {
  const s = await stores();
  const tag = `LIST${(seq += 1)}`;
  const rows = Array.from({ length: 55 }, (_, i) => ({ store_id: s.VW001.id, title: m7Name(`${tag}-${String(i + 1).padStart(2, '0')}`), description: 'm7m8 列表測試', reported_by: users.wo_store_a.id, reporter_name: 'M7M8',
    status: i < 5 ? 'PROCESSING' : 'UNACCEPTED', progress_stage: i < 3 ? 'WAITING_PARTS' : i < 5 ? 'VENDOR_WORKING' : null, priority: 'normal' }));
  expect((await db().from('maintenance_requests').insert(rows)).error).toBeNull();
  const all = await get('wo_works', `${W}?q=${tag}&pageSize=20&page=1`);
  expect(all.status).toBe(200);
  expect(all.body.total).toBe(55);
  expect(all.body.data).toHaveLength(20);
  expect(all.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 55, totalPages: 3 });
  const p3 = await get('wo_works', `${W}?q=${tag}&pageSize=20&page=3`);
  expect(p3.body.data).toHaveLength(15);
  const ids = new Set<string>();
  for (const p of [1, 2, 3]) for (const r of (await get('wo_works', `${W}?q=${tag}&pageSize=20&page=${p}`)).body.data) ids.add(r.id);
  expect(ids.size).toBe(55);
  expect((await get('wo_works', `${W}?q=${tag}&pageSize=9999`)).body.meta.pageSize).toBe(100);
  expect((await get('wo_works', `${W}?q=${tag}&pageSize=0`)).body.meta.pageSize).toBeGreaterThanOrEqual(1);
  const last = await get('wo_works', `${W}?q=${encodeURIComponent(`${tag}-55`)}`);
  expect(last.body.total).toBe(1);
  expect(last.body.data[0].title).toContain(`${tag}-55`);
  // 焦點卡全量計數（不只已載入的）與焦點篩選
  const fc = (await get('wo_works', `${W}?q=${tag}&pageSize=5`)).body.focus_counts;
  expect(fc).toMatchObject({ all: 55, parts: 3, vendor: 2, arrange: 50, completed: 0 });
  expect((await get('wo_works', `${W}?q=${tag}&focus=parts`)).body.total).toBe(3);
  expect((await get('wo_works', `${W}?q=${tag}&focus=all`)).body.total).toBe(55);
  expect((await get('wo_works', `${W}?q=${tag}&status=PROCESSING`)).body.total).toBe(5);
  expect((await get('wo_works', `${W}?q=${tag}&source=LEGACY`)).body.total).toBe(55);
  expect((await get('wo_works', `${W}?q=${tag}&source=REQUEST`)).body.total).toBe(0);
  expect((await get('wo_works', `${W}?q=${tag}&store_id=${s.ZT01.id}`)).body.total).toBe(0);
  // 篩選驗證
  for (const bad of ['status=NOPE', 'focus=NOPE', 'source=NOPE', 'store_id=bad', 'category_id=bad']) expect((await get('wo_works', `${W}?${bad}`)).status, bad).toBe(400);
  // 搜尋跳脫：% 、_、逗號、括號、雙引號不會壞掉也不會比對全部
  for (const q of ['%', '_', 'a,b', '(x)', '"x"', '\\']) {
    const r = await get('wo_works', `${W}?q=${encodeURIComponent(q)}`);
    expect(r.status, q).toBe(200);
    expect(r.body.total, `q=${q}`).toBeLessThan(55);
  }
  const pct = await wo('PCT', { title: m7Name('PCT 100%折扣') });
  expect((await get('wo_works', `${W}?q=${encodeURIComponent('100%')}`)).body.data.map((r: any) => r.id)).toContain(pct.id);
  // 店長端列表：沒有處理人欄位；總務端有
  const storeRow = (await get('wo_store_a', `${W}?q=${tag}-01`)).body.data[0];
  expect(Object.keys(storeRow)).not.toEqual(expect.arrayContaining(['assignee_name']));
  expect((await get('wo_works', `${W}?q=${tag}-01`)).body.data[0]).toHaveProperty('assignee_name');
  // 摘要：資料庫端 group by，與資料庫實際筆數一致
  const sum = await get('wo_works', `${W}/summary`);
  expect(sum.status).toBe(200);
  const vw = (sum.body.data as any[]).find((x) => x.store_id === s.VW001.id);
  const real = await db().from('maintenance_requests').select('id', { count: 'exact', head: true }).eq('store_id', s.VW001.id);
  expect(vw.total).toBe(real.count);
  const mine = (await get('wo_store_a', `${W}/summary`)).body.data as any[];
  expect(mine.map((x) => x.store_id)).toEqual([s.VW001.id]);
  expect((await get('wo_works', `${W}/summary?status=NOPE`)).status).toBe(400);
});

test('G18.integration.detail：店長端看不到處理人、內部進度、用料清單；總務端看得到；照片簽名且不外露儲存路徑；舊照片唯讀合併', async () => {
  const lk = await linked('DET', 'IN_PROGRESS');
  const secret = '內部機密-DET';
  expect((await progress('wo_works', lk.w, { progress_stage: 'VENDOR_WORKING', visibility: 'INTERNAL', notes: secret, assignee_name: '王師傅' })).status).toBe(200);
  expect((await progress('wo_works', lk.w, { progress_stage: 'WAITING_PARTS', notes: '等料件到貨' })).status).toBe(200);
  const g = await get('wo_works', `${W}/${lk.w.id}`);
  expect(g.status).toBe(200);
  expect(g.body.data.ga_side).toBe(true);
  expect(JSON.stringify(g.body.data.timeline)).toContain(secret);
  expect(g.body.data.work_order.assignee_name).toBe('王師傅');
  expect(g.body.data.abilities).toMatchObject({ read_only: false });
  const s = await get('wo_store_a', `${W}/${lk.w.id}`);
  expect(s.status).toBe(200);
  expect(s.body.data.ga_side).toBe(false);
  expect(JSON.stringify(s.body)).not.toContain(secret);
  expect(JSON.stringify(s.body)).not.toContain('王師傅');
  expect(s.body.data.work_order).not.toHaveProperty('assignee_name');
  expect(s.body.data.parts).toEqual([]);
  expect((s.body.data.timeline as any[]).every((t) => t.visibility === 'PUBLIC')).toBe(true);
  expect(s.body.data.abilities).toMatchObject({ read_only: true });
  // 舊照片＋新附件
  const legacyPath = `${M7_FILE_PREFIX}api-det-${Date.now()}.png`;
  expect((await db().storage.from('maintenance-photos').upload(legacyPath, PNG, { contentType: 'image/png', upsert: true })).error).toBeNull();
  await db().from('maintenance_photos').insert({ request_id: lk.w.id, storage_path: legacyPath, file_name: 'before.png', uploaded_by: users.wo_store_a.id, photo_type: 'before' });
  await db().from('maintenance_photos').insert({ request_id: lk.w.id, storage_path: `${M7_FILE_PREFIX}api-det-note.txt`, file_name: 'note.txt', uploaded_by: users.wo_store_a.id, photo_type: 'before' });
  const up = await upload('wo_store_a', lk.w.id, [{ name: 'new.png', mimeType: 'image/png', buffer: PNG }]);
  expect(up.status(), await up.text()).toBe(201);
  const d = await get('wo_works', `${W}/${lk.w.id}`);
  const photos = d.body.data.photos as any[];
  expect(photos.map((p) => p.file_name).sort()).toEqual(['before.png', `${M7_FILE_PREFIX}new.png`]);
  expect(photos.find((p) => p.file_name === 'before.png')).toMatchObject({ legacy: true, label: '舊版照片' });
  expect(photos.find((p) => p.file_name === `${M7_FILE_PREFIX}new.png`)).toMatchObject({ legacy: false, label: '回報照片' });
  expect(JSON.stringify(d.body)).not.toContain('storage_path');
  expect(d.body.data).not.toHaveProperty('attachments');
  expect(d.body.data).not.toHaveProperty('legacy_photos');
  for (const p of photos) {
    expect(p.signed_url, p.file_name).toMatch(/^https?:\/\//);
    const img = await pwRequest.newContext();
    expect((await img.get(p.signed_url)).status(), `${p.file_name} 可開啟`).toBe(200);
    await img.dispose();
  }
});

// ----------------------------------------------------------------------------- 存進度
test('G18.integration.progress：Origin、未登入、權限矩陣、400、有填才更新、STALE、流轉；失敗全回復', async () => {
  const w = await open('PRG');
  const body = { notes: '現場評估中', expected_updated_at: w.updated_at };
  // Origin 不符 403、未登入 401
  const bad = await apis.wo_works.post(`${W}/${w.id}/progress`, { data: body, headers: { Origin: 'https://evil.example' } });
  expect(bad.status()).toBe(403);
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  expect((await anon.post(`${W}/${w.id}/progress`, { data: body })).status()).toBe(401);
  await anon.dispose();
  // 權限矩陣
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall']) {
    const r = await progress(k, w);
    expect(r.status, k).toBe(403);
    expect(r.body.error).toContain('只有查看工單的權限');
  }
  for (const k of ['nobody', 'admin', 'wo_store_a', 'wo_store_b']) expect((await progress(k, w)).status, k).toBe(403);
  expect(await woRow(w.id)).toMatchObject({ updated_at: w.updated_at });
  expect(await updatesOf(w.id)).toHaveLength(0);
  // 400：缺版本、缺說明、格式錯誤（全部沒有寫入）
  expect((await send('wo_works', 'post', `${W}/${w.id}/progress`, { notes: 'x' })).status).toBe(400);
  expect((await progress('wo_works', w, { notes: '' })).status).toBe(400);
  expect((await progress('wo_works', w, { progress_stage: 'NOPE' })).status).toBe(400);
  expect((await progress('wo_works', w, { visibility: 'SECRET' })).status).toBe(400);
  expect((await progress('wo_works', w, { progress_date: '2038-02-31' })).status).toBe(400);
  expect((await progress('wo_works', w, { vendor_id: 'bad' })).status).toBe(400);
  expect((await progress('wo_works', w, {}, 'not-a-date')).status).toBe(400);
  expect((await send('wo_works', 'post', `${W}/${w.id}/progress`, 'oops' as any)).status).toBe(400);
  expect(await updatesOf(w.id)).toHaveLength(0);
  // 成功（有填才更新）
  const cat = await seedMaintenanceCategory('API-C1');
  const r1 = await progress('wo_works', w, { assignee_name: '王師傅', handling_method: '總務自行處理', category_id: cat.id, progress_stage: 'VENDOR_WORKING' });
  expect(r1.status, JSON.stringify(r1.body)).toBe(200);
  expect(r1.body.data).toMatchObject({ id: w.id, status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', assignee_name: '王師傅', handling_method: '總務自行處理', category_id: cat.id });
  const r2 = await progress('wo_manager', w, { notes: '再更新一次', assignee_name: '', handling_method: '  ' });
  expect(r2.status).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ assignee_name: '王師傅', handling_method: '總務自行處理', category_id: cat.id });
  const ups = await updatesOf(w.id);
  expect(ups.map((u) => u.notes)).toEqual(['現場評估中', '再更新一次']);
  expect((await eventsOf(w.id)).filter((e) => e.event_type === 'SAVE_PROGRESS')).toHaveLength(2);
  // STALE（舊版本）
  const stale = await progress('wo_works', w, {}, w.updated_at);
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect(await updatesOf(w.id)).toHaveLength(2);
  // 不能直選待確認或（連結單）等待補資料
  expect((await progress('wo_works', w, { progress_stage: 'WAITING_STORE_CONFIRMATION' })).status).toBe(422);
  const lk = await linked('PRG-USE', 'IN_PROGRESS');
  const use = await progress('wo_works', lk.w, { progress_stage: 'WAITING_STORE_INFO' });
  expect(use.status).toBe(422);
  expect(use.body.error).toContain('補資料');
  // 未受理 → 自動受理
  const un = await wo('PRG-UN');
  expect((await progress('wo_works', un)).status).toBe(200);
  expect(await woRow(un.id)).toMatchObject({ status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW', accepted_by: users.wo_works.id });
  // 只有更新碼不同的帳號都能改
  for (const k of ['wo_mr_update', 'wo_cross_update', 'wo_update_noforce']) expect((await progress(k, w)).status, k).toBe(200);
});

test('G18.integration.progress-guards：已完成不能存進度；待確認與等補資料期間不能存；需求單已完成、退回、取消時不翻回；INTERNAL 不洩漏到需求單', async () => {
  const done = await wo('G-DONE', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED', completed_at: new Date().toISOString() });
  const r = await progress('wo_works', done);
  expect(r.status).toBe(409);
  expect(r.body.error).toContain('不能重新開啟');
  const dl = await linked('G-DONE-L', 'COMPLETED', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED' });
  expect((await progress('wo_works', dl.w)).body.error).toContain('重新開啟');
  const waiting = await open('G-WAIT', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  for (const p of ['progress', 'request-completion']) expect((await act('wo_works', waiting, p, { notes: 'x' })).status, p).toBe(409);
  expect((await act('wo_works', waiting, 'request-supplement', { supplement_type: 'OTHER', supplement_note: 'x' })).status).toBe(409);
  expect(await woRow(waiting.id)).toMatchObject({ updated_at: waiting.updated_at });
  for (const st of ['COMPLETED', 'REJECTED', 'CANCELED']) {
    const lk = await linked(`G-${st}`, st);
    const before = await reqRow(lk.r.id);
    const ok = await progress('wo_works', lk.w, { progress_stage: 'VENDOR_WORKING', notes: '廠商施工' });
    expect(ok.status, `${st} ${JSON.stringify(ok.body)}`).toBe(200);
    const after = await reqRow(lk.r.id);
    expect(after.main_status, st).toBe(st);
    expect(after.public_progress, st).toBe(before.public_progress);
    expect(await woRow(lk.w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
  }
  const lk2 = await linked('G-SUP', 'WAITING_STORE_SUPPLEMENT', { progress_stage: 'WAITING_STORE_INFO' });
  expect((await progress('wo_works', lk2.w)).status).toBe(409);
  // INTERNAL 不洩漏
  const lk3 = await linked('G-INT', 'IN_PROGRESS');
  const secret = '內部機密備註-G18api';
  expect((await progress('wo_works', lk3.w, { visibility: 'INTERNAL', notes: secret, progress_stage: 'VENDOR_WORKING' })).status).toBe(200);
  const rq = await reqRow(lk3.r.id);
  expect(rq.public_progress).toContain('維修工單已更新');
  expect(rq.public_progress).not.toContain(secret);
  const reqEvs = ((await db().from('ga_service_request_events').select('*').eq('request_id', lk3.r.id)).data || []) as any[];
  expect(JSON.stringify(reqEvs)).not.toContain(secret);
});

// ----------------------------------------------------------------------------- 送確認、門市確認、仍有問題（舊式單）
test('G18.integration.completion-store：送門市確認（舊式單不再報錯）、門市確認與仍有問題只在待確認可按；回報人與同店店長可按，別店與總務不行；結案後不能重新開啟', async () => {
  const w = await open('CMP');
  // 非待確認時按確認被擋
  expect((await act('wo_store_a', w, 'store-confirm')).status).toBe(409);
  expect((await act('wo_store_a', w, 'report-unresolved', { reason: '還是壞的' })).status).toBe(409);
  // 送確認：權限
  for (const k of ['wo_viewall', 'wo_store_a', 'nobody', 'admin']) expect((await act(k, w, 'request-completion', { notes: 'x' })).status, k).toBe(403);
  const sent = await act('wo_works', w, 'request-completion', { notes: '已處理完畢' });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.data).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect((await act('wo_works', w, 'request-completion', {})).status).toBe(409);
  // 門市端：缺原因 400；別店 404；總務不能代按；檢視權限的店長可（同店且有回報權限才算店端）
  expect((await act('wo_store_a', w, 'report-unresolved', {})).status).toBe(400);
  expect((await act('wo_store_b', w, 'store-confirm')).status).toBe(404);
  for (const k of ['wo_works', 'wo_manager', 'wo_viewall']) expect([403, 404], k).toContain((await act(k, w, 'store-confirm')).status);
  expect((await act('wo_store_a', w, 'store-confirm', {}, w.updated_at)).status).toBe(409);
  // 仍有問題 → 重新處理 → 再送確認 → 同店另一位店長確認
  const un = await act('wo_store_a', w, 'report-unresolved', { reason: '還是會漏水' });
  expect(un.status, JSON.stringify(un.body)).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'REOPENED', unresolved_reason: '還是會漏水' });
  expect((await act('wo_store_a', w, 'store-confirm')).status).toBe(409);
  expect((await act('wo_works', w, 'request-completion', { notes: '再處理' })).status).toBe(200);
  const ok = await act('wo_store_a2', w, 'store-confirm', { note: '已修好' });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await woRow(w.id)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED' });
  expect((await woRow(w.id)).completed_by).toBe(users.wo_store_a2.id);
  // 結案後：不能存進度、不能再確認、沒有重新開啟
  expect((await progress('wo_works', w)).status).toBe(409);
  expect((await act('wo_store_a', w, 'store-confirm')).status).toBe(409);
  const det = (await get('wo_works', `${W}/${w.id}`)).body.data.abilities;
  expect(det).toMatchObject({ can_reopen: false });
  expect(det.reopen_note).toContain('不能重新開啟');
  const evs = (await eventsOf(w.id)).map((e) => e.event_type);
  expect(evs).toEqual(expect.arrayContaining(['REQUEST_COMPLETION', 'REPORT_UNRESOLVED', 'STORE_CONFIRM_COMPLETE']));
  // 有需求單且需求單在等確認：工單端按鈕擋下並指向我的追蹤
  const lk = await linked('CMP-L', 'IN_PROGRESS');
  expect((await act('wo_works', lk.w, 'request-completion', { notes: '完成' })).status).toBe(200);
  expect((await reqRow(lk.r.id)).main_status).toBe('WAITING_STORE_CONFIRMATION');
  const route = await act('wo_store_a', lk.w, 'store-confirm');
  expect(route.status).toBe(409);
  expect(route.body.error).toContain('我的追蹤');
});

// ----------------------------------------------------------------------------- 強制結案
test('G18.integration.force-close：需要強制結案權限與原因；需求單同步已完成、公開「總務已結案」；原因店長不可見；結案方式標示', async () => {
  const lk = await linked('FC', 'IN_PROGRESS');
  const reason = '重複回報-內部原因-FC';
  expect((await act('wo_update_noforce', lk.w, 'force-close', { force_close_reason: reason })).body.error).toContain('強制結案');
  for (const k of ['wo_update_noforce', 'wo_viewall', 'wo_store_a', 'nobody', 'admin']) expect((await act(k, lk.w, 'force-close', { force_close_reason: reason })).status, k).toBe(403);
  expect((await act('wo_manager', lk.w, 'force-close', {})).status).toBe(400);
  expect((await act('wo_manager', lk.w, 'force-close', { force_close_reason: 'x'.repeat(2001) })).status).toBe(400);
  expect((await act('wo_manager', lk.w, 'force-close', { force_close_reason: reason }, lk.w.updated_at.replace(/\d{4}/, '2001'))).status).toBe(409);
  expect(await woRow(lk.w.id)).toMatchObject({ status: 'PROCESSING', updated_at: lk.w.updated_at });
  const r = await act('wo_manager', lk.w, 'force-close', { force_close_reason: reason });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data).toMatchObject({ status: 'COMPLETED', completion_method: 'ADMIN_FORCE_CLOSED', request_status: 'COMPLETED' });
  const row = await woRow(lk.w.id);
  expect(row).toMatchObject({ status: 'COMPLETED', completion_method: 'ADMIN_FORCE_CLOSED', completed_by: users.wo_manager.id });
  const rq = await reqRow(lk.r.id);
  expect(rq.main_status).toBe('COMPLETED');
  expect(rq.public_progress).toBe('總務已結案');
  expect(rq.completed_at).not.toBeNull();
  expect(JSON.stringify(rq)).not.toContain(reason);
  // 店長：只看到「總務已結案」，看不到原因與處理人
  const s = await get('wo_store_a', `${W}/${lk.w.id}`);
  expect(JSON.stringify(s.body)).not.toContain(reason);
  expect(JSON.stringify(s.body)).toContain('總務已結案');
  expect(s.body.data.work_order.completion_method_label).toBe('強制結案');
  // 總務：看得到原因；列表帶結案方式；列印預設不含、勾選才含
  const g = await get('wo_works', `${W}/${lk.w.id}`);
  expect(JSON.stringify(g.body.data.timeline)).toContain(reason);
  const listRow = (await get('wo_works', `${W}?q=${encodeURIComponent(row.title)}`)).body.data[0];
  expect(listRow).toMatchObject({ completion_method: 'ADMIN_FORCE_CLOSED', completion_method_label: '強制結案', focus: 'completed' });
  const p0 = await get('wo_manager', `${W}/${lk.w.id}/print`);
  expect(JSON.stringify(p0.body)).not.toContain(reason);
  const p1 = await get('wo_manager', `${W}/${lk.w.id}/print?include_internal=1`);
  expect(p1.body.data).toMatchObject({ include_internal: true, force_close_reason: expect.stringContaining(reason) });
  expect((await get('wo_store_a', `${W}/${lk.w.id}/print?include_internal=true`)).status).toBe(403);
  // 只有 view_all：詳情看得到內部欄位、能力 canPrintInternal=false、列印內部備註 403；預設列印 200 且不含內部
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall']) {
    const d = await get(k, `${W}/${lk.w.id}`);
    expect(d.status, k).toBe(200);
    expect(JSON.stringify(d.body.data.timeline), k).toContain(reason);
    expect(d.body.data.ga_side, k).toBe(true);
    expect(d.body.data.abilities.can_print_internal, k).toBe(false);
    expect(d.body.page_abilities.canPrintInternal, k).toBe(false);
    const pv = await get(k, `${W}/${lk.w.id}/print?include_internal=1`);
    expect(pv.status, k).toBe(403);
    expect(JSON.stringify(pv.body), k).not.toContain(reason);
    const pd = await get(k, `${W}/${lk.w.id}/print`);
    expect(pd.status, k).toBe(200);
    expect(pd.body.data.include_internal, k).toBe(false);
  }
  expect((await get('wo_manager', `${W}/${lk.w.id}`)).body.page_abilities.canPrintInternal).toBe(true);
  const p2 = await get('wo_store_a', `${W}/${lk.w.id}/print`);
  expect(p2.status).toBe(200);
  expect(JSON.stringify(p2.body)).not.toContain(reason);
  expect(p2.body.data.include_internal).toBe(false);
  // 已完成再結案 409；未受理不能強制結案
  expect((await act('wo_manager', lk.w, 'force-close', { force_close_reason: reason })).status).toBe(409);
  const un = await wo('FC-UN');
  expect((await act('wo_manager', un, 'force-close', { force_close_reason: reason })).status).toBe(409);
  // 舊式單強制結案：只改工單
  const lg = await open('FC-LEG');
  expect((await act('wo_manager', lg, 'force-close', { force_close_reason: '不需處理' })).status).toBe(200);
  expect(await woRow(lg.id)).toMatchObject({ status: 'COMPLETED', completion_method: 'ADMIN_FORCE_CLOSED' });
});

// ----------------------------------------------------------------------------- 補資料
test('G18.integration.supplement：補資料兩邊同步；舊式單由回報人回覆；已出庫或已有採購單者被擋；參數 400', async () => {
  const lk = await linked('SUP', 'IN_PROGRESS');
  for (const k of ['wo_viewall', 'wo_store_a', 'nobody']) expect((await act(k, lk.w, 'request-supplement', { supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請重拍' })).status, k).toBe(403);
  expect((await act('wo_works', lk.w, 'request-supplement', { supplement_note: 'x' })).status).toBe(400);
  expect((await act('wo_works', lk.w, 'request-supplement', { supplement_type: 'NOPE', supplement_note: 'x' })).status).toBe(400);
  expect((await act('wo_works', lk.w, 'request-supplement', { supplement_type: 'OTHER' })).status).toBe(400);
  expect((await act('wo_works', lk.w, 'request-supplement', { supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請重拍' }, '2001-01-01T00:00:00+00:00')).status).toBe(409);
  expect((await reqRow(lk.r.id)).main_status).toBe('IN_PROGRESS');
  const r = await act('wo_works', lk.w, 'request-supplement', { supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請重拍' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO', request_status: 'WAITING_STORE_SUPPLEMENT' });
  expect(await reqRow(lk.r.id)).toMatchObject({ main_status: 'WAITING_STORE_SUPPLEMENT', supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請重拍' });
  expect((await act('wo_works', lk.w, 'request-supplement', { supplement_type: 'OTHER', supplement_note: 'x' })).status).toBe(409);
  expect((await progress('wo_works', lk.w)).status).toBe(409);
  // 有需求單者：舊式回覆入口要求走我的追蹤
  const nope = await act('wo_store_a', lk.w, 'reply-supplement', { note: '補了' });
  expect(nope.status).toBe(409);
  expect(nope.body.error).toContain('我的追蹤');
  // 舊式單
  const lg = await open('SUP-LEG');
  expect((await act('wo_works', lg, 'request-supplement', { supplement_type: 'MISSING_PHOTO', supplement_note: '請補照片' })).status).toBe(200);
  expect(await woRow(lg.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
  expect((await act('wo_store_a', lg, 'reply-supplement', {})).status).toBe(400);
  for (const k of ['wo_works', 'wo_viewall']) expect([403, 404], k).toContain((await act(k, lg, 'reply-supplement', { note: 'x' })).status);
  expect((await act('wo_store_b', lg, 'reply-supplement', { note: 'x' })).status).toBe(404);
  const rep = await act('wo_store_a', lg, 'reply-supplement', { note: '已補上照片' });
  expect(rep.status, JSON.stringify(rep.body)).toBe(200);
  expect(await woRow(lg.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW' });
  expect((await act('wo_store_a', lg, 'reply-supplement', { note: '再補' })).status).toBe(409);
  // 已出庫或已有採購單的需求單不能補資料（改用留言）：庫存流水不可改刪，改由資料庫層測試（G18-db）與 G28 劇本覆蓋。
});

// ----------------------------------------------------------------------------- 領用料件
test('G18.integration.issue-part：同交易扣庫存、流水記工單編號、冪等、超庫存被擋、缺權限講清楚、待確認與未受理不可領；工單詳情顯示用料清單（店長看不到）', async () => {
  const w = await open('PART');
  const before = await dbBal(loc.id, part.id);
  const k1 = key();
  const body = { location_id: loc.id, part_id: part.id, quantity: 2, input_unit_type: 'BASE', reason: '更換濾網', idempotency_key: k1 };
  // 權限：缺庫存交易管理、缺料件查看、只有 view_all、店長
  const miss1 = await act('wo_works_notxn', w, 'issue-part', { ...body, idempotency_key: key() });
  expect(miss1.status).toBe(403);
  expect(miss1.body.error).toContain('庫存交易管理');
  const miss2 = await act('wo_works_nopart', w, 'issue-part', { ...body, idempotency_key: key() });
  expect(miss2.status).toBe(403);
  expect(miss2.body.error).toContain('料件查看');
  for (const k of ['wo_viewall', 'wo_store_a', 'nobody', 'admin']) expect((await act(k, w, 'issue-part', { ...body, idempotency_key: key() })).status, k).toBe(403);
  // 400
  for (const bad of [{ quantity: 0 }, { quantity: -1 }, { quantity: 'abc' }, { location_id: 'x' }, { part_id: 'x' }, { input_unit_type: 'BOX' }, { idempotency_key: '' }, { reason: 'x'.repeat(501) }]) {
    expect((await act('wo_works', w, 'issue-part', { ...body, idempotency_key: key(), ...bad })).status, JSON.stringify(bad)).toBe(400);
  }
  expect(await dbBal(loc.id, part.id)).toBe(before);
  // 缺版本（第一次送出）→ 400
  expect((await send('wo_works', 'post', `${W}/${w.id}/issue-part`, body)).status).toBe(400);
  // 成功
  const ok = await act('wo_works', w, 'issue-part', body);
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  expect(ok.body.replay).toBe(false);
  expect(await dbBal(loc.id, part.id)).toBe(before - 2);
  const tx = (await db().from('ga_inventory_transactions').select('*').eq('idempotency_key', k1).single()).data as any;
  expect(tx).toMatchObject({ reference_type: 'MAINTENANCE_REQUEST', reference_id: w.id });
  expect(tx.reason).toContain(`WO-${w.id.slice(0, 8).toUpperCase()}`);
  expect(Number(tx.quantity_base)).toBe(-2);
  const ev = (await eventsOf(w.id)).filter((e) => e.event_type === 'PART_ISSUED');
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ visibility: 'INTERNAL' });
  expect(ev[0].metadata).toMatchObject({ transaction_id: tx.id, part_id: part.id, location_id: loc.id });
  // 冪等：同識別碼重送回原結果、不再扣
  const again = await send('wo_works', 'post', `${W}/${w.id}/issue-part`, body);
  expect(again.status, JSON.stringify(again.body)).toBe(200);
  expect(again.body.replay).toBe(true);
  expect(await dbBal(loc.id, part.id)).toBe(before - 2);
  expect((await eventsOf(w.id)).filter((e) => e.event_type === 'PART_ISSUED')).toHaveLength(1);
  // 超過庫存被擋（庫存不變、沒有事件）
  const over = await act('wo_works', w, 'issue-part', { ...body, quantity: 9999, idempotency_key: key() });
  expect([400, 409]).toContain(over.status);
  expect(over.body.error).toMatch(/[一-鿿]/);
  expect(await dbBal(loc.id, part.id)).toBe(before - 2);
  expect((await eventsOf(w.id)).filter((e) => e.event_type === 'PART_ISSUED')).toHaveLength(1);
  // 詳情：總務端有用料清單（數量以流水核對）；店長看不到
  const g = await get('wo_works', `${W}/${w.id}`);
  expect(g.body.data.parts).toHaveLength(1);
  expect(g.body.data.parts[0]).toMatchObject({ transaction_id: tx.id, part_name: part.name });
  expect(Number(g.body.data.parts[0].verified_quantity_base)).toBe(2);
  expect(g.body.data.abilities).toMatchObject({ can_issue_part: true });
  expect((await get('wo_store_a', `${W}/${w.id}`)).body.data.parts).toEqual([]);
  expect(JSON.stringify((await get('wo_store_a', `${W}/${w.id}`)).body)).not.toContain(tx.id);
  // 狀態：未受理、待確認、已完成不可領
  const un = await wo('PART-UN');
  expect((await act('wo_works', un, 'issue-part', { ...body, idempotency_key: key() })).status).toBe(409);
  const wait = await open('PART-WAIT', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect((await act('wo_works', wait, 'issue-part', { ...body, idempotency_key: key() })).status).toBe(409);
  expect(await dbBal(loc.id, part.id)).toBe(before - 2);
});

// ----------------------------------------------------------------------------- 刪除與分類
test('G18.integration.delete：只有未受理且沒連需求單可刪；回報人只能刪自己的；只有 view_all 不能刪；附件只標記；版本與參數驗證', async () => {
  const mine = await wo('DEL-MINE');
  // 回報人以外的店長（同店）與別店、只有 view_all、一般更新（沒有刪除碼）都不能刪
  for (const k of ['wo_store_a2', 'wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_works', 'wo_update_noforce']) {
    const r = await send(k, 'delete', `${W}/${mine.id}?expected_updated_at=${encodeURIComponent(mine.updated_at)}`);
    expect([403, 404], k).toContain(r.status);
  }
  expect((await send('wo_store_b', 'delete', `${W}/${mine.id}?expected_updated_at=${encodeURIComponent(mine.updated_at)}`)).status).toBe(404);
  expect((await send('nobody', 'delete', `${W}/${mine.id}?expected_updated_at=${encodeURIComponent(mine.updated_at)}`)).status).toBe(404);
  expect(await woRow(mine.id)).not.toBeNull();
  expect((await send('wo_store_a', 'delete', `${W}/${mine.id}`)).status).toBe(400);
  expect((await send('wo_store_a', 'delete', `${W}/${mine.id}?expected_updated_at=garbage`)).status).toBe(400);
  expect((await send('wo_store_a', 'delete', `${W}/${mine.id}?expected_updated_at=2001-01-01T00:00:00%2B00:00`)).status).toBe(409);
  // 附件：先放一張新照片，刪除後只標記
  const up = await upload('wo_store_a', mine.id, [{ name: 'del.png', mimeType: 'image/png', buffer: PNG }]);
  expect(up.status(), await up.text()).toBe(201);
  const fresh = await upd(mine.id);
  const ok = await send('wo_store_a', 'delete', `${W}/${mine.id}`, { expected_updated_at: fresh });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await woRow(mine.id)).toBeNull();
  const atts = ((await db().from('ga_resource_attachments').select('*').eq('resource_id', mine.id)).data || []) as any[];
  expect(atts).toHaveLength(1);
  expect(atts[0].deleted_at).not.toBeNull();
  expect(atts[0].deleted_by).toBe(users.wo_store_a.id);
  const { data: obj } = await db().storage.from('general-affairs-attachments').download(atts[0].storage_path);
  expect(obj, '儲存檔案保留（只標記不實刪）').not.toBeNull();
  expect((await get('wo_works', `${W}/${mine.id}`)).status).toBe(404);
  // 總務（工單管理）可刪別人的未受理單；已受理、已連需求單都不能刪並提示強制結案
  const other = await wo('DEL-GA');
  expect((await send('wo_manager', 'delete', `${W}/${other.id}`, { expected_updated_at: other.updated_at })).status).toBe(200);
  expect(await woRow(other.id)).toBeNull();
  const accepted = await open('DEL-ACC');
  const r1 = await send('wo_manager', 'delete', `${W}/${accepted.id}`, { expected_updated_at: accepted.updated_at });
  expect(r1.status).toBe(409);
  expect(r1.body.error).toContain('不處理，強制結案');
  const own = await wo('DEL-OWN-ACC', { status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW' });
  expect((await send('wo_store_a', 'delete', `${W}/${own.id}`, { expected_updated_at: own.updated_at })).status).toBe(409);
  const lk = await linked('DEL-LK', 'IN_PROGRESS', { status: 'UNACCEPTED', progress_stage: null });
  const r2 = await send('wo_manager', 'delete', `${W}/${lk.w.id}`, { expected_updated_at: lk.w.updated_at });
  expect(r2.status).toBe(409);
  expect(r2.body.error).toContain('需求單');
  const r3 = await send('wo_store_a', 'delete', `${W}/${lk.w.id}`, { expected_updated_at: lk.w.updated_at });
  expect(r3.status).toBe(409);
  for (const x of [accepted, own, lk.w]) expect(await woRow(x.id)).not.toBeNull();
  expect((await send('wo_manager', 'delete', `${W}/${crypto.randomUUID()}`, { expected_updated_at: new Date().toISOString() })).status).toBe(404);
});

test('G18.integration.category：改分類需要更新權限、版本衝突 409、可清除、參數 400、寫事件；失敗不留痕跡', async () => {
  const w = await open('CAT');
  const c1 = await seedMaintenanceCategory('API-CAT-1');
  const patch = (who: string, data: Record<string, unknown>) => send(who, 'patch', `${W}/${w.id}/category`, data);
  for (const k of ['wo_viewall', 'wo_store_a', 'nobody', 'admin']) expect((await patch(k, { category_id: c1.id, expected_updated_at: w.updated_at })).status, k).toBe(403);
  expect((await patch('wo_works', { category_id: c1.id })).status).toBe(400);
  expect((await patch('wo_works', { category_id: 'bad', expected_updated_at: w.updated_at })).status).toBe(400);
  expect((await patch('wo_works', { category_id: crypto.randomUUID(), expected_updated_at: w.updated_at })).status).toBe(404);
  expect((await patch('wo_works', { category_id: c1.id, expected_updated_at: '2001-01-01T00:00:00+00:00' })).status).toBe(409);
  expect((await woRow(w.id)).category_id).toBeNull();
  const ok = await patch('wo_works', { category_id: c1.id, expected_updated_at: w.updated_at });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect((await woRow(w.id)).category_id).toBe(c1.id);
  expect((await eventsOf(w.id)).filter((e) => e.event_type === 'CATEGORY_CHANGED')).toHaveLength(1);
  const clear = await patch('wo_cross_update', { category_id: null, expected_updated_at: await upd(w.id) });
  expect(clear.status).toBe(200);
  expect((await woRow(w.id)).category_id).toBeNull();
  // 店長端看不到內部事件
  expect(JSON.stringify((await get('wo_store_a', `${W}/${w.id}`)).body)).not.toContain('工單分類由');
});

// ----------------------------------------------------------------------------- 照片上傳（共用附件）
test('G18.integration.attachments：只收圖片（含檔頭檢查）、單次最多 5 張、回報人可加回報照片、進度照片需更新權限、看不到的工單 404、失敗不留檔案', async () => {
  const w = await open('ATT');
  const post = (who: string, _p: string, files: MpFile[], fields: Record<string, string> = {}) => upload(who, w.id, files, fields);
  const png = (n = 'a.png') => ({ name: n, mimeType: 'image/png', buffer: PNG });
  const listAtt = async () => ((await db().from('ga_resource_attachments').select('*').eq('resource_id', w.id)).data || []) as any[];
  const objectsUnder = async () => ((await db().storage.from('general-affairs-attachments').list(`maintenance_request/${w.id}`, { limit: 100 })).data || []) as any[];
  // 非圖片擋下
  const pdf = await post('wo_works', 'attachments', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]);
  expect(pdf.status()).toBe(400);
  const fake = await post('wo_works', 'attachments', [{ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>not an image</html>') }]);
  expect(fake.status()).toBe(400);
  expect((await fake.json()).error).toContain('不是圖片');
  const txt = await post('wo_works', 'attachments', [{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  expect(txt.status()).toBe(400);
  expect((await post('wo_works', 'attachments', [])).status()).toBe(400);
  expect((await post('wo_works', 'attachments', Array.from({ length: 6 }, (_, i) => png(`${i}.png`)))).status()).toBe(400);
  expect(await listAtt()).toHaveLength(0);
  // 權限
  for (const k of ['wo_viewall', 'wo_store_a2']) expect([403, 404], k).toContain((await post(k, 'attachments', [png()])).status());
  expect((await post('wo_store_b', 'attachments', [png()])).status()).toBe(404);
  expect((await post('nobody', 'attachments', [png()])).status()).toBe(403);
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  const mp = multipartBody([png()]);
  expect((await anon.post(`${W}/${w.id}/attachments`, { data: mp.data, headers: mp.headers })).status()).toBe(401);
  await anon.dispose();
  expect((await upload('wo_works', w.id, [png()], {}, { Origin: 'https://evil.example' })).status()).toBe(403);
  // 成功：回報人加回報照片；更新者加多張
  const ok1 = await post('wo_store_a', 'attachments', [png('r1.png')]);
  expect(ok1.status(), await ok1.text()).toBe(201);
  const ok2 = await post('wo_works', 'attachments', [png('g1.png'), png('g2.png')]);
  expect(ok2.status()).toBe(201);
  const rows = await listAtt();
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.resource_type === 'MAINTENANCE_REQUEST' && r.purpose === 'REPORT_PHOTO' && r.storage_path.startsWith('maintenance_request/') && r.content_type === 'image/png')).toBe(true);
  expect(await objectsUnder()).not.toHaveLength(0);
  // 進度照片：需要更新權限、進度紀錄要屬於這張工單
  expect((await progress('wo_works', w)).status).toBe(200);
  const upd1 = (await updatesOf(w.id))[0];
  expect((await post('wo_store_a', 'attachments', [png()], { update_id: upd1.id })).status()).toBe(403);
  expect((await post('wo_works', 'attachments', [png()], { update_id: 'bad' })).status()).toBe(400);
  expect((await post('wo_works', 'attachments', [png()], { update_id: crypto.randomUUID() })).status()).toBe(404);
  const pr = await post('wo_works', 'attachments', [png('p1.png')], { update_id: upd1.id });
  expect(pr.status(), await pr.text()).toBe(201);
  expect(((await db().from('ga_resource_attachments').select('*').eq('resource_id', upd1.id)).data || [])[0]).toMatchObject({ resource_type: 'MAINTENANCE_UPDATE', resource_id: upd1.id, purpose: 'PROGRESS_PHOTO' });
  const det = (await get('wo_works', `${W}/${w.id}`)).body.data.photos as any[];
  expect(det.map((p) => p.file_name).sort()).toEqual(['g1.png', 'g2.png', 'p1.png', 'r1.png'].map((n) => `${M7_FILE_PREFIX}${n}`));
  expect(det.find((p) => p.file_name === `${M7_FILE_PREFIX}p1.png`).label).toBe('進度照片');
  // 已完成工單：回報人不能再加；更新者可以
  const done = await wo('ATT-DONE', { status: 'COMPLETED', progress_stage: 'OTHER', completion_method: 'STORE_CONFIRMED', completed_at: new Date().toISOString() });
  const lateOwner = await upload('wo_store_a', done.id, [png()]);
  expect(lateOwner.status()).toBe(409);
});

test('G18.integration.rollback：寫入失敗不留半套資料（版本衝突、非法流轉、缺權限、參數錯誤）', async () => {
  const w = await open('RB');
  const snapshot = async () => ({ row: await woRow(w.id), ups: (await updatesOf(w.id)).length, evs: (await eventsOf(w.id)).length });
  const before = await snapshot();
  const attempts = [
    () => progress('wo_works', w, {}, '2001-01-01T00:00:00+00:00'),
    () => progress('wo_viewall', w),
    () => progress('wo_works', w, { progress_stage: 'WAITING_STORE_CONFIRMATION' }),
    () => act('wo_works', w, 'request-supplement', { supplement_type: 'NOPE', supplement_note: 'x' }),
    () => act('wo_update_noforce', w, 'force-close', { force_close_reason: 'x' }),
    () => act('wo_works', w, 'issue-part', { location_id: loc.id, part_id: part.id, quantity: 99999, idempotency_key: key() }),
    () => act('wo_store_a', w, 'store-confirm'),
  ];
  for (const a of attempts) expect((await a()).status).toBeGreaterThanOrEqual(400);
  expect(await snapshot()).toEqual(before);
  const reqFail = await linked('RB-L', 'IN_PROGRESS');
  const rqBefore = await reqRow(reqFail.r.id);
  expect((await progress('wo_works', reqFail.w, { progress_stage: 'WAITING_STORE_CONFIRMATION' })).status).toBe(422);
  expect((await act('wo_works', reqFail.w, 'force-close', {})).status).toBe(400);
  expect(await reqRow(reqFail.r.id)).toEqual(rqBefore);
  expect(await woRow(reqFail.w.id)).toMatchObject({ status: 'PROCESSING', updated_at: reqFail.w.updated_at });
});

test('G18.integration.print：列印資料預設只有公開進度與照片；總務勾選才含內部備註；店長端一律不含；舊照片與新照片都在', async () => {
  const w = await open('PRT');
  expect((await progress('wo_works', w, { visibility: 'INTERNAL', notes: '內部備註-PRT', progress_stage: 'VENDOR_WORKING' })).status).toBe(200);
  expect((await progress('wo_works', w, { notes: '公開進度-PRT', progress_stage: 'WAITING_PARTS' })).status).toBe(200);
  const up = await upload('wo_works', w.id, [{ name: 'prt.png', mimeType: 'image/png', buffer: PNG }]);
  expect(up.status()).toBe(201);
  const p0 = await get('wo_works', `${W}/${w.id}/print`);
  expect(p0.status).toBe(200);
  expect(p0.body.data).toMatchObject({ include_internal: false, internal_updates: [], force_close_reason: null });
  expect(JSON.stringify(p0.body)).toContain('公開進度-PRT');
  expect(JSON.stringify(p0.body)).not.toContain('內部備註-PRT');
  expect(p0.body.data.photos.map((p: any) => p.file_name)).toContain(`${M7_FILE_PREFIX}prt.png`);
  expect(JSON.stringify(p0.body)).not.toContain('storage_path');
  const p1 = await get('wo_works', `${W}/${w.id}/print?include_internal=1`);
  expect(p1.body.data.include_internal).toBe(true);
  expect(JSON.stringify(p1.body.data.internal_updates)).toContain('內部備註-PRT');
  const s0 = await get('wo_store_a', `${W}/${w.id}/print`);
  expect(s0.status).toBe(200);
  expect(JSON.stringify(s0.body)).not.toContain('內部備註-PRT');
  expect(s0.body.data.work_order).not.toHaveProperty('assignee_name');
  expect((await get('wo_store_a', `${W}/${w.id}/print?include_internal=1`)).status).toBe(403);
  expect((await get('wo_store_b', `${W}/${w.id}/print`)).status).toBe(404);
  expect((await get('nobody', `${W}/${w.id}/print`)).status).toBe(403);
  expect((await get('wo_works', `${W}/${crypto.randomUUID()}/print`)).status).toBe(404);
});

test('G18.integration.routes：未知路徑 404、方法不支援 405、id 格式 400', async () => {
  const w = await open('RT');
  expect((await get('wo_works', `${W}/${w.id}/nope`)).status).toBe(404);
  expect((await send('wo_works', 'post', `${W}/${w.id}/nope`, {})).status).toBe(404);
  expect((await send('wo_works', 'post', W, {})).status).toBe(405);
  expect((await send('wo_works', 'post', `${W}/summary`, {})).status).toBe(405);
  expect((await send('wo_works', 'post', `${W}/bad/progress`, {})).status).toBe(400);
  expect((await send('wo_works', 'patch', `${W}/${w.id}`, {})).status).toBe(404);
});
