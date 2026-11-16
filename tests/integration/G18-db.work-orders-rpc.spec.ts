import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { adminDb, callFn, cleanupM7M8, m7Name, M7_FILE_PREFIX, seedBalance, seedCategory, seedLocation, seedLocationPart, seedMaintenanceCategory, seedPart, seedWorkOrder, assertGaBaseline, stores } from '../support/m7m8-fixtures';
import { anonClient, setupPoUsers, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 5 批 G18（資料庫層）工單 RPC 整合：ga_ws_wo_list／get／summary／print／transition／store_confirm／report_unresolved／reply_supplement／delete／create_legacy／category／issue_part，
// 以及第 4 批 ga_ws_req_transition／ga_ws_req_store_action 的補資料與送確認同步（W1）。
// 涵蓋：權限矩陣（未登入、只有各種 view_all 不能改、管理員沒有角色只能看、缺哪個權限講清楚）、流轉表（允許與禁止）、有填才更新、需求單護欄（已完成／退回／取消不翻回）、INTERNAL 不外洩、
//      強制結案原因僅內部可見、補資料往返、領用料件（庫存扣減、流水參照工單、冪等、超庫存、缺權限）、刪除規則與附件只標記、新增舊式回報（照片規則與冪等）、改分類、
//      列表分頁精確筆數與搜尋跳脫與焦點卡、摘要、列印資料、RLS 收緊後直連行為，以及 BEGIN…ROLLBACK 的資料庫層測試（FK 連帶刪除、階段常數對齊、函式授權與 search_path）。
// 測試資料：名稱與標題一律帶 [自動測試]M7M8 標記、只用 VW／ZT 測試門市；結束只清自己的（cleanupM7M8 含工單附件、舊照片檔、測試分類）。
test.describe.configure({ mode: 'serial' });

const root = path.resolve(__dirname, '..', '..');
const KEYS: PoKey[] = ['wo_works', 'wo_works_notxn', 'wo_works_nopart', 'wo_manager', 'wo_update_noforce', 'wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_mr_update', 'wo_cross_update',
  'wo_store_a', 'wo_store_a2', 'wo_store_b', 'wo_store_a_viewonly', 'wo_cross_store_a', 'wo_outsider_own', 'nobody', 'admin', 'rq_staff'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let part: any;
let loc: any;
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const fn = (who: PoKey, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).maybeSingle()).data as any;
const upd = async (id: string) => (await woRow(id)).updated_at as string;
const reqRow = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const updatesOf = async (id: string) => ((await db().from('maintenance_updates').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
const eventsOf = async (id: string) => ((await db().from('maintenance_ticket_events').select('*').eq('ticket_id', id).order('created_at').order('id')).data || []) as any[];
const reqEvents = async (id: string) => ((await db().from('ga_service_request_events').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
/** 直接寫入工單（預設門市 VW001、回報人 wo_store_a）。 */
const wo = (suffix: string, over: Record<string, unknown> = {}, store = 'VW001', reporter = 'wo_store_a') => seedWorkOrder(store, `${suffix}-${(seq += 1)}`, users[reporter].id, over);
/** 已受理且處理中的工單。 */
const open = (suffix: string, over: Record<string, unknown> = {}, store = 'VW001') => wo(suffix, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString(), ...over }, store);
/** 需求單＋連結的工單（需求單 IN_PROGRESS、工單處理中；可覆寫）。 */
async function linked(suffix: string, reqStatus = 'IN_PROGRESS', woOver: Record<string, unknown> = {}, reqOver: Record<string, unknown> = {}) {
  const s = await stores();
  const r = (await db().from('ga_service_requests').insert({ store_id: s.VW001.id, created_by: users.wo_store_a.id, request_type: 'REPAIR', title: m7Name(`REQ-${suffix}-${(seq += 1)}`), description: 'm7m8 工單測試',
    main_status: reqStatus, intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS', ...reqOver }).select('*').single()).data as any;
  const w = await open(`WO-${suffix}`, { ga_service_request_id: r.id, ...woOver });
  await db().from('ga_service_requests').update({ maintenance_request_id: w.id }).eq('id', r.id);
  return { r: await reqRow(r.id), w: await woRow(w.id) };
}
/** 以 ga_ws_wo_create_legacy 建立舊式回報（含 n 張已上傳到儲存空間的圖片）；回傳工單列與照片路徑。 */
async function legacy(who: PoKey, suffix: string, n = 0, storeCode = 'VW001') {
  const s = await stores();
  const id = crypto.randomUUID();
  const atts: any[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = `maintenance_request/${id}/${M7_FILE_PREFIX}${suffix.toLowerCase()}-${i}.png`;
    const up = await db().storage.from('general-affairs-attachments').upload(p, PNG, { contentType: 'image/png', upsert: true });
    if (up.error) throw new Error(`上傳測試圖片失敗：${up.error.message}`);
    atts.push({ storage_path: p, file_name: `${M7_FILE_PREFIX}${suffix.toLowerCase()}-${i}.png`, content_type: 'image/png', size_bytes: PNG.length });
  }
  const r = await fn(who, 'ga_ws_wo_create_legacy', { p_payload: { id, store_id: s[storeCode].id, title: m7Name(`${suffix}-${(seq += 1)}`), description: 'm7m8 舊式回報', attachments: atts }, p_key: crypto.randomUUID() });
  if (!r.ok) throw new Error(`建立舊式回報失敗：${JSON.stringify(r)}`);
  return { w: await woRow(id), paths: atts.map((a) => a.storage_path as string) };
}
const tr = async (who: PoKey, w: any, action: string, payload: Record<string, unknown> = {}, expected?: string) =>
  fn(who, 'ga_ws_wo_transition', { p_id: w.id, p_action: action, p_expected_updated_at: expected ?? (await upd(w.id)), p_payload: payload });
const save = (who: PoKey, w: any, payload: Record<string, unknown> = {}) => tr(who, w, 'SAVE_PROGRESS', { notes: '現場評估中', ...payload });

function runSqlDo(body: string, tag: string): string {
  const sql = `DO $$\n${body}\nEND $$;`;
  const file = path.join(os.tmpdir(), `g18db-${tag}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql);
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
  const made = await setupPoUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  const cat = await seedCategory('part', 'WO');
  part = await seedPart(cat.id, 'WO-P1');
  loc = await seedLocation(null, 'WO-W');
  await seedLocationPart(loc.id, part.id);
  await seedBalance(loc.id, part.id, 10);
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件、舊照片檔、測試分類）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const left = await db().from('maintenance_requests').select('id', { count: 'exact', head: true }).like('title', '[自動測試]M7M8 T%');
  expect(left.count, '工單殘留').toBe(0);
});

// ----------------------------------------------------------------------------- 權限矩陣
test('權限矩陣（未登入與內部函式）：未登入全部拒絕；內部輔助函式不能被登入者直接呼叫', async () => {
  const anon = anonClient();
  const w = await open('ANON');
  const now = new Date().toISOString();
  for (const [name, args] of [
    ['ga_ws_wo_list', {}], ['ga_ws_wo_get', { p_id: w.id }], ['ga_ws_wo_summary', {}], ['ga_ws_wo_print', { p_id: w.id }],
    ['ga_ws_wo_transition', { p_id: w.id, p_action: 'SAVE_PROGRESS', p_expected_updated_at: now, p_payload: {} }], ['ga_ws_wo_store_confirm', { p_id: w.id, p_note: null, p_expected_updated_at: now }],
    ['ga_ws_wo_report_unresolved', { p_id: w.id, p_reason: 'x', p_expected_updated_at: now }], ['ga_ws_wo_reply_supplement', { p_id: w.id, p_note: 'x', p_expected_updated_at: now }],
    ['ga_ws_wo_delete', { p_id: w.id, p_expected_updated_at: now }], ['ga_ws_wo_create_legacy', { p_payload: {}, p_key: 'x' }], ['ga_ws_wo_category', { p_id: w.id, p_category_id: null, p_expected_updated_at: now }],
    ['ga_ws_wo_issue_part', { p_id: w.id, p_location_id: loc.id, p_part_id: part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: null, p_notes: null, p_key: 'k', p_expected_updated_at: now }],
  ] as [string, Record<string, unknown>][]) {
    const r = await callFn(anon, name, args);
    expect(r.ok, `${name} 未登入`).toBe(false);
    expect([0, 401], `${name} 未登入`).toContain(r.status);
  }
  for (const [name, args] of [
    ['ga_wo_row', { p_id: w.id, p_ga: true }], ['ga_wo_no', { p_id: w.id }], ['ga_wo_can_update', { p_uid: users.wo_works.id }], ['ga_wo_sync_request', { p_wo_id: w.id, p_kind: 'PROGRESS', p_text: 'x', p_vis: 'PUBLIC', p_uid: users.wo_works.id }],
    ['ga_wo_apply_completion_request', { p_wo: w.id, p_uid: users.wo_works.id, p_text: 'x' }], ['ga_wo_abilities', { p_id: w.id, p_uid: users.wo_works.id }],
  ] as [string, Record<string, unknown>][]) {
    const r = await callFn(users.wo_works.client, name, args);
    expect(r.ok === false || r.status === 0, `${name} 不可被登入者呼叫`).toBe(true);
    expect(r.status ?? 0).toBe(0);
  }
});

test('權限矩陣（讀）：沒權限 403；只有 view_all 類可看全部；店長只看自己門市；管理員沒有角色看不到', async () => {
  const a = await wo('READ-A');
  const b = await wo('READ-B', {}, 'ZT01', 'wo_store_b');
  const ids = async (who: PoKey) => {
    const r = await fn(who, 'ga_ws_wo_list', { p_filters: { q: 'READ-' }, p_page: 1, p_page_size: 100 });
    return { r, ids: (r.data?.rows || []).map((x: any) => x.id) as string[] };
  };
  for (const k of ['nobody', 'admin', 'rq_staff'] as PoKey[]) {
    for (const [name, args] of [['ga_ws_wo_list', {}], ['ga_ws_wo_summary', {}], ['ga_ws_wo_get', { p_id: a.id }], ['ga_ws_wo_print', { p_id: a.id }]] as [string, Record<string, unknown>][]) {
      const r = await fn(k, name, args);
      expect(r.status, `${k} ${name}`).toBe(403);
      expect(r.code).toBe('PERMISSION_DENIED');
    }
  }
  for (const k of ['wo_works', 'wo_manager', 'wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_mr_update', 'wo_cross_update'] as PoKey[]) {
    const { r, ids: got } = await ids(k);
    expect(r.status, k).toBe(200);
    expect(got, `${k} 看得到全部門市`).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await fn(k, 'ga_ws_wo_get', { p_id: b.id })).status, `${k} get`).toBe(200);
  }
  // 店長：只有自己門市（含回報人本人）；沒有查看全部
  for (const k of ['wo_store_a', 'wo_store_a2', 'wo_store_a_viewonly'] as PoKey[]) {
    const { got } = await ids(k).then((x) => ({ got: x.ids }));
    expect(got, `${k} 只看自己門市`).toContain(a.id);
    expect(got, `${k} 看不到別間門市`).not.toContain(b.id);
    expect((await fn(k, 'ga_ws_wo_get', { p_id: b.id })).status, `${k} 不能看別間`).toBe(404);
  }
  expect((await fn('wo_store_b', 'ga_ws_wo_get', { p_id: a.id })).status).toBe(404);
  // 有查看自己門市權限但不在任何門市名單、也不是回報人：空清單，不是 403
  const out = await fn('wo_outsider_own', 'ga_ws_wo_list', { p_filters: { q: 'READ-' } });
  expect(out.status).toBe(200);
  expect(out.data.total).toBe(0);
  // 非總務端：處理人與內部欄位遮蔽
  const own = await fn('wo_store_a', 'ga_ws_wo_get', { p_id: a.id });
  expect(own.data.ga_side).toBe(false);
  expect(Object.keys(own.data.work_order)).not.toEqual(expect.arrayContaining(['assignee_name', 'handling_method', 'vendor_id']));
  const ga = await fn('wo_works', 'ga_ws_wo_get', { p_id: a.id });
  expect(Object.keys(ga.data.work_order)).toEqual(expect.arrayContaining(['assignee_name', 'handling_method', 'vendor_id']));
});

test('權限矩陣（寫）：只有各種 view_all 不能改；更新或管理可以；管理員沒有角色只能看；缺哪個權限講清楚', async () => {
  const w = await open('WRITE');
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall'] as PoKey[]) {
    const r = await save(k, w);
    expect(r.status, k).toBe(403);
    expect(r.code).toBe('PERMISSION_DENIED');
    expect(r.error).toContain('只有查看工單的權限');
  }
  const adm = await save('admin', w);
  expect(adm.status).toBe(403);
  const nob = await save('nobody', w);
  expect(nob.status).toBe(403);
  expect(nob.error).toContain('沒有修改工單的權限');
  for (const k of ['wo_store_a', 'wo_store_b'] as PoKey[]) expect((await save(k, w)).status, k).toBe(403);
  expect(await woRow(w.id)).toMatchObject({ updated_at: w.updated_at });
  for (const k of ['wo_works', 'wo_manager', 'wo_update_noforce', 'wo_mr_update', 'wo_cross_update'] as PoKey[]) {
    const r = await save(k, w, { notes: `${k} 更新` });
    expect(r.ok, `${k}: ${JSON.stringify(r)}`).toBe(true);
  }
  // 其他寫入函式同樣需要更新權限
  for (const [name, args] of [
    ['ga_ws_wo_category', { p_id: w.id, p_category_id: null, p_expected_updated_at: await upd(w.id) }],
  ] as [string, Record<string, unknown>][]) {
    expect((await fn('wo_viewall', name, args)).status, `viewall ${name}`).toBe(403);
    expect((await fn('wo_store_a', name, args)).status, `store ${name}`).toBe(403);
  }
  // 強制結案：更新權限＋強制結案權限，缺強制結案講清楚
  const fc = await tr('wo_update_noforce', w, 'FORCE_CLOSE', { force_close_reason: '測試' });
  expect(fc.status).toBe(403);
  expect(fc.code).toBe('FORCE_CLOSE_PERMISSION_REQUIRED');
  expect(fc.error).toContain('強制結案');
  expect((await tr('wo_viewall', w, 'FORCE_CLOSE', { force_close_reason: '測試' })).status).toBe(403);
});

// ----------------------------------------------------------------------------- 存進度
test('存進度：有填才更新（不覆蓋承辦人、處理方式、廠商）；未受理自動受理；執行類階段推成處理中；版本衝突 409；參數 400', async () => {
  const cat = await seedMaintenanceCategory('C1');
  const w = await wo('PROG', {}, 'VW001');
  expect(w.status).toBe('UNACCEPTED');
  // 未受理 + 存進度（沒指定階段）→ 已受理＋初步評估；accepted_at/by 寫入；承辦人只在有給時才寫
  const r1 = await save('wo_works', w, { assignee_name: '王師傅', handling_method: '總務自行處理', category_id: cat.id });
  expect(r1.ok, JSON.stringify(r1)).toBe(true);
  let row = await woRow(w.id);
  expect(row).toMatchObject({ status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW', assignee_name: '王師傅', handling_method: '總務自行處理', category_id: cat.id, accepted_by: users.wo_works.id });
  expect(row.accepted_at).not.toBeNull();
  // 再存一次（什麼承辦資料都不帶）：承辦人、處理方式、分類都不變；階段選執行類 → 處理中
  const r2 = await save('wo_manager', w, { progress_stage: 'VENDOR_WORKING', notes: '廠商施工中' });
  expect(r2.ok, JSON.stringify(r2)).toBe(true);
  row = await woRow(w.id);
  expect(row).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', assignee_name: '王師傅', handling_method: '總務自行處理', category_id: cat.id, accepted_by: users.wo_works.id });
  // 留白欄位視為沒填；assignee_id 有給但沒給名字 → 名字取該人姓名
  const r3 = await save('wo_works', w, { assignee_name: '  ', handling_method: '', vendor_id: '', assignee_id: users.wo_works.id });
  expect(r3.ok).toBe(true);
  row = await woRow(w.id);
  expect(row.handling_method).toBe('總務自行處理');
  expect(row.assignee_id).toBe(users.wo_works.id);
  const prof = (await db().from('profiles').select('full_name').eq('id', users.wo_works.id).single()).data as any;
  expect(row.assignee_name).toBe(prof.full_name); // 新給承辦人 id 沒給名字：名字取該人姓名；名字留白不會把原本的名字清掉
  // 進度紀錄與事件
  const ups = await updatesOf(w.id);
  expect(ups).toHaveLength(3);
  expect(ups[1]).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', visibility: 'PUBLIC', notes: '廠商施工中', updated_by: users.wo_manager.id });
  const evs = await eventsOf(w.id);
  expect(evs.map((e) => e.event_type)).toEqual(['SAVE_PROGRESS', 'SAVE_PROGRESS', 'SAVE_PROGRESS']);
  // 非執行類階段保持原狀態（處理中維持處理中）
  const r4 = await save('wo_works', w, { progress_stage: 'INTERNAL_HANDLING' });
  expect(r4.ok).toBe(true);
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INTERNAL_HANDLING' });
  // 版本衝突、缺版本、參數錯誤
  const stale = await tr('wo_works', w, 'SAVE_PROGRESS', { notes: 'x' }, '2000-01-01T00:00:00+00:00');
  expect(stale).toMatchObject({ ok: false, status: 409, code: 'STALE' });
  expect(await fn('wo_works', 'ga_ws_wo_transition', { p_id: w.id, p_action: 'SAVE_PROGRESS', p_expected_updated_at: null, p_payload: { notes: 'x' } })).toMatchObject({ status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await save('wo_works', w, { notes: '' })).toMatchObject({ status: 400, code: 'NOTES_REQUIRED' });
  expect(await save('wo_works', w, { notes: 'x'.repeat(2001) })).toMatchObject({ status: 400, code: 'NOTES_TOO_LONG' });
  expect(await save('wo_works', w, { progress_stage: 'NOT_A_STAGE' })).toMatchObject({ status: 400, code: 'STAGE_INVALID' });
  expect(await save('wo_works', w, { visibility: 'SECRET' })).toMatchObject({ status: 400, code: 'VISIBILITY_INVALID' });
  expect(await save('wo_works', w, { progress_date: '2038-02-31' })).toMatchObject({ status: 400, code: 'DATE_INVALID' });
  expect(await save('wo_works', w, { category_id: 'not-a-uuid' })).toMatchObject({ status: 400, code: 'ID_INVALID' });
  expect(await tr('wo_works', w, 'EXPLODE', {})).toMatchObject({ status: 400, code: 'INVALID_ACTION' });
  expect(await fn('wo_works', 'ga_ws_wo_transition', { p_id: w.id, p_action: 'SAVE_PROGRESS', p_expected_updated_at: await upd(w.id), p_payload: [1] })).toMatchObject({ status: 400, code: 'PAYLOAD_INVALID' });
  expect(await fn('wo_works', 'ga_ws_wo_transition', { p_id: crypto.randomUUID(), p_action: 'SAVE_PROGRESS', p_expected_updated_at: new Date().toISOString(), p_payload: { notes: 'x' } })).toMatchObject({ status: 404 });
  // 失敗不留痕跡：進度紀錄筆數沒有增加
  expect((await updatesOf(w.id)).length).toBe(4);
  // 不可直接選「待門市確認」，也不可已受理的連結單選「等待門市補充資料」
  expect(await save('wo_works', w, { progress_stage: 'WAITING_STORE_CONFIRMATION' })).toMatchObject({ status: 422, code: 'USE_REQUEST_COMPLETION' });
  const lk = await linked('USE-SUP', 'IN_PROGRESS');
  expect(await save('wo_works', lk.w, { progress_stage: 'WAITING_STORE_INFO' })).toMatchObject({ status: 422, code: 'USE_SUPPLEMENT' });
  // 內部進度：進度紀錄與事件是 INTERNAL，需求單公開文字只有「維修工單已更新，目前狀態」，不洩漏內容；需求單進處理中
  const secret = '內部機密備註-不可外洩';
  const ri = await save('wo_works', lk.w, { progress_stage: 'VENDOR_WORKING', visibility: 'INTERNAL', notes: secret });
  expect(ri.ok, JSON.stringify(ri)).toBe(true);
  const rq = await reqRow(lk.r.id);
  expect(rq.main_status).toBe('IN_PROGRESS');
  expect(rq.public_progress).toBe('維修工單已更新，目前狀態：廠商施工中。');
  expect(JSON.stringify(await reqEvents(lk.r.id))).not.toContain(secret);
  const lastEv = (await reqEvents(lk.r.id)).filter((e) => e.event_type === 'WORK_ORDER_PROGRESS_SYNCED').pop();
  expect(lastEv).toMatchObject({ visibility: 'INTERNAL' });
  // 公開進度：需求單公開文字帶說明
  const rp = await save('wo_works', lk.w, { progress_stage: 'WAITING_PARTS', notes: '等料件到貨' });
  expect(rp.ok).toBe(true);
  expect((await reqRow(lk.r.id)).public_progress).toBe('維修工單進度更新：等待料件。等料件到貨');
  // 店長看不到內部進度與處理人
  const store = await fn('wo_store_a', 'ga_ws_wo_get', { p_id: lk.w.id });
  expect(JSON.stringify(store.data)).not.toContain(secret);
  expect(store.data.timeline.every((t: any) => t.visibility === 'PUBLIC')).toBe(true);
  const gaView = await fn('wo_works', 'ga_ws_wo_get', { p_id: lk.w.id });
  expect(JSON.stringify(gaView.data.timeline)).toContain(secret);
});

test('流轉表：已完成不能存進度（連結單提示到需求單重新開啟、舊式單提示不能重新開啟）；待門市確認與等補資料期間不能存；未受理不能送確認', async () => {
  const done = await wo('DONE', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED', completed_at: new Date().toISOString() });
  const r = await save('wo_works', done);
  expect(r).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(r.error).toContain('不能重新開啟');
  const dl = await linked('DONE-L', 'COMPLETED', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED' });
  expect((await save('wo_works', dl.w)).error).toContain('重新開啟');
  expect(await tr('wo_works', done, 'REQUEST_COMPLETION', {})).toMatchObject({ status: 409 });
  expect(await tr('wo_manager', done, 'FORCE_CLOSE', { force_close_reason: 'x' })).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(await tr('wo_works', done, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' })).toMatchObject({ status: 409 });
  const waiting = await open('WAITING', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect(await save('wo_works', waiting)).toMatchObject({ status: 409, code: 'WAITING_STORE_CONFIRMATION' });
  expect(await tr('wo_works', waiting, 'REQUEST_COMPLETION', {})).toMatchObject({ status: 409, code: 'WAITING_STORE_CONFIRMATION' });
  expect(await tr('wo_works', waiting, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' })).toMatchObject({ status: 409 });
  const un = await wo('UNACC');
  expect(await tr('wo_works', un, 'REQUEST_COMPLETION', {})).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(await tr('wo_manager', un, 'FORCE_CLOSE', { force_close_reason: 'x' })).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(await tr('wo_works', un, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' })).toMatchObject({ status: 409 });
  // 每個失敗都沒有寫入
  for (const x of [done, dl.w, waiting, un]) expect(await woRow(x.id)).toMatchObject({ status: x.status, progress_stage: x.progress_stage, updated_at: x.updated_at });
});

test('需求單護欄：需求單已完成、退回、取消時工單存進度只記在工單、不翻回；待總務複核與待補資料期間也不翻轉需求單', async () => {
  for (const st of ['COMPLETED', 'REJECTED', 'CANCELED', 'WAITING_GA_REVIEW']) {
    const lk = await linked(`GUARD-${st}`, st);
    const before = await reqRow(lk.r.id);
    const r = await save('wo_works', lk.w, { progress_stage: 'VENDOR_WORKING', notes: '廠商施工' });
    expect(r.ok, `${st}: ${JSON.stringify(r)}`).toBe(true);
    const after = await reqRow(lk.r.id);
    expect(after.main_status, st).toBe(st);
    expect(after.public_progress, st).toBe(before.public_progress);
    expect(await woRow(lk.w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
    expect((await updatesOf(lk.w.id)).length).toBe(1);
  }
  // 需求單在待門市補資料：工單（等待門市補充資料階段）不能存進度
  const lk2 = await linked('GUARD-SUP', 'WAITING_STORE_SUPPLEMENT', { progress_stage: 'WAITING_STORE_INFO' });
  expect(await save('wo_works', lk2.w)).toMatchObject({ status: 409, code: 'WAITING_STORE_SUPPLEMENT' });
  expect(await tr('wo_works', lk2.w, 'REQUEST_COMPLETION', {})).toMatchObject({ status: 409, code: 'WAITING_STORE_SUPPLEMENT' });
  // 已受理需求單（ACCEPTED）→ 存進度後進處理中
  const lk3 = await linked('GUARD-ACC', 'ACCEPTED');
  expect((await save('wo_works', lk3.w, { progress_stage: 'SEARCHING_VENDOR' })).ok).toBe(true);
  expect((await reqRow(lk3.r.id)).main_status).toBe('IN_PROGRESS');
  // 需求單已刪除（deleted_at）→ 只記工單
  const lk4 = await linked('GUARD-DEL', 'IN_PROGRESS');
  await db().from('ga_service_requests').update({ deleted_at: new Date().toISOString() }).eq('id', lk4.r.id);
  expect((await save('wo_works', lk4.w)).ok).toBe(true);
});

// ----------------------------------------------------------------------------- 送門市確認與門市回覆
test('送門市確認：工單與需求單同交易；舊式單不再報錯；與第 4 批需求單端送確認結果一致（共用同一個內部函式）', async () => {
  const lk = await linked('REQC', 'IN_PROGRESS');
  const r = await tr('wo_works', lk.w, 'REQUEST_COMPLETION', { notes: '已更換完畢' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const w1 = await woRow(lk.w.id);
  expect(w1).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_requested_by: users.wo_works.id });
  expect(w1.completion_requested_at).not.toBeNull();
  const q1 = await reqRow(lk.r.id);
  expect(q1.main_status).toBe('WAITING_STORE_CONFIRMATION');
  expect(q1.public_progress).toBe('總務已將處理結果送門市確認。已更換完畢');
  expect(q1.waiting_confirm_since).not.toBeNull();
  expect((await reqEvents(lk.r.id)).some((e) => e.event_type === 'STORE_CONFIRMATION_REQUESTED' && e.visibility === 'PUBLIC')).toBe(true);
  // 第 4 批需求單端送確認（改走共用內部函式）→ 工單結果一致
  const lk2 = await linked('REQC2', 'IN_PROGRESS');
  const r2 = await callFn(users.rq_staff.client, 'ga_ws_req_transition', { p_id: lk2.r.id, p_action: 'request_store_confirmation', p_expected_updated_at: lk2.r.updated_at, p_payload: {} });
  expect(r2.ok, JSON.stringify(r2)).toBe(true);
  const w2 = await woRow(lk2.w.id);
  expect(w2).toMatchObject({ status: w1.status, progress_stage: w1.progress_stage, completion_requested_by: users.rq_staff.id });
  expect((await reqRow(lk2.r.id)).main_status).toBe('WAITING_STORE_CONFIRMATION');
  const u2 = (await updatesOf(lk2.w.id)).pop();
  expect(u2).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION', visibility: 'PUBLIC', notes: '總務已標記處理完成，等待門市確認結果。' });
  expect((await eventsOf(lk2.w.id)).pop()).toMatchObject({ event_type: 'REQUEST_COMPLETION', visibility: 'PUBLIC', metadata: { source: 'ga_service_request_workspace' } });
  // 舊式單（沒有需求單）：只改工單，不再丟錯
  const legacy = await open('REQC-LEG');
  const r3 = await tr('wo_works', legacy, 'REQUEST_COMPLETION', {});
  expect(r3.ok, JSON.stringify(r3)).toBe(true);
  expect(await woRow(legacy.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect((await updatesOf(legacy.id)).pop().notes).toBe('總務已標記處理完成，等待門市確認結果。');
  // 已受理但還沒處理中的單也可以送確認
  const acc = await wo('REQC-ACC', { status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW' });
  expect((await tr('wo_works', acc, 'REQUEST_COMPLETION', {})).ok).toBe(true);
});

test('舊式回報的門市確認與仍有問題：只在待門市確認可按；回報人或該門市店長；有需求單者改走我的追蹤', async () => {
  const w = await open('STORE', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  const cf = (who: PoKey, x: any, note: string | null = null, expected?: string) => fn(who, 'ga_ws_wo_store_confirm', { p_id: x.id, p_note: note, p_expected_updated_at: expected ?? x.updated_at });
  const un = (who: PoKey, x: any, reason: string | null = '還是會漏水', expected?: string) => fn(who, 'ga_ws_wo_report_unresolved', { p_id: x.id, p_reason: reason, p_expected_updated_at: expected ?? x.updated_at });
  // 不是門市端動作者：總務更新者（非回報人、非店長）、別間門市店長、只有查看自己門市的店長（沒有回報權限）
  expect((await cf('wo_works', w)).status).toBe(403);
  expect((await cf('wo_store_b', w)).status).toBe(404);
  expect((await cf('wo_store_a_viewonly', w)).status).toBe(403);
  expect((await un('wo_works', w)).status).toBe(403);
  expect((await cf('wo_store_a', w, null, '2000-01-01T00:00:00+00:00'))).toMatchObject({ status: 409, code: 'STALE' });
  expect(await fn('wo_store_a', 'ga_ws_wo_store_confirm', { p_id: w.id, p_note: null, p_expected_updated_at: null })).toMatchObject({ status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', updated_at: w.updated_at });
  // 仍有問題：必須原因；回報人本人（wo_store_a 同時是回報人與 VW001 店長）
  expect(await un('wo_store_a', w, '  ')).toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
  const r1 = await un('wo_store_a2', w, '還是會漏水'); // 同門市另一位店長（不是回報人）
  expect(r1.ok, JSON.stringify(r1)).toBe(true);
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'REOPENED', unresolved_reason: '還是會漏水' });
  expect((await updatesOf(w.id)).pop()).toMatchObject({ visibility: 'PUBLIC', progress_stage: 'REOPENED', notes: '還是會漏水', updated_by: users.wo_store_a2.id });
  expect((await eventsOf(w.id)).pop()).toMatchObject({ event_type: 'REPORT_UNRESOLVED', visibility: 'PUBLIC' });
  // 不在待確認：不能再按
  expect(await cf('wo_store_a', await woRow(w.id))).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(await un('wo_store_a', await woRow(w.id))).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  // 重新處理 → 再送確認 → 確認完成
  expect((await save('wo_works', await woRow(w.id), { progress_stage: 'VENDOR_WORKING' })).ok).toBe(true);
  expect((await tr('wo_works', await woRow(w.id), 'REQUEST_COMPLETION', {})).ok).toBe(true);
  const ok = await cf('wo_store_a', await woRow(w.id), '已修好');
  expect(ok.ok, JSON.stringify(ok)).toBe(true);
  const done = await woRow(w.id);
  expect(done).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED', completed_by: users.wo_store_a.id });
  expect(done.completed_at).not.toBeNull();
  expect((await updatesOf(w.id)).pop().notes).toBe('已修好');
  // 已完成：再按確認 409；存進度 409（沒有重新開啟）
  expect(await cf('wo_store_a', done)).toMatchObject({ status: 409 });
  expect((await save('wo_works', done)).status).toBe(409);
  // 有需求單且需求單在待確認：改走我的追蹤（單一路徑）
  const lk = await linked('STORE-L', 'WAITING_STORE_CONFIRMATION', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect(await cf('wo_store_a', lk.w)).toMatchObject({ status: 409, code: 'USE_REQUEST' });
  expect(await un('wo_store_a', lk.w)).toMatchObject({ status: 409, code: 'USE_REQUEST' });
  // 需求單這端確認（第 4 批）→ 工單同步完成，結案方式帶出
  const c4 = await callFn(users.wo_store_a.client, 'ga_ws_req_store_action', { p_id: lk.r.id, p_action: 'confirm_complete', p_note: null, p_expected_updated_at: null });
  expect(c4.ok, JSON.stringify(c4)).toBe(true);
  expect(await woRow(lk.w.id)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED' });
  const view = await fn('wo_store_a', 'ga_ws_wo_get', { p_id: lk.w.id });
  expect(view.data.work_order).toMatchObject({ completion_method_label: '門市確認完成', request_status: 'COMPLETED' });
  // abilities：待確認時店長端可按；已完成後沒有重新開啟
  const w2 = await open('STORE-AB', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  const ab = (await fn('wo_store_a', 'ga_ws_wo_get', { p_id: w2.id })).data.abilities;
  expect(ab).toMatchObject({ can_store_confirm: true, can_report_unresolved: true, can_save_progress: false, can_delete: false });
  const abGa = (await fn('wo_works', 'ga_ws_wo_get', { p_id: w2.id })).data.abilities;
  expect(abGa).toMatchObject({ can_store_confirm: false, can_save_progress: false, can_request_completion: false, can_issue_part: false });
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: done.id })).data.abilities).toMatchObject({ can_reopen: false, can_store_confirm: false });
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: done.id })).data.abilities.reopen_note).toContain('不能重新開啟');
});

// ----------------------------------------------------------------------------- 強制結案
test('強制結案：需要權限與原因；工單與需求單都結案；原因只有內部看得到，店長只看到「總務已結案」', async () => {
  const lk = await linked('FC', 'IN_PROGRESS', { assignee_name: '王師傅' });
  const reason = '重複報修，不需處理-機密原因';
  expect(await tr('wo_manager', lk.w, 'FORCE_CLOSE', { force_close_reason: '  ' })).toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
  const r = await tr('wo_manager', lk.w, 'FORCE_CLOSE', { force_close_reason: reason });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(await woRow(lk.w.id)).toMatchObject({ status: 'COMPLETED', completion_method: 'ADMIN_FORCE_CLOSED', completed_by: users.wo_manager.id });
  const q = await reqRow(lk.r.id);
  expect(q).toMatchObject({ main_status: 'COMPLETED', public_progress: '總務已結案' });
  expect(q.completed_at).not.toBeNull();
  expect(JSON.stringify(q)).not.toContain(reason);
  expect(JSON.stringify(await reqEvents(lk.r.id))).not.toContain(reason);
  const ups = await updatesOf(lk.w.id);
  expect(ups.filter((u) => u.visibility === 'INTERNAL').map((u) => u.notes)).toEqual([`不處理，強制結案。原因：${reason}`]);
  expect(ups.filter((u) => u.visibility === 'PUBLIC').map((u) => u.notes)).toEqual(['總務已結案']);
  const evs = await eventsOf(lk.w.id);
  expect(evs.find((e) => e.event_type === 'FORCE_CLOSE')).toMatchObject({ visibility: 'INTERNAL', metadata: { reason } });
  expect(evs.find((e) => e.event_type === 'FORCE_CLOSE_NOTICE')).toMatchObject({ visibility: 'PUBLIC', description: '總務已結案' });
  // 店長端看不到原因與處理人；總務端看得到；列表帶結案方式
  const store = await fn('wo_store_a', 'ga_ws_wo_get', { p_id: lk.w.id });
  expect(JSON.stringify(store.data)).not.toContain(reason);
  expect(JSON.stringify(store.data)).not.toContain('王師傅');
  expect(JSON.stringify(store.data.timeline)).toContain('總務已結案');
  expect(store.data.work_order).toMatchObject({ completion_method: 'ADMIN_FORCE_CLOSED', completion_method_label: '強制結案', status: 'COMPLETED' });
  const ga = await fn('wo_works', 'ga_ws_wo_get', { p_id: lk.w.id });
  expect(JSON.stringify(ga.data.timeline)).toContain(reason);
  const list = await fn('wo_store_a', 'ga_ws_wo_list', { p_filters: { q: lk.w.title } });
  expect(list.data.rows[0]).toMatchObject({ completion_method_label: '強制結案' });
  // 列印：非總務不含內部；總務勾選後含內部與原因
  const pStore = await fn('wo_store_a', 'ga_ws_wo_print', { p_id: lk.w.id, p_include_internal: true });
  expect(pStore.data.include_internal).toBe(false);
  expect(JSON.stringify(pStore.data)).not.toContain(reason);
  const pGaDefault = await fn('wo_works', 'ga_ws_wo_print', { p_id: lk.w.id });
  expect(pGaDefault.data.include_internal).toBe(false);
  expect(JSON.stringify(pGaDefault.data)).not.toContain(reason);
  const pGa = await fn('wo_works', 'ga_ws_wo_print', { p_id: lk.w.id, p_include_internal: true });
  expect(pGa.data.include_internal).toBe(true);
  expect(pGa.data.force_close_reason).toContain(reason);
  expect(JSON.stringify(pGa.data.internal_updates)).toContain(reason);
  // 沒有需求單的舊式單也可以強制結案；強制結案不翻轉已結案的需求單
  const leg = await open('FC-LEG');
  expect((await tr('wo_manager', leg, 'FORCE_CLOSE', { force_close_reason: '不處理' })).ok).toBe(true);
  const lk2 = await linked('FC-REJ', 'REJECTED');
  expect((await tr('wo_manager', lk2.w, 'FORCE_CLOSE', { force_close_reason: '退回後結案' })).ok).toBe(true);
  expect((await reqRow(lk2.r.id)).main_status).toBe('REJECTED');
});

// ----------------------------------------------------------------------------- 補資料往返（W1）
test('補資料往返：工單按補資料→需求單進待門市補資料→店長在我的追蹤回覆→工單回初步評估、需求單待總務複核；需求單端的補資料也同步工單', async () => {
  const lk = await linked('SUP', 'IN_PROGRESS', { progress_stage: 'VENDOR_WORKING' });
  expect(await tr('wo_works', lk.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'BAD', supplement_note: 'x' })).toMatchObject({ status: 400, code: 'REASON_TYPE_INVALID' });
  expect(await tr('wo_works', lk.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'PHOTO_UNCLEAR', supplement_note: ' ' })).toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
  const r = await tr('wo_works', lk.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請補拍漏水處近照' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(await woRow(lk.w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
  const q = await reqRow(lk.r.id);
  expect(q).toMatchObject({ main_status: 'WAITING_STORE_SUPPLEMENT', supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請補拍漏水處近照', public_progress: '總務要求補資料：照片不清楚。請補拍漏水處近照' });
  expect((await updatesOf(lk.w.id)).pop()).toMatchObject({ visibility: 'PUBLIC', progress_stage: 'WAITING_STORE_INFO', notes: '總務要求補資料：照片不清楚。請補拍漏水處近照' });
  expect((await eventsOf(lk.w.id)).pop()).toMatchObject({ event_type: 'SUPPLEMENT_REQUESTED', visibility: 'PUBLIC' });
  expect((await reqEvents(lk.r.id)).pop()).toMatchObject({ event_type: 'SUPPLEMENT_REQUESTED', visibility: 'PUBLIC' });
  // 重複要求被擋；等待期間不能存進度與送確認
  expect(await tr('wo_works', await woRow(lk.w.id), 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' })).toMatchObject({ status: 409 });
  expect(await save('wo_works', await woRow(lk.w.id))).toMatchObject({ status: 409, code: 'WAITING_STORE_SUPPLEMENT' });
  // 店長在我的追蹤回覆（第 4 批入口）
  const re = await callFn(users.wo_store_a.client, 'ga_ws_req_store_action', { p_id: lk.r.id, p_action: 'submit_supplement', p_note: '已補拍，請看附件', p_expected_updated_at: null });
  expect(re.ok, JSON.stringify(re)).toBe(true);
  expect((await reqRow(lk.r.id)).main_status).toBe('WAITING_GA_REVIEW');
  expect(await woRow(lk.w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW' });
  expect((await updatesOf(lk.w.id)).pop()).toMatchObject({ visibility: 'PUBLIC', progress_stage: 'INITIAL_REVIEW', notes: '門市已補充資料：已補拍，請看附件' });
  expect((await eventsOf(lk.w.id)).pop()).toMatchObject({ event_type: 'SUPPLEMENT_REPLIED', visibility: 'PUBLIC' });
  // 回覆後工單可再存進度（需求單在待總務複核，不翻轉）
  expect((await save('wo_works', await woRow(lk.w.id), { progress_stage: 'VENDOR_WORKING' })).ok).toBe(true);
  expect((await reqRow(lk.r.id)).main_status).toBe('WAITING_GA_REVIEW');
  // 總務代門市回覆（需求單管理者、非該門市名單）→ 工單文字標記代按
  const lk2 = await linked('SUP-PROXY', 'IN_PROGRESS', { progress_stage: 'VENDOR_WORKING' });
  expect((await tr('wo_works', lk2.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: '請補充' })).ok).toBe(true);
  const px = await callFn(users.rq_staff.client, 'ga_ws_req_store_action', { p_id: lk2.r.id, p_action: 'submit_supplement', p_note: '店長電話補充', p_expected_updated_at: null });
  expect(px.ok, JSON.stringify(px)).toBe(true);
  expect((await updatesOf(lk2.w.id)).pop().notes).toBe('【總務代門市操作】門市已補充資料：店長電話補充');
  // 需求單端按「要求補資料」（第 4 批入口）→ 連結工單同步進等待門市補充資料
  const lk3 = await linked('SUP-REQ', 'IN_PROGRESS', { progress_stage: 'VENDOR_WORKING' });
  const rr = await callFn(users.rq_staff.client, 'ga_ws_req_transition', { p_id: lk3.r.id, p_action: 'request_supplement', p_expected_updated_at: lk3.r.updated_at, p_payload: { supplement_type: 'MISSING_PHOTO', supplement_note: '缺照片' } });
  expect(rr.ok, JSON.stringify(rr)).toBe(true);
  expect(await woRow(lk3.w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
  expect((await reqRow(lk3.r.id)).main_status).toBe('WAITING_STORE_SUPPLEMENT');
  expect((await updatesOf(lk3.w.id)).pop().notes).toBe('總務要求補資料：缺少必要照片。缺照片');
  // 需求單沒有連結工單時需求單端補資料照舊
  const s = await stores();
  const plain = (await db().from('ga_service_requests').insert({ store_id: s.VW001.id, created_by: users.wo_store_a.id, request_type: 'PURCHASE_SUPPLEMENT', title: m7Name(`REQ-PLAIN-${(seq += 1)}`), description: 'x', resource_type: 'PART', part_id: part.id, desired_quantity: 1, main_status: 'WAITING_GA_REVIEW' }).select('*').single()).data as any;
  const rp = await callFn(users.rq_staff.client, 'ga_ws_req_transition', { p_id: plain.id, p_action: 'request_supplement', p_expected_updated_at: plain.updated_at, p_payload: { supplement_type: 'OTHER', supplement_note: '請補充規格' } });
  expect(rp.ok, JSON.stringify(rp)).toBe(true);
  expect((await reqRow(plain.id)).main_status).toBe('WAITING_STORE_SUPPLEMENT');
});

test('補資料：已出庫或已有採購單的需求單被擋並提示改用留言；需求單已結案、已在待補資料、待門市確認也被擋；舊式單只改工單，由回報人回覆', async () => {
  // 已出庫：處理單與出庫單據
  const lk = await linked('SUP-ISSUED', 'IN_PROGRESS');
  const ful = (await db().from('ga_part_fulfillments').insert({ request_id: lk.r.id, status: 'STOCK_ISSUE', requested_quantity: 1, unit: '個', created_by: users.wo_works.id, updated_by: users.wo_works.id }).select('*').single());
  expect(ful.error?.message ?? null).toBeNull();
  const doc = await db().from('ga_part_fulfillment_documents').insert({ fulfillment_id: ful.data!.id, document_type: 'STOCK_ISSUE', document_id: crypto.randomUUID(), document_no: 'ZT-M7M8-DOC', quantity: 1, status: 'POSTED', created_by: users.wo_works.id });
  expect(doc.error?.message ?? null).toBeNull();
  const r = await tr('wo_works', lk.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' });
  expect(r).toMatchObject({ status: 409, code: 'HAS_DOCUMENTS' });
  expect(r.error).toContain('留言');
  expect(await woRow(lk.w.id)).toMatchObject({ progress_stage: 'INITIAL_REVIEW', updated_at: lk.w.updated_at });
  expect((await fn('wo_works', 'ga_ws_wo_get', { p_id: lk.w.id })).data.abilities).toMatchObject({ can_request_supplement: false });
  expect((await fn('wo_works', 'ga_ws_wo_get', { p_id: lk.w.id })).data.abilities.request_supplement_reason).toContain('出庫');
  // 需求單狀態不對
  for (const st of ['COMPLETED', 'REJECTED', 'CANCELED', 'WAITING_STORE_SUPPLEMENT', 'WAITING_STORE_CONFIRMATION']) {
    const x = await linked(`SUP-ST-${st}`, st);
    const rr = await tr('wo_works', x.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' });
    expect(rr, st).toMatchObject({ ok: false, status: 409, code: 'REQUEST_STATE' });
    expect((await reqRow(x.r.id)).main_status).toBe(st);
  }
  // 待總務複核的需求單可以再要求補資料
  const rv = await linked('SUP-REVIEW', 'WAITING_GA_REVIEW');
  expect((await tr('wo_works', rv.w, 'REQUEST_SUPPLEMENT', { supplement_type: 'OTHER', supplement_note: 'x' })).ok).toBe(true);
  // 舊式單：只改工單；店長（回報人）用 reply_supplement 回覆；總務不能代回覆
  const leg = await open('SUP-LEG', { progress_stage: 'VENDOR_WORKING' });
  expect((await tr('wo_works', leg, 'REQUEST_SUPPLEMENT', { supplement_type: 'DESCRIPTION_INSUFFICIENT', supplement_note: '請描述位置' })).ok).toBe(true);
  expect(await woRow(leg.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
  const rep = (who: PoKey, note: string | null, expected?: string) => fn(who, 'ga_ws_wo_reply_supplement', { p_id: leg.id, p_note: note, p_expected_updated_at: expected ?? leg.updated_at });
  const cur = await woRow(leg.id);
  expect((await rep('wo_works', '代回覆', cur.updated_at)).status).toBe(403);
  expect((await rep('wo_store_b', 'x', cur.updated_at)).status).toBe(404);
  expect(await rep('wo_store_a', ' ', cur.updated_at)).toMatchObject({ status: 400, code: 'NOTE_REQUIRED' });
  expect(await rep('wo_store_a', 'x', '2000-01-01T00:00:00+00:00')).toMatchObject({ status: 409, code: 'STALE' });
  const ok = await rep('wo_store_a', '在廚房右側牆面', cur.updated_at);
  expect(ok.ok, JSON.stringify(ok)).toBe(true);
  expect(await woRow(leg.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW' });
  expect(await rep('wo_store_a', 'again', (await woRow(leg.id)).updated_at)).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  // 有需求單者回覆請走我的追蹤
  const lkx = await linked('SUP-USEREQ', 'WAITING_STORE_SUPPLEMENT', { progress_stage: 'WAITING_STORE_INFO' });
  expect(await fn('wo_store_a', 'ga_ws_wo_reply_supplement', { p_id: lkx.w.id, p_note: 'x', p_expected_updated_at: lkx.w.updated_at })).toMatchObject({ status: 409, code: 'USE_REQUEST' });
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: lkx.w.id })).data.abilities).toMatchObject({ reply_supplement_use_request: true, can_reply_supplement: false });
});

// ----------------------------------------------------------------------------- 領用料件（W2）
test('領用料件：同交易扣庫存、流水記工單編號與工單 id；冪等；超庫存被擋；缺權限講清楚；狀態與版本檢查；內部事件與用料清單', async () => {
  const w = await open('PART', { progress_stage: 'VENDOR_WORKING' });
  const woNo = `WO-${w.id.slice(0, 8).toUpperCase()}`;
  const issue = (who: PoKey, x: any, qty: number, k: string, over: Record<string, unknown> = {}) =>
    fn(who, 'ga_ws_wo_issue_part', { p_id: x.id, p_location_id: loc.id, p_part_id: part.id, p_quantity: qty, p_input_unit_type: 'BASE', p_reason: '更換零件', p_notes: null, p_key: k, p_expected_updated_at: x.updated_at, ...over });
  // 權限：缺哪個講清楚
  const cases: [PoKey, string, string][] = [['wo_works_notxn', 'TRANSACTION_PERMISSION_REQUIRED', '庫存交易管理'], ['wo_works_nopart', 'PART_VIEW_REQUIRED', '料件查看'], ['wo_viewall', 'PERMISSION_DENIED', '工單更新'],
    ['wo_store_a', 'PERMISSION_DENIED', '工單更新'], ['admin', 'PERMISSION_DENIED', '工單更新'], ['nobody', 'PERMISSION_DENIED', '工單更新']];
  for (const [k, code, missing] of cases) {
    const r = await issue(k, w, 1, key());
    expect(r.status, k).toBe(403);
    expect(r.code, k).toBe(code);
    expect(r.error, k).toContain(missing);
  }
  expect(await woRow(w.id)).toMatchObject({ updated_at: w.updated_at });
  // 參數
  expect(await issue('wo_works', w, 0, key())).toMatchObject({ status: 400, code: 'QUANTITY_INVALID' });
  expect(await issue('wo_works', w, 1, '')).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  expect(await issue('wo_works', w, 1, key(), { p_input_unit_type: 'BOX' })).toMatchObject({ status: 400, code: 'UNIT_INVALID' });
  expect(await issue('wo_works', w, 1, key(), { p_part_id: null })).toMatchObject({ status: 400, code: 'FIELDS_REQUIRED' });
  expect(await issue('wo_works', w, 1, key(), { p_expected_updated_at: null })).toMatchObject({ status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await issue('wo_works', w, 1, key(), { p_expected_updated_at: '2000-01-01T00:00:00+00:00' })).toMatchObject({ status: 409, code: 'STALE' });
  expect(await issue('wo_works', w, 1, key(), { p_part_id: crypto.randomUUID() })).toMatchObject({ status: 404, code: 'PART_NOT_FOUND' });
  const bal0 = Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).single()).data!.quantity_base);
  expect(bal0).toBe(10);
  // 成功
  const k1 = key();
  const r1 = await issue('wo_works', w, 2, k1);
  expect(r1.ok, JSON.stringify(r1)).toBe(true);
  expect(r1.status).toBe(201);
  const tx = (await db().from('ga_inventory_transactions').select('*').eq('id', r1.data.transaction.transaction_id).single()).data as any;
  expect(tx).toMatchObject({ transaction_type: 'ISSUE', reference_type: 'MAINTENANCE_REQUEST', reference_id: w.id, idempotency_key: k1, quantity_base: -2, location_id: loc.id, part_id: part.id });
  expect(tx.reason).toBe(`維修工單領用 ${woNo}｜更換零件`);
  expect(tx.metadata).toMatchObject({ work_order_id: w.id, work_order_no: woNo, source: 'maintenance_work_order_part_issue' });
  expect(Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).single()).data!.quantity_base)).toBe(8);
  const w1 = await woRow(w.id);
  expect(w1.updated_at).not.toBe(w.updated_at);
  expect(w1).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
  const ev = (await eventsOf(w.id)).find((e) => e.event_type === 'PART_ISSUED')!;
  expect(ev).toMatchObject({ visibility: 'INTERNAL' });
  expect(ev.metadata).toMatchObject({ transaction_id: tx.id, transaction_no: tx.transaction_no, part_id: part.id, quantity: 2, location_id: loc.id });
  // 冪等：同一識別重送（用舊版本也行）→ 回原結果、不再扣、不重寫事件
  const r1b = await issue('wo_works', w, 2, k1);
  expect(r1b).toMatchObject({ ok: true, status: 200, idempotent_replay: true });
  expect(r1b.data.transaction.transaction_id).toBe(r1.data.transaction.transaction_id);
  expect(Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).single()).data!.quantity_base)).toBe(8);
  expect((await eventsOf(w.id)).filter((e) => e.event_type === 'PART_ISSUED')).toHaveLength(1);
  // 同一識別、不同內容 → 衝突
  expect(await issue('wo_works', await woRow(w.id), 3, k1)).toMatchObject({ ok: false, status: 409 });
  // 超過庫存：被擋、什麼都不變
  const w2 = await woRow(w.id);
  const over = await issue('wo_works', w2, 9, key());
  expect(over).toMatchObject({ ok: false, status: 409, code: 'INSUFFICIENT_STOCK' });
  expect(Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).single()).data!.quantity_base)).toBe(8);
  expect(await woRow(w.id)).toMatchObject({ updated_at: w2.updated_at });
  expect((await eventsOf(w.id)).filter((e) => e.event_type === 'PART_ISSUED')).toHaveLength(1);
  // 內部旗標用畢設回：登入者直接帶參考單據過帳仍被擋
  const direct = await fn('wo_works', 'ga_ws_inv_post', { p_transaction_type: 'ISSUE', p_location_id: loc.id, p_part_id: part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: 'x', p_notes: null, p_idempotency_key: key(), p_occurred_at: null, p_reference_type: 'MAINTENANCE_REQUEST', p_reference_id: w.id, p_metadata: {} });
  expect(direct).toMatchObject({ ok: false, status: 403, code: 'REFERENCE_NOT_ALLOWED' });
  // 用料清單：總務端看得到並以流水核對數量；店長端沒有
  const ga = await fn('wo_works', 'ga_ws_wo_get', { p_id: w.id });
  expect(ga.data.parts).toHaveLength(1);
  expect(ga.data.parts[0]).toMatchObject({ transaction_no: tx.transaction_no, part_name: part.name, location_name: loc.name, verified_quantity_base: 2 });
  expect(Number(ga.data.parts[0].quantity)).toBe(2);
  expect(JSON.stringify((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: w.id })).data.timeline)).not.toContain('領用料件');
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: w.id })).data.parts).toEqual([]);
  // 狀態：未受理、待門市確認、已完成都不能領用
  const un = await wo('PART-UN');
  expect(await issue('wo_works', un, 1, key())).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  const wc = await open('PART-WC', { progress_stage: 'WAITING_STORE_CONFIRMATION' });
  expect(await issue('wo_works', wc, 1, key())).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  const dn = await wo('PART-DONE', { status: 'COMPLETED', progress_stage: 'OTHER' });
  expect(await issue('wo_works', dn, 1, key())).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).single()).data!.quantity_base)).toBe(8);
  // abilities 說明缺哪個權限
  const abNoTxn = (await fn('wo_works_notxn', 'ga_ws_wo_get', { p_id: w.id })).data.abilities;
  expect(abNoTxn).toMatchObject({ can_issue_part: false, issue_part_missing: ['庫存交易管理'] });
  expect(abNoTxn.issue_part_reason).toContain('庫存交易管理');
  expect((await fn('wo_works', 'ga_ws_wo_get', { p_id: w.id })).data.abilities).toMatchObject({ can_issue_part: true });
  // 第 4 批規則不動：維修單的需求單仍不能走採購評估與需求單出庫（D4）
  const lk = await linked('PART-D4', 'ACCEPTED');
  const d4 = await callFn(users.rq_staff.client, 'ga_ws_req_stock_issue', { p_id: lk.r.id, p_location_id: loc.id, p_part_id: part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: null, p_notes: null, p_substitute_reason: null, p_key: key() });
  expect(d4.ok).toBe(false);
});

// ----------------------------------------------------------------------------- 刪除
test('刪除：只有未受理且沒連需求單的單；回報人只能刪自己的；總務（管理）可刪；附件只標記不實刪；失敗全不變', async () => {
  const del = (who: PoKey, x: any, expected?: string) => fn(who, 'ga_ws_wo_delete', { p_id: x.id, p_expected_updated_at: expected ?? x.updated_at });
  // 規則
  const acc = await wo('DEL-ACC', { status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW' });
  const r1 = await del('wo_store_a', acc);
  expect(r1).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  expect(r1.error).toContain('強制結案');
  expect(await del('wo_manager', acc)).toMatchObject({ status: 409, code: 'INVALID_STATE' });
  const lk = await linked('DEL-LK', 'IN_PROGRESS', { status: 'UNACCEPTED', progress_stage: null });
  expect(await del('wo_manager', lk.w)).toMatchObject({ status: 409, code: 'HAS_REQUEST' });
  expect(await woRow(acc.id)).not.toBeNull();
  expect(await woRow(lk.w.id)).not.toBeNull();
  // 權限：非回報人的同門市店長、只有 view_all、別間店長、無權限者都不能刪（看得到的 403、看不到的 404）
  const made = await legacy('wo_store_a', 'DEL-UN', 2);
  const un = made.w;
  const paths = made.paths;
  expect((await del('wo_store_a2', un)).status).toBe(403);
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_works', 'wo_update_noforce']) {
    const r = await del(k as PoKey, un);
    expect([403, 404], `${k} 不能刪`).toContain(r.status);
    expect(r.ok).toBe(false);
  }
  expect((await del('wo_store_b', un)).status).toBe(404);
  expect((await del('nobody', un)).status).toBe(404);
  expect(await del('wo_store_a', un, '2000-01-01T00:00:00+00:00')).toMatchObject({ status: 409, code: 'STALE' });
  expect(await fn('wo_store_a', 'ga_ws_wo_delete', { p_id: un.id, p_expected_updated_at: null })).toMatchObject({ status: 400, code: 'EXPECTED_REQUIRED' });
  expect(await woRow(un.id)).not.toBeNull();
  // 回報人本人可刪
  const ok = await del('wo_store_a', un);
  expect(ok.ok, JSON.stringify(ok)).toBe(true);
  expect(ok.data).toMatchObject({ deleted: true, attachments_marked_deleted: 2 });
  expect(await woRow(un.id)).toBeNull();
  const att = ((await db().from('ga_resource_attachments').select('*').in('storage_path', paths)).data || []) as any[];
  expect(att).toHaveLength(2);
  for (const a of att) {
    expect(a.deleted_at).not.toBeNull();
    expect(a.deleted_by).toBe(users.wo_store_a.id);
    expect(a.deletion_reason).toContain(`WO-${un.id.slice(0, 8).toUpperCase()}`);
  }
  for (const p of paths) {
    const dl = await db().storage.from('general-affairs-attachments').download(p);
    expect(dl.error, `儲存檔不實刪 ${p}`).toBeNull();
  }
  // 連帶刪除：進度、事件
  expect(((await db().from('maintenance_updates').select('id').eq('request_id', un.id)).data || []).length).toBe(0);
  expect(await del('wo_store_a', un)).toMatchObject({ status: 404 });
  // 總務（工單管理）可刪別人回報的未受理單；其他舊更新權限也可
  for (const k of ['wo_manager', 'wo_mr_update', 'wo_cross_update'] as PoKey[]) {
    const x = await wo(`DEL-${k}`);
    const r = await del(k, x);
    expect(r.ok, `${k}: ${JSON.stringify(r)}`).toBe(true);
    expect(await woRow(x.id)).toBeNull();
  }
  // 沒有 expected_updated_at 衝突：刪除前被別人改過
  const x2 = await wo('DEL-RACE');
  const old = x2.updated_at;
  expect((await save('wo_works', x2)).ok).toBe(true);
  expect(await del('wo_manager', x2, old)).toMatchObject({ status: 409, code: 'STALE' });
  // abilities
  const x3 = await wo('DEL-AB');
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: x3.id })).data.abilities).toMatchObject({ can_delete: true });
  expect((await fn('wo_store_a2', 'ga_ws_wo_get', { p_id: x3.id })).data.abilities).toMatchObject({ can_delete: false });
  expect((await fn('wo_viewall', 'ga_ws_wo_get', { p_id: x3.id })).data.abilities).toMatchObject({ can_delete: false, read_only: true });
  expect((await fn('wo_manager', 'ga_ws_wo_get', { p_id: x3.id })).data.abilities).toMatchObject({ can_delete: true });
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: acc.id })).data.abilities.delete_reason).toContain('強制結案');
});

// ----------------------------------------------------------------------------- 新增舊式回報
test('新增舊式回報（跨部門維修頁）：店長（回報權限）可新增、最多 5 張圖片、路徑與檔案存在檢查、冪等；別間門市與沒權限被擋', async () => {
  const s = await stores();
  const mkId = () => crypto.randomUUID();
  const upload = async (id: string, n: number) => {
    const out: any[] = [];
    for (let i = 0; i < n; i += 1) {
      const p = `maintenance_request/${id}/${M7_FILE_PREFIX}new-${i}.png`;
      expect((await db().storage.from('general-affairs-attachments').upload(p, PNG, { contentType: 'image/png', upsert: true })).error).toBeNull();
      out.push({ storage_path: p, file_name: `${M7_FILE_PREFIX}new-${i}.png`, content_type: 'image/png', size_bytes: PNG.length });
    }
    return out;
  };
  const create = (who: PoKey, payload: Record<string, unknown>, k: string = key()) => fn(who, 'ga_ws_wo_create_legacy', { p_payload: payload, p_key: k });
  const id1 = mkId();
  const atts = await upload(id1, 2);
  const k1 = key();
  const body = { id: id1, store_id: s.VW001.id, title: m7Name('NEW-1'), description: '廁所水龍頭漏水', contact_phone: '0912000000', attachments: atts };
  const r = await create('wo_store_a', body, k1);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.status).toBe(201);
  expect(r.data).toMatchObject({ id: id1, status: 'UNACCEPTED', attachment_count: 2 });
  expect(r.data.wo_no).toBe(`WO-${id1.slice(0, 8).toUpperCase()}`);
  const row = await woRow(id1);
  expect(row).toMatchObject({ status: 'UNACCEPTED', reported_by: users.wo_store_a.id, store_id: s.VW001.id, priority: 'normal', ga_service_request_id: null, progress_stage: null });
  expect(row.contact_name).toBeTruthy();
  const ev = await eventsOf(id1);
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ event_type: 'CREATED', visibility: 'PUBLIC', created_by: users.wo_store_a.id, metadata: { create_key: k1 } });
  const att = ((await db().from('ga_resource_attachments').select('*').eq('resource_id', id1)).data || []) as any[];
  expect(att).toHaveLength(2);
  expect(att[0]).toMatchObject({ resource_type: 'MAINTENANCE_REQUEST', storage_bucket: 'general-affairs-attachments', content_type: 'image/png', uploaded_by: users.wo_store_a.id });
  // 冪等：同人同識別碼重送回原工單
  const again = await create('wo_store_a', { ...body, id: mkId() }, k1);
  expect(again).toMatchObject({ ok: true, status: 200, idempotent_replay: true });
  expect(again.data.id).toBe(id1);
  // 驗證
  expect(await create('wo_store_a', { ...body, id: mkId(), title: ' ' })).toMatchObject({ status: 400, code: 'TITLE_REQUIRED' });
  expect(await create('wo_store_a', { ...body, id: mkId(), store_id: null })).toMatchObject({ status: 400, code: 'STORE_REQUIRED' });
  expect(await create('wo_store_a', { ...body, id: mkId(), priority: 'asap' })).toMatchObject({ status: 400, code: 'PRIORITY_INVALID' });
  expect(await fn('wo_store_a', 'ga_ws_wo_create_legacy', { p_payload: { ...body, id: mkId() }, p_key: '' })).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const idx = mkId();
  expect(await create('wo_store_a', { ...body, id: idx, title: m7Name('NEW-X'), attachments: await upload(idx, 6) })).toMatchObject({ status: 400, code: 'TOO_MANY_PHOTOS' });
  const idp = mkId();
  const pdf = [{ storage_path: `maintenance_request/${idp}/${M7_FILE_PREFIX}x.pdf`, file_name: `${M7_FILE_PREFIX}x.pdf`, content_type: 'application/pdf', size_bytes: 10 }];
  expect(await create('wo_store_a', { ...body, id: idp, attachments: pdf })).toMatchObject({ status: 400, code: 'NOT_IMAGE' });
  const idq = mkId();
  expect(await create('wo_store_a', { ...body, id: idq, attachments: [{ ...atts[0], storage_path: `maintenance_request/${mkId()}/${M7_FILE_PREFIX}other.png` }] })).toMatchObject({ status: 400, code: 'PATH_INVALID' });
  const idm = mkId();
  expect(await create('wo_store_a', { ...body, id: idm, attachments: [{ ...atts[0], storage_path: `maintenance_request/${idm}/${M7_FILE_PREFIX}missing.png` }] })).toMatchObject({ status: 400, code: 'FILE_MISSING' });
  expect(await create('wo_store_a', { ...body, id: mkId(), attachments: [{ ...atts[0], size_bytes: 0 }] })).toMatchObject({ status: 400 });
  expect(await create('wo_store_a', { ...body, id: id1, title: m7Name('NEW-DUP') })).toMatchObject({ status: 409, code: 'DUPLICATE' });
  // 權限：別間門市店長、沒有回報權限（只有查看自己）、不在名單、無權限；總務更新者可代建；舊跨部門回報權限也可
  expect((await create('wo_store_b', { ...body, id: mkId(), title: m7Name('NEW-B') })).status).toBe(403);
  expect((await create('wo_store_a_viewonly', { ...body, id: mkId(), title: m7Name('NEW-V') })).status).toBe(403);
  expect((await create('wo_outsider_own', { ...body, id: mkId(), title: m7Name('NEW-O') })).status).toBe(403);
  expect((await create('nobody', { ...body, id: mkId(), title: m7Name('NEW-N') })).status).toBe(403);
  expect((await create('admin', { ...body, id: mkId(), title: m7Name('NEW-ADM') })).status).toBe(403);
  expect((await create('wo_viewall', { ...body, id: mkId(), title: m7Name('NEW-VA') })).status).toBe(403);
  const ga = await create('wo_works', { ...body, id: mkId(), title: m7Name('NEW-GA'), attachments: [] });
  expect(ga.ok, JSON.stringify(ga)).toBe(true);
  const cross = await create('wo_cross_store_a', { ...body, id: mkId(), title: m7Name('NEW-X2'), attachments: [] });
  expect(cross.ok, JSON.stringify(cross)).toBe(true);
  // 失敗不留痕跡：沒有因驗證失敗而產生的工單
  const bad = await db().from('maintenance_requests').select('id', { count: 'exact', head: true }).in('id', [idx, idp, idq, idm]);
  expect(bad.count).toBe(0);
  // 新增的單回報人可以看、可以刪（未受理）
  expect((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: id1 })).data.attachments).toHaveLength(2);
});

// ----------------------------------------------------------------------------- 改分類
test('改分類：需要更新權限；可清除；寫內部事件；版本衝突與找不到分類', async () => {
  const c1 = await seedMaintenanceCategory('CAT1');
  const c2 = await seedMaintenanceCategory('CAT2');
  const w = await open('CAT');
  const set = (who: PoKey, x: any, cid: string | null, expected?: string) => fn(who, 'ga_ws_wo_category', { p_id: x.id, p_category_id: cid, p_expected_updated_at: expected ?? x.updated_at });
  expect((await set('wo_viewall', w, c1.id)).status).toBe(403);
  expect((await set('wo_store_a', w, c1.id)).status).toBe(403);
  expect(await set('wo_works', w, crypto.randomUUID())).toMatchObject({ status: 404, code: 'CATEGORY_NOT_FOUND' });
  expect(await set('wo_works', w, c1.id, '2000-01-01T00:00:00+00:00')).toMatchObject({ status: 409, code: 'STALE' });
  const r = await set('wo_works', w, c1.id);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect((await woRow(w.id)).category_id).toBe(c1.id);
  const r2 = await set('wo_manager', await woRow(w.id), c2.id);
  expect(r2.ok).toBe(true);
  const ev = (await eventsOf(w.id)).filter((e) => e.event_type === 'CATEGORY_CHANGED');
  expect(ev).toHaveLength(2);
  expect(ev[1]).toMatchObject({ visibility: 'INTERNAL' });
  expect(ev[1].description).toContain(c1.name);
  expect(ev[1].description).toContain(c2.name);
  expect((await set('wo_works', await woRow(w.id), null)).ok).toBe(true);
  expect((await woRow(w.id)).category_id).toBeNull();
  // 店長端看不到分類變更事件
  expect(JSON.stringify((await fn('wo_store_a', 'ga_ws_wo_get', { p_id: w.id })).data.timeline)).not.toContain('工單分類由');
});

// ----------------------------------------------------------------------------- 列表、摘要、列印
test('列表：伺服端分頁與精確筆數（第 51 筆之後搜得到）、搜尋跳脫、焦點卡全量計數、篩選與輸入驗證', async () => {
  const s = await stores();
  const tag = m7Name(`LIST${(seq += 1)}`);
  const rows = Array.from({ length: 53 }, (_, i) => ({ store_id: i % 2 ? s.VW001.id : s.ZT01.id, title: `${tag}-${String(i).padStart(2, '0')}`, description: i === 51 ? '特別的 100%_percent 說明' : 'm7m8 列表', reported_by: users.wo_works.id,
    reporter_name: 'M7M8 回報人', status: 'UNACCEPTED', priority: 'normal', reported_at: new Date(Date.UTC(2038, 0, 1, 0, 0, 53 - i)).toISOString() }));
  const ins = await db().from('maintenance_requests').insert(rows).select('id,title');
  expect(ins.error?.message ?? null).toBeNull();
  const list = (who: PoKey, f: Record<string, unknown>, page = 1, size = 20) => fn(who, 'ga_ws_wo_list', { p_filters: { q: tag, ...f }, p_page: page, p_page_size: size });
  const p1 = await list('wo_works', {}, 1, 50);
  expect(p1.data).toMatchObject({ total: 53, page: 1, page_size: 50 });
  expect(p1.data.rows).toHaveLength(50);
  const p2 = await list('wo_works', {}, 2, 50);
  expect(p2.data.rows).toHaveLength(3);
  expect(new Set([...p1.data.rows, ...p2.data.rows].map((x: any) => x.id)).size).toBe(53);
  expect(p1.data.rows[0].title).toBe(`${tag}-00`); // 依回報時間新到舊
  // 第 51 筆之後的資料用搜尋找得到
  const f = await fn('wo_works', 'ga_ws_wo_list', { p_filters: { q: `${tag}-52` } });
  expect(f.data.total).toBe(1);
  // 跳脫：% 與 _ 不是萬用字元
  expect((await fn('wo_works', 'ga_ws_wo_list', { p_filters: { q: `${tag}%` } })).data.total).toBe(0);
  expect((await fn('wo_works', 'ga_ws_wo_list', { p_filters: { q: `${tag}-5_` } })).data.total).toBe(0);
  expect((await fn('wo_works', 'ga_ws_wo_list', { p_filters: { q: '100%_percent' } })).data.total).toBe(1);
  expect((await fn('wo_works', 'ga_ws_wo_list', { p_filters: { q: "'; DROP TABLE x; --" } })).data.total).toBe(0);
  // 門市範圍：店長只算自己門市
  const store = await list('wo_store_a', {}, 1, 100);
  expect(store.data.total).toBe(rows.filter((x) => x.store_id === s.VW001.id).length);
  expect(store.data.rows.every((x: any) => x.store_id === s.VW001.id)).toBe(true);
  expect((await list('wo_works', { store_id: s.ZT01.id })).data.total).toBe(27);
  // pageSize 上限 100、page < 1 視為 1
  expect((await list('wo_works', {}, 0, 1000)).data).toMatchObject({ page: 1, page_size: 100 });
  expect((await list('wo_works', {}, 1, 0)).data.page_size).toBe(20);
  // 焦點卡與狀態篩選（全量計數，不受分頁影響）
  await db().from('maintenance_requests').update({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' }).eq('title', `${tag}-00`);
  await db().from('maintenance_requests').update({ status: 'PROCESSING', progress_stage: 'WAITING_PARTS' }).in('title', [`${tag}-01`, `${tag}-02`]);
  await db().from('maintenance_requests').update({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' }).eq('title', `${tag}-03`);
  await db().from('maintenance_requests').update({ status: 'PROCESSING', progress_stage: 'REOPENED' }).eq('title', `${tag}-04`);
  await db().from('maintenance_requests').update({ status: 'COMPLETED', progress_stage: 'OTHER', completion_method: 'STORE_CONFIRMED' }).eq('title', `${tag}-05`);
  const c = (await list('wo_works', {}, 1, 5)).data.focus_counts;
  expect(c).toEqual({ all: 53, store_rejected: 1, arrange: 47, vendor: 1, parts: 2, store_confirmation: 1, completed: 1 });
  expect((await list('wo_works', { focus: 'parts' })).data).toMatchObject({ total: 2 });
  expect((await list('wo_works', { focus: 'parts' })).data.focus_counts.all).toBe(53); // 焦點卡不受焦點篩選影響
  expect((await list('wo_works', { status: 'PROCESSING' })).data.total).toBe(5);
  expect((await list('wo_works', { status: 'COMPLETED', focus: 'completed' })).data.total).toBe(1);
  expect((await list('wo_works', { source: 'REQUEST' })).data.total).toBe(0);
  expect((await list('wo_works', { source: 'LEGACY' })).data.total).toBe(53);
  expect((await list('wo_works', { focus: 'all' })).data.total).toBe(53);
  // 輸入驗證
  for (const bad of [{ status: 'DONE' }, { focus: 'x' }, { source: 'x' }, { store_id: 'abc' }]) expect(await list('wo_works', bad), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400, code: 'FILTER_INVALID' });
  expect(await fn('wo_works', 'ga_ws_wo_list', { p_filters: [1] })).toMatchObject({ status: 400, code: 'FILTER_INVALID' });
  // 列表資料欄位與處理人遮蔽
  const row = p1.data.rows[0];
  expect(row).toMatchObject({ source: 'LEGACY', wo_no: `WO-${row.id.slice(0, 8).toUpperCase()}`, store_code: expect.any(String) });
  expect('assignee_name' in row).toBe(true);
  expect('assignee_name' in store.data.rows[0]).toBe(false);
  // 摘要：資料庫端 group by（超過 50 筆也正確）、店長只算自己門市
  const sum = await fn('wo_works', 'ga_ws_wo_summary', {});
  expect(sum.status).toBe(200);
  const mine = (st: string) => (sum.data.stores as any[]).find((x) => x.store_id === s[st].id);
  expect(mine('ZT01').total).toBeGreaterThanOrEqual(27);
  const sumA = await fn('wo_store_a', 'ga_ws_wo_summary', {});
  expect((sumA.data.stores as any[]).every((x) => x.store_id === s.VW001.id)).toBe(true);
  expect(await fn('wo_works', 'ga_ws_wo_summary', { p_filters: { status: 'X' } })).toMatchObject({ status: 400 });
  const sumDone = await fn('wo_works', 'ga_ws_wo_summary', { p_filters: { status: 'COMPLETED' } });
  expect((sumDone.data.stores as any[]).reduce((n, x) => n + x.completed, 0)).toBeGreaterThanOrEqual(1);
  expect((sumDone.data.stores as any[]).every((x) => x.unaccepted === 0 && x.processing === 0)).toBe(true);
});

test('詳情與時間軸：進度與公開事件合併（受理、轉店、用料、新增）；非總務端只看公開；舊照片唯讀合併；列印只含公開', async () => {
  const lk = await linked('TL', 'IN_PROGRESS');
  await db().from('maintenance_ticket_events').insert([
    { ticket_id: lk.w.id, event_type: 'STORE_MOVED', description: '設備轉店，工單隨之轉到新門市', visibility: 'PUBLIC', created_by: users.wo_manager.id },
    { ticket_id: lk.w.id, event_type: 'ACCEPT', description: '由總務需求單受理後建立維修工單。', visibility: 'PUBLIC', created_by: users.wo_manager.id },
    { ticket_id: lk.w.id, event_type: 'MIGRATED', description: '內部移轉紀錄', visibility: 'INTERNAL', created_by: users.wo_manager.id },
  ]);
  expect((await save('wo_works', lk.w, { notes: '公開進度一', progress_stage: 'SEARCHING_VENDOR' })).ok).toBe(true);
  expect((await save('wo_works', await woRow(lk.w.id), { notes: '內部進度二', visibility: 'INTERNAL' })).ok).toBe(true);
  // 舊照片（唯讀）：寫列與 bucket 檔
  const legacyPath = `${M7_FILE_PREFIX}legacy/${lk.w.id}/before.png`;
  expect((await db().storage.from('maintenance-photos').upload(legacyPath, PNG, { contentType: 'image/png', upsert: true })).error).toBeNull();
  await db().from('maintenance_photos').insert({ request_id: lk.w.id, storage_path: legacyPath, file_name: 'before.png', uploaded_by: users.wo_store_a.id, photo_type: 'before' });
  const upId = (await updatesOf(lk.w.id))[0].id;
  await db().from('maintenance_update_photos').insert({ update_id: upId, storage_path: `${M7_FILE_PREFIX}legacy/${lk.w.id}/progress.png`, file_name: 'progress.png', uploaded_by: users.wo_works.id });
  const ga = (await fn('wo_works', 'ga_ws_wo_get', { p_id: lk.w.id })).data;
  const texts = ga.timeline.map((t: any) => t.text) as string[];
  expect(texts).toEqual(expect.arrayContaining(['設備轉店，工單隨之轉到新門市', '由總務需求單受理後建立維修工單。', '內部移轉紀錄', '公開進度一', '內部進度二']));
  const ats = ga.timeline.map((t: any) => t.at);
  expect([...ats].sort()).toEqual(ats);
  expect(ga.legacy_photos).toHaveLength(2);
  expect(ga.legacy_photos.every((p: any) => p.legacy === true && p.storage_bucket === 'maintenance-photos')).toBe(true);
  expect(ga.work_order).toMatchObject({ request_no: lk.r.request_no, request_status: 'IN_PROGRESS', source: 'REQUEST' });
  const st = (await fn('wo_store_a', 'ga_ws_wo_get', { p_id: lk.w.id })).data;
  const sTexts = st.timeline.map((t: any) => t.text) as string[];
  expect(sTexts).toContain('設備轉店，工單隨之轉到新門市');
  expect(sTexts).not.toContain('內部移轉紀錄');
  expect(sTexts).not.toContain('內部進度二');
  expect(st.timeline.every((t: any) => t.visibility === 'PUBLIC' && !('by_name' in t && t.by_name))).toBe(true);
  expect(st.legacy_photos).toHaveLength(2);
  // 列印：公開時間軸、不含內部進度
  const p = await fn('wo_store_a', 'ga_ws_wo_print', { p_id: lk.w.id });
  expect(JSON.stringify(p.data.public_timeline)).toContain('公開進度一');
  expect(JSON.stringify(p.data.public_timeline)).not.toContain('內部進度二');
  expect(p.data.legacy_photos).toHaveLength(2);
  expect(p.data.work_order.wo_no).toBe(`WO-${lk.w.id.slice(0, 8).toUpperCase()}`);
  const pGa = await fn('wo_manager', 'ga_ws_wo_print', { p_id: lk.w.id, p_include_internal: true });
  expect(JSON.stringify(pGa.data.internal_updates)).toContain('內部進度二');
  // 找不到
  expect((await fn('wo_works', 'ga_ws_wo_get', { p_id: crypto.randomUUID() })).status).toBe(404);
  expect((await fn('wo_works', 'ga_ws_wo_print', { p_id: crypto.randomUUID() })).status).toBe(404);
});

// ----------------------------------------------------------------------------- RLS 收緊後直連行為
test('RLS（資料表直連）：只有 view_all 不能改不能刪；更新權限可改；店長不能改；回報人只能刪未受理且未連結的自己的單；讀取不空白', async () => {
  const w = await open('RLS');
  const un = await wo('RLS-UN');
  const accepted = await wo('RLS-ACC', { status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW' });
  const patch = async (who: PoKey, id: string, title: string) => {
    const r = await users[who].client.from('maintenance_requests').update({ description: title }).eq('id', id).select('id');
    return { n: (r.data || []).length, error: r.error?.message };
  };
  // 讀取：view_all 看得到（不空白）、店長看得到自己門市
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_works'] as PoKey[]) {
    const r = await users[k].client.from('maintenance_requests').select('id').eq('id', w.id);
    expect((r.data || []).length, `${k} 讀取`).toBe(1);
  }
  expect(((await users.wo_store_a.client.from('maintenance_requests').select('id').eq('id', w.id)).data || []).length).toBe(1);
  expect(((await users.wo_store_b.client.from('maintenance_requests').select('id').eq('id', w.id)).data || []).length).toBe(0);
  // 修改：只有 view_all 與店長 → 沒有任何列被改（靜默 0 列）；更新權限 → 1 列
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_store_a', 'wo_store_b', 'nobody', 'admin'] as PoKey[]) expect((await patch(k, w.id, `x-${k}`)).n, `${k} 不能改`).toBe(0);
  for (const k of ['wo_works', 'wo_manager', 'wo_mr_update', 'wo_cross_update'] as PoKey[]) expect((await patch(k, w.id, `y-${k}`)).n, `${k} 可以改`).toBe(1);
  expect((await woRow(w.id)).description).toBe('y-wo_cross_update');
  // 進度表寫入：view_all 不能寫；更新者可寫
  // （本人署名的寫入條款維持原樣：只有 view_all 的人不能用別人的名字寫進度，更新者可以）
  const insUp = (who: PoKey, as: PoKey = who) => users[who].client.from('maintenance_updates').insert({ request_id: w.id, status: 'PROCESSING', notes: `rls-${who}`, updated_by: users[as].id, updated_by_name: as });
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall'] as PoKey[]) {
    const r = await insUp(k, 'wo_works');
    expect(r.error, `${k} 不能用別人的名義寫進度`).not.toBeNull();
  }
  expect((await insUp('wo_works')).error).toBeNull();
  expect((await insUp('wo_mr_update', 'wo_works')).error).toBeNull();
  // 刪除：view_all 刪不掉（0 列）；已受理的單任何人（含更新權限）刪不掉；回報人只能刪未受理且未連結的自己的單
  for (const k of ['wo_viewall', 'wo_mr_viewall', 'wo_cross_viewall', 'wo_store_b', 'nobody'] as PoKey[]) {
    const r = await users[k].client.from('maintenance_requests').delete().eq('id', un.id).select('id');
    expect((r.data || []).length, `${k} 不能刪`).toBe(0);
  }
  expect(await woRow(un.id)).not.toBeNull();
  for (const k of ['wo_store_a', 'wo_manager'] as PoKey[]) {
    const r = await users[k].client.from('maintenance_requests').delete().eq('id', accepted.id).select('id');
    expect((r.data || []).length, `${k} 已受理不能刪`).toBe(0);
  }
  const lk = await linked('RLS-LK', 'IN_PROGRESS', { status: 'UNACCEPTED', progress_stage: null });
  expect(((await users.wo_store_a.client.from('maintenance_requests').delete().eq('id', lk.w.id).select('id')).data || []).length).toBe(0);
  expect(((await users.wo_store_a.client.from('maintenance_requests').delete().eq('id', un.id).select('id')).data || []).length).toBe(1);
  const un2 = await wo('RLS-UN2');
  expect(((await users.wo_mr_update.client.from('maintenance_requests').delete().eq('id', un2.id).select('id')).data || []).length).toBe(1);
});

// ----------------------------------------------------------------------------- 資料庫層（BEGIN…ROLLBACK）
test('資料庫層（交易內執行、結束一律回復）：子表連帶刪除、需求單刪除時連結設為空、階段常數與資料表 16 列對齊、內部旗標預設關閉', async () => {
  test.setTimeout(180_000);
  const s = await stores();
  const out = runSqlDo(`
DECLARE
  v_store uuid := '${s.ZT01.id}';
  v_uid uuid := '${users.wo_works.id}';
  v_wo uuid; v_up uuid; v_req uuid;
  n_up int; n_ev int; n_ph int; n_uph int; r_link text; r_stage boolean; r_flag text; r_count int; r_status text := 'none'; r_method text := 'none'; r_vis text := 'none'; r_mk text;
BEGIN
  INSERT INTO public.maintenance_requests (store_id, title, reported_by, reporter_name) VALUES (v_store, '${m7Name('DBWO')}', v_uid, 'db') RETURNING id INTO v_wo;
  INSERT INTO public.maintenance_updates (request_id, status, notes, updated_by, updated_by_name) VALUES (v_wo, 'ACCEPTED', 'n', v_uid, 'db') RETURNING id INTO v_up;
  INSERT INTO public.maintenance_update_photos (update_id, storage_path, file_name, uploaded_by) VALUES (v_up, 'p/x.png', 'x.png', v_uid);
  INSERT INTO public.maintenance_photos (request_id, storage_path, file_name, uploaded_by) VALUES (v_wo, 'p/y.png', 'y.png', v_uid);
  INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, description, created_by) VALUES (v_wo, 'CREATED', 'e', v_uid);
  INSERT INTO public.ga_service_requests (store_id, created_by, request_type, title, description, main_status) VALUES (v_store, v_uid, 'REPAIR', '${m7Name('DBREQ')}', 'x', 'IN_PROGRESS') RETURNING id INTO v_req;
  UPDATE public.maintenance_requests SET ga_service_request_id = v_req WHERE id = v_wo;
  DELETE FROM public.ga_service_requests WHERE id = v_req;
  SELECT coalesce(ga_service_request_id::text, 'NULL') INTO r_link FROM public.maintenance_requests WHERE id = v_wo;
  BEGIN UPDATE public.maintenance_requests SET status = 'DONE' WHERE id = v_wo; EXCEPTION WHEN OTHERS THEN r_status := SQLSTATE; END;
  BEGIN UPDATE public.maintenance_requests SET completion_method = 'MAGIC' WHERE id = v_wo; EXCEPTION WHEN OTHERS THEN r_method := SQLSTATE; END;
  BEGIN INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, description, visibility, created_by) VALUES (v_wo, 'X', 'e', 'SECRET', v_uid); EXCEPTION WHEN OTHERS THEN r_vis := SQLSTATE; END;
  DELETE FROM public.maintenance_requests WHERE id = v_wo;
  SELECT count(*) INTO n_up FROM public.maintenance_updates WHERE request_id = v_wo;
  SELECT count(*) INTO n_ev FROM public.maintenance_ticket_events WHERE ticket_id = v_wo;
  SELECT count(*) INTO n_ph FROM public.maintenance_photos WHERE request_id = v_wo;
  SELECT count(*) INTO n_uph FROM public.maintenance_update_photos WHERE update_id = v_up;
  SELECT (SELECT array_agg(code ORDER BY code) FROM public.maintenance_progress_stages) = (SELECT array_agg(c ORDER BY c) FROM unnest(public.ga_wo_stage_codes()) c) INTO r_stage;
  SELECT count(*) INTO r_count FROM public.maintenance_progress_stages;
  r_flag := coalesce(current_setting('app.ga_inv_internal_post', true), '');
  r_mk := public.ga_wo_no('00000000-1111-2222-3333-444444444444'::uuid);
  RAISE EXCEPTION 'G18DB:link=%,up=%,ev=%,ph=%,uph=%,stage=%,stages=%,flag=%,status=%,method=%,vis=%,no=%:END', r_link, n_up, n_ev, n_ph, n_uph, r_stage, r_count, r_flag, r_status, r_method, r_vis, r_mk;`, 'cascade');
  const m = /G18DB:([^:]*?):END/.exec(out);
  expect(m, out.slice(0, 1200)).not.toBeNull();
  const v = Object.fromEntries(m![1].split(',').map((kv) => kv.split('=')));
  expect(v).toMatchObject({ link: 'NULL', up: '0', ev: '0', ph: '0', uph: '0', stage: 't', stages: '16', flag: '', status: '23514', method: '23514', vis: '23514', no: 'WO-00000000' });
  const left = await db().from('maintenance_requests').select('id', { count: 'exact', head: true }).like('title', `${m7Name('DBWO')}%`);
  expect(left.count).toBe(0);
});

test('資料庫層（函式目錄）：全部 ga_ws_wo_* 與 ga_wo_* 都是 SECURITY DEFINER 並固定 search_path；匿名不能執行；內部輔助函式登入者不能執行；ga_ws_wo_* 登入者可執行', async () => {
  test.setTimeout(120_000);
  const out = runSqlDo(`
DECLARE
  r record;
  n_ws int := 0; n_int int := 0; bad_def text := ''; bad_anon text := ''; bad_auth text := ''; bad_int text := ''; bad_path text := '';
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'ga\\_ws\\_wo\\_%' OR p.proname LIKE 'ga\\_wo\\_%') LOOP
    IF r.proname LIKE 'ga\\_ws\\_wo\\_%' THEN n_ws := n_ws + 1; ELSE n_int := n_int + 1; END IF;
    IF NOT r.prosecdef AND r.proname NOT IN ('ga_wo_no', 'ga_wo_stage_codes', 'ga_wo_stage_label', 'ga_wo_status_label', 'ga_wo_is_exec_stage', 'ga_wo_focus', 'ga_wo_try_uuid') THEN bad_def := bad_def || r.proname || ' '; END IF;
    IF r.prosecdef AND NOT coalesce(r.proconfig::text LIKE '%search_path%', false) THEN bad_path := bad_path || r.proname || ' '; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN bad_anon := bad_anon || r.proname || ' '; END IF;
    IF r.proname LIKE 'ga\\_ws\\_wo\\_%' AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN bad_auth := bad_auth || r.proname || ' '; END IF;
    IF r.proname LIKE 'ga\\_wo\\_%' AND has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN bad_int := bad_int || r.proname || ' '; END IF;
  END LOOP;
  RAISE EXCEPTION 'G18DB:ws=%,int=%,def=[%],path=[%],anon=[%],auth=[%],internal=[%]:END', n_ws, n_int, bad_def, bad_path, bad_anon, bad_auth, bad_int;`, 'catalog');
  const m = /G18DB:(.*?):END/s.exec(out);
  expect(m, out.slice(0, 1200)).not.toBeNull();
  expect(m![1]).toMatch(/^ws=12,int=\d+,def=\[\],path=\[\],anon=\[\],auth=\[\],internal=\[\]$/);
});
