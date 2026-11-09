import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { addDays, taipeiToday, warrantyState } from '../../lib/workspace/general-affairs/asset-fields';
import { assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, seedFacility, seedRepairRequest, stores } from '../support/m7m8-fixtures';
import { makePng } from '../support/png';

// M7/M8 第 2 批 G09 對等層：舊版保固頁（設備與設施清單 + 附件）與維修紀錄頁（/api/maintenance-requests）對上新版同一個登入者的結果。
// 差異都列在 tests/parity/allowlist.json（page: ga-asset-history）。
const map = loadMap('ga-asset-history');
const rec = new ParityRecorder('ga-asset-history');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_facility_view', 'store_manager', 'ga_store_manager_b'];
let eqCat: { id: string };
let facCat: { id: string };
let managerA = '';
let sid: Record<string, string> = {};
const png = makePng({ width: 64, height: 64, inkPixels: 10 });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqCat = await seedCategory('equipment', 'EC');
  facCat = await seedCategory('facility', 'FC');
  managerA = (await (await apis.store_manager.get('/api/workspace/session')).json()).user.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));

/** 舊版保固頁（EquipmentWarrantyClient／FacilityWarrantyClient）在瀏覽器算保固狀態的邏輯（逐字照抄，只把 Date.now() 換成可指定的時間）。 */
function legacyBucket(has: boolean, end: string | null, nowMs: number) {
  if (!has) return 'none';
  if (!end) return 'missing';
  const diffDays = Math.ceil((new Date(end).getTime() - nowMs) / 86400000);
  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'expiring';
  return 'active';
}

test('設備保固頁：同一個登入者，設備 id、保固欄位、保固狀態與保固文件相同；到期日改用台北時間、保固文件一次查完（列入白名單）', async () => {
  const e = entry('warranty-read');
  const today = taipeiToday();
  const mk = (suffix: string, over: Record<string, unknown>) => seedEquipment('VW002', eqCat.id, `GW-${suffix}`, over);
  const rows = {
    exp: await mk('exp', { has_warranty: true, warranty_end_date: addDays(today, -40), specs: { warranty_claim_method: 'OTHER', warranty_claim_notes: '備註' } }),
    soon: await mk('soon', { has_warranty: true, warranty_end_date: addDays(today, 10) }),
    ok: await mk('ok', { has_warranty: true, warranty_end_date: addDays(today, 200), specs: { warranty_claim_method: 'ONLINE_REGISTRATION' } }),
    missing: await mk('missing', { has_warranty: true }),
    none: await mk('none', { has_warranty: false }),
  };
  const up = await apis.ga_works.post(`${N}/attachments`, { multipart: { resource_type: 'EQUIPMENT', resource_id: rows.ok.id, purpose: 'WARRANTY_DOCUMENT', is_primary: 'false', files: { name: 'm7m8t-保固.png', mimeType: 'image/png', buffer: png } } });
  expect(up.status()).toBe(201);
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=100&sortBy=warranty_end_date&sortDir=asc`;
  for (const role of ['ga_works', 'ga_equipment_view']) {
    const lr = await apis[role].get(`${L}/equipment?${q}`);
    const nr = await apis[role].get(`${N}/equipment?${q}&withWarrantyDocs=1`);
    expect(lr.status(), role).toBe(200);
    expect(nr.status(), role).toBe(200);
    const legacy = (await body(lr)).data as any[], native = (await body(nr)).data as any[];
    const mine = (r: any) => String(r.name).includes('GW-');
    const lm = legacy.filter(mine), nm = native.filter(mine);
    // 同一個到期日（含都沒填日期）的幾筆，舊版沒有第二排序鍵、順序不固定；所以比對「id 集合」與「到期日排序結果」
    if (JSON.stringify(lm.map((r) => r.id).sort()) !== JSON.stringify(nm.map((r) => r.id).sort())) diffs.push({ kind: 'changed', key: `${role}:ids`, legacy: lm.map((r) => r.id), native: nm.map((r) => r.id) });
    if (JSON.stringify(lm.map((r) => r.warranty_end_date)) !== JSON.stringify(nm.map((r) => r.warranty_end_date))) diffs.push({ kind: 'changed', key: `${role}:end-date-order`, legacy: lm.map((r) => r.warranty_end_date), native: nm.map((r) => r.warranty_end_date) });
    const byId = new Map(nm.map((r) => [r.id, r]));
    for (const l of lm) {
      compared += 1;
      const n = byId.get(l.id);
      if (!n) continue;
      for (const c of ['has_warranty', 'warranty_end_date']) if (l[c] !== n[c]) diffs.push({ kind: 'changed', key: `${role}:${l.id}#${c}`, legacy: l[c], native: n[c] });
      if (JSON.stringify(l.specs) !== JSON.stringify(n.specs)) diffs.push({ kind: 'changed', key: `${role}:${l.id}#specs`, legacy: l.specs, native: n.specs });
      // 保固狀態（遠離邊界的日期）：舊版在瀏覽器算，新版伺服端算
      const lb = legacyBucket(l.has_warranty, l.warranty_end_date, Date.now());
      if (lb !== n.warranty.state) diffs.push({ kind: 'changed', key: `${role}:${l.id}#warranty-state`, legacy: lb, native: n.warranty.state });
      // 保固文件：舊版每台各送一次附件請求，新版同一次清單回傳
      const la = await body(await apis[role].get(`${L}/attachments?resourceType=EQUIPMENT&resourceId=${l.id}`));
      const lf = ((la.data || []) as any[]).filter((a) => a.purpose === 'WARRANTY_DOCUMENT').map((a) => a.file_name).sort();
      const nf = (n.warranty_documents || []).map((a: any) => a.file_name).sort();
      if (JSON.stringify(lf) !== JSON.stringify(nf)) diffs.push({ kind: 'changed', key: `${role}:${l.id}#warranty-documents`, legacy: lf, native: nf });
    }
    for (const k of Object.keys(nm[0] || {})) if (!(k in (lm[0] || {}))) diffs.push({ kind: 'only-native', key: `${role}:row#${k}` });
    const nj = await body(nr), lj = await body(lr);
    for (const k of Object.keys(nj)) if (!(k in lj)) diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(lj)) if (!(k in nj)) diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  expect(rows.none.id).toBeTruthy();
  // 到期日邊界：台北時間 2026-11-10 00:30（UTC 還是 11-09）。舊版用 UTC 時間差算，到期日前一天的 00:30 仍算「保固中」；新版以台北日期為準，已過保。
  const now = new Date('2026-11-10T00:30:00+08:00');
  for (const end of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-12-10', '2026-12-11']) {
    const lb = legacyBucket(true, end, now.getTime());
    const nb = warrantyState({ has_warranty: true, end_date: end }, now).state;
    compared += 1;
    if (lb !== nb) diffs.push({ kind: 'changed', key: 'warranty-taipei-time', legacy: `${end}:${lb}`, native: `${end}:${nb}` });
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設備保固頁', legacy: { endpoint: `GET ${L}/equipment（保固頁）` }, native: { endpoint: `GET ${N}/equipment?withWarrantyDocs=1`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('設施保固頁：設施 specs 內的保固與新版保固狀態相同', async () => {
  const e = entry('facility-warranty-read');
  const today = taipeiToday();
  const mk = (suffix: string, specs: Record<string, unknown>) => seedFacility('VW002', facCat.id, `GF-${suffix}`, { specs });
  await mk('exp', { facility_has_warranty: true, facility_warranty_end_date: addDays(today, -40) });
  await mk('soon', { facility_has_warranty: true, facility_warranty_end_date: addDays(today, 12), facility_warranty_claim_method: 'OTHER', facility_warranty_claim_notes: '洽供應商' });
  await mk('ok', { facility_has_warranty: true, facility_warranty_end_date: addDays(today, 300) });
  await mk('missing', { facility_has_warranty: true });
  await mk('none', { facility_has_warranty: false });
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=100&sortBy=name&sortOrder=asc`;
  const lr = await apis.ga_works.get(`${L}/facilities?${q}`);
  const nr = await apis.ga_works.get(`${N}/facilities?${q}&withWarrantyDocs=1`);
  const legacy = ((await body(lr)).data as any[]).filter((r) => String(r.name).includes('GF-'));
  const native = new Map((((await body(nr)).data) as any[]).filter((r) => String(r.name).includes('GF-')).map((r) => [r.id, r]));
  if (legacy.length !== native.size) diffs.push({ kind: 'count', key: 'rows', legacy: legacy.length, native: native.size });
  for (const l of legacy) {
    compared += 1;
    const n = native.get(l.id);
    if (!n) continue;
    const lb = legacyBucket(l.specs?.facility_has_warranty === true, typeof l.specs?.facility_warranty_end_date === 'string' ? l.specs.facility_warranty_end_date : null, Date.now());
    if (lb !== n.warranty.state) diffs.push({ kind: 'changed', key: `${l.id}#warranty-state`, legacy: lb, native: n.warranty.state });
    if ((l.specs?.facility_warranty_claim_notes ?? null) !== (n.specs?.facility_warranty_claim_notes ?? null)) diffs.push({ kind: 'changed', key: `${l.id}#claim-notes`, legacy: l.specs?.facility_warranty_claim_notes, native: n.specs?.facility_warranty_claim_notes });
  }
  // 設施保固頁新版可直接依保固狀態篩選與依到期日排序（舊版一律載入前 100 筆再在瀏覽器過濾）
  const f = await body(await apis.ga_works.get(`${N}/facilities?${q}&warranty=expired`));
  expect(f.data.filter((r: any) => String(r.name).includes('GF-')).map((r: any) => r.warranty.state)).toEqual(['expired']);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設施保固頁', legacy: { endpoint: `GET ${L}/facilities（保固頁）` }, native: { endpoint: `GET ${N}/facilities?withWarrantyDocs=1`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('維修紀錄：舊頁讀 maintenance-requests 並過濾 equipment_id／facility_id（資料表沒有這兩欄，實際沒有資料）；新版讀報修需求單與其工單，完整分頁；店長舊版全域查詢 403、新版只看自己門市（列入白名單）', async () => {
  const e = entry('maintenance-history-read');
  const eq = await seedEquipment('ZT01', eqCat.id, 'GH-EQ');
  const fac = await seedFacility('ZT01', facCat.id, 'GH-FAC');
  const r1 = await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'GH-r1', 'IN_PROGRESS', managerA);
  await seedRepairRequest('ZT01', { facilityId: fac.id }, 'GH-r2', 'COMPLETED', managerA);
  const diffs: Diff[] = [];
  let compared = 0;
  const lr = await apis.ga_works.get(`${L.replace('/general-affairs', '')}/maintenance-requests?source=general_affairs&pageSize=100`);
  const legacyRows = ((await body(lr)).data || []) as any[];
  const linkedEquipment = legacyRows.filter((r) => Boolean(r.equipment_id)).length;
  const linkedFacility = legacyRows.filter((r) => Boolean(r.facility_id)).length;
  const q = `q=${encodeURIComponent(m7Name('GH-'))}&pageSize=100`;
  const ne = await body(await apis.ga_works.get(`${N}/asset-maintenance/history?type=equipment&${q}`));
  const nf = await body(await apis.ga_works.get(`${N}/asset-maintenance/history?type=facility&${q}`));
  compared += 2;
  expect(ne.data.map((r: any) => r.id)).toEqual([r1.id]);
  expect(nf.data).toHaveLength(1);
  if (linkedEquipment !== ne.total) diffs.push({ kind: 'count', key: 'maintenance-history-linked-equipment-rows', legacy: linkedEquipment, native: ne.total });
  if (linkedFacility !== nf.total) diffs.push({ kind: 'count', key: 'maintenance-history-linked-facility-rows', legacy: linkedFacility, native: nf.total });
  // 店長：舊版沒有帶門市的全域查詢要 view_all 權限（403）；新版直接只看自己有名單身分的門市
  const ls = await apis.store_manager.get(`${L.replace('/general-affairs', '')}/maintenance-requests?source=general_affairs&pageSize=100`);
  const ns = await apis.store_manager.get(`${N}/asset-maintenance/history?type=equipment&${q}`);
  compared += 1;
  expect(ns.status()).toBe(200);
  if (ls.status() !== ns.status()) diffs.push({ kind: 'status', key: 'maintenance-history-store-manager', legacy: ls.status(), native: ns.status() });
  // 超過 100 筆：舊版只載入前 100 筆（單頁上限），新版可翻頁並回精確筆數
  const lj = await body(lr);
  const lmeta = lj.meta || {};
  const nmeta = ne.meta;
  if (lmeta.pageSize !== undefined && lmeta.pageSize !== nmeta.pageSize) diffs.push({ kind: 'count', key: 'maintenance-history-page-size', legacy: lmeta.pageSize, native: nmeta.pageSize });
  for (const k of Object.keys(ne)) if (!(k in lj)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '維修紀錄', legacy: { endpoint: `GET /api/maintenance-requests?source=general_affairs` }, native: { endpoint: `GET ${N}/asset-maintenance/history`, status: 200 }, compared: { rows: compared }, diffs }));
});
