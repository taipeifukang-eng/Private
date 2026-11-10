import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, seedCategory } from '../support/m7m8-fixtures';
import { buildImportXlsx, importEquipmentLine, importFacilityLine, importFileName } from '../support/m7m8-import';

// M7/M8 第 2 批 Q29 對等層：Excel 匯入後，舊版 API 與資料庫回讀都要看到同一個結果。舊版沒有 Excel 匯入，所以「新增」列入白名單（page: ga-asset-import）。
const map = loadMap('ga-asset-import');
const rec = new ParityRecorder('ga-asset-import');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const apis: Record<string, APIRequestContext> = {};
let eqCat: { id: string; code: string };
let facCat: { id: string; code: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ['ga_works', 'store_manager']) apis[k] = await apiAs(k);
  eqCat = await seedCategory('equipment', 'IPE');
  facCat = await seedCategory('facility', 'IPF');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const send = (path: string, buffer: Buffer, tag: string, extra: Record<string, string> = {}) =>
  apis.ga_works.post(`${N}/asset-import/${path}`, { multipart: { file: { name: importFileName(tag), mimeType: XLSX_TYPE, buffer }, ...extra } });

test('匯入後：舊版設備與設施詳情逐欄等於 Excel 填的值，舊版店長待辦列出匯入的設備', async () => {
  const e = entry('import-readback');
  const eqLine = importEquipmentLine('PI-設備', 'ZT01', eqCat.code, { 狀態: '備品', 重要程度: '高', 購置金額: '8,800', 是否保固: '是', 保固到期日: '2030-05-31', 購置日期: '2026-02-03', 區域: '倉庫／後倉' });
  const facLine = importFacilityLine('PI-設施', 'ZT01', facCat.code, { 狀態: '整修中', 數量: 4, 單位: '組', 設施代碼: m7Code('PIF') });
  const done = await body(await send('commit', buildImportXlsx([eqLine, facLine]), 'parity', { idempotencyKey: `m7m8-parity-${Date.now()}-abcd` }));
  expect(done.committed).toBe(true);
  const db = adminDb();
  const eq = (await db.from('ga_equipment').select('*').eq('name', eqLine.名稱 as string).single()).data as any;
  const fac = (await db.from('ga_facilities').select('*').eq('name', facLine.名稱 as string).single()).data as any;
  const diffs: Diff[] = [];

  const le = (await body(await apis.ga_works.get(`${L}/equipment/${eq.id}`))).data;
  const expectedEq: Record<string, unknown> = { name: eqLine.名稱, status: 'SPARE', criticality: 'HIGH', asset_code: eqLine.資產編號, purchase_amount: 8800, has_warranty: true, warranty_end_date: '2030-05-31', purchased_at: '2026-02-03', area: '倉庫／後倉', store_id: eq.store_id, category_id: eqCat.id, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO' };
  for (const [k, v] of Object.entries(expectedEq)) if (!same(le[k], v)) diffs.push({ kind: 'changed', key: `equipment#${k}`, legacy: le[k], native: v });
  const lf = (await body(await apis.ga_works.get(`${L}/facilities/${fac.id}`))).data;
  const expectedFac: Record<string, unknown> = { name: facLine.名稱, status: 'UNDER_RENOVATION', quantity: 4, unit: '組', facility_code: m7Code('PIF'), store_id: fac.store_id, category_id: facCat.id };
  for (const [k, v] of Object.entries(expectedFac)) if (!same(lf[k], v)) diffs.push({ kind: 'changed', key: `facility#${k}`, legacy: lf[k], native: v });

  // 舊版店長待辦（A 店店長）：列出匯入的設備、待上傳設備照片；沒有設施
  const tasks = ((await body(await apis.store_manager.get(`${L}/equipment/store-onboarding-tasks`))).data || []) as any[];
  const t = tasks.find((x) => x.id === eq.id);
  const legacyStatus = t?.equipment?.onboarding_status;
  if (!t) diffs.push({ kind: 'changed', key: 'legacy-task-missing-for-imported-equipment', legacy: false, native: true });
  else if (legacyStatus !== 'NEEDS_EQUIPMENT_PHOTO' || t.task_type !== 'EQUIPMENT_PHOTO') diffs.push({ kind: 'changed', key: 'legacy-task-status', legacy: legacyStatus, native: 'NEEDS_EQUIPMENT_PHOTO' });
  if (tasks.some((x) => x.id === fac.id)) diffs.push({ kind: 'changed', key: 'legacy-task-has-facility', legacy: true, native: false });
  const nativeTasks = ((await body(await apis.store_manager.get(`${N}/onboarding/tasks?pageSize=100`))).data || []) as any[];
  if (!nativeTasks.some((x) => x.id === fac.id)) diffs.push({ kind: 'changed', key: 'native-task-missing-facility', legacy: false, native: false });
  diffs.push({ kind: 'only-native', key: 'asset-import-api', detail: '舊版沒有 Excel 匯入（Q29 新增）' });
  diffs.push({ kind: 'only-native', key: 'facility-onboarding-tasks', detail: '舊版店長待辦只有設備；新版設施也有貼標待辦（解讀 b）' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: 'Excel 匯入後回讀', legacy: { endpoint: `GET ${L}/equipment/:id、/facilities/:id` }, native: { endpoint: `POST ${N}/asset-import/commit` }, compared: { rows: 2 }, diffs }));
});

test('整批全成或全不變：有錯的檔案新版整批不寫入，舊版清單查不到任何一列', async () => {
  const e = entry('import-atomic');
  const good = importEquipmentLine('PA-好', 'ZT01', eqCat.code);
  const bad = importEquipmentLine('PA-壞', 'NOPE99', eqCat.code);
  const r = await body(await send('commit', buildImportXlsx([good, bad]), 'parity-bad', { idempotencyKey: `m7m8-parity-${Date.now()}-efgh` }));
  expect(r.committed).toBe(false);
  const diffs: Diff[] = [];
  for (const name of [good.名稱, bad.名稱]) {
    const res = await body(await apis.ga_works.get(`${L}/equipment?search=${encodeURIComponent(String(name))}&pageSize=100`));
    const hit = ((res.data || []) as any[]).some((x) => x.name === name);
    if (hit) diffs.push({ kind: 'changed', key: `legacy-list-has:${name}`, legacy: true, native: false });
  }
  diffs.push({ kind: 'only-native', key: 'asset-import-api', detail: '舊版沒有整批匯入（Q29 新增）' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '整批全成或全不變', legacy: { endpoint: `GET ${L}/equipment` }, native: { endpoint: `POST ${N}/asset-import/commit` }, compared: { rows: 2 }, diffs }));
});
