import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, row, seedCategory, seedEquipment, seedFacility } from '../support/m7m8-fixtures';
import { workspaceScanTarget } from '../../lib/workspace/general-affairs/qr-url';

// M7/M8 第 2 批 G10 對等層：舊版資產掃描 API、設備標籤頁資料來源，對上新版掃描 API 與標籤 API（同一個登入者、同一個 token、同一組設備）。
// 差異都列在 tests/parity/allowlist.json（page: ga-qr）。
const map = loadMap('ga-qr');
const rec = new ParityRecorder('ga-qr');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_facility_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string };
let facCat: { id: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  eqCat = await seedCategory('equipment', 'PQ');
  facCat = await seedCategory('facility', 'PF');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
/** 頂層鍵：只有一邊有的就是差異。 */
function topKeys(diffs: Diff[], label: string, legacy: Record<string, any>, native: Record<string, any>) {
  for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: k, detail: `${label} 舊版有、新版沒有` });
  for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: k, detail: `${label} 新版有、舊版沒有` });
}

test('掃描資料：同一個登入者與 token，識別、門市、分類、位置、保固結束日與報修權限相同；差異列入白名單', async () => {
  const e = entry('scan-read');
  const eq = await seedEquipment('ZT01', eqCat.id, 'PS-EQ', { asset_code: m7Code('PE'), brand: '舊牌', model: '新型', serial_number: 'SN-PAR', area: '前場營業區', location_detail: '收銀台', has_warranty: true, warranty_end_date: '2099-05-05', purchase_amount: 7777, notes: '不外露' });
  const fac = await seedFacility('ZT01', facCat.id, 'PS-FAC', { facility_code: m7Code('PF'), area: '倉庫', location_detail: '後門', specs: { facility_brand: 'F牌', facility_model: 'F型', facility_has_warranty: true, facility_warranty_end_date: '2099-01-01' } });
  const diffs: Diff[] = [];
  let compared = 0;
  const COMMON = ['type', 'id', 'token', 'code', 'name', 'status', 'area', 'location_detail'];
  for (const [asset, label] of [[eq, 'equipment'], [fac, 'facility']] as const) {
    for (const role of ['ga_works', 'ga_equipment_view', 'store_manager']) {
      const lr = await apis[role].get(`${L}/assets/scan/${asset.qr_token}`);
      const nr = await apis[role].get(`${N}/assets/scan/${asset.qr_token}`);
      const tag = `${label}:${role}`;
      if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `${tag}:status`, legacy: lr.status(), native: nr.status() });
      expect(nr.status(), tag).toBe(200);
      const lb = await body(lr);
      const nb = await body(nr);
      const l = lb.data, n = nb.data;
      compared += 1;
      if ('success' in lb && !('success' in nb)) diffs.push({ kind: 'only-legacy', key: 'success', detail: '舊版外層 success' });
      for (const k of COMMON) if (!same(l[k], n[k])) diffs.push({ kind: 'changed', key: `${tag}#${k}`, legacy: l[k], native: n[k] });
      for (const k of ['store', 'category']) if (!same(l[k], n[k])) diffs.push({ kind: 'changed', key: `${tag}#${k}`, legacy: l[k], native: n[k] });
      for (const k of ['brand', 'model']) {
        if (!(k in n)) diffs.push({ kind: 'only-legacy', key: k, detail: `${tag} 店長只看基本欄位` });
        else if (!same(l[k], n[k])) diffs.push({ kind: 'changed', key: `${tag}#${k}`, legacy: l[k], native: n[k] });
      }
      if (!same(l.warranty?.end_date, n.warranty?.end_date)) diffs.push({ kind: 'changed', key: `${tag}#warranty.end_date`, legacy: l.warranty?.end_date, native: n.warranty?.end_date });
      if (l.warranty?.label !== n.warranty?.label) diffs.push({ kind: 'changed', key: 'warranty.label', legacy: l.warranty?.label, native: n.warranty?.label, detail: `${tag} 保固狀態文字` });
      // 報修按鈕：舊版 can_create_repair_request 與新版 canReport 在這幾個角色相同
      if (l.access.can_create_repair_request !== n.canReport) diffs.push({ kind: 'changed', key: `${tag}#canReport`, legacy: l.access.can_create_repair_request, native: n.canReport });
      topKeys(diffs, tag, l, n);
      // 沒有資料庫欄位外洩：新版不含金額、備註、QR token 以外的內部欄位
      const text = JSON.stringify(nb);
      for (const secret of ['7777', '不外露']) expect(text, `${tag} ${secret}`).not.toContain(secret);
    }
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '資產掃描資料', legacy: { endpoint: `GET ${L}/assets/scan/:token` }, native: { endpoint: `GET ${N}/assets/scan/:token`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('掃描失敗情形：格式錯誤、未登入、找不到、無權限、已作廢的狀態碼相同；說明文字與固定 code 為新增', async () => {
  const e = entry('scan-errors');
  const eq = await seedEquipment('ZT01', eqCat.id, 'PE-EQ', { asset_code: m7Code('EE') });
  const dead = await seedEquipment('ZT01', eqCat.id, 'PE-DEAD', { asset_code: m7Code('ED') });
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', dead.id);
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const diffs: Diff[] = [];
  const cases: { label: string; token: string; role: string | null }[] = [
    { label: 'bad-token', token: 'short', role: 'ga_works' },
    { label: 'anonymous', token: eq.qr_token, role: null },
    { label: 'not-found', token: 'f'.repeat(32), role: 'ga_works' },
    { label: 'no-access-other-store', token: eq.qr_token, role: 'ga_store_manager_b' },
    { label: 'no-access-no-permission', token: eq.qr_token, role: 'denied' },
    { label: 'revoked-scrapped', token: dead.qr_token, role: 'ga_works' },
    { label: 'revoked-for-store-manager', token: dead.qr_token, role: 'store_manager' },
  ];
  try {
    for (const c of cases) {
      const client = c.role ? apis[c.role] : anon;
      const lr = await client.get(`${L}/assets/scan/${c.token}`);
      const nr = await client.get(`${N}/assets/scan/${c.token}`);
      const lb = await body(lr), nb = await body(nr);
      if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `${c.label}:status`, legacy: lr.status(), native: nr.status() });
      else if (!same(lb.error, nb.error) && c.label !== 'anonymous') diffs.push({ kind: 'changed', key: `error-message-${c.label}`, legacy: lb.error, native: nb.error, detail: `${c.label} 說明文字` });
      if (c.label !== 'anonymous') {
        if ('success' in lb && !('success' in nb)) diffs.push({ kind: 'only-legacy', key: 'success', detail: '舊版外層 success' });
        for (const k of Object.keys(nb)) if (k !== 'error' && !(k in lb)) diffs.push({ kind: 'only-native', key: `error-${k}`, detail: `${c.label} 新版另帶 ${k}` });
      }
    }
  } finally {
    await anon.dispose();
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '資產掃描失敗情形', legacy: { endpoint: `GET ${L}/assets/scan/:token` }, native: { endpoint: `GET ${N}/assets/scan/:token` }, compared: { rows: cases.length }, diffs }));
});

test('設備標籤：舊版清單的 qr_scan_path 與新版標籤 API 的永久路徑逐台相同；新版排除報廢並說明', async () => {
  const e = entry('labels-read');
  const a = await seedEquipment('ZT02', eqCat.id, 'PL-A', { asset_code: m7Code('LA') });
  const b = await seedEquipment('ZT02', eqCat.id, 'PL-B', { asset_code: m7Code('LB') });
  const dead = await seedEquipment('ZT02', eqCat.id, 'PL-DEAD', { asset_code: m7Code('LD') });
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', dead.id);
  const diffs: Diff[] = [];
  const lr = await apis.ga_works.get(`${L}/equipment?search=${encodeURIComponent('PL-')}&pageSize=100`);
  const nr = await apis.ga_works.get(`${N}/qr/labels?type=equipment&q=${encodeURIComponent('PL-')}`);
  expect(lr.status()).toBe(200);
  expect(nr.status()).toBe(200);
  const legacy = ((await body(lr)).data as any[]).filter((r) => r.qr_scan_path || r.qr_token);
  const native = (await body(nr)) as any;
  const nm = new Map((native.items as any[]).map((i) => [i.id, i]));
  for (const l of legacy) {
    const n = nm.get(l.id);
    if (!n) {
      diffs.push({ kind: 'only-legacy', key: 'scrapped-label-excluded', detail: `${l.id} 舊版會印、新版排除（${l.status}）` });
      continue;
    }
    const legacyPath = l.qr_scan_path || `/general-affairs/assets/scan/${l.qr_token}`;
    if (new URL(n.qrUrl).pathname !== legacyPath) diffs.push({ kind: 'changed', key: 'qr-path', legacy: legacyPath, native: new URL(n.qrUrl).pathname });
    if (!same(l.asset_code, n.code)) diffs.push({ kind: 'changed', key: 'code', legacy: l.asset_code, native: n.code });
    // 資料庫 token 沒有被重發
    expect((await row('ga_equipment', l.id)).qr_token).toBe(l.qr_token ?? n.qrUrl.split('/').pop());
  }
  expect(legacy.map((l) => l.id).sort()).toEqual([a.id, b.id, dead.id].sort());
  expect([...nm.keys()].sort()).toEqual([a.id, b.id].sort());
  expect((native.excluded as any[]).map((x) => x.id)).toContain(dead.id);
  for (const k of ['watermark', 'baseUrl', 'limit', 'truncated', 'matched', 'excluded', 'excludedTotal']) diffs.push({ kind: 'only-native', key: `labels#${k}`, detail: '新版標籤 API 另帶' });
  // 設施標籤列印是新功能（解讀 b）：舊版沒有設施標籤頁，新版 API 可列印
  const fac = await seedFacility('ZT02', facCat.id, 'PL-FAC', { facility_code: m7Code('LF') });
  const fr = await apis.ga_works.get(`${N}/qr/labels?type=facility&ids=${fac.id}`);
  expect(fr.status()).toBe(200);
  expect(((await body(fr)) as any).items).toHaveLength(1);
  diffs.push({ kind: 'only-native', key: 'facility-labels', detail: '舊版沒有設施標籤列印' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設備標籤資料', legacy: { endpoint: `GET ${L}/equipment` }, native: { endpoint: `GET ${N}/qr/labels`, status: 200 }, compared: { rows: legacy.length }, diffs }));
});

test('QR 永久網址：測試站開啟轉址旗標後轉到新版掃描頁；token 與資料庫相同、永久路徑不變', async () => {
  const e = entry('scan-permanent-url');
  const eq = await seedEquipment('ZT01', eqCat.id, 'PU-EQ', { asset_code: m7Code('PU') });
  const diffs: Diff[] = [];
  const res = await apis.ga_works.get(`/general-affairs/assets/scan/${eq.qr_token}`, { maxRedirects: 0 });
  expect([307, 308, 302, 303]).toContain(res.status());
  const location = res.headers().location || '';
  expect(location).toContain(workspaceScanTarget(eq.qr_token));
  diffs.push({ kind: 'changed', key: 'permanent-url-redirect', legacy: '舊版頁面（不轉址）', native: location, detail: '旗標開啟時永久網址轉到新版掃描頁' });
  expect((await row('ga_equipment', eq.id)).qr_token).toBe(eq.qr_token);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: 'QR 永久網址', legacy: { endpoint: 'GET /general-affairs/assets/scan/:token' }, native: { endpoint: `GET ${N}/assets/scan/:token`, status: 200 }, compared: { rows: 1 }, diffs }));
});
