import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, row, seedCategory, seedEquipment, stores } from '../support/m7m8-fixtures';
import { createRequire } from 'node:module';
import path from 'node:path';

// M7/M8 第 4 批 G27（B6，D20、D21）對等層：舊版直接改設備所屬門市時，進行中的報修單與工單一律留在舊門市；
// 新版（轉移單確認收到、更正所屬門市）維修類未結案單與工單一起轉到新門市。舊版沒有搬單、時間軸事件與搬走明細，所以這些列入白名單（page: ga-asset-move）。
const nodeRequire = createRequire(path.join(__dirname, 'G27.ga-asset-move.spec.ts'));
const accountId = (k: string) => (nodeRequire('../support/credentials.cjs') as { getAccount: (k: string) => { userId: string } }).getAccount(k).userId;
const map = loadMap('ga-asset-move');
const rec = new ParityRecorder('ga-asset-move');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'store_manager', 'ga_store_manager_b'];
let eqCat: { id: string };
const body = async (r: any) => r.json().catch(() => ({}));

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  eqCat = await seedCategory('equipment', 'PM');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

/** 一台設備、一張維修單（含工單）、一張添購單、一張舊式工單。 */
async function seedSet(tag: string) {
  const s = await stores();
  const eq = await seedEquipment('ZT01', eqCat.id, `PM-${tag}`);
  const uid = accountId('store_manager');
  const mk = async (type: string, status: string, suffix: string) => ((await adminDb().from('ga_service_requests').insert({
    store_id: s.ZT01.id, created_by: uid, request_type: type, title: m7Name(`PM-${tag}-${suffix}`), description: 'parity', resource_type: 'EQUIPMENT', equipment_id: eq.id, main_status: status,
  }).select('*').single()).data as any);
  const repair = await mk('REPAIR', 'WAITING_STORE_CONFIRMATION', 'R');
  const wo = (await adminDb().from('maintenance_requests').insert({
    store_id: s.ZT01.id, title: m7Name(`PM-${tag}-W`), description: 'parity', reported_by: uid, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING', resource_type: 'equipment', ga_service_request_id: repair.id,
  }).select('*').single()).data as any;
  await adminDb().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('id', repair.id);
  const purchase = await mk('PURCHASE_SUPPLEMENT', 'IN_PROGRESS', 'P');
  const legacyWo = (await adminDb().from('maintenance_requests').insert({
    store_id: s.ZT01.id, title: m7Name(`PM-${tag} 舊工單 ${eq.name}`), description: '舊式工單', reported_by: uid, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING', resource_type: 'equipment',
  }).select('*').single()).data as any;
  return { s, eq, repair, wo, purchase, legacyWo };
}
/** 兩版詳情共同的欄位（舊版回 { data: { request... } } 或 { data }，兩邊都取 store_id、main_status、request_no）。 */
const view = (b: any) => { const d = b?.data?.request ?? b?.data ?? {}; return { request_no: d.request_no, store_id: d.store_id, main_status: d.main_status }; };

test('同樣換店：舊版（直接改所屬門市）單子留在舊門市；新版（轉移單確認收到）維修類未結案單與工單轉到新門市，添購單留下；兩版 API 讀到的結果一致', async () => {
  const e = entry('transfer-follow-readback');
  const legacy = await seedSet('L');
  const native = await seedSet('N');
  const { s } = native;
  const diffs: Diff[] = [];

  // 舊版：總務改設備所屬門市
  const lp = await apis.ga_works.patch(`${L}/equipment/${legacy.eq.id}`, { data: { store_id: s.VW001.id } });
  expect(lp.status()).toBe(200);
  expect((await row('ga_equipment', legacy.eq.id)).store_id).toBe(s.VW001.id);
  expect((await row('ga_service_requests', legacy.repair.id)).store_id).toBe(s.ZT01.id);
  expect((await row('maintenance_requests', legacy.wo.id)).store_id).toBe(s.ZT01.id);

  // 新版：轉移單
  const made = await apis.ga_works.post(`${N}/transfers`, { data: { assetType: 'EQUIPMENT', assetId: native.eq.id, toStoreId: s.VW001.id, reason: 'parity G27' } });
  expect(made.status()).toBe(201);
  const id = (await body(made)).data.id as string;
  expect((await apis.store_manager.post(`${N}/transfers/${id}/handover`, { data: {} })).status()).toBe(200);
  expect((await apis.ga_store_manager_b.post(`${N}/transfers/${id}/receive`, { data: {} })).status()).toBe(200);
  expect((await row('ga_equipment', native.eq.id)).store_id).toBe(s.VW001.id);

  // 兩版 API 對同一張單的讀取一致（各自看自己那組）：舊版組讀回舊門市；新版組兩版 API 都讀回新門市
  const nativeRepair = native.repair;
  const lr = view(await body(await apis.ga_works.get(`${L}/requests/${nativeRepair.id}`)));
  const nr = view(await body(await apis.ga_works.get(`${N}/requests/${nativeRepair.id}`)));
  if (lr.store_id !== nr.store_id || lr.main_status !== nr.main_status) diffs.push({ kind: 'changed', key: 'moved-request-view', legacy: lr, native: nr });
  expect(lr.store_id).toBe(s.VW001.id);
  expect(nr.store_id).toBe(s.VW001.id);
  expect(nr.main_status).toBe('WAITING_STORE_CONFIRMATION');
  expect((await row('maintenance_requests', native.wo.id)).store_id).toBe(s.VW001.id);
  expect((await row('ga_service_requests', native.purchase.id)).store_id).toBe(s.ZT01.id);
  expect((await row('maintenance_requests', native.legacyWo.id)).store_id).toBe(s.ZT01.id);
  // 舊版組的單子留在舊門市 vs 新版組的單子轉到新門市：核可差異
  diffs.push({ kind: 'changed', key: 'open-requests-follow-asset', legacy: { store: 'ZT01（單子留在舊門市）' }, native: { store: 'VW001（單子轉到新門市）' } });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '換店後單子的所屬門市', legacy: { endpoint: `GET ${L}/requests/:id` }, native: { endpoint: `GET ${N}/requests/:id` }, compared: { rows: 2 }, diffs }));
});

test('搬單規則（舊版沒有）：公開時間軸事件不發通知、轉移單搬走明細、確認視窗預覽、更正所屬門市也搬、舊式工單只列清單', async () => {
  const e = entry('transfer-follow-rules');
  const set = await seedSet('R');
  const { s } = set;
  const diffs: Diff[] = [];

  // 預覽：舊版沒有 open-orders 的搬單預覽欄位
  const pre = await body(await apis.ga_works.get(`${N}/equipment/${set.eq.id}/open-orders`));
  expect(pre.data).toMatchObject({ moving_count: 1, staying_count: 1, unlinked_count: 1 });
  const probe = await apis.ga_works.get(`${L}/equipment/${set.eq.id}/open-orders`);
  diffs.push({ kind: 'only-native', key: 'open-orders-move-preview', detail: `舊版沒有搬單預覽（舊版 open-orders 回 ${probe.status()}）；新版回 moving／staying／unlinked` });

  // 更正所屬門市也搬（舊版直接改所屬門市不處理單子）
  const ver = (await row('ga_equipment', set.eq.id)).updated_at as string;
  const cor = await apis.ga_works.post(`${N}/equipment/${set.eq.id}/correct-store`, { data: { to_store_id: s.VW001.id, reason: 'parity 更正', expected_updated_at: ver } });
  expect(cor.status()).toBe(200);
  expect((await body(cor)).data).toMatchObject({ moved_request_count: 1, unlinked_work_order_count: 1 });
  expect((await row('ga_service_requests', set.repair.id)).store_id).toBe(s.VW001.id);
  expect((await row('ga_service_requests', set.purchase.id)).store_id).toBe(s.ZT01.id);
  diffs.push({ kind: 'only-native', key: 'correction-also-moves', detail: '新版更正所屬門市也帶走進行中的維修單；舊版直接改所屬門市不處理單子' });

  // 時間軸公開事件（只在搬走的單）
  const ev = ((await adminDb().from('ga_service_request_events').select('visibility,title,event_type').eq('request_id', set.repair.id).eq('event_type', 'ASSET_STORE_MOVED')).data || []) as any[];
  expect(ev).toHaveLength(1);
  expect(ev[0].visibility).toBe('PUBLIC');
  expect(ev[0].title).toMatch(/^因設備所屬門市更正，由 .+ 轉到 .+$/);
  expect(((await adminDb().from('ga_service_request_events').select('id').eq('request_id', set.purchase.id).eq('event_type', 'ASSET_STORE_MOVED')).data || [])).toHaveLength(0);
  diffs.push({ kind: 'only-native', key: 'move-timeline-public-event', detail: '舊版沒有搬單時間軸事件；新版寫公開事件、不發通知' });

  // 設備異動紀錄帶搬走張數；轉移單詳情可看明細（另用一台設備走轉移單）
  const evApi = await body(await apis.ga_works.get(`${N}/equipment/${set.eq.id}/events`));
  expect((evApi.data as any[]).find((x) => x.event_type === 'STORE_CORRECTION')).toMatchObject({ moved_request_count: 1, unlinked_work_order_count: 1 });
  const t = await seedSet('T');
  const made = await apis.ga_works.post(`${N}/transfers`, { data: { assetType: 'EQUIPMENT', assetId: t.eq.id, toStoreId: s.VW001.id, reason: 'parity 明細' } });
  const id = (await body(made)).data.id as string;
  await apis.store_manager.post(`${N}/transfers/${id}/handover`, { data: {} });
  await apis.ga_store_manager_b.post(`${N}/transfers/${id}/receive`, { data: {} });
  const d = await body(await apis.ga_works.get(`${N}/transfers/${id}`));
  expect((d.data.moved as any[]).map((m) => m.kind).sort()).toEqual(['REQUEST', 'UNLINKED_WORK_ORDER', 'WORK_ORDER']);
  expect((d.data.moved as any[]).find((m) => m.kind === 'UNLINKED_WORK_ORDER')).toMatchObject({ moved: false, work_order_id: t.legacyWo.id });
  diffs.push({ kind: 'only-native', key: 'transfer-moved-list', detail: '舊版沒有轉移單與搬走明細；新版轉移單詳情列出搬走的單與沒搬的舊式工單' });
  diffs.push({ kind: 'only-native', key: 'legacy-work-order-match', detail: '舊式工單屬於哪項資產只能憑標題或說明提到資產編號或名稱判斷（實作取捨，待確認）' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '搬單規則', legacy: { endpoint: '（舊版沒有搬單）' }, native: { endpoint: `GET ${N}/transfers/:id` }, compared: { rows: 3 }, diffs }));
});
