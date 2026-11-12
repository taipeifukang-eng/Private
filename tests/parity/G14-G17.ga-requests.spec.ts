import crypto from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G14 至 G17 對等層：舊版 /api/general-affairs/requests*、part-fulfillments* 與新版同功能 API，同一個登入者（總務）、同一份輸入逐項比對；
// 寫入以 service role 回讀資料庫欄位比對。差異都列在 tests/parity/allowlist.json（page: ga-requests）。
const map = loadMap('ga-requests');
const rec = new ParityRecorder('ga-requests');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
let ga: APIRequestContext;
let gaId = '';
let sid: Record<string, string> = {};
let part: any;
let part2: any;
let loc: any;

test.describe.configure({ mode: 'default' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  ga = await apiAs('ga_works');
  gaId = ((await adminDb().from('profiles').select('id').eq('email', 'vue-workspace-ga-works@example.test').single()).data as any).id;
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
  const cat = await seedCategory('part', 'PRQ');
  part = await seedPart(cat.id, 'PRQ-P1', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  part2 = await seedPart(cat.id, 'PRQ-P2', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  loc = await seedLocation(null, 'PRQ-L');
  for (const p of [part, part2]) await seedLocationPart(loc.id, p.id);
});
test.afterAll(async () => {
  await ga.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const TIME = /(_at|_since)$/;
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME.test(key) && a && b) return Date.parse(String(a)) === Date.parse(String(b));
  if (a !== null && b !== null && a !== undefined && b !== undefined && typeof a !== 'object' && typeof b !== 'object' && String(a).trim() !== '' && String(b).trim() !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) === Number(b);
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
};
function diffRow(diffs: Diff[], label: string, legacy: any, native: any, nested: string[] = []) {
  for (const k of Object.keys(legacy)) {
    if (nested.includes(k)) continue;
    if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${label}#${k}` });
    else if (!same(legacy[k], native[k], k)) diffs.push({ kind: 'changed', key: `${label}#${k}`, legacy: legacy[k], native: native[k] });
  }
  for (const k of Object.keys(native)) if (!nested.includes(k) && !(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
  for (const k of nested) {
    const l = legacy[k], n = native[k];
    if (l && n && typeof l === 'object' && !Array.isArray(l)) for (const kk of Object.keys(l)) if (!(kk in n)) diffs.push({ kind: 'only-legacy', key: `${label}:${k}#${kk}` }); else if (!same(l[kk], n[kk], kk)) diffs.push({ kind: 'changed', key: `${label}:${k}#${kk}`, legacy: l[kk], native: n[kk] });
    if (l && n && typeof n === 'object' && !Array.isArray(n)) for (const kk of Object.keys(n)) if (!(l && kk in l)) diffs.push({ kind: 'only-native', key: `${label}:${k}#${kk}` });
  }
}
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });
const key = () => crypto.randomUUID();
const mk = (storeCode: 'VW001' | 'ZT01', suffix: string, over: Record<string, unknown> = {}) => seedRequest(sid[storeCode], gaId, suffix, { part_id: part.id, desired_unit: part.base_unit, ...over });
const dbReq = async (id: string) => (await adminDb().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const ver = async (id: string) => (await dbReq(id)).updated_at as string;
const dbEv = async (id: string) => ((await adminDb().from('ga_service_request_events').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
const dbBal = async (l: string, p: string) => Number(((await adminDb().from('ga_inventory_balances').select('quantity_base').eq('location_id', l).eq('part_id', p).maybeSingle()).data as any)?.quantity_base ?? 0);
const REQ_COLS = ['main_status', 'intake_route', 'assignee_role', 'assignee_name', 'public_progress', 'internal_note', 'rejection_reason', 'rejection_note', 'supplement_type', 'supplement_note'];
const cmpCols = (diffs: Diff[], label: string, l: any, n: any, cols = REQ_COLS) => {
  for (const c of cols) if (!same(l?.[c], n?.[c], c)) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: l?.[c], native: n?.[c] });
};

test('需求單清單：同一個登入者、同一個搜尋，id、欄位、門市與設備設施料件關聯、筆數相同；新版多回內部欄位、逾期標示、統計與動作', async () => {
  const e = entry('request-list-read');
  const a = await mk('VW001', 'RL-A', { main_status: 'PENDING_INTAKE' });
  const b = await mk('ZT01', 'RL-B', { main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'TRANSFER' });
  const diffs: Diff[] = [];
  const q = `search=${encodeURIComponent(m7Name('RL-'))}&pageSize=100`;
  const lr = await ga.get(`${L}/requests?${q}`);
  const nr = await ga.get(`${N}/requests?${q}`);
  statusDiff(diffs, 'status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const legacy = await body(lr), native = await body(nr);
  const lids = (legacy.data as any[]).map((r) => r.id), nids = (native.data as any[]).map((r) => r.id);
  expect(nids.sort()).toEqual([a.id, b.id].sort());
  // 兩張單的建立時間可能相同（同一毫秒內種入），排序由各自的次序規則決定；這裡比對的是同一批單（集合相同），不比次序。
  if (JSON.stringify([...lids].sort()) !== JSON.stringify([...nids].sort())) diffs.push({ kind: 'changed', key: 'ids', legacy: lids, native: nids });
  for (const k of Object.keys(legacy.meta)) if (legacy.meta[k] !== native.meta[k]) diffs.push({ kind: 'count', key: `meta#${k}`, legacy: legacy.meta[k], native: native.meta[k] });
  const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
  let compared = 0;
  for (const l of legacy.data as any[]) {
    compared += 1;
    const n = nm.get(l.id);
    if (n) diffRow(diffs, l.id, l, n, ['store', 'equipment', 'facility', 'part']);
  }
  for (const k of Object.keys(native)) if (!(k in legacy) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(legacy)) if (!(k in native) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-legacy', key: `top#${k}` });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '需求單清單', legacy: { endpoint: `GET ${L}/requests` }, native: { endpoint: `GET ${N}/requests`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('需求單詳情：同一張單，需求欄位、事件、留言比對；新版多回動作、關聯採購單、處理單與單據摘要，留言多回已編輯／已刪除標示', async () => {
  const e = entry('request-detail-read');
  const r = await mk('VW001', 'RD', { main_status: 'ACCEPTED', intake_route: 'TRANSFER' });
  await ga.post(`${N}/requests/${r.id}/comments`, { data: { body: '公開留言 RD' } });
  await ga.post(`${N}/requests/${r.id}/comments`, { data: { body: '內部備註 RD', visibility: 'INTERNAL' } });
  const diffs: Diff[] = [];
  const lr = await ga.get(`${L}/requests/${r.id}?surface=GA_WORKBENCH`);
  const nr = await ga.get(`${N}/requests/${r.id}?surface=GA_WORKBENCH`);
  statusDiff(diffs, 'status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const legacy = await body(lr), native = await body(nr);
  diffRow(diffs, 'data', legacy.data, native.data, ['store', 'equipment', 'facility', 'part']);
  const lc = (legacy.comments as any[]).map((c) => ({ id: c.id, body: c.body, visibility: c.visibility })), nc = (native.comments as any[]).map((c) => ({ id: c.id, body: c.body, visibility: c.visibility }));
  if (JSON.stringify(lc) !== JSON.stringify(nc)) diffs.push({ kind: 'changed', key: 'comments', legacy: lc, native: nc });
  const le = (legacy.events as any[]).map((x) => x.id), ne = (native.events as any[]).map((x) => x.id);
  if (JSON.stringify(le) !== JSON.stringify(ne)) diffs.push({ kind: 'changed', key: 'events', legacy: le, native: ne });
  if ((legacy.comments as any[])[0]) diffRow(diffs, 'comment', legacy.comments[0], native.comments[0]);
  for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `top#${k}` });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '需求單詳情', legacy: { endpoint: `GET ${L}/requests/:id` }, native: { endpoint: `GET ${N}/requests/:id`, status: 200 }, compared: { rows: 1 }, diffs }));
});

test('受理：同一份輸入，舊版與新版受理後狀態、分流、承辦、進度、內部備註相同；新規則擋已完成、維修走採購、非料件走出庫（舊版都放行）；新版必須帶版本', async () => {
  const e = entry('request-accept-write-readback');
  const diffs: Diff[] = [];
  const input = { action: 'accept', intake_route: 'TRANSFER', assignee_role: 'GENERAL_AFFAIRS', assignee_name: '測試承辦', internal_note: '受理備註 PA' };
  const l1 = await mk('VW001', 'PA-L', { main_status: 'PENDING_INTAKE' }), n1 = await mk('VW001', 'PA-N', { main_status: 'PENDING_INTAKE' });
  const lr = await ga.patch(`${L}/requests/${l1.id}`, { data: input });
  const nr = await ga.patch(`${N}/requests/${n1.id}`, { data: { ...input, expected_updated_at: await ver(n1.id) } });
  statusDiff(diffs, 'accept-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  cmpCols(diffs, 'accept', await dbReq(l1.id), await dbReq(n1.id));
  const evL = (await dbEv(l1.id)).map((x) => x.event_type), evN = (await dbEv(n1.id)).map((x) => x.event_type);
  if (JSON.stringify(evL) !== JSON.stringify(evN)) diffs.push({ kind: 'changed', key: 'accept-events', legacy: evL, native: evN });
  // 已完成再受理
  const l2 = await mk('VW001', 'PA-L2', { main_status: 'COMPLETED' }), n2 = await mk('VW001', 'PA-N2', { main_status: 'COMPLETED' });
  const lr2 = await ga.patch(`${L}/requests/${l2.id}`, { data: input });
  const nr2 = await ga.patch(`${N}/requests/${n2.id}`, { data: { ...input, expected_updated_at: await ver(n2.id) } });
  statusDiff(diffs, 'accept-completed-status', lr2.status(), nr2.status());
  expect(nr2.status()).toBe(409);
  // 維修單走採購評估
  const rp = { request_type: 'REPAIR', resource_type: null, part_id: null, desired_quantity: null, main_status: 'PENDING_INTAKE' };
  const l3 = await mk('VW001', 'PA-L3', rp), n3 = await mk('VW001', 'PA-N3', rp);
  const lr3 = await ga.patch(`${L}/requests/${l3.id}`, { data: { ...input, intake_route: 'PURCHASE_REVIEW' } });
  const nr3 = await ga.patch(`${N}/requests/${n3.id}`, { data: { ...input, intake_route: 'PURCHASE_REVIEW', expected_updated_at: await ver(n3.id) } });
  statusDiff(diffs, 'accept-repair-purchase-status', lr3.status(), nr3.status());
  expect(nr3.status()).toBe(422);
  // 非料件走庫存出庫
  const np = { resource_type: 'OTHER_PURCHASE', part_id: null, main_status: 'PENDING_INTAKE' };
  const l4 = await mk('VW001', 'PA-L4', np), n4 = await mk('VW001', 'PA-N4', np);
  const lr4 = await ga.patch(`${L}/requests/${l4.id}`, { data: { ...input, intake_route: 'STOCK_ISSUE' } });
  const nr4 = await ga.patch(`${N}/requests/${n4.id}`, { data: { ...input, intake_route: 'STOCK_ISSUE', expected_updated_at: await ver(n4.id) } });
  statusDiff(diffs, 'accept-nonpart-stock-status', lr4.status(), nr4.status());
  expect(nr4.status()).toBe(422);
  // 沒帶版本
  const l5 = await mk('VW001', 'PA-L5', { main_status: 'PENDING_INTAKE' }), n5 = await mk('VW001', 'PA-N5', { main_status: 'PENDING_INTAKE' });
  const lr5 = await ga.patch(`${L}/requests/${l5.id}`, { data: input });
  const nr5 = await ga.patch(`${N}/requests/${n5.id}`, { data: input });
  statusDiff(diffs, 'accept-without-version-status', lr5.status(), nr5.status());
  expect(nr5.status()).toBe(400);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '受理', legacy: { endpoint: `PATCH ${L}/requests/:id` }, native: { endpoint: `PATCH ${N}/requests/:id`, status: 200 }, compared: { rows: 5 }, diffs }));
});

test('門市確認完成（總務代按）：舊版直接完成；新版必須填說明並標「總務代門市操作」；完成後狀態、完成時間相同', async () => {
  const e = entry('request-store-action-write-readback');
  const diffs: Diff[] = [];
  const l1 = await mk('VW001', 'SA-L', { main_status: 'WAITING_STORE_CONFIRMATION' }), n1 = await mk('VW001', 'SA-N', { main_status: 'WAITING_STORE_CONFIRMATION' });
  const lr = await ga.post(`${L}/requests/${l1.id}/store-actions`, { data: { action: 'confirm_complete', note: '電話確認' } });
  const nrNoNote = await ga.post(`${N}/requests/${n1.id}/store-actions`, { data: { action: 'confirm_complete' } });
  statusDiff(diffs, 'proxy-without-note-status', 200, nrNoNote.status());
  expect(nrNoNote.status()).toBe(400);
  const nr = await ga.post(`${N}/requests/${n1.id}/store-actions`, { data: { action: 'confirm_complete', note: '電話確認' } });
  statusDiff(diffs, 'confirm-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const rl = await dbReq(l1.id), rn = await dbReq(n1.id);
  cmpCols(diffs, 'confirm', rl, rn, ['main_status', 'public_progress']);
  if (!!rl.completed_at !== !!rn.completed_at) diffs.push({ kind: 'changed', key: 'confirm#completed_at', legacy: rl.completed_at, native: rn.completed_at });
  const el = (await dbEv(l1.id)).find((x) => x.event_type === 'STORE_COMPLETION_CONFIRMED'), en = (await dbEv(n1.id)).find((x) => x.event_type === 'STORE_COMPLETION_CONFIRMED');
  if (el.proxy_for_store !== en.proxy_for_store) diffs.push({ kind: 'changed', key: 'confirm-event#proxy_for_store', legacy: el.proxy_for_store, native: en.proxy_for_store });
  if (el.title !== en.title) diffs.push({ kind: 'changed', key: 'confirm-event#title', legacy: el.title, native: en.title });
  // 狀態不對：兩邊都 409
  const l2 = await mk('VW001', 'SA-L2', { main_status: 'IN_PROGRESS' }), n2 = await mk('VW001', 'SA-N2', { main_status: 'IN_PROGRESS' });
  const lr2 = await ga.post(`${L}/requests/${l2.id}/store-actions`, { data: { action: 'confirm_complete', note: 'x' } });
  const nr2 = await ga.post(`${N}/requests/${n2.id}/store-actions`, { data: { action: 'confirm_complete', note: 'x' } });
  statusDiff(diffs, 'confirm-wrong-state-status', lr2.status(), nr2.status());
  expect(nr2.status()).toBe(409);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '門市動作', legacy: { endpoint: `POST ${L}/requests/:id/store-actions` }, native: { endpoint: `POST ${N}/requests/:id/store-actions`, status: 200 }, compared: { rows: 3 }, diffs }));
});

test('料件處理單清單：同一張需求單的處理單、單據、事件欄位比對；新版多回待交付、動作、分頁與統計，單據多回作廢欄位', async () => {
  const e = entry('fulfillment-list-read');
  const diffs: Diff[] = [];
  const r = await mk('VW001', 'FL', { main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE', desired_quantity: 5 });
  const ins = await adminDb().from('ga_part_fulfillments').insert({ request_id: r.id, status: 'STOCK_ISSUE', requested_quantity: 5, fulfilled_quantity: 2, unit: part.base_unit, current_step: '已建立出庫單', created_by: gaId }).select('*').single();
  expect(ins.error).toBeNull();
  const fid = (ins.data as any).id as string;
  await adminDb().from('ga_part_fulfillment_documents').insert({ fulfillment_id: fid, document_type: 'STOCK_ISSUE', document_id: crypto.randomUUID(), document_no: 'TST-FL', quantity: 2, status: 'POSTED', created_by: gaId });
  await adminDb().from('ga_part_fulfillment_events').insert({ fulfillment_id: fid, event_type: 'STOCK_ISSUED', title: '測試事件', description: 'FL', created_by: gaId });
  const lr = await ga.get(`${L}/part-fulfillments?requestId=${r.id}`);
  const nr = await ga.get(`${N}/part-fulfillments?requestId=${r.id}`);
  statusDiff(diffs, 'status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const legacy = await body(lr), native = await body(nr);
  expect((native.data as any[]).map((x) => x.id)).toEqual([fid]);
  const l = (legacy.data as any[])[0], n = (native.data as any[])[0];
  diffRow(diffs, fid, l, n, ['request', 'documents', 'events']);
  diffRow(diffs, `${fid}:request`, l.request, n.request, ['store', 'part']);
  const ld = l.documents[0], nd = n.documents.find((x: any) => x.id === ld.id);
  if (nd) diffRow(diffs, `${fid}:document`, ld, nd); else diffs.push({ kind: 'changed', key: `${fid}:document-missing`, legacy: ld.id, native: null });
  const le = l.events[0], ne = n.events.find((x: any) => x.id === le.id);
  if (ne) diffRow(diffs, `${fid}:event`, le, ne); else diffs.push({ kind: 'changed', key: `${fid}:event-missing`, legacy: le.id, native: null });
  for (const k of Object.keys(native)) if (!(k in legacy) && k !== 'data') diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(legacy)) if (!(k in native) && k !== 'data') diffs.push({ kind: 'only-legacy', key: `top#${k}` });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '料件處理單清單', legacy: { endpoint: `GET ${L}/part-fulfillments` }, native: { endpoint: `GET ${N}/part-fulfillments`, status: 200 }, compared: { rows: 1 }, diffs }));
});

test('庫存出庫：同一份輸入出庫後庫存、處理單、單據相同；新規則擋超量與替代料未填原因（舊版第一次出庫可超量、料件不核對）', async () => {
  const e = entry('stock-issue-write-readback');
  const diffs: Diff[] = [];
  await seedBalance(loc.id, part.id, 100);
  await seedBalance(loc.id, part2.id, 100);
  const base = { desired_quantity: 3, main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE' };
  const l1 = await mk('VW001', 'SI-L', base), n1 = await mk('VW001', 'SI-N', base);
  const lb = await dbBal(loc.id, part.id);
  const lr = await ga.post(`${L}/requests/${l1.id}/stock-issue`, { data: { locationId: loc.id, partId: part.id, quantity: 2, inputUnitType: 'BASE', idempotencyKey: key(), reason: '出庫 SI' } });
  const nr = await ga.post(`${N}/requests/${n1.id}/stock-issue`, { data: { location_id: loc.id, part_id: part.id, quantity: 2, input_unit_type: 'BASE', idempotency_key: key(), reason: '出庫 SI' } });
  statusDiff(diffs, 'issue-status', lr.status(), nr.status());
  expect(nr.status()).toBe(201);
  expect(await dbBal(loc.id, part.id)).toBe(lb - 4);
  const fl = (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', l1.id).single()).data as any;
  const fn = (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', n1.id).single()).data as any;
  for (const c of ['status', 'requested_quantity', 'fulfilled_quantity', 'unit', 'current_step']) if (!same(fl[c], fn[c], c)) diffs.push({ kind: 'changed', key: `issue-fulfillment#${c}`, legacy: fl[c], native: fn[c] });
  cmpCols(diffs, 'issue-request', await dbReq(l1.id), await dbReq(n1.id), ['main_status', 'public_progress']);
  // 超量（需求 3，再出 5）
  const lr2 = await ga.post(`${L}/requests/${l1.id}/stock-issue`, { data: { locationId: loc.id, partId: part.id, quantity: 5, inputUnitType: 'BASE', idempotencyKey: key() } });
  const nr2 = await ga.post(`${N}/requests/${n1.id}/stock-issue`, { data: { location_id: loc.id, part_id: part.id, quantity: 5, input_unit_type: 'BASE', idempotency_key: key() } });
  statusDiff(diffs, 'issue-over-status', lr2.status(), nr2.status());
  expect(nr2.status()).toBe(409);
  // 第一次出庫就超量（舊版還沒有處理單時不檢查剩餘量）
  const l4 = await mk('VW001', 'SI-L4', base), n4 = await mk('VW001', 'SI-N4', base);
  const lr4 = await ga.post(`${L}/requests/${l4.id}/stock-issue`, { data: { locationId: loc.id, partId: part.id, quantity: 5, inputUnitType: 'BASE', idempotencyKey: key() } });
  const nr4 = await ga.post(`${N}/requests/${n4.id}/stock-issue`, { data: { location_id: loc.id, part_id: part.id, quantity: 5, input_unit_type: 'BASE', idempotency_key: key() } });
  statusDiff(diffs, 'issue-first-over-status', lr4.status(), nr4.status());
  expect(nr4.status()).toBe(409);
  // 替代料
  const l3 = await mk('VW001', 'SI-L3', base), n3 = await mk('VW001', 'SI-N3', base);
  const lr3 = await ga.post(`${L}/requests/${l3.id}/stock-issue`, { data: { locationId: loc.id, partId: part2.id, quantity: 1, inputUnitType: 'BASE', idempotencyKey: key() } });
  const nr3 = await ga.post(`${N}/requests/${n3.id}/stock-issue`, { data: { location_id: loc.id, part_id: part2.id, quantity: 1, input_unit_type: 'BASE', idempotency_key: key() } });
  statusDiff(diffs, 'issue-substitute-status', lr3.status(), nr3.status());
  expect(nr3.status()).toBe(422);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '庫存出庫', legacy: { endpoint: `POST ${L}/requests/:id/stock-issue` }, native: { endpoint: `POST ${N}/requests/:id/stock-issue`, status: 201 }, compared: { rows: 3 }, diffs }));
});
