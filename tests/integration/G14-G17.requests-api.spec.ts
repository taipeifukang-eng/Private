import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { PERM, seedRequest, seedReview, seedVendor, setupPoUsers, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';
import { REQUEST_STATUSES, REQUEST_TRANSITIONS, canTransition, nextStatus } from '../../lib/workspace/general-affairs/request-rules';

// M7/M8 第 4 批 G14 至 G17 整合：回報建立、我的追蹤、需求單工作台、料件處理中心 API（/api/workspace/general-affairs/reports、requests、part-fulfillments）。
// 涵蓋：權限矩陣（401／403）與 Origin、400 驗證、Q16 欄位遮蔽（內部備註、內部事件、留言改刪與原文）、Q17 合法流轉表（資料庫逐項對照純函式表）與前置檢查、D4 受理擋、
//      Q16 總務代按須說明並標記、D5 逾期標示與設定、Q18 出庫超量與替代料、D1 採購評估產生草稿採購單（含整體回復）、改決策時舊採購單標取消、報價歷史、待交付與送門市確認、異常逐筆作廢、採購單金額與供應商遮蔽。
// 所有資料帶 [自動測試]M7M8 標記，結束清除；與其他整合檔一樣循序執行。
const R = '/api/workspace/general-affairs/requests';
const F = '/api/workspace/general-affairs/part-fulfillments';
const KEYS: PoKey[] = ['rq_staff', 'rq_manage_only', 'rq_view_all', 'rq_store_a', 'rq_store_b', 'rq_store_viewonly', 'rq_create_nostore', 'ful_view', 'ful_manage_only', 'nobody'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let sid: Record<string, string> = {};
let part: any;
let part2: any;
let loc: any;
let vendor: any;
let seq = 0;
let originalDays = 7;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const ver = async (id: string) => ((await db().from('ga_service_requests').select('updated_at').eq('id', id).single()).data as any).updated_at as string;
const dbReq = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const dbEvents = async (id: string) => ((await db().from('ga_service_request_events').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
const dbFul = async (reqId: string) => (await db().from('ga_part_fulfillments').select('*').eq('request_id', reqId).maybeSingle()).data as any;
const dbDocs = async (fulId: string) => ((await db().from('ga_part_fulfillment_documents').select('*').eq('fulfillment_id', fulId).order('created_at')).data || []) as any[];
const dbBal = async (l: string, p: string) => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', l).eq('part_id', p).maybeSingle()).data as any)?.quantity_base ?? 0);
const mk = async (storeCode: 'VW001' | 'ZT01', over: Record<string, unknown> = {}, who = 'rq_store_a') =>
  seedRequest(sid[storeCode], users[who].id, `R${(seq += 1)}`, { part_id: part.id, desired_unit: part.base_unit, ...over });
/** 受理後走到可評估採購或出庫的狀態（直接用 DB 設定，API 測試另有專門的受理測試）。 */
const setRoute = async (id: string, route: string, status = 'ACCEPTED') => { await db().from('ga_service_requests').update({ intake_route: route, main_status: status }).eq('id', id); };
const payloadFor = (action: string) => ({
  accept: { intake_route: 'TRANSFER', assignee_role: 'GENERAL_AFFAIRS' }, reject: { rejection_reason: 'OTHER', rejection_note: '測試駁回' }, request_supplement: { supplement_type: 'OTHER', supplement_note: '測試補資料' },
  update_progress: {}, request_store_confirmation: {}, assign: { assignee_role: 'WORKS' }, cancel: { reason: '測試取消' }, reopen: { reason: '測試重新開啟' }, withdraw: {},
} as Record<string, unknown>)[action] || {};

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
  const cat = await seedCategory('part', 'RQ');
  part = await seedPart(cat.id, 'RQ-P1', { purchase_unit: '箱', purchase_to_base_rate: 12, allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: true });
  part2 = await seedPart(cat.id, 'RQ-P2');
  loc = await seedLocation(null, 'RQ-L');
  await seedLocationPart(loc.id, part.id);
  await seedLocationPart(loc.id, part2.id);
  vendor = await seedVendor('RQ');
  originalDays = Number(((await db().from('ga_workflow_settings').select('value_num').eq('key', 'request_overdue_confirm_days').single()).data as any).value_num);
});
test.afterAll(async () => {
  await db().from('ga_workflow_settings').update({ value_num: originalDays }).eq('key', 'request_overdue_confirm_days');
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
});

// ----------------------------------------------------------------------------- G14 建立
test('G14 建立：未登入 401、Origin 不符 403、權限矩陣、門市範圍', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const body = { store_id: sid.VW001, request_type: 'REPAIR', title: m7Name('權限'), description: '權限矩陣測試用說明' };
  expect((await anon.post('/api/workspace/general-affairs/reports', { data: body, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  expect((await anon.get(`${R}`)).status()).toBe(401);
  await anon.dispose();
  const evil = await j(await apis.rq_store_a.post('/api/workspace/general-affairs/reports', { data: { ...body, title: m7Name('Origin') }, headers: { Origin: 'http://evil.example' } }));
  expect(evil.status).toBe(403);
  for (const k of ['nobody', 'rq_view_all', 'rq_store_viewonly', 'ful_view']) expect((await send(k, 'post', '/api/workspace/general-affairs/reports', { ...body, title: m7Name(`無權限 ${k}`) })).status, k).toBe(403);
  const own = await send('rq_store_a', 'post', '/api/workspace/general-affairs/reports', { ...body, title: m7Name('自己門市') });
  expect(own.status, JSON.stringify(own.body)).toBe(201);
  expect(own.body.data.main_status).toBe('PENDING_INTAKE');
  const other = await send('rq_store_a', 'post', '/api/workspace/general-affairs/reports', { ...body, store_id: sid.ZT01, title: m7Name('別家門市') });
  expect(other.status).toBe(403);
  expect((await send('rq_create_nostore', 'post', '/api/workspace/general-affairs/reports', { ...body, title: m7Name('不在名單') })).status).toBe(403);
  const any = await send('rq_staff', 'post', '/api/workspace/general-affairs/reports', { ...body, store_id: sid.ZT01, title: m7Name('總務代建') });
  expect(any.status, JSON.stringify(any.body)).toBe(201);
  expect(((await db().from('ga_service_requests').select('id').eq('title', m7Name('別家門市'))).data || [])).toHaveLength(0);
});

test('G14 建立：400 驗證、固定識別防重複、DB 回讀與 QR 標的、request-targets 範圍', async () => {
  const base = { store_id: sid.VW001, request_type: 'REPAIR', title: m7Name('驗證'), description: '驗證測試的說明文字' };
  const bad = async (over: Record<string, unknown>) => (await send('rq_store_a', 'post', '/api/workspace/general-affairs/reports', { ...base, ...over })).status;
  expect(await bad({ title: '' })).toBe(400);
  expect(await bad({ description: '短' })).toBe(400);
  expect(await bad({ request_type: 'XX' })).toBe(400);
  expect(await bad({ store_id: 'not-a-uuid' })).toBe(400);
  expect(await bad({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART' })).toBe(400); // 缺數量
  expect(await bad({ resource_type: 'EQUIPMENT', equipment_id: crypto.randomUUID(), facility_id: crypto.randomUUID() })).toBe(400);
  const r = await apis.rq_store_a.post('/api/workspace/general-affairs/reports', { data: 'not json', headers: { 'Content-Type': 'application/json' } });
  expect(r.status()).toBe(400);
  const k = key();
  const payload = { ...base, title: m7Name('冪等'), idempotency_key: k };
  const a = await send('rq_store_a', 'post', '/api/workspace/general-affairs/reports', payload);
  const b = await send('rq_store_a', 'post', '/api/workspace/general-affairs/reports', payload);
  expect([a.status, b.status]).toEqual([201, 200]);
  expect(b.body.data.id).toBe(a.body.data.id);
  expect(((await db().from('ga_service_requests').select('id').eq('title', m7Name('冪等'))).data || [])).toHaveLength(1);
  const row = await dbReq(a.body.data.id);
  expect(row).toMatchObject({ main_status: 'PENDING_INTAKE', created_by: users.rq_store_a.id, store_id: sid.VW001, request_type: 'REPAIR' });
  expect((await dbEvents(row.id)).map((e) => e.event_type)).toContain('REQUEST_CREATED');
  expect((await get('rq_store_a', `/api/workspace/general-affairs/request-targets?storeId=${sid.VW001}`)).status).toBe(200);
  expect((await get('rq_store_a', `/api/workspace/general-affairs/request-targets?storeId=${sid.ZT01}`)).status).toBe(403);
  expect((await get('rq_store_a', '/api/workspace/general-affairs/request-targets')).status).toBe(400);
  expect((await get('nobody', `/api/workspace/general-affairs/request-targets?storeId=${sid.VW001}`)).status).toBe(403);
});

// ----------------------------------------------------------------------------- G15 / G16 讀取與遮蔽
test('G15／G16 讀取：權限、範圍（我的追蹤只含自己門市）、精確統計、分頁、搜尋跳脫、篩選驗證', async () => {
  const a1 = await mk('VW001', { main_status: 'PENDING_INTAKE' });
  const b1 = await mk('ZT01', { main_status: 'PENDING_INTAKE' }, 'rq_store_b');
  expect((await get('nobody', R)).status).toBe(403);
  expect((await get('ful_view', R)).status).toBe(403);
  const staff = await get('rq_staff', `${R}?pageSize=100`);
  expect(staff.status).toBe(200);
  const staffIds = (staff.body.data as any[]).map((r) => r.id);
  expect(staffIds).toEqual(expect.arrayContaining([a1.id, b1.id]));
  expect(staff.body.permissions.manage).toBe(true);
  const mineA = await get('rq_store_a', '/api/workspace/general-affairs/reports/mine?pageSize=100');
  const mineIds = (mineA.body.data as any[]).map((r) => r.id);
  expect(mineIds).toContain(a1.id);
  expect(mineIds).not.toContain(b1.id);
  expect(staff.body.stats.PENDING_INTAKE).toBeGreaterThanOrEqual(2);
  expect((await get('rq_view_all', R)).status).toBe(200);
  expect((await get('rq_store_a', `${R}/${b1.id}`)).status).toBe(404); // 他店的單：RLS 讀不到
  expect((await get('rq_store_a', `${R}?storeId=${sid.ZT01}`)).status).toBe(403);
  expect((await get('rq_staff', `${R}?status=NOPE`)).status).toBe(400);
  expect((await get('rq_staff', `${R}?type=NOPE`)).status).toBe(400);
  expect((await get('rq_staff', `${R}/not-a-uuid`)).status).toBe(400);
  const p1 = await get('rq_staff', `${R}?pageSize=1&page=1`);
  expect((p1.body.data as any[]).length).toBe(1);
  expect(p1.body.total).toBeGreaterThanOrEqual(2);
  expect((await get('rq_staff', `${R}?pageSize=1000`)).body.meta.pageSize).toBe(100);
  const weird = await get('rq_staff', `${R}?search=${encodeURIComponent('a,b)(\\"c%')}`);
  expect(weird.status).toBe(200);
  const hit = await get('rq_staff', `${R}?search=${encodeURIComponent(a1.request_no)}`);
  expect((hit.body.data as any[]).map((r) => r.id)).toEqual([a1.id]);
});


test('Q16 遮蔽：內部備註、內部事件、內部留言不傳給門市；留言可改刪並標示，原文只給總務', async () => {
  const q = await mk('VW001', { main_status: 'PENDING_INTAKE' });
  const acc = await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'accept', expected_updated_at: await ver(q.id), intake_route: 'TRANSFER', assignee_role: 'GENERAL_AFFAIRS', internal_note: '內部備註不給門市' });
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  const prog = await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'update_progress', expected_updated_at: await ver(q.id), internal_note: '內部處理紀錄' });
  expect(prog.status).toBe(200);
  const internal = await send('rq_staff', 'post', `${R}/${q.id}/comments`, { body: '只有總務看得到的內部留言', visibility: 'INTERNAL' });
  expect(internal.status).toBe(201);
  const pub = await send('rq_staff', 'post', `${R}/${q.id}/comments`, { body: '總務公開留言' });
  expect(pub.status).toBe(201);
  const storeC = await send('rq_store_a', 'post', `${R}/${q.id}/comments`, { body: '門市原本的留言', source_context: 'STORE_TRACKING' });
  expect(storeC.status).toBe(201);
  expect((await send('rq_store_a', 'post', `${R}/${q.id}/comments`, { body: '門市想寫內部', visibility: 'INTERNAL' })).status).toBe(403);
  expect((await send('rq_store_b', 'post', `${R}/${q.id}/comments`, { body: '他店不能留言' })).status).toBe(403);
  expect((await send('rq_store_viewonly', 'post', `${R}/${q.id}/comments`, { body: '沒有留言權限' })).status).toBe(403);
  expect((await send('rq_store_a', 'post', `${R}/${q.id}/comments`, { body: '   ' })).status).toBe(400);

  const store = await get('rq_store_a', `${R}/${q.id}?surface=STORE_TRACKING`);
  expect(store.status).toBe(200);
  expect(store.body.data.internal_note).toBeUndefined();
  expect(store.body.data.assignee_user_id).toBeUndefined();
  expect(JSON.stringify(store.body)).not.toContain('內部備註不給門市');
  expect(JSON.stringify(store.body)).not.toContain('內部處理紀錄');
  expect(JSON.stringify(store.body)).not.toContain('只有總務看得到的內部留言');
  expect((store.body.events as any[]).every((e) => e.visibility !== 'INTERNAL')).toBe(true);
  expect(store.body.documents).toBeUndefined();
  expect(store.body.purchase_orders).toEqual([]);
  const ga = await get('rq_staff', `${R}/${q.id}?surface=GA_WORKBENCH`);
  expect(ga.body.data.internal_note).toBe('內部處理紀錄');
  expect((ga.body.comments as any[]).some((c) => c.visibility === 'INTERNAL')).toBe(true);

  // 門市編輯自己的留言：標示已編輯，原文只給總務
  const cid = storeC.body.data.id as string;
  const edit = await send('rq_store_a', 'patch', `${R}/${q.id}/comments/${cid}`, { body: '門市改過的留言' });
  expect(edit.status, JSON.stringify(edit.body)).toBe(200);
  const row = (await db().from('ga_service_request_comments').select('*').eq('id', cid).single()).data as any;
  expect(row).toMatchObject({ body: '門市改過的留言', original_body: '門市原本的留言' });
  expect(row.edited_at).toBeTruthy();
  const s2 = await get('rq_store_a', `${R}/${q.id}`);
  const sc = (s2.body.comments as any[]).find((c) => c.id === cid);
  expect(sc).toMatchObject({ is_edited: true, is_deleted: false, body: '門市改過的留言' });
  expect(sc.original_body).toBeUndefined();
  const g2 = await get('rq_staff', `${R}/${q.id}`);
  expect((g2.body.comments as any[]).find((c) => c.id === cid).original_body).toBe('門市原本的留言');
  // 總務不能改門市的留言；別人不能改
  expect((await send('rq_staff', 'patch', `${R}/${q.id}/comments/${cid}`, { body: '總務想改門市留言' })).status).toBe(403);
  const gid = pub.body.data.id as string;
  expect((await send('rq_store_a', 'patch', `${R}/${q.id}/comments/${gid}`, { body: '門市想改總務留言' })).status).toBe(403);
  // 門市刪除：門市只看到占位，總務看得到原文；刪過的不能再改
  expect((await send('rq_store_a', 'delete', `${R}/${q.id}/comments/${cid}`)).status).toBe(200);
  const s3 = await get('rq_store_a', `${R}/${q.id}`);
  const dc = (s3.body.comments as any[]).find((c) => c.id === cid);
  expect(dc).toMatchObject({ is_deleted: true, body: '（此留言已刪除）' });
  expect(JSON.stringify(s3.body)).not.toContain('門市原本的留言');
  expect(JSON.stringify(s3.body)).not.toContain('門市改過的留言');
  const g3 = await get('rq_staff', `${R}/${q.id}`);
  expect((g3.body.comments as any[]).find((c) => c.id === cid).original_body).toBe('門市原本的留言');
  expect((await send('rq_store_a', 'patch', `${R}/${q.id}/comments/${cid}`, { body: '再改' })).status).toBe(404);
  // 已讀標記：總務標記一次、重複標記回 already_read；門市不能標記
  const sc2 = await send('rq_store_a', 'post', `${R}/${q.id}/comments`, { body: '另一則門市留言', source_context: 'STORE_TRACKING' });
  const rid = sc2.body.data.id as string;
  expect((await send('rq_store_a', 'post', `${R}/${q.id}/comments/${rid}/read`)).status).toBe(403);
  expect((await send('rq_staff', 'post', `${R}/${q.id}/comments/${rid}/read`)).status).toBe(200);
  expect((await send('rq_staff', 'post', `${R}/${q.id}/comments/${rid}/read`)).body.already_read).toBe(true);
  const events = await dbEvents(q.id);
  expect(events.filter((e) => e.event_type === 'STORE_COMMENT_READ')).toHaveLength(1);
  expect(events.some((e) => e.event_type === 'PUBLIC_COMMENT_EDITED')).toBe(true);
  expect(events.some((e) => e.event_type === 'PUBLIC_COMMENT_DELETED')).toBe(true);
});

// ----------------------------------------------------------------------------- Q17 流轉
test('Q17 合法流轉表：資料庫對每個「動作 × 狀態」都與純函式表一致（合法 200 且到對的狀態，不合法 409）', async () => {
  test.setTimeout(400_000);
  const manageActions = ['accept', 'reject', 'request_supplement', 'update_progress', 'request_store_confirmation', 'assign', 'cancel', 'reopen'];
  const mismatches: string[] = [];
  for (const status of REQUEST_STATUSES) {
    for (const action of manageActions) {
      const r = await mk('VW001', { main_status: status, intake_route: ['ACCEPTED', 'IN_PROGRESS', 'WAITING_STORE_CONFIRMATION'].includes(status) ? 'TRANSFER' : null });
      const res = await send('rq_staff', 'patch', `${R}/${r.id}`, { action, expected_updated_at: await ver(r.id), ...(payloadFor(action) as object) });
      const want = canTransition(action, status);
      const row = await dbReq(r.id);
      if (want) {
        if (res.status !== 200 || row.main_status !== nextStatus(action, status)) mismatches.push(`${action}@${status}: 預期 200→${nextStatus(action, status)}，實際 ${res.status}→${row.main_status} ${JSON.stringify(res.body).slice(0, 120)}`);
      } else if (res.status !== 409 || row.main_status !== status) mismatches.push(`${action}@${status}: 預期 409 不變，實際 ${res.status}→${row.main_status}`);
    }
    for (const action of ['submit_supplement', 'confirm_complete', 'report_problem', 'withdraw']) {
      const r = await mk('VW001', { main_status: status });
      const res = action === 'withdraw'
        ? await send('rq_store_a', 'patch', `${R}/${r.id}`, { action, expected_updated_at: await ver(r.id) })
        : await send('rq_store_a', 'post', `${R}/${r.id}/store-actions`, { action, note: '測試' });
      const want = canTransition(action, status);
      const row = await dbReq(r.id);
      if (want) {
        if (res.status !== 200 || row.main_status !== nextStatus(action, status)) mismatches.push(`${action}@${status}: 預期 200→${nextStatus(action, status)}，實際 ${res.status}→${row.main_status}`);
      } else if (res.status !== 409 || row.main_status !== status) mismatches.push(`${action}@${status}: 預期 409 不變，實際 ${res.status}→${row.main_status}`);
    }
  }
  expect(mismatches).toEqual([]);
  expect(Object.keys(REQUEST_TRANSITIONS).sort()).toEqual(['accept', 'assign', 'cancel', 'confirm_complete', 'reject', 'reopen', 'report_problem', 'request_store_confirmation', 'request_supplement', 'submit_supplement', 'update_progress', 'withdraw']);
});

test('Q17 動作規則：原因必填、版本 STALE、缺版本 400、權限、重新開啟次數、撤回限門市、取消與駁回的前置檢查', async () => {
  const q = await mk('VW001', { main_status: 'PENDING_INTAKE' });
  const v0 = await ver(q.id);
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'reject', rejection_reason: 'OTHER', rejection_note: 'x' })).status).toBe(400); // 缺 expected
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'nope', expected_updated_at: v0 })).status).toBe(400);
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'reject', expected_updated_at: v0, rejection_reason: 'OTHER' })).status).toBe(400); // 缺說明
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'reject', expected_updated_at: v0, rejection_reason: 'BAD', rejection_note: 'x' })).status).toBe(400);
  for (const k of ['rq_store_a', 'rq_view_all', 'nobody', 'ful_view']) expect((await send(k, 'patch', `${R}/${q.id}`, { action: 'cancel', expected_updated_at: v0, reason: 'x' })).status, k).toBe(403);
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'cancel', expected_updated_at: v0 })).status).toBe(400); // 取消要原因
  const stale = await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'cancel', expected_updated_at: '2000-01-01T00:00:00Z', reason: '舊版本' });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await dbReq(q.id)).main_status).toBe('PENDING_INTAKE');
  // 他店店長不能撤回；本店可以；撤回後是 CANCELED
  expect((await send('rq_store_b', 'patch', `${R}/${q.id}`, { action: 'withdraw', expected_updated_at: v0 })).status).toBe(403);
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'withdraw', expected_updated_at: v0 })).status).toBe(403);
  const wd = await send('rq_store_a', 'patch', `${R}/${q.id}`, { action: 'withdraw', expected_updated_at: v0 });
  expect(wd.status, JSON.stringify(wd.body)).toBe(200);
  expect((await dbReq(q.id)).main_status).toBe('CANCELED');
  expect((await dbEvents(q.id)).map((e) => e.event_type)).toContain('REQUEST_WITHDRAWN');
  // 已取消是終態
  expect((await send('rq_staff', 'patch', `${R}/${q.id}`, { action: 'reopen', expected_updated_at: await ver(q.id), reason: 'x' })).status).toBe(409);
  // 已完成 → 重新開啟 → IN_PROGRESS；已駁回 → PENDING_INTAKE；次數累加、原因必填
  const done = await mk('VW001', { main_status: 'COMPLETED' });
  expect((await send('rq_staff', 'patch', `${R}/${done.id}`, { action: 'reopen', expected_updated_at: await ver(done.id) })).status).toBe(400);
  expect((await send('rq_staff', 'patch', `${R}/${done.id}`, { action: 'reopen', expected_updated_at: await ver(done.id), reason: '東西又壞了' })).status).toBe(200);
  expect(await dbReq(done.id)).toMatchObject({ main_status: 'IN_PROGRESS', reopened_count: 1 });
  const rej = await mk('VW001', { main_status: 'REJECTED' });
  expect((await send('rq_staff', 'patch', `${R}/${rej.id}`, { action: 'reopen', expected_updated_at: await ver(rej.id), reason: '重新評估' })).status).toBe(200);
  expect(await dbReq(rej.id)).toMatchObject({ main_status: 'PENDING_INTAKE', reopened_count: 1 });
  // 取消／駁回前置：已出庫、已有採購單（含草稿）、進行中工單都擋
  const a = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW' });
  const po = await callFn(users.rq_staff.client, 'ga_ws_po_create', { p_header: { notes: m7Name('擋取消'), vendor_id: vendor.id, receiving_location_id: loc.id }, p_items: [{ part_id: part.id, quantity: 1, unit_price: 10, request_id: a.id }], p_create_key: key() });
  expect(po.ok, JSON.stringify(po)).toBe(true);
  for (const [action, extra] of [['cancel', { reason: 'x' }], ['reject', { rejection_reason: 'OTHER', rejection_note: 'x' }]] as const) {
    const r = await send('rq_staff', 'patch', `${R}/${a.id}`, { action, expected_updated_at: await ver(a.id), ...extra });
    expect(r.status, action).toBe(409);
    expect(r.body.error).toMatch(/採購單/);
  }
  const rep = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'REPAIR_DISPATCH', request_type: 'REPAIR', resource_type: null, part_id: null, desired_quantity: null });
  const acc = await send('rq_staff', 'patch', `${R}/${rep.id}`, { action: 'accept', expected_updated_at: await ver(rep.id), intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS' });
  expect(acc.status).toBe(409); // 已受理不能再受理
});

test('D4 受理：維修單不能走採購評估、非料件不能走庫存出庫、添購不能維修派工；有採購單或已出庫不可請門市補資料；維修派工建立工單', async () => {
  const repair = await mk('VW001', { main_status: 'PENDING_INTAKE', request_type: 'REPAIR', resource_type: null, part_id: null, desired_quantity: null });
  const acc = (id: string, route: string) => send('rq_staff', 'patch', `${R}/${id}`, { action: 'accept', expected_updated_at: undefined, intake_route: route, assignee_role: 'GENERAL_AFFAIRS' });
  const tryAccept = async (id: string, route: string) => send('rq_staff', 'patch', `${R}/${id}`, { action: 'accept', expected_updated_at: await ver(id), intake_route: route, assignee_role: 'GENERAL_AFFAIRS' });
  void acc;
  const r1 = await tryAccept(repair.id, 'PURCHASE_REVIEW');
  expect(r1.status).toBe(422);
  expect(r1.body.error).toContain('維修單不能走採購評估');
  const other = await mk('VW001', { main_status: 'PENDING_INTAKE', resource_type: 'OTHER_PURCHASE', part_id: null });
  expect((await tryAccept(other.id, 'STOCK_ISSUE')).status).toBe(422);
  expect((await tryAccept(other.id, 'REPAIR_DISPATCH')).status).toBe(422);
  expect((await dbReq(other.id)).main_status).toBe('PENDING_INTAKE');
  expect((await tryAccept(other.id, 'PURCHASE_REVIEW')).status).toBe(200);
  // 維修派工：同交易建立工單並連結
  const ok = await tryAccept(repair.id, 'REPAIR_DISPATCH');
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  const row = await dbReq(repair.id);
  expect(row).toMatchObject({ main_status: 'ACCEPTED', intake_route: 'REPAIR_DISPATCH', assignee_role: 'GENERAL_AFFAIRS' });
  expect(row.maintenance_request_id).toBeTruthy();
  const wo = (await db().from('maintenance_requests').select('*').eq('id', row.maintenance_request_id).single()).data as any;
  expect(wo).toMatchObject({ ga_service_request_id: repair.id, status: 'ACCEPTED', store_id: sid.VW001 });
  // 有進行中工單：不能取消、不能駁回
  const cancel = await send('rq_staff', 'patch', `${R}/${repair.id}`, { action: 'cancel', expected_updated_at: await ver(repair.id), reason: 'x' });
  expect(cancel.status).toBe(409);
  // 有草稿採購單：請門市補資料被擋（改用留言）
  const buy = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW' });
  const po = await callFn(users.rq_staff.client, 'ga_ws_po_create', { p_header: { notes: m7Name('擋補資料'), vendor_id: vendor.id, receiving_location_id: loc.id }, p_items: [{ part_id: part.id, quantity: 1, unit_price: 10, request_id: buy.id }], p_create_key: key() });
  expect(po.ok).toBe(true);
  const sup = await send('rq_staff', 'patch', `${R}/${buy.id}`, { action: 'request_supplement', expected_updated_at: await ver(buy.id), supplement_type: 'OTHER', supplement_note: '請補' });
  expect(sup.status).toBe(409);
  expect(sup.body.error).toContain('請改用留言');
  // 草稿取消後可以補資料
  expect((await callFn(users.rq_staff.client, 'ga_ws_po_action', { p_id: po.data.id, p_action: 'cancel', p_expected_updated_at: po.data.updated_at, p_note: null })).ok).toBe(true);
  expect((await send('rq_staff', 'patch', `${R}/${buy.id}`, { action: 'request_supplement', expected_updated_at: await ver(buy.id), supplement_type: 'OTHER', supplement_note: '請補' })).status).toBe(200);
  // 店長補資料 → 待總務複核 → 再受理
  const back = await send('rq_store_a', 'post', `${R}/${buy.id}/store-actions`, { action: 'submit_supplement', note: '已補充' });
  expect(back.status).toBe(200);
  expect((await dbReq(buy.id)).main_status).toBe('WAITING_GA_REVIEW');
});

// ----------------------------------------------------------------------------- Q16 門市動作與代按
test('Q16 門市動作：自己門市的店長確認完成、他店與唯讀不行；總務代按須說明並標「總務代門市操作」；回報問題退回；工單與處理單同步', async () => {
  const q = await mk('VW001', { main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'TRANSFER' });
  expect((await send('rq_store_b', 'post', `${R}/${q.id}/store-actions`, { action: 'confirm_complete', note: 'x' })).status).toBe(403);
  expect((await send('rq_store_viewonly', 'post', `${R}/${q.id}/store-actions`, { action: 'confirm_complete', note: 'x' })).status).toBe(403);
  expect((await send('nobody', 'post', `${R}/${q.id}/store-actions`, { action: 'confirm_complete' })).status).toBe(403);
  expect((await send('rq_store_a', 'post', `${R}/${q.id}/store-actions`, { action: 'nope' })).status).toBe(400);
  expect((await send('rq_store_a', 'post', `${R}/${q.id}/store-actions`, { action: 'report_problem' })).status).toBe(400); // 要原因
  // 總務代按：沒說明 400；有說明 → 事件標記、留言前綴、可見於門市時間軸
  const noNote = await send('rq_staff', 'post', `${R}/${q.id}/store-actions`, { action: 'confirm_complete' });
  expect(noNote.status).toBe(400);
  expect((await dbReq(q.id)).main_status).toBe('WAITING_STORE_CONFIRMATION');
  const proxy = await send('rq_staff', 'post', `${R}/${q.id}/store-actions`, { action: 'confirm_complete', note: '店長電話確認收到' });
  expect(proxy.status, JSON.stringify(proxy.body)).toBe(200);
  expect(proxy.body.data.proxy_for_store).toBe(true);
  const ev = (await dbEvents(q.id)).find((e) => e.event_type === 'STORE_COMPLETION_CONFIRMED');
  expect(ev).toMatchObject({ proxy_for_store: true, visibility: 'PUBLIC', created_by: users.rq_staff.id });
  const cm = ((await db().from('ga_service_request_comments').select('body').eq('request_id', q.id)).data || []) as any[];
  expect(cm.some((c) => String(c.body).startsWith('【總務代門市操作】'))).toBe(true);
  expect(await dbReq(q.id)).toMatchObject({ main_status: 'COMPLETED' });
  const view = await get('rq_store_a', `${R}/${q.id}`);
  expect((view.body.events as any[]).find((e) => e.event_type === 'STORE_COMPLETION_CONFIRMED').proxy_for_store).toBe(true);
  // 店長自己按：不標代按
  const own = await mk('VW001', { main_status: 'WAITING_STORE_CONFIRMATION' });
  const ok = await send('rq_store_a', 'post', `${R}/${own.id}/store-actions`, { action: 'confirm_complete' });
  expect(ok.status).toBe(200);
  expect(ok.body.data.proxy_for_store).toBe(false);
  expect((await dbEvents(own.id)).find((e) => e.event_type === 'STORE_COMPLETION_CONFIRMED').proxy_for_store).toBe(false);
  expect((await dbReq(own.id)).completed_at).toBeTruthy();
  // 回報有問題：退回處理中，處理單進異常
  const prob = await mk('VW001', { main_status: 'WAITING_STORE_CONFIRMATION' });
  const fulIns = await db().from('ga_part_fulfillments').insert({ request_id: prob.id, status: 'WAITING_STORE_CONFIRMATION', requested_quantity: 10, fulfilled_quantity: 10, unit: part.base_unit, created_by: users.rq_staff.id }).select('*').single();
  expect(fulIns.error).toBeNull();
  const rp = await send('rq_store_a', 'post', `${R}/${prob.id}/store-actions`, { action: 'report_problem', note: '少一個' });
  expect(rp.status).toBe(200);
  expect((await dbReq(prob.id)).main_status).toBe('IN_PROGRESS');
  expect((await dbFul(prob.id)).status).toBe('EXCEPTION');
  // 維修工單同步：確認完成後工單 COMPLETED
  const rep = await mk('VW001', { main_status: 'PENDING_INTAKE', request_type: 'REPAIR', resource_type: null, part_id: null, desired_quantity: null });
  expect((await send('rq_staff', 'patch', `${R}/${rep.id}`, { action: 'accept', expected_updated_at: await ver(rep.id), intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS' })).status).toBe(200);
  expect((await send('rq_staff', 'patch', `${R}/${rep.id}`, { action: 'update_progress', expected_updated_at: await ver(rep.id) })).status).toBe(200);
  expect((await send('rq_staff', 'patch', `${R}/${rep.id}`, { action: 'request_store_confirmation', expected_updated_at: await ver(rep.id) })).status).toBe(200);
  const woId = (await dbReq(rep.id)).maintenance_request_id as string;
  expect(((await db().from('maintenance_requests').select('status,progress_stage').eq('id', woId).single()).data as any)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect((await send('rq_store_a', 'post', `${R}/${rep.id}/store-actions`, { action: 'confirm_complete' })).status).toBe(200);
  expect(((await db().from('maintenance_requests').select('status').eq('id', woId).single()).data as any).status).toBe('COMPLETED');
});

// ----------------------------------------------------------------------------- D5 逾期
test('D5 逾期未確認：天數設定（權限、範圍、STALE）、超過天數標示與一鍵篩選與精確統計；不自動結案', async () => {
  expect((await get('nobody', `${R}/settings`)).status).toBe(403);
  const s0 = await get('rq_view_all', `${R}/settings`);
  expect(s0.status).toBe(200);
  expect(s0.body.data.overdue_days).toBe(originalDays);
  const v = s0.body.data.updated_at as string;
  expect((await send('rq_view_all', 'patch', `${R}/settings`, { overdue_days: 5, expected_updated_at: v })).status).toBe(403);
  for (const bad of [0, 91, 1.5, 'x', null]) expect((await send('rq_staff', 'patch', `${R}/settings`, { overdue_days: bad, expected_updated_at: v })).status, String(bad)).toBe(400);
  expect((await send('rq_staff', 'patch', `${R}/settings`, { overdue_days: 5 })).status).toBe(400);
  expect((await send('rq_staff', 'patch', `${R}/settings`, { overdue_days: 5, expected_updated_at: '2000-01-01T00:00:00Z' })).body.code).toBe('STALE');
  const old = await mk('VW001', { main_status: 'WAITING_STORE_CONFIRMATION' });
  const fresh = await mk('VW001', { main_status: 'WAITING_STORE_CONFIRMATION' });
  await db().from('ga_service_requests').update({ waiting_confirm_since: new Date(Date.now() - 6 * 86400_000).toISOString() }).eq('id', old.id);
  const before = await get('rq_staff', `${R}?overdue=true&pageSize=100`);
  expect((before.body.data as any[]).map((r) => r.id)).not.toContain(old.id); // 預設 7 天，6 天還沒逾期
  const set = await send('rq_staff', 'patch', `${R}/settings`, { overdue_days: 5, expected_updated_at: v });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  expect(Number(((await db().from('ga_workflow_settings').select('value_num').eq('key', 'request_overdue_confirm_days').single()).data as any).value_num)).toBe(5);
  expect(((await db().from('ga_workflow_setting_events').select('*').eq('setting_key', 'request_overdue_confirm_days').eq('actor_id', users.rq_staff.id)).data || []).length).toBeGreaterThanOrEqual(1);
  const after = await get('rq_staff', `${R}?overdue=true&pageSize=100`);
  const ids = (after.body.data as any[]).map((r) => r.id);
  expect(ids).toContain(old.id);
  expect(ids).not.toContain(fresh.id);
  expect((after.body.data as any[]).every((r) => r.is_overdue_confirm)).toBe(true);
  expect(after.body.stats.overdue).toBeGreaterThanOrEqual(1);
  expect(after.body.total).toBe(after.body.stats.overdue);
  expect((await dbReq(old.id)).main_status).toBe('WAITING_STORE_CONFIRMATION'); // 不自動結案
  const det = await get('rq_staff', `${R}/${old.id}`);
  expect(det.body.data.is_overdue_confirm).toBe(true);
  const store = await get('rq_store_a', `${R}/${old.id}`);
  expect(store.body.data.waiting_confirm_since).toBeUndefined();
  // 離開待確認後起算時間清空
  expect((await send('rq_store_a', 'post', `${R}/${old.id}/store-actions`, { action: 'report_problem', note: '退回' })).status).toBe(200);
  expect((await dbReq(old.id)).waiting_confirm_since).toBeNull();
  await db().from('ga_workflow_settings').update({ value_num: originalDays }).eq('key', 'request_overdue_confirm_days');
});

// ----------------------------------------------------------------------------- Q18 庫存出庫
test('Q18 庫存出庫：權限缺哪個講清楚、須先分流庫存出庫、不得超量、料件須相同（替代料須原因）、固定識別不重複扣庫存、同交易同步處理單', async () => {
  const q = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE', desired_quantity: 3 });
  await seedBalance(loc.id, part.id, 20);
  await seedBalance(loc.id, part2.id, 20);
  const body = (over: Record<string, unknown> = {}) => ({ location_id: loc.id, part_id: part.id, quantity: 2, input_unit_type: 'BASE', idempotency_key: key(), ...over });
  const url = `${R}/${q.id}/stock-issue`;
  for (const k of ['nobody', 'rq_store_a', 'rq_view_all', 'ful_view']) expect((await send(k, 'post', url, body())).status, k).toBe(403);
  const noInv = await send('rq_manage_only', 'post', url, body());
  expect(noInv.status).toBe(403);
  expect(noInv.body.error).toMatch(/料件處理管理|庫存交易管理|料件查看/);
  const onlyFul = await send('ful_manage_only', 'post', url, body());
  expect(onlyFul.status).toBe(403);
  expect(onlyFul.body.error).toContain('庫存交易管理');
  // 400
  expect((await send('rq_staff', 'post', url, body({ quantity: 0 }))).status).toBe(400);
  expect((await send('rq_staff', 'post', url, body({ location_id: 'x' }))).status).toBe(400);
  expect((await send('rq_staff', 'post', url, body({ idempotency_key: '' }))).status).toBe(400);
  // 還沒分流庫存出庫 → 409
  const wrong = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'TRANSFER', desired_quantity: 3 });
  expect((await send('rq_staff', 'post', `${R}/${wrong.id}/stock-issue`, body())).status).toBe(409);
  // 非料件需求
  const nonPart = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE', resource_type: 'OTHER_PURCHASE', part_id: null, desired_quantity: 3 });
  expect((await send('rq_staff', 'post', `${R}/${nonPart.id}/stock-issue`, body())).status).toBe(422);
  // 超量（需求 3，一次出 4）→ 409 且庫存沒動
  const over = await send('rq_staff', 'post', url, body({ quantity: 4 }));
  expect(over.status).toBe(409);
  expect(over.body.code).toBe('OVER_REQUEST');
  expect(await dbBal(loc.id, part.id)).toBe(20);
  // 料件不同：沒填原因 422；填原因通過（記在事件）
  const sub = await send('rq_staff', 'post', url, body({ part_id: part2.id, quantity: 1 }));
  expect(sub.status).toBe(422);
  expect(sub.body.code).toBe('SUBSTITUTE_REASON_REQUIRED');
  // 第一次出庫 2（同 key 重送一次也只扣一次）
  const k1 = key();
  const first = await send('rq_staff', 'post', url, body({ idempotency_key: k1 }));
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const again = await send('rq_staff', 'post', url, body({ idempotency_key: k1 }));
  expect([200, 201]).toContain(again.status);
  expect(await dbBal(loc.id, part.id)).toBe(18);
  const ful = await dbFul(q.id);
  expect(ful).toMatchObject({ status: 'STOCK_ISSUE' });
  expect(Number(ful.fulfilled_quantity)).toBe(2);
  expect((await dbDocs(ful.id)).filter((d) => d.document_type === 'STOCK_ISSUE')).toHaveLength(1);
  expect((await dbReq(q.id)).main_status).toBe('IN_PROGRESS');
  expect((await dbEvents(q.id)).map((e) => e.event_type)).toContain('STOCK_ISSUED');
  // 剩餘 1：再出 2 超量；替代料出 1 帶原因 OK，已達需求量
  expect((await send('rq_staff', 'post', url, body({ quantity: 2 }))).body.code).toBe('OVER_REQUEST');
  const subOk = await send('rq_staff', 'post', url, body({ part_id: part2.id, quantity: 1, substitute_reason: '原料件缺貨改用替代料' }));
  expect(subOk.status, JSON.stringify(subOk.body)).toBe(201);
  expect(await dbBal(loc.id, part2.id)).toBe(19);
  const ev = (await dbEvents(q.id)).filter((e) => e.event_type === 'STOCK_ISSUED').pop();
  expect(ev.metadata.substitute_reason).toBe('原料件缺貨改用替代料');
  const ful2 = await dbFul(q.id);
  expect(Number(ful2.fulfilled_quantity)).toBe(3);
  expect(ful2.ready_to_deliver_at).toBeTruthy(); // 待交付
  // 全部出完再出：超量
  expect((await send('rq_staff', 'post', url, body({ quantity: 1 }))).body.code).toBe('OVER_REQUEST');
});

// ----------------------------------------------------------------------------- D1 採購評估
test('D1／Q18 採購評估：權限與前置、選進入採購同交易產生草稿採購單並連結需求單與處理單、重存不重複、改決策取消舊單且報價留歷史、已到貨者擋', async () => {
  const q = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW', desired_quantity: 10, resource_type: 'PART' });
  const url = `${R}/${q.id}/purchase-review`;
  const pay = (over: Record<string, unknown> = {}) => ({ decision: 'PURCHASE', approvedQuantity: 10, approvedUnit: part.base_unit, vendorId: vendor.id, quotedAmount: 1000, decisionNote: '評估要採購', expected_updated_at: undefined as any, ...over });
  const save = async (id: string, over: Record<string, unknown> = {}) => send('rq_staff', 'post', `${R}/${id}/purchase-review`, { ...pay(over), expected_updated_at: await ver(id) });
  for (const k of ['nobody', 'rq_store_a', 'rq_view_all', 'ful_view']) expect((await send(k, 'post', url, { ...pay(), expected_updated_at: await ver(q.id) })).status, k).toBe(403);
  expect((await send('rq_manage_only', 'post', url, { ...pay(), expected_updated_at: await ver(q.id) })).status).toBe(403);
  expect((await get('rq_manage_only', url)).status).toBe(403); // 沒有採購評估查看權限
  // 400
  expect((await save(q.id, { decisionNote: '' })).status).toBe(400);
  expect((await save(q.id, { decision: 'XX' })).status).toBe(400);
  expect((await save(q.id, { approvedQuantity: undefined })).status).toBe(400);
  expect((await send('rq_staff', 'post', url, pay())).status).toBe(400); // 缺 expected
  // 前置：分流不是採購評估 → 409；維修單 → 422
  const wrong = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE' });
  expect((await save(wrong.id)).status).toBe(409);
  // 成功：草稿採購單、連結、處理單文件
  const ok = await save(q.id);
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  const poData = ok.body.data.purchase_order;
  expect(poData).toBeTruthy();
  const po = (await db().from('ga_purchase_orders').select('*').eq('id', poData.id).single()).data as any;
  expect(po).toMatchObject({ status: 'DRAFT', source_request_id: q.id });
  expect(po.purchase_review_id).toBeTruthy();
  const items = ((await db().from('ga_purchase_order_items').select('*').eq('po_id', po.id)).data || []) as any[];
  expect(items.every((i) => i.request_id === q.id)).toBe(true);
  const ful = await dbFul(q.id);
  expect(ful).toMatchObject({ status: 'PURCHASING' });
  const docs = await dbDocs(ful.id);
  expect(docs.filter((d) => d.document_type === 'PURCHASE' && d.document_id === po.id)).toHaveLength(1);
  expect((await dbReq(q.id)).main_status).toBe('IN_PROGRESS');
  expect(((await db().from('ga_purchase_reviews').select('*').eq('request_id', q.id)).data || [])).toHaveLength(1);
  // 重存同決策：不再產生第二張採購單
  const resave = await save(q.id, { quotedAmount: 1200 });
  expect(resave.status, JSON.stringify(resave.body)).toBe(201);
  expect(((await db().from('ga_purchase_orders').select('id').eq('source_request_id', q.id)).data || [])).toHaveLength(1);
  // 需求單頁顯示連結的採購單（含金額與供應商；沒有採購評估權限的總務只看到單號與進度）
  const det = await get('rq_staff', `${R}/${q.id}`);
  expect((det.body.purchase_orders as any[]).map((o) => o.po_no)).toEqual([po.po_no]);
  expect(det.body.purchase_orders[0].vendor_name).toBeTruthy();
  expect(det.body.fulfillment.id).toBe(ful.id);
  // 報價歷史：改決策前先多存一次（兩筆報價，舊的標已取代）
  const quotes = ((await db().from('ga_purchase_review_quotes').select('*').eq('purchase_review_id', po.purchase_review_id).order('created_at')).data || []) as any[];
  expect(quotes.length).toBe(2);
  expect(quotes[0].superseded_at).toBeTruthy();
  expect(quotes[1].superseded_at).toBeNull();
  // 已到貨者擋：模擬已驗入
  await db().from('ga_purchase_order_items').update({ received_qty: 1 }).eq('po_id', po.id);
  const blocked = await save(q.id, { decision: 'STOCK_ISSUE' });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('PO_ALREADY_RECEIVED');
  expect((await dbPoStatus(po.id))).toBe('DRAFT');
  await db().from('ga_purchase_order_items').update({ received_qty: 0 }).eq('po_id', po.id);
  // 改成庫存出庫：舊採購單標已取消、報價仍在（沒有被刪）、需求單改走庫存出庫
  const sw = await save(q.id, { decision: 'STOCK_ISSUE' });
  expect(sw.status, JSON.stringify(sw.body)).toBe(201);
  expect(await dbPoStatus(po.id)).toBe('CANCELED');
  expect(((await db().from('ga_purchase_review_quotes').select('id').eq('purchase_review_id', po.purchase_review_id)).data || []).length).toBe(2);
  expect(await dbReq(q.id)).toMatchObject({ intake_route: 'STOCK_ISSUE', main_status: 'ACCEPTED' });
  expect(((await dbDocs(ful.id)).find((d) => d.document_id === po.id) as any).status).toBe('CANCELED');
});

async function dbPoStatus(id: string) { return ((await db().from('ga_purchase_orders').select('status').eq('id', id).single()).data as any).status as string; }

test('D1 採購評估整體回復：產生草稿採購單失敗（需求量已被別張採購單占滿）時，評估、需求單狀態、報價都不留痕', async () => {
  const q = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW', desired_quantity: 5 });
  const full = await callFn(users.rq_staff.client, 'ga_ws_po_create', { p_header: { notes: m7Name('占滿'), vendor_id: vendor.id, receiving_location_id: loc.id }, p_items: [{ part_id: part.id, quantity: 5, unit_price: 10, request_id: q.id }], p_create_key: key() });
  expect(full.ok, JSON.stringify(full)).toBe(true);
  const r = await send('rq_staff', 'post', `${R}/${q.id}/purchase-review`, { decision: 'PURCHASE', approvedQuantity: 3, approvedUnit: part.base_unit, vendorId: vendor.id, quotedAmount: 100, decisionNote: '會被回復', expected_updated_at: await ver(q.id) });
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('NO_REMAINING');
  expect(((await db().from('ga_purchase_reviews').select('id').eq('request_id', q.id)).data || [])).toHaveLength(0);
  expect((await dbReq(q.id)).main_status).toBe('ACCEPTED');
  expect(((await dbEvents(q.id)).filter((e) => e.event_type === 'PURCHASE_REVIEW_DECIDED'))).toHaveLength(0);
});

// ----------------------------------------------------------------------------- G17 處理單
test('G17 處理單：讀取權限、遮蔽、建立冪等、決定處理方式（STALE）、待交付與送門市確認（需求單一起往下）、異常登記與逐筆作廢後重選', async () => {
  const q = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'TRANSFER', desired_quantity: 4 });
  expect((await get('nobody', F)).status).toBe(403);
  expect((await get('rq_store_a', F)).status).toBe(403);
  expect((await get('ful_view', F)).status).toBe(200);
  expect((await send('ful_view', 'post', F, { requestId: q.id })).status).toBe(403); // 只有查看
  expect((await send('rq_staff', 'post', F, { requestId: 'x' })).status).toBe(400);
  const c1 = await send('rq_staff', 'post', F, { requestId: q.id });
  expect(c1.status, JSON.stringify(c1.body)).toBe(201);
  const c2 = await send('rq_staff', 'post', F, { requestId: q.id });
  expect(c2.status).toBe(200);
  expect(c2.body.existing).toBe(true);
  expect(c2.body.data.id).toBe(c1.body.data.id);
  const fid = c1.body.data.id as string;
  const nonPart = await mk('VW001', { main_status: 'ACCEPTED', resource_type: 'OTHER_PURCHASE', part_id: null });
  expect((await send('rq_staff', 'post', F, { requestId: nonPart.id })).status).toBe(400);
  // 決定
  const dv = async () => ((await db().from('ga_part_fulfillments').select('updated_at').eq('id', fid).single()).data as any).updated_at as string;
  expect((await send('rq_staff', 'post', `${F}/${fid}/decision`, { decision: 'STOCK_ISSUE' })).status).toBe(400); // 缺版本
  expect((await send('rq_staff', 'post', `${F}/${fid}/decision`, { decision: 'NOPE', expected_updated_at: await dv() })).status).toBe(400);
  expect((await send('ful_view', 'post', `${F}/${fid}/decision`, { decision: 'STOCK_ISSUE', expected_updated_at: await dv() })).status).toBe(403);
  expect((await send('rq_staff', 'post', `${F}/${fid}/decision`, { decision: 'STOCK_ISSUE', expected_updated_at: '2000-01-01T00:00:00Z' })).body.code).toBe('STALE');
  expect((await send('rq_staff', 'post', `${F}/${fid}/decision`, { decision: 'STOCK_ISSUE', expected_updated_at: await dv() })).status).toBe(200);
  expect(await dbFul(q.id)).toMatchObject({ status: 'STOCK_ISSUE' });
  expect((await dbReq(q.id)).intake_route).toBe('STOCK_ISSUE');
  // 送門市確認：量不足 409
  expect((await send('rq_staff', 'post', `${F}/${fid}/deliver`, { expected_updated_at: await dv() })).status).toBe(409);
  const detail0 = await get('rq_staff', `${F}/${fid}`);
  expect(detail0.body.data.abilities.deliver).toBe(false);
  expect(detail0.body.data.is_ready_to_deliver).toBe(false);
  // 達量 → 待交付（觸發器記錄時間）；清單篩選與統計
  const docIns = await db().from('ga_part_fulfillment_documents').insert({ fulfillment_id: fid, document_type: 'STOCK_ISSUE', document_id: crypto.randomUUID(), document_no: 'TST-ISSUE', quantity: 4, status: 'POSTED', created_by: users.rq_staff.id });
  expect(docIns.error).toBeNull();
  await db().from('ga_part_fulfillments').update({ fulfilled_quantity: 4 }).eq('id', fid);
  const ready = (await db().from('ga_part_fulfillments').select('ready_to_deliver_at').eq('id', fid).single()).data as any;
  expect(ready.ready_to_deliver_at).toBeTruthy();
  const rl = await get('rq_staff', `${F}?ready=true&pageSize=100`);
  expect((rl.body.data as any[]).map((r) => r.id)).toContain(fid);
  expect(rl.body.stats.ready).toBeGreaterThanOrEqual(1);
  expect((rl.body.data as any[]).find((r) => r.id === fid).status_label).toBe('待交付');
  expect((await get('rq_staff', `${F}?fulfillmentId=${fid}`)).body.data.map((r: any) => r.id)).toEqual([fid]);
  expect((await get('rq_staff', `${F}?status=NOPE`)).status).toBe(400);
  expect((await send('ful_view', 'post', `${F}/${fid}/deliver`, { expected_updated_at: await dv() })).status).toBe(403);
  const dl = await send('rq_staff', 'post', `${F}/${fid}/deliver`, { expected_updated_at: await dv() });
  expect(dl.status, JSON.stringify(dl.body)).toBe(200);
  expect(await dbFul(q.id)).toMatchObject({ status: 'WAITING_STORE_CONFIRMATION' });
  expect(await dbReq(q.id)).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' });
  expect((await dbReq(q.id)).waiting_confirm_since).toBeTruthy();
  // 送出後不能再選處理方式
  expect((await send('rq_staff', 'post', `${F}/${fid}/decision`, { decision: 'TRANSFER', expected_updated_at: await dv() })).status).toBe(409);
  // 店長確認完成 → 處理單一起完成
  expect((await send('rq_store_a', 'post', `${R}/${q.id}/store-actions`, { action: 'confirm_complete' })).status).toBe(200);
  expect((await dbFul(q.id)).status).toBe('COMPLETED');
  expect(await dbReq(q.id)).toMatchObject({ main_status: 'COMPLETED' });
});

test('Q18 異常與作廢：先登記異常才能作廢單據；作廢要原因、釋放已承諾量、不沖回庫存；採購單作廢＝取消（已到貨者擋）；重選處理方式；單據明細遮蔽金額與供應商', async () => {
  const q = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE', desired_quantity: 6 });
  await seedBalance(loc.id, part.id, 10).catch(() => undefined);
  const issue = await send('rq_staff', 'post', `${R}/${q.id}/stock-issue`, { location_id: loc.id, part_id: part.id, quantity: 2, input_unit_type: 'BASE', idempotency_key: key() });
  expect(issue.status, JSON.stringify(issue.body)).toBe(201);
  const ful = await dbFul(q.id);
  const doc = (await dbDocs(ful.id))[0];
  const balAfterIssue = await dbBal(loc.id, part.id);
  const dv = async () => ((await db().from('ga_part_fulfillments').select('updated_at').eq('id', ful.id).single()).data as any).updated_at as string;
  // 還沒異常不能作廢
  const early = await send('rq_staff', 'post', `${F}/${ful.id}/documents/${doc.id}/void`, { reason: '想作廢' });
  expect(early.status).toBe(409);
  // 登記異常：類型與說明必填
  expect((await send('rq_staff', 'post', `${F}/${ful.id}/exception`, { type: '亂填', note: 'x', expected_updated_at: await dv() })).status).toBe(400);
  expect((await send('rq_staff', 'post', `${F}/${ful.id}/exception`, { type: '少收', note: '', expected_updated_at: await dv() })).status).toBe(400);
  expect((await send('ful_view', 'post', `${F}/${ful.id}/exception`, { type: '少收', note: 'x', expected_updated_at: await dv() })).status).toBe(403);
  const ex = await send('rq_staff', 'post', `${F}/${ful.id}/exception`, { type: '少收', note: '門市說少了一個', expected_updated_at: await dv() });
  expect(ex.status, JSON.stringify(ex.body)).toBe(200);
  expect(await dbFul(q.id)).toMatchObject({ status: 'EXCEPTION' });
  // 作廢：要原因；ful_view 不行；成功後釋放量、庫存不動
  expect((await send('rq_staff', 'post', `${F}/${ful.id}/documents/${doc.id}/void`, {})).status).toBe(400);
  expect((await send('ful_view', 'post', `${F}/${ful.id}/documents/${doc.id}/void`, { reason: 'x' })).status).toBe(403);
  const vd = await send('rq_staff', 'post', `${F}/${ful.id}/documents/${doc.id}/void`, { reason: '重新處理' });
  expect(vd.status, JSON.stringify(vd.body)).toBe(200);
  expect(Number(vd.body.data.fulfilled_quantity)).toBe(0);
  const d2 = (await dbDocs(ful.id))[0];
  expect(d2).toMatchObject({ status: 'CANCELED', void_reason: '重新處理' });
  expect(d2.voided_at).toBeTruthy();
  expect(await dbBal(loc.id, part.id)).toBe(balAfterIssue); // 庫存不自動沖回
  expect((await send('rq_staff', 'post', `${F}/${ful.id}/documents/${doc.id}/void`, { reason: '再作廢' })).status).toBe(409);
  // 釋放後可再出庫 6（先前 2 被釋放）
  const reissue = await send('rq_staff', 'post', `${R}/${q.id}/stock-issue`, { location_id: loc.id, part_id: part.id, quantity: 6, input_unit_type: 'BASE', idempotency_key: key() });
  expect(reissue.status, JSON.stringify(reissue.body)).toBe(201);
  // 另一張：採購單作廢＝取消；已到貨者擋
  const p = await mk('VW001', { main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW', desired_quantity: 3 });
  const rv = await send('rq_staff', 'post', `${R}/${p.id}/purchase-review`, { decision: 'PURCHASE', approvedQuantity: 3, approvedUnit: part.base_unit, vendorId: vendor.id, quotedAmount: 300, decisionNote: '採購', expected_updated_at: await ver(p.id) });
  expect(rv.status, JSON.stringify(rv.body)).toBe(201);
  const pf = await dbFul(p.id);
  const pdoc = (await dbDocs(pf.id)).find((d) => d.document_type === 'PURCHASE') as any;
  const pv = async () => ((await db().from('ga_part_fulfillments').select('updated_at').eq('id', pf.id).single()).data as any).updated_at as string;
  expect((await send('rq_staff', 'post', `${F}/${pf.id}/exception`, { type: '未收', note: '廠商沒送', expected_updated_at: await pv() })).status).toBe(200);
  await db().from('ga_purchase_order_items').update({ received_qty: 1 }).eq('po_id', pdoc.document_id);
  const blocked = await send('rq_staff', 'post', `${F}/${pf.id}/documents/${pdoc.id}/void`, { reason: '想作廢' });
  expect(blocked.status).toBe(409);
  expect(await dbPoStatus(pdoc.document_id)).toBe('DRAFT');
  await db().from('ga_purchase_order_items').update({ received_qty: 0 }).eq('po_id', pdoc.document_id);
  // 單據明細遮蔽：只有查看權限（沒有採購評估權限）看不到金額與供應商
  const lim = await get('ful_view', `${F}/documents/PURCHASE/${pdoc.document_id}`);
  expect(lim.status).toBe(200);
  expect(JSON.stringify(lim.body)).not.toContain('total_amount');
  expect(lim.body.data.vendor_name).toBeUndefined();
  const full = await get('rq_staff', `${F}/documents/PURCHASE/${pdoc.document_id}`);
  expect(full.body.data.total_amount).toBeDefined();
  expect(full.body.data.vendor_name).toBeTruthy();
  expect((await get('rq_staff', `${F}/documents/BAD/${pdoc.document_id}`)).status).toBe(400);
  expect((await get('nobody', `${F}/documents/PURCHASE/${pdoc.document_id}`)).status).toBe(403);
  // 作廢採購單（取消）→ 重選處理方式
  const vp = await send('rq_staff', 'post', `${F}/${pf.id}/documents/${pdoc.id}/void`, { reason: '改走庫存' });
  expect(vp.status, JSON.stringify(vp.body)).toBe(200);
  expect(await dbPoStatus(pdoc.document_id)).toBe('CANCELED');
  const re = await send('rq_staff', 'post', `${F}/${pf.id}/decision`, { decision: 'STOCK_ISSUE', expected_updated_at: await pv() });
  expect(re.status, JSON.stringify(re.body)).toBe(200);
  expect(await dbFul(p.id)).toMatchObject({ status: 'STOCK_ISSUE' });
  void seedReview;
  void PERM;
});

test('併發：兩人同時受理同一張需求單，只成功一次（另一個 409）', async () => {
  const q = await mk('VW001', { main_status: 'PENDING_INTAKE' });
  const v = await ver(q.id);
  const body = { action: 'accept', expected_updated_at: v, intake_route: 'TRANSFER', assignee_role: 'GENERAL_AFFAIRS' };
  const [a, b] = await Promise.all([send('rq_staff', 'patch', `${R}/${q.id}`, body), send('rq_staff', 'patch', `${R}/${q.id}`, body)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(((await dbEvents(q.id)).filter((e) => e.event_type === 'REQUEST_ACCEPTED'))).toHaveLength(1);
});
