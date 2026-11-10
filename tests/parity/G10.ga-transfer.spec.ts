import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, row, seedCategory, seedEquipment, seedRepairRequest, stores } from '../support/m7m8-fixtures';
import { createRequire } from 'node:module';
import path from 'node:path';

// M7/M8 第 2 批 Q28 對等層：轉移單完成後，舊版 API 與資料庫回讀都要看到同一個結果（換店、QR 沿用、舊版掃描範圍跟著換）。
// 舊版沒有轉移單，所以「新增」與「規則限制」列入白名單（page: ga-transfer）。
const nodeRequire = createRequire(path.join(__dirname, 'G10.ga-transfer.spec.ts'));
const accountId = (k: string) => (nodeRequire('../support/credentials.cjs') as { getAccount: (k: string) => { userId: string } }).getAccount(k).userId;
const map = loadMap('ga-transfer');
const rec = new ParityRecorder('ga-transfer');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'store_manager', 'ga_store_manager_b'];
let eqCat: { id: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  eqCat = await seedCategory('equipment', 'PT');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

test('轉移完成後：舊版設備詳情、舊版掃描範圍與新版回讀一致（門市、QR token、編號、狀態），資料庫沒有重發 token', async () => {
  const e = entry('transfer-readback');
  const s = await stores();
  const eq = await seedEquipment('ZT01', eqCat.id, 'PT-EQ', { asset_code: m7Code('TQ') });
  const repair = await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'PT-未結', 'ACCEPTED', accountId('store_manager'));
  const diffs: Diff[] = [];

  // 轉移前：舊版與新版掃描範圍相同（A 店 200、B 店 403）
  for (const [role, expected] of [['store_manager', 200], ['ga_store_manager_b', 403]] as const) {
    const lr = await apis[role].get(`${L}/assets/scan/${eq.qr_token}`);
    const nr = await apis[role].get(`${N}/assets/scan/${eq.qr_token}`);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `before:${role}:scan`, legacy: lr.status(), native: nr.status() });
    expect([lr.status(), nr.status()], `轉移前 ${role}`).toEqual([expected, expected]);
  }

  // 新版轉移單：發起 -> 交出 -> 收到
  const made = await apis.ga_works.post(`${N}/transfers`, { data: { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: s.VW001.id, reason: 'parity' } });
  expect(made.status()).toBe(201);
  const id = (await body(made)).data.id as string;
  expect((await apis.store_manager.post(`${N}/transfers/${id}/handover`, { data: {} })).status()).toBe(200);
  expect((await apis.ga_store_manager_b.post(`${N}/transfers/${id}/receive`, { data: {} })).status()).toBe(200);

  // 轉移後：舊版詳情 vs 新版詳情
  const lr = await apis.ga_works.get(`${L}/equipment/${eq.id}`);
  const nr = await apis.ga_works.get(`${N}/equipment/${eq.id}`);
  expect([lr.status(), nr.status()]).toEqual([200, 200]);
  const l = (await body(lr)).data, n = (await body(nr)).data;
  for (const k of ['id', 'name', 'asset_code', 'status', 'store_id', 'qr_token']) if (!same(l[k], n[k])) diffs.push({ kind: 'changed', key: `after#${k}`, legacy: l[k], native: n[k] });
  expect(l.store_id).toBe(s.VW001.id);
  expect((await row('ga_equipment', eq.id)).qr_token).toBe(eq.qr_token); // 資料庫沒有重發

  // 轉移後掃描範圍：舊版與新版都換成 B 店 200、A 店 403
  for (const [role, expected] of [['ga_store_manager_b', 200], ['store_manager', 403]] as const) {
    const lr2 = await apis[role].get(`${L}/assets/scan/${eq.qr_token}`);
    const nr2 = await apis[role].get(`${N}/assets/scan/${eq.qr_token}`);
    if (lr2.status() !== nr2.status()) diffs.push({ kind: 'status', key: `after:${role}:scan`, legacy: lr2.status(), native: nr2.status() });
    expect([lr2.status(), nr2.status()], `轉移後 ${role}`).toEqual([expected, expected]);
  }
  // 舊版設備清單（總務）依門市：換店後出現在 B 店、不在 A 店
  const inStore = async (store: string) => (((await body(await apis.ga_works.get(`${L}/equipment?store_id=${store}&search=${encodeURIComponent('PT-EQ')}&pageSize=100`))).data || []) as any[]).some((r) => r.id === eq.id);
  if ((await inStore(s.VW001.id)) !== true) diffs.push({ kind: 'changed', key: 'legacy-list-new-store', legacy: false, native: true });
  if ((await inStore(s.ZT01.id)) !== false) diffs.push({ kind: 'changed', key: 'legacy-list-old-store', legacy: true, native: false });

  // 新版才有：轉移單 API；進行中的報修單仍屬原門市
  const probe = await apis.ga_works.get(`${L}/equipment/transfers`);
  diffs.push({ kind: 'only-native', key: 'transfers-api', detail: `舊版沒有轉移單（舊版 /equipment/transfers 回 ${probe.status()}），新版 /transfers 為新增` });
  expect((await row('ga_service_requests', repair.id)).store_id).toBe(s.ZT01.id);
  diffs.push({ kind: 'changed', key: 'open-requests-stay-in-origin-store', detail: '換店後進行中的報修單仍屬原門市（解讀 h）' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '轉移單完成後回讀', legacy: { endpoint: `GET ${L}/equipment/:id` }, native: { endpoint: `GET ${N}/equipment/:id` }, compared: { rows: 1 }, diffs }));
});

test('轉移單規則（舊版沒有）：確認交出與收到只認店長身分；總務代替店長被擋', async () => {
  const e = entry('transfer-rules');
  const s = await stores();
  const eq = await seedEquipment('ZT01', eqCat.id, 'PT-RULE');
  const id = (await body(await apis.ga_works.post(`${N}/transfers`, { data: { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: s.VW001.id, reason: 'parity-rule' } }))).data.id as string;
  const diffs: Diff[] = [{ kind: 'only-native', key: 'transfers-api', detail: '舊版沒有轉移單 API' }];
  const byGa = await apis.ga_works.post(`${N}/transfers/${id}/handover`, { data: {} });
  expect(byGa.status()).toBe(403);
  diffs.push({ kind: 'changed', key: 'confirm-role-store-manager-only', detail: '總務（非名單店長）不能代替店長確認交出（解讀 g）' });
  await adminDb().from('ga_asset_transfers').update({ status: 'CANCELLED' }).eq('id', id);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '轉移單規則', legacy: { endpoint: '（舊版沒有轉移單）' }, native: { endpoint: `POST ${N}/transfers/:id/handover` }, compared: { rows: 1 }, diffs }));
});
