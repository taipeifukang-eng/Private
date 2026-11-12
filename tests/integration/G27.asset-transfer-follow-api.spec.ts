import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import crypto from 'node:crypto';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, seedFacility, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';
import { isMovableRequest, legacyWorkOrderMatches, movedTimelineTitle } from '../../lib/workspace/general-affairs/asset-move';

// M7/M8 第 4 批 G27（B6，D20、D21）整合：資產換店時，維修類未結案需求單與其工單一起搬到新門市。
// 涵蓋：全流程（轉移收到才搬、搬與不搬的各類型與狀態、舊式工單只列清單、時間軸公開事件、不發通知、轉移單明細、舊店只剩已結案單、新店店長接手）、
//      更正所屬門市也搬、設施同規則、確認視窗預覽、權限矩陣、Origin、400、409 STALE（併發：搬走後舊版本寫入被擋）、重複確認冪等、資料庫回讀。
// 所有資料帶 [自動測試]M7M8 標記，結束清除；與其他整合檔一樣循序執行。
const BASE = '/api/workspace/general-affairs';
const KEYS: PoKey[] = ['tf_ga', 'tf_view', 'eq_manage', 'rq_store_a', 'rq_store_b', 'nobody'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let sid: Record<string, string> = {};
let eqCat: { id: string };
let facCat: { id: string };
let seq = 0;
const db = () => adminDb();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const post = async (k: string, p: string, data: unknown = {}) => j(await apis[k].post(`${BASE}/${p}`, { data }));
const reqRow = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).single()).data as any;
const reqEvents = async (id: string) => ((await db().from('ga_service_request_events').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
const movedRows = async (assetId: string) => ((await db().from('ga_asset_transfer_moved_requests').select('*').eq('asset_id', assetId).order('created_at').order('kind')).data || []) as any[];

/** 建一張維修需求單；with WO 時一併建連結工單（status 預設處理中）。 */
async function mkRequest(storeCode: 'VW001' | 'ZT01', target: { equipmentId?: string; facilityId?: string }, status: string, opts: { type?: string; workOrder?: boolean } = {}) {
  const n = (seq += 1);
  const creator = storeCode === 'VW001' ? users.rq_store_a.id : users.rq_store_b.id;
  const row = (await db().from('ga_service_requests').insert({
    store_id: sid[storeCode], created_by: creator, request_type: opts.type || 'REPAIR', title: m7Name(`G27-R${n}`), description: 'G27 搬單測試',
    resource_type: target.equipmentId ? 'EQUIPMENT' : 'FACILITY', equipment_id: target.equipmentId ?? null, facility_id: target.facilityId ?? null, main_status: status,
  }).select('*').single()).data as any;
  let wo: any = null;
  if (opts.workOrder) {
    wo = (await db().from('maintenance_requests').insert({
      store_id: sid[storeCode], title: m7Name(`G27-W${n}`), description: 'G27 工單', reported_by: creator, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING',
      resource_type: target.equipmentId ? 'equipment' : 'facility', progress_stage: 'INITIAL_REVIEW', ga_service_request_id: row.id,
    }).select('*').single()).data as any;
    await db().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('id', row.id);
  }
  return { req: row, wo };
}
/** 舊式工單：沒連到需求單。 */
async function mkLegacy(storeCode: 'VW001' | 'ZT01', title: string, status = 'PROCESSING') {
  return (await db().from('maintenance_requests').insert({
    store_id: sid[storeCode], title: m7Name(title), description: '舊式工單', reported_by: users.rq_store_b.id, reporter_name: 'M7M8', priority: 'normal', status, resource_type: 'equipment',
  }).select('*').single()).data as any;
}
async function doTransfer(assetType: 'EQUIPMENT' | 'FACILITY', assetId: string, to: 'VW001' | 'ZT01', from: 'VW001' | 'ZT01') {
  const fromMgr = from === 'ZT01' ? 'rq_store_b' : 'rq_store_a';
  const toMgr = to === 'ZT01' ? 'rq_store_b' : 'rq_store_a';
  const made = await post('tf_ga', 'transfers', { assetType, assetId, toStoreId: sid[to], reason: 'G27 搬單測試' });
  expect(made.status).toBe(201);
  const id = made.body.data.id as string;
  expect((await post(fromMgr, `transfers/${id}/handover`, { note: '交出' })).status).toBe(200);
  const rec = await post(toMgr, `transfers/${id}/receive`, { note: '收到' });
  return { id, rec };
}

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
  eqCat = await seedCategory('equipment', 'G27E');
  facCat = await seedCategory('facility', 'G27F');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  const b = await cleanupM7M8();
  const a = await teardownUsers();
  expect([...b, ...a], '清除總務測試資料').toEqual([]);
});

test('全流程：轉移收到才搬；維修類未結案（含待門市確認、待補資料）連工單一起搬，添購與已結案不搬，舊式工單只列清單；時間軸公開事件；新店接手舊店只剩已結案', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27-流程');
  const A = await mkRequest('ZT01', { equipmentId: eq.id }, 'WAITING_STORE_CONFIRMATION', { workOrder: true });
  const B = await mkRequest('ZT01', { equipmentId: eq.id }, 'WAITING_STORE_SUPPLEMENT');
  const C = await mkRequest('ZT01', { equipmentId: eq.id }, 'IN_PROGRESS', { workOrder: true });
  const P = await mkRequest('ZT01', { equipmentId: eq.id }, 'IN_PROGRESS', { type: 'PURCHASE_SUPPLEMENT' });
  const D = await mkRequest('ZT01', { equipmentId: eq.id }, 'COMPLETED');
  const E = await mkRequest('ZT01', { equipmentId: eq.id }, 'REJECTED');
  const F = await mkRequest('ZT01', { equipmentId: eq.id }, 'CANCELED');
  const L1 = await mkLegacy('ZT01', `舊工單提到${eq.name}故障`);
  const L2 = await mkLegacy('ZT01', '舊工單與此設備無關');
  const L3 = await mkLegacy('ZT01', `舊工單已完成${eq.name}`, 'COMPLETED');

  // 確認視窗預覽：會搬 3 張（A、B、C）、留 1 張（添購）、舊式工單 1 張
  const pre = await get('tf_ga', `equipment/${eq.id}/open-orders`);
  expect(pre.status).toBe(200);
  expect(pre.body.data).toMatchObject({ moving_count: 3, staying_count: 1, unlinked_count: 1 });
  expect(pre.body.data.moving.map((m: any) => m.request_no).sort()).toEqual([A.req.request_no, B.req.request_no, C.req.request_no].sort());
  expect(pre.body.data.staying[0].request_no).toBe(P.req.request_no);
  expect(pre.body.data.unlinked_work_orders.map((w: any) => w.work_order_id)).toEqual([L1.id]);

  const made = await post('tf_ga', 'transfers', { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: sid.VW001, reason: 'G27 流程' });
  const id = made.body.data.id as string;
  // 發起與交出都不搬
  expect((await reqRow(A.req.id)).store_id).toBe(sid.ZT01);
  expect((await post('rq_store_b', `transfers/${id}/handover`, {})).status).toBe(200);
  expect((await reqRow(A.req.id)).store_id).toBe(sid.ZT01);
  expect((await movedRows(eq.id)).length).toBe(0);

  const rec = await post('rq_store_a', `transfers/${id}/receive`, { note: '收到' });
  expect(rec.status).toBe(200);
  expect(rec.body.data).toMatchObject({ status: 'COMPLETED', moved_request_count: 3, unlinked_work_order_count: 1 });

  // DB 回讀：A、B、C 與 A、C 的工單換店；其餘不動
  for (const r of [A, B, C]) expect((await reqRow(r.req.id)).store_id, r.req.request_no).toBe(sid.VW001);
  for (const r of [A, C]) expect((await woRow(r.wo.id)).store_id).toBe(sid.VW001);
  for (const r of [P, D, E, F]) expect((await reqRow(r.req.id)).store_id, r.req.request_no).toBe(sid.ZT01);
  expect((await woRow(L1.id)).store_id).toBe(sid.ZT01);
  expect((await woRow(L2.id)).store_id).toBe(sid.ZT01);
  expect((await woRow(L3.id)).store_id).toBe(sid.ZT01);
  // 狀態不變（待門市確認仍是待門市確認）
  expect((await reqRow(A.req.id)).main_status).toBe('WAITING_STORE_CONFIRMATION');
  expect((await reqRow(B.req.id)).main_status).toBe('WAITING_STORE_SUPPLEMENT');

  // 搬單明細：3 張需求單、2 張工單、1 筆舊式工單（沒搬）
  const rows = await movedRows(eq.id);
  expect(rows.filter((r) => r.kind === 'REQUEST').map((r) => r.doc_no).sort()).toEqual([A.req.request_no, B.req.request_no, C.req.request_no].sort());
  expect(rows.filter((r) => r.kind === 'WORK_ORDER')).toHaveLength(2);
  const un = rows.filter((r) => r.kind === 'UNLINKED_WORK_ORDER');
  expect(un).toHaveLength(1);
  expect(un[0]).toMatchObject({ moved: false, work_order_id: L1.id, from_store_id: sid.ZT01, to_store_id: sid.VW001, transfer_id: id });
  expect(rows.every((r) => r.transfer_id === id && r.asset_event_id)).toBe(true);

  // 時間軸：公開事件、文字固定、沒有多餘事件（不發通知）；沒搬的單沒有事件
  const names = (await db().from('stores').select('id,short_name,store_name').in('id', [sid.ZT01, sid.VW001])).data as any[];
  const nm = (x: string) => { const s = names.find((n) => n.id === x); return (s.short_name || s.store_name) as string; };
  const title = movedTimelineTitle('TRANSFER', nm(sid.ZT01), nm(sid.VW001));
  for (const r of [A, B, C]) {
    const moved = (await reqEvents(r.req.id)).filter((e) => e.event_type === 'ASSET_STORE_MOVED');
    expect(moved, r.req.request_no).toHaveLength(1);
    expect(moved[0]).toMatchObject({ visibility: 'PUBLIC', title, old_status: r.req.main_status, new_status: r.req.main_status });
  }
  for (const r of [P, D]) expect((await reqEvents(r.req.id)).filter((e) => e.event_type === 'ASSET_STORE_MOVED')).toHaveLength(0);
  const woEv = ((await db().from('maintenance_ticket_events').select('*').eq('ticket_id', A.wo.id).eq('event_type', 'STORE_MOVED')).data || []) as any[];
  expect(woEv).toHaveLength(1);
  expect(woEv[0]).toMatchObject({ visibility: 'PUBLIC', description: title });

  // 轉移單詳情可點開看搬了哪幾張單；轉出入雙方店長與總務都看得到
  for (const k of ['tf_ga', 'rq_store_a', 'rq_store_b']) {
    const d = await get(k, `transfers/${id}`);
    expect(d.status, k).toBe(200);
    expect(d.body.data.moved).toHaveLength(6);
    expect(d.body.data.moved.filter((m: any) => m.kind === 'REQUEST')).toHaveLength(3);
  }
  // 設備異動紀錄：換店事件帶搬走張數
  const evApi = await get('tf_ga', `equipment/${eq.id}/events`);
  expect(evApi.body.data.find((e: any) => e.event_type === 'STORE_TRANSFER')).toMatchObject({ moved_request_count: 3, unlinked_work_order_count: 1 });

  // 新店店長接手：看得到並能對單留言；舊店店長看不到進行中的單，只剩已結案、添購
  const newMgr = apis.rq_store_a;
  const oldMgr = apis.rq_store_b;
  expect((await j(await newMgr.get(`${BASE}/requests/${A.req.id}`))).status).toBe(200);
  const detail = await j(await newMgr.get(`${BASE}/requests/${A.req.id}`));
  expect(detail.body.events.map((e: any) => e.title)).toContain(title);
  expect((await j(await oldMgr.get(`${BASE}/requests/${A.req.id}`))).status).toBeGreaterThanOrEqual(403);
  expect((await j(await oldMgr.get(`${BASE}/requests/${B.req.id}`))).status).toBeGreaterThanOrEqual(403);
  for (const r of [P, D, E, F]) expect((await j(await oldMgr.get(`${BASE}/requests/${r.req.id}`))).status, r.req.request_no).toBe(200);
  const mineOld = await j(await oldMgr.get(`${BASE}/reports/mine?pageSize=100`));
  const mineNew = await j(await newMgr.get(`${BASE}/reports/mine?pageSize=100`));
  const idsOld = (mineOld.body.data || []).map((r: any) => r.id);
  const idsNew = (mineNew.body.data || []).map((r: any) => r.id);
  for (const r of [A, B, C]) { expect(idsOld).not.toContain(r.req.id); expect(idsNew).toContain(r.req.id); }
  for (const r of [P, D, E, F]) expect(idsOld).toContain(r.req.id);

  // 冪等：重複確認收到 409，不會再搬、不會多寫事件
  expect((await post('rq_store_a', `transfers/${id}/receive`, {})).status).toBe(409);
  expect((await movedRows(eq.id)).length).toBe(6);
  expect((await reqEvents(A.req.id)).filter((e) => e.event_type === 'ASSET_STORE_MOVED')).toHaveLength(1);
});

test('更正所屬門市也搬（事件標「更正」）；只搬維修類未結案；設施同規則；預覽與結果一致', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27-更正');
  const A = await mkRequest('ZT01', { equipmentId: eq.id }, 'ACCEPTED', { workOrder: true });
  const P = await mkRequest('ZT01', { equipmentId: eq.id }, 'IN_PROGRESS', { type: 'PURCHASE_SUPPLEMENT' });
  const D = await mkRequest('ZT01', { equipmentId: eq.id }, 'COMPLETED');
  const L1 = await mkLegacy('ZT01', `舊工單${eq.name}`);
  const pre = (await get('tf_ga', `equipment/${eq.id}/open-orders`)).body.data;
  expect(pre).toMatchObject({ moving_count: 1, staying_count: 1, unlinked_count: 1, open_count: 2 });
  const ver = (await db().from('ga_equipment').select('updated_at').eq('id', eq.id).single()).data as any;
  const r = await post('tf_ga', `equipment/${eq.id}/correct-store`, { to_store_id: sid.VW001, reason: 'G27 建檔選錯', expected_updated_at: ver.updated_at });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ to_store_id: sid.VW001, moved_request_count: 1, unlinked_work_order_count: 1 });
  expect((await reqRow(A.req.id)).store_id).toBe(sid.VW001);
  expect((await woRow(A.wo.id)).store_id).toBe(sid.VW001);
  expect((await reqRow(P.req.id)).store_id).toBe(sid.ZT01);
  expect((await reqRow(D.req.id)).store_id).toBe(sid.ZT01);
  expect((await woRow(L1.id)).store_id).toBe(sid.ZT01);
  const ev = (await reqEvents(A.req.id)).find((e) => e.event_type === 'ASSET_STORE_MOVED');
  expect(ev).toMatchObject({ visibility: 'PUBLIC' });
  expect(ev.title).toMatch(/^因設備所屬門市更正，由 .+ 轉到 .+$/);
  const rows = await movedRows(eq.id);
  expect(rows).toHaveLength(3);
  expect(rows.every((m) => m.transfer_id === null && m.asset_event_id)).toBe(true);
  const evApi = await get('tf_ga', `equipment/${eq.id}/events`);
  expect(evApi.body.data.find((e: any) => e.event_type === 'STORE_CORRECTION')).toMatchObject({ moved_request_count: 1, unlinked_work_order_count: 1 });
  // 搬走後原店店長（rq_store_b）看不到，新店看得到
  expect((await j(await apis.rq_store_b.get(`${BASE}/requests/${A.req.id}`))).status).toBeGreaterThanOrEqual(403);
  expect((await j(await apis.rq_store_a.get(`${BASE}/requests/${A.req.id}`))).status).toBe(200);

  // 設施同規則（VW001 → ZT01 轉移）
  const fac = await seedFacility('VW001', facCat.id, 'G27-設施');
  const FA = await mkRequest('VW001', { facilityId: fac.id }, 'WAITING_STORE_CONFIRMATION', { workOrder: true });
  const FD = await mkRequest('VW001', { facilityId: fac.id }, 'CANCELED');
  const { rec } = await doTransfer('FACILITY', fac.id, 'ZT01', 'VW001');
  expect(rec.status).toBe(200);
  expect(rec.body.data).toMatchObject({ moved_request_count: 1 });
  expect((await reqRow(FA.req.id)).store_id).toBe(sid.ZT01);
  expect((await woRow(FA.wo.id)).store_id).toBe(sid.ZT01);
  expect((await reqRow(FD.req.id)).store_id).toBe(sid.VW001);
});

test('沒有進行中的單：照常換店，搬走 0 張，明細為空；轉移前（未完成）明細不顯示任何搬走紀錄', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27-空');
  const made = await post('tf_ga', 'transfers', { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: sid.VW001, reason: 'G27 空' });
  const id = made.body.data.id as string;
  expect((await get('tf_ga', `transfers/${id}`)).body.data.moved).toEqual([]);
  await post('rq_store_b', `transfers/${id}/handover`, {});
  const rec = await post('rq_store_a', `transfers/${id}/receive`, {});
  expect(rec.body.data).toMatchObject({ status: 'COMPLETED', moved_request_count: 0, unlinked_work_order_count: 0 });
  expect((await db().from('ga_equipment').select('store_id').eq('id', eq.id).single()).data).toMatchObject({ store_id: sid.VW001 });
  expect((await get('tf_ga', `transfers/${id}`)).body.data.moved).toEqual([]);
  // 取消的轉移單不搬任何單
  const eq2 = await seedEquipment('ZT01', eqCat.id, 'G27-取消');
  const R = await mkRequest('ZT01', { equipmentId: eq2.id }, 'IN_PROGRESS');
  const m2 = await post('tf_ga', 'transfers', { assetType: 'EQUIPMENT', assetId: eq2.id, toStoreId: sid.VW001, reason: 'G27 取消' });
  expect((await post('tf_ga', `transfers/${m2.body.data.id}/cancel`, { reason: '不轉了' })).status).toBe(200);
  expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
  expect(await movedRows(eq2.id)).toEqual([]);
});

test('權限矩陣、Origin、400、404：預覽、轉移單明細、搬單入口都不能繞過', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27-權限');
  const R = await mkRequest('ZT01', { equipmentId: eq.id }, 'IN_PROGRESS');
  // 預覽（open-orders）：設備查看或管理可看；沒有權限 403；未登入 401
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get(`${BASE}/equipment/${eq.id}/open-orders`)).status()).toBe(401);
  await anon.dispose();
  for (const k of ['tf_ga', 'tf_view', 'eq_manage']) expect((await get(k, `equipment/${eq.id}/open-orders`)).status, k).toBe(200);
  for (const k of ['nobody', 'rq_store_a']) expect((await get(k, `equipment/${eq.id}/open-orders`)).status, k).toBe(403);
  expect((await get('tf_ga', 'equipment/not-a-uuid/open-orders')).status).toBe(400);
  expect((await get('tf_ga', 'equipment/00000000-0000-4000-8000-000000000000/open-orders')).status).toBe(404);

  // 更正所屬門市：設備查看者與店長不能做（不能搬單）；Origin 不符 403；缺原因 400；同店 400
  const ver = (await db().from('ga_equipment').select('updated_at').eq('id', eq.id).single()).data as any;
  const body = { to_store_id: sid.VW001, reason: 'G27', expected_updated_at: ver.updated_at };
  expect((await j(await apis.tf_ga.post(`${BASE}/equipment/${eq.id}/correct-store`, { data: body, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const k of ['tf_view', 'rq_store_b', 'nobody']) expect((await post(k, `equipment/${eq.id}/correct-store`, body)).status, k).toBe(403);
  expect((await post('tf_ga', `equipment/${eq.id}/correct-store`, { ...body, reason: ' ' })).status).toBe(400);
  expect((await post('tf_ga', `equipment/${eq.id}/correct-store`, { ...body, to_store_id: sid.ZT01 })).status).toBe(400);
  expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01); // 被擋的都沒搬
  expect(await movedRows(eq.id)).toEqual([]);
  // 舊版本 409 STALE
  const stale = await post('tf_ga', `equipment/${eq.id}/correct-store`, { ...body, expected_updated_at: '2000-01-01T00:00:00Z' });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);

  // 轉移收到：Origin 不符 403；總務不能代替店長；轉出店店長不能收；搬單函式不對登入者開放
  const made = await post('tf_ga', 'transfers', { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: sid.VW001, reason: 'G27 權限' });
  const id = made.body.data.id as string;
  await post('rq_store_b', `transfers/${id}/handover`, {});
  expect((await j(await apis.rq_store_a.post(`${BASE}/transfers/${id}/receive`, { data: {}, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const k of ['tf_ga', 'rq_store_b']) expect((await post(k, `transfers/${id}/receive`, {})).status, k).toBe(403);
  expect((await post('nobody', `transfers/${id}/receive`, {})).status).toBe(404); // 看不到這張單（列級權限），一樣不能收
  expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
  const direct = await users.rq_store_a.client.rpc('ga_ws_asset_move_open_requests', { p_type: 'EQUIPMENT', p_asset_id: eq.id, p_from: sid.ZT01, p_to: sid.VW001, p_transfer_id: null, p_event_id: null, p_actor: users.rq_store_a.id, p_mode: 'TRANSFER' });
  expect(direct.error).not.toBeNull(); // 內部函式不開放給登入者直接呼叫
  expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
  // 轉移單明細：沒有權限也不是雙方店長 -> 不會看到搬單明細（詳情本身 403）
  expect((await get('nobody', `transfers/${id}`)).status).toBe(403);
  const moved = await users.tf_view.client.rpc('ga_ws_asset_moved_list', { p_transfer_id: id, p_type: null, p_asset_id: null });
  expect(moved.data.ok).toBe(true); // 設備查看者可看
  const none = await users.nobody.client.rpc('ga_ws_asset_moved_list', { p_transfer_id: id, p_type: null, p_asset_id: null });
  expect(none.data).toMatchObject({ ok: false, status: 403 });
  const bad = await users.tf_view.client.rpc('ga_ws_asset_moved_list', { p_transfer_id: null, p_type: null, p_asset_id: null });
  expect(bad.data).toMatchObject({ ok: false, status: 400 });
  // 收尾：由正確的店長收到
  expect((await post('rq_store_a', `transfers/${id}/receive`, {})).status).toBe(200);
  expect((await reqRow(R.req.id)).store_id).toBe(sid.VW001);
});

test('併發與 STALE：搬走之後，持舊版本的人去改需求單會被 409 擋下；搬單鎖列，兩張單同時收到不重複搬', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27-併發');
  const A = await mkRequest('ZT01', { equipmentId: eq.id }, 'WAITING_STORE_CONFIRMATION', { workOrder: true });
  const oldVer = (await reqRow(A.req.id)).updated_at as string;
  const { rec } = await doTransfer('EQUIPMENT', eq.id, 'VW001', 'ZT01');
  expect(rec.status).toBe(200);
  const newVer = (await reqRow(A.req.id)).updated_at as string;
  expect(newVer).not.toBe(oldVer); // 換店會更新版本，其他人畫面上的舊版本因此失效
  const stale = await j(await apis.tf_ga.patch(`${BASE}/requests/${A.req.id}`, { data: { action: 'update_progress', expected_updated_at: oldVer, public_progress: '舊版本寫入' } }));
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await reqRow(A.req.id)).public_progress).not.toBe('舊版本寫入');
  // 兩個店長同時按「確認收到」同一張單：只有一個成功、只搬一次
  const eq2 = await seedEquipment('ZT01', eqCat.id, 'G27-雙收');
  const R = await mkRequest('ZT01', { equipmentId: eq2.id }, 'IN_PROGRESS', { workOrder: true });
  const made = await post('tf_ga', 'transfers', { assetType: 'EQUIPMENT', assetId: eq2.id, toStoreId: sid.VW001, reason: 'G27 併發' });
  const id = made.body.data.id as string;
  await post('rq_store_b', `transfers/${id}/handover`, {});
  const both = await Promise.all([post('rq_store_a', `transfers/${id}/receive`, {}), post('rq_store_a', `transfers/${id}/receive`, {})]);
  expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
  expect((await movedRows(eq2.id)).filter((m) => m.kind === 'REQUEST')).toHaveLength(1);
  expect((await reqEvents(R.req.id)).filter((e) => e.event_type === 'ASSET_STORE_MOVED')).toHaveLength(1);
});

test('舊式工單清單的判斷：要同店、未完成、資源類型相符、標題提到資產編號或名稱；已連到需求單的不算', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27-判斷');
  const code = `G27${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await db().from('ga_equipment').update({ asset_code: code }).eq('id', eq.id);
  const hit1 = await mkLegacy('ZT01', `報修 ${code} 無法開機`);
  const hit2 = await mkLegacy('ZT01', `${eq.name} 異音`);
  const otherStore = await mkLegacy('VW001', `${eq.name} 在別家店`);
  const done = await mkLegacy('ZT01', `${eq.name} 已完成`, 'COMPLETED');
  const wrongType = (await db().from('maintenance_requests').insert({ store_id: sid.ZT01, title: m7Name(`G27-設施類 ${eq.name}`), description: 'x', reported_by: users.rq_store_b.id, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING', resource_type: 'facility' }).select('*').single()).data as any;
  const linked = await mkRequest('ZT01', { equipmentId: eq.id }, 'IN_PROGRESS', { workOrder: true });
  const pre = (await get('tf_ga', `equipment/${eq.id}/open-orders`)).body.data;
  const ids = pre.unlinked_work_orders.map((w: any) => w.work_order_id).sort();
  expect(ids).toEqual([hit1.id, hit2.id].sort());
  for (const x of [otherStore, done, wrongType]) expect(ids).not.toContain(x.id);
  expect(ids).not.toContain(linked.wo.id);
  // 純函式與資料庫判斷一致
  const asset = { type: 'EQUIPMENT' as const, store_id: sid.ZT01, code, name: eq.name as string };
  const wo = (r: any) => ({ ga_service_request_id: r.ga_service_request_id, store_id: r.store_id, status: r.status, resource_type: r.resource_type, title: r.title, description: r.description });
  for (const [r, want] of [[hit1, true], [hit2, true], [otherStore, false], [done, false], [wrongType, false], [linked.wo, false]] as const) expect(legacyWorkOrderMatches(wo(r), asset), String(r.title)).toBe(want);
  expect(isMovableRequest({ request_type: 'REPAIR', main_status: 'WAITING_STORE_CONFIRMATION' })).toBe(true);
  expect(isMovableRequest({ request_type: 'REPAIR', main_status: 'COMPLETED' })).toBe(false);
  expect(isMovableRequest({ request_type: 'PURCHASE_SUPPLEMENT', main_status: 'IN_PROGRESS' })).toBe(false);
});
