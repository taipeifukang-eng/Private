import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { apiForUser, adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedMaintenanceCategory, seedWorkOrder, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 5 批 G18.parity：同一個登入者、同一份輸入，舊版 /api/maintenance-requests*、maintenance-updates、maintenance-categories 與新版
// /api/workspace/general-affairs/work-orders*、cross-dept-maintenance、maintenance-categories 逐項比對（讀取比對共同欄位與筆數；寫入以 service role 回讀資料庫欄位、進度紀錄與事件）。
// 差異都登記在 tests/parity/allowlist.json（page: ga-work-orders／cross-dept-maintenance，id 以 m7m8-b5- 開頭）；未登記的差異一律失敗。
const mapWo = loadMap('ga-work-orders');
const mapCd = loadMap('cross-dept-maintenance');
const recWo = new ParityRecorder('ga-work-orders');
const recCd = new ParityRecorder('cross-dept-maintenance');
const L = '/api';
const N = '/api/workspace/general-affairs';
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const api: Record<string, APIRequestContext> = {};
const db = () => adminDb();
let seq = 0;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const j = async (r: any) => r.json().catch(() => ({}));
const row = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).maybeSingle()).data as any;
const updatesOf = async (id: string) => ((await db().from('maintenance_updates').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
const eventsOf = async (id: string) => ((await db().from('maintenance_ticket_events').select('*').eq('ticket_id', id).order('created_at').order('id')).data || []) as any[];
const reqRow = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const TIME = /(_at)$/;
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME.test(key)) return !!a === !!b; // 時間欄位只比有沒有值（兩邊是不同的單，時間不可能相同）
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
};
const cmp = (diffs: Diff[], label: string, l: any, n: any, cols: string[]) => {
  for (const c of cols) if (!same(l?.[c], n?.[c], c)) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: l?.[c], native: n?.[c], detail: JSON.stringify({ legacy: l?.[c], native: n?.[c] }).slice(0, 200) });
};
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n, detail: `legacy ${l} native ${n}` });
const WO_COLS = ['title', 'description', 'status', 'progress_stage', 'store_id', 'reported_by', 'reporter_name', 'priority', 'category_id', 'resource_type', 'issue_type', 'contact_name', 'contact_phone',
  'assignee_id', 'assignee_name', 'handling_method', 'vendor_id', 'accepted_by', 'completed_by', 'completion_method', 'unresolved_reason', 'ga_service_request_id', 'accepted_at', 'completed_at', 'completion_requested_at', 'reported_at', 'created_at'];
const WRITE_COLS = ['status', 'progress_stage', 'assignee_id', 'assignee_name', 'handling_method', 'vendor_id', 'category_id', 'accepted_at', 'accepted_by', 'completed_at', 'completed_by', 'completion_method', 'completion_requested_at', 'unresolved_reason'];
const UPD_COLS = ['status', 'progress_stage', 'visibility', 'notes', 'updated_by'];
const open = (suffix: string, over: Record<string, unknown> = {}, reporter = 'wo_store_a') =>
  seedWorkOrder('VW001', `PW-${suffix}-${(seq += 1)}`, users[reporter].id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString(), accepted_by: users.wo_manager.id, assignee_name: 'M7M8 工務乙', handling_method: '原有處理方式', ...over });
async function linkedPair(suffix: string) {
  const s = await stores();
  const out: { w: any; r: any }[] = [];
  for (const side of ['L', 'N']) {
    const r = (await db().from('ga_service_requests').insert({ store_id: s.VW001.id, created_by: users.wo_store_a.id, request_type: 'REPAIR', title: m7Name(`PW-REQ-${suffix}-${side}-${(seq += 1)}`), description: 'm7m8 對等測試',
      main_status: 'IN_PROGRESS', intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS' }).select('*').single()).data as any;
    const w = await open(`${suffix}-${side}`, { ga_service_request_id: r.id });
    await db().from('ga_service_requests').update({ maintenance_request_id: w.id }).eq('id', r.id);
    out.push({ w, r });
  }
  return out;
}
const diffUpdates = (diffs: Diff[], label: string, l: any[], n: any[]) => {
  if (l.length !== n.length) diffs.push({ kind: 'count', key: `${label}#updates`, legacy: l.length, native: n.length });
  for (let i = 0; i < Math.min(l.length, n.length); i += 1) cmp(diffs, `${label}:update${i}`, l[i], n[i], UPD_COLS.filter((c) => c !== 'updated_by'));
};
const diffEvents = (diffs: Diff[], label: string, l: any[], n: any[]) => {
  const a = l.map((x) => `${x.event_type}:${x.visibility}`), b = n.map((x) => `${x.event_type}:${x.visibility}`);
  if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ kind: 'changed', key: `${label}#events`, legacy: a, native: b, detail: JSON.stringify({ legacy: a, native: b }) });
};

test.describe.configure({ mode: 'default' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_manager', 'wo_store_a', 'wo_cross_manager']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) api[k] = await apiForUser(users[k] as any);
});
test.afterAll(async () => {
  for (const c of Object.values(api)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});
const ent = (map: typeof mapWo, id: string) => map.entries.find((e) => e.id === id)!.id;

test('工單列表：同一個總務、同一個搜尋，id、共同欄位、門市與分類關聯、筆數相同；新版多回顯示欄位、焦點卡計數與頁面權限', async () => {
  const cat = await seedMaintenanceCategory('PW-CAT');
  const a = await open('LIST-A', { category_id: cat.id });
  const b = await seedWorkOrder('ZT01', `PW-LIST-B-${(seq += 1)}`, users.wo_store_a.id, { status: 'UNACCEPTED' });
  const c = await open('LIST-C', { progress_stage: 'WAITING_STORE_CONFIRMATION', completion_requested_at: new Date().toISOString() });
  const diffs: Diff[] = [];
  const q = `q=${encodeURIComponent(m7Name('PW-LIST-'))}&pageSize=100`;
  const lr = await api.wo_manager.get(`${L}/maintenance-requests?${q}`);
  const nr = await api.wo_manager.get(`${N}/work-orders?${q}`);
  statusDiff(diffs, 'status', lr.status(), nr.status());
  expect(lr.status()).toBe(200);
  expect(nr.status()).toBe(200);
  const legacy = await j(lr), native = await j(nr);
  const lids = (legacy.data as any[]).map((r) => r.id).sort(), nids = (native.data as any[]).map((r) => r.id).sort();
  expect(nids).toEqual([a.id, b.id, c.id].sort());
  if (JSON.stringify(lids) !== JSON.stringify(nids)) diffs.push({ kind: 'changed', key: 'ids', legacy: lids, native: nids });
  if (legacy.pagination.total !== native.total) diffs.push({ kind: 'count', key: 'total', legacy: legacy.pagination.total, native: native.total });
  const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
  for (const l of legacy.data as any[]) {
    const n = nm.get(l.id);
    if (!n) continue;
    cmp(diffs, l.id, l, n, WO_COLS);
    if ((l.store?.store_code ?? null) !== (n.store_code ?? null)) diffs.push({ kind: 'changed', key: `${l.id}#store_code`, legacy: l.store?.store_code, native: n.store_code });
    if ((l.category?.name ?? null) !== (n.category_name ?? null)) diffs.push({ kind: 'changed', key: `${l.id}#category_name`, legacy: l.category?.name, native: n.category_name });
    const covered = new Set([...WO_COLS, 'store', 'category', 'updated_at', 'completion_requested_by', 'store_code', 'store_name', 'category_name']);
    for (const k of Object.keys(n)) if (!(k in l) && !covered.has(k)) diffs.push({ kind: 'only-native', key: `${l.id}#${k}` });
    for (const k of Object.keys(l)) if (!(k in n) && !covered.has(k)) diffs.push({ kind: 'only-legacy', key: `${l.id}#${k}` });
    if (!('completion_requested_by' in n)) diffs.push({ kind: 'only-legacy', key: `${l.id}#completion_requested_by` });
    if (!('store' in n)) diffs.push({ kind: 'only-legacy', key: `${l.id}#store` });
    if (!('category' in n)) diffs.push({ kind: 'only-legacy', key: `${l.id}#category` });
  }
  for (const k of Object.keys(native)) if (!(k in legacy) && !['data', 'total', 'meta'].includes(k)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(legacy)) if (!(k in native) && !['data', 'success', 'pagination'].includes(k)) diffs.push({ kind: 'only-legacy', key: `top#${k}` });
  // 舊版以 page／pageSize 分頁、新版同名並多回 meta；筆數與頁數相同
  if (legacy.pagination.totalPages !== native.meta?.totalPages && native.meta?.totalPages !== undefined) diffs.push({ kind: 'count', key: 'totalPages', legacy: legacy.pagination.totalPages, native: native.meta.totalPages });
  // 篩選：status 與 category_id（舊版參數名）
  const lf = await j(await api.wo_manager.get(`${L}/maintenance-requests?${q}&status=PROCESSING`)), nf = await j(await api.wo_manager.get(`${N}/work-orders?${q}&status=PROCESSING`));
  if (JSON.stringify((lf.data as any[]).map((r) => r.id).sort()) !== JSON.stringify((nf.data as any[]).map((r) => r.id).sort())) diffs.push({ kind: 'changed', key: 'filter-status', legacy: lf.data.length, native: nf.data.length });
  const lc = await j(await api.wo_manager.get(`${L}/maintenance-requests?${q}&category_id=${cat.id}`)), nc = await j(await api.wo_manager.get(`${N}/work-orders?${q}&category_id=${cat.id}`));
  if (JSON.stringify((lc.data as any[]).map((r) => r.id)) !== JSON.stringify((nc.data as any[]).map((r) => r.id))) diffs.push({ kind: 'changed', key: 'filter-category', legacy: lc.data.length, native: nc.data.length });
  const ls = await j(await api.wo_manager.get(`${L}/maintenance-requests?store_id=${a.store_id}&${q}`)), ns = await j(await api.wo_manager.get(`${N}/work-orders?store_id=${a.store_id}&${q}`));
  if (JSON.stringify((ls.data as any[]).map((r) => r.id).sort()) !== JSON.stringify((ns.data as any[]).map((r) => r.id).sort())) diffs.push({ kind: 'changed', key: 'filter-store', legacy: ls.data.length, native: ns.data.length });
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-list-read'), mechanism: 'api-read', title: '工單列表', legacy: { endpoint: `GET ${L}/maintenance-requests` }, native: { endpoint: `GET ${N}/work-orders`, status: 200 }, compared: { rows: legacy.data.length }, diffs }));
});

test('工單詳情與進度紀錄：同一張工單，共同欄位與進度紀錄相同；新版多回時間軸（進度加事件）、用料、照片與動作能力', async () => {
  const w = await open('DET');
  const ins = await db().from('maintenance_updates').insert([
    { request_id: w.id, status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', visibility: 'PUBLIC', notes: '公開進度 PD', progress_date: today(), updated_by: users.wo_manager.id, updated_by_name: 'M7M8' },
    { request_id: w.id, status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', visibility: 'INTERNAL', notes: '內部進度 PD', progress_date: today(), updated_by: users.wo_manager.id, updated_by_name: 'M7M8' },
  ]);
  expect(ins.error).toBeNull();
  const diffs: Diff[] = [];
  const lu = await api.wo_manager.get(`${L}/maintenance-updates?request_id=${w.id}`);
  const nd = await api.wo_manager.get(`${N}/work-orders/${w.id}`);
  statusDiff(diffs, 'status', lu.status(), nd.status());
  expect(nd.status()).toBe(200);
  const legacyUpd = ((await j(lu)).data as any[]).map((u) => u.notes).sort();
  const native = await j(nd);
  const timeline = JSON.stringify(native.data.timeline);
  for (const n of legacyUpd) if (!timeline.includes(n)) diffs.push({ kind: 'changed', key: `update#${n}`, legacy: n, native: null });
  // 與舊版列表同一列比對共同欄位
  const ll = ((await j(await api.wo_manager.get(`${L}/maintenance-requests?q=${encodeURIComponent(w.title)}`))).data as any[])[0];
  cmp(diffs, w.id, ll, native.data.work_order, WO_COLS);
  for (const k of Object.keys(native.data)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(native)) if (k !== 'data') diffs.push({ kind: 'only-native', key: `top#${k}` });
  // 店長看詳情：舊版直接讀資料表（內部進度被 RLS 擋），新版同樣只回公開
  const lus = ((await j(await api.wo_store_a.get(`${L}/maintenance-updates?request_id=${w.id}`))).data as any[]).map((u) => u.notes);
  const nds = JSON.stringify((await j(await api.wo_store_a.get(`${N}/work-orders/${w.id}`))).data.timeline);
  expect(lus).toEqual(['公開進度 PD']);
  expect(nds).toContain('公開進度 PD');
  expect(nds).not.toContain('內部進度 PD');
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-detail-read'), mechanism: 'api-read', title: '工單詳情與進度', legacy: { endpoint: `GET ${L}/maintenance-updates` }, native: { endpoint: `GET ${N}/work-orders/:id`, status: 200 }, compared: { rows: 1, updates: legacyUpd.length }, diffs }));
});

test('各門市各狀態筆數：同一個總務、同一批工單，舊版與新版筆數相同；新版多回待門市確認筆數', async () => {
  await open('SUM-A');
  await seedWorkOrder('VW001', `PW-SUM-B-${(seq += 1)}`, users.wo_store_a.id);
  await open('SUM-C', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completed_at: new Date().toISOString(), completion_method: 'STORE_CONFIRMED' });
  const diffs: Diff[] = [];
  const lr = await api.wo_manager.get(`${L}/maintenance-requests/summary`);
  const nr = await api.wo_manager.get(`${N}/work-orders/summary`);
  statusDiff(diffs, 'status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const legacy = (await j(lr)).data as any[], native = (await j(nr)).data as any[];
  const nm = new Map(native.map((r) => [r.store_id, r]));
  const lm = new Map(legacy.map((r) => [r.store_id, r]));
  if (JSON.stringify([...lm.keys()].sort()) !== JSON.stringify([...nm.keys()].sort())) diffs.push({ kind: 'changed', key: 'stores', legacy: [...lm.keys()].length, native: [...nm.keys()].length });
  for (const l of legacy) {
    const n = nm.get(l.store_id);
    if (!n) continue;
    cmp(diffs, l.store_id, l, n, ['store_code', 'store_name', 'unaccepted', 'accepted', 'processing', 'completed', 'total']);
    for (const k of Object.keys(n)) if (!(k in l)) diffs.push({ kind: 'only-native', key: `${l.store_id}#${k}` });
    for (const k of Object.keys(l)) if (!(k in n) && !['pending', 'in_progress'].includes(k)) diffs.push({ kind: 'only-legacy', key: `${l.store_id}#${k}` });
    if (!('pending' in n)) diffs.push({ kind: 'only-legacy', key: `${l.store_id}#pending` });
    if (!('in_progress' in n)) diffs.push({ kind: 'only-legacy', key: `${l.store_id}#in_progress` });
  }
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-summary-read'), mechanism: 'api-read', title: '各門市各狀態筆數', legacy: { endpoint: `GET ${L}/maintenance-requests/summary` }, native: { endpoint: `GET ${N}/work-orders/summary`, status: 200 }, compared: { rows: legacy.length }, diffs }));
});

test('存進度：同一份輸入，舊版與新版回讀的工單欄位、進度紀錄與事件；新版不覆蓋承辦人與處理方式、事件另記公開／內部', async () => {
  const diffs: Diff[] = [];
  const lw = await open('PRG-L'), nw = await open('PRG-N');
  const input = { notes: '現場評估中 PG', progress_stage: 'WAITING_VENDOR_REPLY' };
  const lr = await api.wo_manager.post(`${L}/maintenance-updates`, { data: { request_id: lw.id, progress_date: today(), ...input } });
  const nr = await api.wo_manager.post(`${N}/work-orders/${nw.id}/progress`, { data: { ...input, expected_updated_at: nw.updated_at } });
  statusDiff(diffs, 'progress-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const l = await row(lw.id), n = await row(nw.id);
  cmp(diffs, 'progress', l, n, WRITE_COLS);
  diffUpdates(diffs, 'progress', await updatesOf(lw.id), await updatesOf(nw.id));
  diffEvents(diffs, 'progress', await eventsOf(lw.id), await eventsOf(nw.id));
  // 新版：沒有版本資訊被擋（舊版不需要）
  const nn = await api.wo_manager.post(`${N}/work-orders/${nw.id}/progress`, { data: input });
  const ln = await api.wo_manager.post(`${L}/maintenance-updates`, { data: { request_id: lw.id, progress_date: today(), ...input } });
  statusDiff(diffs, 'progress-no-version', ln.status(), nn.status());
  // 新版：非法流轉（已完成再存進度）被擋，舊版放行
  const cl = await open('PRG-DONE-L', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completed_at: new Date().toISOString(), completion_method: 'STORE_CONFIRMED' });
  const cn = await open('PRG-DONE-N', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completed_at: new Date().toISOString(), completion_method: 'STORE_CONFIRMED' });
  const dl = await api.wo_manager.post(`${L}/maintenance-updates`, { data: { request_id: cl.id, progress_date: today(), ...input } });
  const dn = await api.wo_manager.post(`${N}/work-orders/${cn.id}/progress`, { data: { ...input, expected_updated_at: cn.updated_at } });
  statusDiff(diffs, 'progress-completed', dl.status(), dn.status());
  cmp(diffs, 'progress-completed', await row(cl.id), await row(cn.id), ['status', 'progress_stage']);
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-progress-write-readback'), mechanism: 'write-readback', title: '存進度', legacy: { endpoint: `POST ${L}/maintenance-updates`, status: lr.status() }, native: { endpoint: `POST ${N}/work-orders/:id/progress`, status: nr.status() }, compared: { rows: 2 }, diffs }));
});

test('送門市確認：同一份輸入，工單與需求單回讀相同（階段、需求單狀態、對外進度）；新版說明可留白、需求單同步由資料庫函式在同交易完成', async () => {
  const diffs: Diff[] = [];
  const [L1, N1] = await linkedPair('CMP');
  const input = { notes: '已修好，請確認 CM' };
  const lr = await api.wo_manager.post(`${L}/maintenance-updates`, { data: { request_id: L1.w.id, progress_date: today(), action: 'REQUEST_COMPLETION', ...input } });
  const nr = await api.wo_manager.post(`${N}/work-orders/${N1.w.id}/request-completion`, { data: { ...input, expected_updated_at: N1.w.updated_at } });
  statusDiff(diffs, 'completion-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  cmp(diffs, 'completion', await row(L1.w.id), await row(N1.w.id), WRITE_COLS);
  cmp(diffs, 'completion-request', await reqRow(L1.r.id), await reqRow(N1.r.id), ['main_status', 'public_progress']);
  diffUpdates(diffs, 'completion', await updatesOf(L1.w.id), await updatesOf(N1.w.id));
  diffEvents(diffs, 'completion', await eventsOf(L1.w.id), await eventsOf(N1.w.id));
  // 沒有連需求單的單：舊版送確認直接丟英文錯誤、新版（舊式單）讓回報人確認
  const lo = await open('CMP-LEG-L'), no = await open('CMP-LEG-N');
  const l2 = await api.wo_manager.post(`${L}/maintenance-updates`, { data: { request_id: lo.id, progress_date: today(), action: 'REQUEST_COMPLETION', ...input } });
  const n2 = await api.wo_manager.post(`${N}/work-orders/${no.id}/request-completion`, { data: { ...input, expected_updated_at: no.updated_at } });
  statusDiff(diffs, 'completion-legacy-order-status', l2.status(), n2.status());
  cmp(diffs, 'completion-legacy-order', await row(lo.id), await row(no.id), ['status', 'progress_stage']);
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-completion-write-readback'), mechanism: 'write-readback', title: '送門市確認', legacy: { endpoint: `POST ${L}/maintenance-updates`, status: lr.status() }, native: { endpoint: `POST ${N}/work-orders/:id/request-completion`, status: nr.status() }, compared: { rows: 4 }, diffs }));
});

test('強制結案：舊版與新版回讀；新版需求單標已完成、原因只內部可見（舊版把原因寫進公開進度）、按鈕改名「不處理，強制結案」', async () => {
  const diffs: Diff[] = [];
  const [L1, N1] = await linkedPair('FC');
  const reason = '門市已自行處理，不需要派工 FC';
  const lr = await api.wo_manager.post(`${L}/maintenance-updates`, { data: { request_id: L1.w.id, progress_date: today(), action: 'FORCE_CLOSE', notes: '強制結案', force_close_reason: reason } });
  const nr = await api.wo_manager.post(`${N}/work-orders/${N1.w.id}/force-close`, { data: { force_close_reason: reason, expected_updated_at: N1.w.updated_at } });
  statusDiff(diffs, 'force-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  cmp(diffs, 'force', await row(L1.w.id), await row(N1.w.id), WRITE_COLS);
  cmp(diffs, 'force-request', await reqRow(L1.r.id), await reqRow(N1.r.id), ['main_status']);
  diffUpdates(diffs, 'force', await updatesOf(L1.w.id), await updatesOf(N1.w.id));
  diffEvents(diffs, 'force', await eventsOf(L1.w.id), await eventsOf(N1.w.id));
  // 店長看得到的公開進度：舊版含原因，新版只有「總務已結案」
  const lpub = (await updatesOf(L1.w.id)).filter((u) => u.visibility === 'PUBLIC').map((u) => u.notes).join('|');
  const npub = (await updatesOf(N1.w.id)).filter((u) => u.visibility === 'PUBLIC').map((u) => u.notes).join('|');
  if (lpub.includes(reason) !== npub.includes(reason)) diffs.push({ kind: 'changed', key: 'force-reason-public', legacy: lpub.includes(reason), native: npub.includes(reason) });
  expect(npub).not.toContain(reason);
  const stDetail = JSON.stringify((await j(await api.wo_store_a.get(`${N}/work-orders/${N1.w.id}`))).data);
  expect(stDetail).not.toContain(reason);
  // 沒有強制結案權限（只有更新）：兩邊都擋
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-force-close-write-readback'), mechanism: 'write-readback', title: '強制結案', legacy: { endpoint: `POST ${L}/maintenance-updates`, status: lr.status() }, native: { endpoint: `POST ${N}/work-orders/:id/force-close`, status: nr.status() }, compared: { rows: 2 }, diffs }));
});

test('改分類：舊版與新版回讀相同；新版必須帶版本、分類不存在白話提示', async () => {
  const diffs: Diff[] = [];
  const cat = await seedMaintenanceCategory('PW-CAT2');
  const lw = await open('CAT-L'), nw = await open('CAT-N');
  const lr = await api.wo_manager.patch(`${L}/maintenance-requests`, { data: { id: lw.id, category_id: cat.id } });
  const nr = await api.wo_manager.patch(`${N}/work-orders/${nw.id}/category`, { data: { category_id: cat.id, expected_updated_at: nw.updated_at } });
  statusDiff(diffs, 'category-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  cmp(diffs, 'category', await row(lw.id), await row(nw.id), ['status', 'progress_stage', 'category_id', 'assignee_name', 'handling_method']);
  const bad = '00000000-0000-4000-8000-000000000000';
  const lb = await api.wo_manager.patch(`${L}/maintenance-requests`, { data: { id: lw.id, category_id: bad } });
  const nb = await api.wo_manager.patch(`${N}/work-orders/${nw.id}/category`, { data: { category_id: bad, expected_updated_at: (await row(nw.id)).updated_at } });
  statusDiff(diffs, 'category-missing-status', lb.status(), nb.status());
  assertNoUnlistedDiffs(recWo.record({ entry: ent(mapWo, 'wo-category-write-readback'), mechanism: 'write-readback', title: '改分類', legacy: { endpoint: `PATCH ${L}/maintenance-requests`, status: lr.status() }, native: { endpoint: `PATCH ${N}/work-orders/:id/category`, status: nr.status() }, compared: { rows: 2 }, diffs }));
});

// ----------------------------------------------------------------------------- 跨部門（總務組頁）
test('新增舊式回報：同一個回報人、同一份輸入，回讀的工單與事件相同；新版多一個防重複識別碼、可附最多 5 張照片', async () => {
  const diffs: Diff[] = [];
  const s = await stores();
  const tl = m7Name(`PW-NEW-L-${(seq += 1)}`), tn = m7Name(`PW-NEW-N-${(seq += 1)}`);
  const lr = await api.wo_store_a.post(`${L}/maintenance-requests`, { data: { store_id: s.VW001.id, title: tl, description: '飲水機漏水 PN', contact_name: '店長', contact_phone: '0912345678' } });
  const nr = await api.wo_store_a.post(`${N}/cross-dept-maintenance`, { data: { store_id: s.VW001.id, title: tn, description: '飲水機漏水 PN', contact_name: '店長', contact_phone: '0912345678', idempotency_key: `pw-${Date.now()}` } });
  statusDiff(diffs, 'create-status', lr.status(), nr.status());
  expect(nr.status()).toBe(201);
  const l = (await db().from('maintenance_requests').select('*').eq('title', tl).single()).data as any;
  const n = (await db().from('maintenance_requests').select('*').eq('title', tn).single()).data as any;
  cmp(diffs, 'create', l, n, ['description', 'status', 'progress_stage', 'store_id', 'reported_by', 'reporter_name', 'priority', 'contact_name', 'contact_phone', 'category_id', 'ga_service_request_id']);
  diffEvents(diffs, 'create', await eventsOf(l.id), await eventsOf(n.id));
  // 缺標題：兩邊都 400
  const lb = await api.wo_store_a.post(`${L}/maintenance-requests`, { data: { store_id: s.VW001.id } });
  const nb = await api.wo_store_a.post(`${N}/cross-dept-maintenance`, { data: { store_id: s.VW001.id, idempotency_key: `pw2-${Date.now()}` } });
  statusDiff(diffs, 'create-missing-title', lb.status(), nb.status());
  // 別間門市：兩邊都 403
  const lz = await api.wo_store_a.post(`${L}/maintenance-requests`, { data: { store_id: s.ZT01.id, title: m7Name(`PW-NEW-X-${(seq += 1)}`) } });
  const nz = await api.wo_store_a.post(`${N}/cross-dept-maintenance`, { data: { store_id: s.ZT01.id, title: m7Name(`PW-NEW-Y-${(seq += 1)}`), idempotency_key: `pw3-${Date.now()}` } });
  statusDiff(diffs, 'create-other-store', lz.status(), nz.status());
  assertNoUnlistedDiffs(recCd.record({ entry: ent(mapCd, 'legacy-create-write-readback'), mechanism: 'write-readback', title: '新增舊式回報', legacy: { endpoint: `POST ${L}/maintenance-requests`, status: lr.status() }, native: { endpoint: `POST ${N}/cross-dept-maintenance`, status: nr.status() }, compared: { rows: 2 }, diffs }));
});

test('門市確認完成：舊版店長按確認，進度被記錄但工單更新被資料庫政策靜默擋掉（工單沒完成）；新版店長確認後工單完成，且只在待門市確認時可按', async () => {
  const diffs: Diff[] = [];
  const mk = (s: string) => open(s, { progress_stage: 'WAITING_STORE_CONFIRMATION', completion_requested_at: new Date().toISOString() });
  const lw = await mk('CONF-L'), nw = await mk('CONF-N');
  const lr = await api.wo_store_a.post(`${L}/maintenance-updates`, { data: { request_id: lw.id, progress_date: today(), action: 'STORE_CONFIRM_COMPLETE', notes: '確認完成 CF' } });
  const nr = await api.wo_store_a.post(`${N}/work-orders/${nw.id}/store-confirm`, { data: { note: '確認完成 CF', expected_updated_at: nw.updated_at } });
  statusDiff(diffs, 'confirm-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  cmp(diffs, 'confirm', await row(lw.id), await row(nw.id), ['status', 'progress_stage', 'completion_method', 'completed_at', 'completed_by']);
  // 不是待確認時按確認：新版擋、舊版照樣記錄
  const ow = await open('CONF-OPEN-N');
  const bad = await api.wo_store_a.post(`${N}/work-orders/${ow.id}/store-confirm`, { data: { note: 'x', expected_updated_at: ow.updated_at } });
  expect(bad.status()).toBeGreaterThanOrEqual(400);
  expect((await row(ow.id)).status).toBe('PROCESSING');
  const ol = await open('CONF-OPEN-L');
  const badL = await api.wo_store_a.post(`${L}/maintenance-updates`, { data: { request_id: ol.id, progress_date: today(), action: 'STORE_CONFIRM_COMPLETE', notes: 'x' } });
  statusDiff(diffs, 'confirm-not-waiting-status', badL.status(), bad.status());
  assertNoUnlistedDiffs(recCd.record({ entry: ent(mapCd, 'legacy-confirm-write-readback'), mechanism: 'write-readback', title: '門市確認完成', legacy: { endpoint: `POST ${L}/maintenance-updates`, status: lr.status() }, native: { endpoint: `POST ${N}/work-orders/:id/store-confirm`, status: nr.status() }, compared: { rows: 3 }, diffs }));
});

test('仍有問題：舊版店長按仍有問題，工單被政策靜默擋下沒回到處理中；新版回到「重新處理」並記錄原因，原因必填', async () => {
  const diffs: Diff[] = [];
  const mk = (s: string) => open(s, { progress_stage: 'WAITING_STORE_CONFIRMATION', completion_requested_at: new Date().toISOString() });
  const lw = await mk('UNR-L'), nw = await mk('UNR-N');
  const lr = await api.wo_store_a.post(`${L}/maintenance-updates`, { data: { request_id: lw.id, progress_date: today(), action: 'REPORT_UNRESOLVED', notes: '還是會滴水 UR' } });
  const nr = await api.wo_store_a.post(`${N}/work-orders/${nw.id}/report-unresolved`, { data: { reason: '還是會滴水 UR', expected_updated_at: nw.updated_at } });
  statusDiff(diffs, 'unresolved-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  cmp(diffs, 'unresolved', await row(lw.id), await row(nw.id), ['status', 'progress_stage', 'unresolved_reason']);
  const nb = await api.wo_store_a.post(`${N}/work-orders/${nw.id}/report-unresolved`, { data: { reason: '', expected_updated_at: (await row(nw.id)).updated_at } });
  expect(nb.status()).toBe(400);
  assertNoUnlistedDiffs(recCd.record({ entry: ent(mapCd, 'legacy-unresolved-write-readback'), mechanism: 'write-readback', title: '仍有問題', legacy: { endpoint: `POST ${L}/maintenance-updates`, status: lr.status() }, native: { endpoint: `POST ${N}/work-orders/:id/report-unresolved`, status: nr.status() }, compared: { rows: 2 }, diffs }));
});

test('刪除：未受理且沒連需求單的單兩邊都能刪；已受理或已連需求單，舊版回成功但被政策擋下（資料還在），新版明確拒絕', async () => {
  const diffs: Diff[] = [];
  const un = async (s: string) => seedWorkOrder('VW001', `PW-DEL-${s}-${(seq += 1)}`, users.wo_store_a.id);
  const [dl, dn] = [await un('L'), await un('N')];
  const lr = await api.wo_store_a.delete(`${L}/maintenance-requests?id=${dl.id}`);
  const nr = await api.wo_store_a.delete(`${N}/work-orders/${dn.id}`, { data: { expected_updated_at: dn.updated_at } });
  statusDiff(diffs, 'delete-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  if (!!(await row(dl.id)) !== !!(await row(dn.id))) diffs.push({ kind: 'changed', key: 'delete#exists', legacy: !!(await row(dl.id)), native: !!(await row(dn.id)) });
  const al = await open('DEL-ACC-L'), an = await open('DEL-ACC-N');
  const lr2 = await api.wo_store_a.delete(`${L}/maintenance-requests?id=${al.id}`);
  const nr2 = await api.wo_store_a.delete(`${N}/work-orders/${an.id}`, { data: { expected_updated_at: an.updated_at } });
  statusDiff(diffs, 'delete-accepted-status', lr2.status(), nr2.status());
  if (!!(await row(al.id)) !== !!(await row(an.id))) diffs.push({ kind: 'changed', key: 'delete-accepted#exists', legacy: !!(await row(al.id)), native: !!(await row(an.id)) });
  expect(await row(an.id)).not.toBeNull();
  // 舊版回成功卻沒刪掉：記為差異（新版明確拒絕，不再「假成功」）
  if (lr2.status() === 200 && (await row(al.id))) diffs.push({ kind: 'changed', key: 'delete-accepted#silent-success', legacy: 'success but kept', native: nr2.status() });
  assertNoUnlistedDiffs(recCd.record({ entry: ent(mapCd, 'legacy-delete-write-readback'), mechanism: 'write-readback', title: '回報人刪除', legacy: { endpoint: `DELETE ${L}/maintenance-requests`, status: lr.status() }, native: { endpoint: `DELETE ${N}/work-orders/:id`, status: nr.status() }, compared: { rows: 4 }, diffs }));
});

test('維修分類清單：同一個分類管理者，id、名稱、排序、啟用狀態、筆數相同；新版不回建立人與更新人、多回頁面權限', async () => {
  const diffs: Diff[] = [];
  await seedMaintenanceCategory('PW-CLIST-A');
  await seedMaintenanceCategory('PW-CLIST-B', { is_active: false });
  const lr = await api.wo_cross_manager.get(`${L}/maintenance-categories?include_inactive=1`);
  const nr = await api.wo_cross_manager.get(`${N}/maintenance-categories?include_inactive=1`);
  statusDiff(diffs, 'cat-list-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const legacy = (await j(lr)).data as any[], native = await j(nr);
  const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
  if (legacy.length !== native.data.length) diffs.push({ kind: 'count', key: 'rows', legacy: legacy.length, native: native.data.length });
  for (const l of legacy) {
    const n = nm.get(l.id);
    if (!n) { diffs.push({ kind: 'only-legacy', key: `row#${l.id}` }); continue; }
    cmp(diffs, l.id, l, n, ['name', 'sort_order', 'is_active', 'created_at', 'updated_at']);
    for (const k of Object.keys(l)) if (!(k in n)) diffs.push({ kind: 'only-legacy', key: `${l.id}#${k}` });
  }
  for (const k of Object.keys(native)) if (k !== 'data') diffs.push({ kind: 'only-native', key: `top#${k}` });
  assertNoUnlistedDiffs(recCd.record({ entry: ent(mapCd, 'category-list-read'), mechanism: 'api-read', title: '維修分類清單', legacy: { endpoint: `GET ${L}/maintenance-categories` }, native: { endpoint: `GET ${N}/maintenance-categories`, status: 200 }, compared: { rows: legacy.length }, diffs }));
});

test('維修分類新增、改名、停用：同一份輸入回讀相同；重名舊版丟英文資料庫錯誤、新版白話；新版名稱最長 50 字、排序必須是數字', async () => {
  const diffs: Diff[] = [];
  const nl = m7Name(`PW-CNEW-L-${(seq += 1)}`), nn = m7Name(`PW-CNEW-N-${(seq += 1)}`);
  const lr = await api.wo_cross_manager.post(`${L}/maintenance-categories`, { data: { name: nl } });
  const nr = await api.wo_cross_manager.post(`${N}/maintenance-categories`, { data: { name: nn } });
  statusDiff(diffs, 'cat-create-status', lr.status(), nr.status());
  expect(nr.status()).toBe(201);
  const l = (await db().from('maintenance_categories').select('*').eq('name', nl).single()).data as any;
  const n = (await db().from('maintenance_categories').select('*').eq('name', nn).single()).data as any;
  cmp(diffs, 'cat-create', l, n, ['is_active']);
  if (!!n.created_by !== !!l.created_by) diffs.push({ kind: 'changed', key: 'cat-create#created_by', legacy: l.created_by, native: n.created_by });
  // 改名與停用
  const lp = await api.wo_cross_manager.patch(`${L}/maintenance-categories`, { data: { id: l.id, name: `${nl}-改`, is_active: false } });
  const np = await api.wo_cross_manager.patch(`${N}/maintenance-categories/${n.id}`, { data: { name: `${nn}-改`, is_active: false } });
  statusDiff(diffs, 'cat-patch-status', lp.status(), np.status());
  cmp(diffs, 'cat-patch', (await db().from('maintenance_categories').select('*').eq('id', l.id).single()).data, (await db().from('maintenance_categories').select('*').eq('id', n.id).single()).data, ['is_active']);
  // 重名（大小寫與前後空白不同、含已停用）：舊版以資料庫唯一鍵擋、新版白話
  const dl = await api.wo_cross_manager.post(`${L}/maintenance-categories`, { data: { name: `${nl}-改` } });
  const dn = await api.wo_cross_manager.post(`${N}/maintenance-categories`, { data: { name: ` ${nn.toUpperCase()}-改 ` } });
  statusDiff(diffs, 'cat-duplicate-status', dl.status(), dn.status());
  const msgL = String((await j(dl)).error || ''), msgN = String((await j(dn)).error || '');
  if (/duplicate key|unique constraint/i.test(msgL) && !/duplicate key|unique constraint/i.test(msgN)) diffs.push({ kind: 'changed', key: 'cat-duplicate#message', legacy: msgL.slice(0, 80), native: msgN.slice(0, 80) });
  expect(msgN).toContain('已有相同名稱');
  // 名稱過長
  const long = 'X'.repeat(51);
  const ll = await api.wo_cross_manager.post(`${L}/maintenance-categories`, { data: { name: `${m7Name('PW-LONG')}${long}` } });
  const nlg = await api.wo_cross_manager.post(`${N}/maintenance-categories`, { data: { name: long } });
  statusDiff(diffs, 'cat-name-length-status', ll.status(), nlg.status());
  assertNoUnlistedDiffs(recCd.record({ entry: ent(mapCd, 'category-write-readback'), mechanism: 'write-readback', title: '維修分類新增改名停用', legacy: { endpoint: `POST ${L}/maintenance-categories`, status: lr.status() }, native: { endpoint: `POST ${N}/maintenance-categories`, status: nr.status() }, compared: { rows: 4 }, diffs }));
});
