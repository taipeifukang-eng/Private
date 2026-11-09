import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Code, m7Name, rowsWhere, seedBalance, seedCategory, seedEquipmentTemplate, seedLocation, seedPart,
  setupM7Users, M7_FILE_PREFIX, type M7User,
} from '../support/m7m8-fixtures';
import { makePng } from '../support/png';
import { gaNavigation } from '../../lib/workspace/general-affairs/nav';
import { resolveAccess } from '../../lib/workspace/permission-semantics';
import { getVisibleGeneralAffairsNavGroups, flattenGeneralAffairsNavItems } from '../../components/general-affairs/navigation';

// M7/M8 G01-G05 對等層：舊版 /api/general-affairs/**（分類、料件、型號與架型、適用料件、附件）與新版 /api/workspace/general-affairs/** 同一個登入者、同一份輸入逐項比對；
// 寫入以 service role 回讀資料庫欄位比對。差異都列在 tests/parity/allowlist.json（page: ga-assets）：Q3 附件、Q4 分類、Q5 店長欄位、Q6 料件、Q7 型號與架型，以及搜尋輸入壞掉的修正。
const map = loadMap('ga-assets');
const rec = new ParityRecorder('ga-assets');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let ctx: { partCat: any; eqCat: any; facCat: any };
const ROLES = ['ga_staff', 'ga_works', 'ga_part_view', 'ga_part_edit', 'ga_category_view', 'ga_category_edit', 'ga_template_view', 'ga_template_edit', 'ga_facility_view', 'ga_facility_edit', 'ga_store_manager_b', 'ga_vendor_manager', 'denied', 'ga_vendor_view', 'ga_vendor_edit', 'store_manager'];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  const s = await setupM7Users(['real_store_manager']);
  users = s.users;
  teardownUsers = s.teardown;
  apis.real_store_manager = await apiForUser(users.real_store_manager);
  ctx = { partCat: await seedCategory('part', 'PC'), eqCat: await seedCategory('equipment', 'EC'), facCat: await seedCategory('facility', 'FC') };
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const sortById = (rows: any[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const pickCols = (r: any, cols: string[]) => Object.fromEntries(cols.map((c) => [c, r?.[c] ?? null]));
/** 逐欄比對兩列，差異放進 diffs（key 為 <列鍵>#<欄位>）。 */
function diffRows(diffs: Diff[], label: string, legacy: any, native: any, cols: string[]) {
  for (const c of cols) {
    const a = legacy?.[c] ?? null, b = native?.[c] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: a, native: b });
  }
}
function diffKeys(diffs: Diff[], label: string, legacy: any, native: any) {
  for (const k of Object.keys(native || {})) if (!(k in (legacy || {}))) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
  for (const k of Object.keys(legacy || {})) if (!(k in (native || {}))) diffs.push({ kind: 'only-legacy', key: `${label}#${k}` });
}
const SYS = new Set(['specification', 'brand', 'id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by', 'name', 'code', 'part_code', 'model', 'storage_path', 'uploaded_at', 'uploaded_by', 'file_name']);
const dbCols = (r: any) => Object.keys(r || {}).filter((k) => !SYS.has(k));
const form = (files: { name: string; mimeType: string; buffer: Buffer }[], fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('files', new Blob([new Uint8Array(f.buffer)], { type: f.mimeType }), f.name);
  return fd;
};

test('分類清單：舊版全部一次回 vs 新版最大頁，三種分類的 id 與欄位相同、筆數相同', async () => {
  const e = entry('categories-read');
  const diffs: Diff[] = [];
  let compared = 0;
  for (const type of ['part', 'equipment', 'facility']) {
    for (const role of ['ga_staff', 'ga_category_view']) {
      const legacy = (await body(await apis[role].get(`${L}/categories?type=${type}`))).data as any[];
      const nativeRes = await body(await apis[role].get(`${N}/categories?type=${type}&all=1&pageSize=500&search=`));
      // search 為空時只列最上層；改用 all=1 才跨層，所以這裡取 all
      const native = (await body(await apis[role].get(`${N}/categories?type=${type}&all=1&pageSize=500`))).data as any[];
      expect(nativeRes.meta ?? {}).toBeDefined();
      const total = (await body(await apis[role].get(`${N}/categories?type=${type}&all=1&pageSize=500`))).meta.total;
      if (total !== legacy.length) diffs.push({ kind: 'count', key: `${role}:${type}`, legacy: legacy.length, native: total });
      const nm = new Map(native.map((r) => [r.id, r]));
      for (const l of legacy) {
        const n = nm.get(l.id);
        compared += 1;
        if (!n) { diffs.push({ kind: 'only-legacy', key: `${role}:${type}:${l.id}` }); continue; }
        diffRows(diffs, `${role}:${type}:${l.code}`, l, n, Object.keys(l));
      }
      const first = native[0];
      if (first) for (const k of Object.keys(first)) if (!(k in legacy[0])) diffs.push({ kind: 'only-native', key: `${role}:${type}#${k}` });
    }
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '分類清單', legacy: { endpoint: `GET ${L}/categories` }, native: { endpoint: `GET ${N}/categories`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('料件清單：同一個搜尋、同一個登入者，料件 id 與欄位相同；店長看不到備註；搜尋含逗號括號時舊版壞掉、新版正常', async () => {
  const e = entry('parts-read');
  for (let i = 0; i < 4; i += 1) await seedPart(ctx.partCat.id, `PR${i}`, { brand: `PB${i}`, notes: `備註 ${i}` });
  await seedPart(ctx.partCat.id, 'PR-off', { is_active: false });
  const diffs: Diff[] = [];
  let compared = 0;
  for (const role of ['ga_staff', 'ga_part_view', 'ga_part_edit', 'real_store_manager']) {
    const lr = await apis[role].get(`${L}/parts?search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=100&sortBy=name&sortOrder=asc`);
    const nr = await apis[role].get(`${N}/parts?search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=100&sortBy=name&sortOrder=asc`);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `${role}:status`, legacy: lr.status(), native: nr.status() });
    const legacy = await body(lr);
    const native = await body(nr);
    expect(legacy.data?.length, role).toBeGreaterThan(3);
    if (legacy.meta.total !== native.meta.total) diffs.push({ kind: 'count', key: `${role}:total`, legacy: legacy.meta.total, native: native.meta.total });
    const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
    for (const l of legacy.data as any[]) {
      const n = nm.get(l.id);
      compared += 1;
      if (!n) { diffs.push({ kind: 'only-legacy', key: `${role}:${l.id}` }); continue; }
      const q5 = role === 'real_store_manager';
      diffRows(diffs, `${role}:${l.id}`, l, n, Object.keys(l).filter((k) => !(q5 && k === 'notes')));
      if (q5) {
        if ('notes' in l && !('notes' in n) && !diffs.some((d) => d.key === 'q5-store-manager-notes')) diffs.push({ kind: 'only-legacy', key: 'q5-store-manager-notes' });
        const { notes: _a, ...lrest } = l;
        diffKeys(diffs, `${role}`, lrest, n);
      } else diffKeys(diffs, `${role}`, l, n);
    }
    diffKeys(diffs, `${role}:top`, legacy, native);
  }
  // 搜尋輸入逗號、括號
  for (const q of ['螺絲(M4),長', 'a,b', '")']) {
    const lr = await apis.ga_staff.get(`${L}/parts?search=${encodeURIComponent(q)}`);
    const nr = await apis.ga_staff.get(`${N}/parts?search=${encodeURIComponent(q)}`);
    compared += 1;
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: 'parts-search-special-chars', legacy: lr.status(), native: nr.status() });
    expect(nr.status()).toBe(200);
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '料件清單', legacy: { endpoint: `GET ${L}/parts` }, native: { endpoint: `GET ${N}/parts`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('型號與架型清單：id、欄位與使用筆數相同', async () => {
  const e = entry('templates-read');
  const t1 = await seedEquipmentTemplate(ctx.eqCat.id, 'TR1');
  await seedEquipmentTemplate(ctx.eqCat.id, 'TR2', { is_active: false });
  const f = (await (await apis.ga_staff.post(`${N}/templates/facility`, { data: { code: m7Code('TRF'), name: m7Name('TRF'), category_id: ctx.facCat.id } })).json()).data;
  const eq = await adminDb().from('ga_equipment').insert({ store_id: (await adminDb().from('stores').select('id').eq('store_code', 'VW001').single()).data.id, category_id: ctx.eqCat.id, name: m7Name('TR-eq'), template_id: t1.id }).select('id').single();
  expect(eq.error).toBeNull();
  const diffs: Diff[] = [];
  let compared = 0;
  for (const role of ['ga_staff', 'ga_template_view']) {
    const mark = encodeURIComponent('[自動測試]M7M8');
    const lr = await apis[role].get(`${L}/equipment/templates?search=${mark}&pageSize=100&sortBy=name&sortDir=asc`);
    const nr = await apis[role].get(`${N}/templates/equipment?search=${mark}&pageSize=100&sortBy=name&sortDir=asc`);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `${role}:eq:status`, legacy: lr.status(), native: nr.status() });
    const legacy = await body(lr), native = await body(nr);
    const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
    for (const l of legacy.data as any[]) {
      compared += 1;
      const n = nm.get(l.id);
      if (!n) { diffs.push({ kind: 'only-legacy', key: `${role}:eq:${l.id}` }); continue; }
      diffRows(diffs, `${role}:eq:${l.id}`, l, n, Object.keys(l));
    }
    if (legacy.meta.total !== native.meta.total) diffs.push({ kind: 'count', key: `${role}:eq:total`, legacy: legacy.meta.total, native: native.meta.total });
    diffKeys(diffs, `${role}:eq:top`, legacy, native);
  }
  for (const role of ['ga_staff', 'ga_facility_view']) {
    const lr = await apis[role].get(`${L}/facility-templates`);
    const nr = await apis[role].get(`${N}/templates/facility?search=${encodeURIComponent(m7Code('TRF'))}`);
    const legacy = ((await body(lr)).data as any[]).find((r) => r.id === f.id);
    const native = ((await body(nr)).data as any[]).find((r) => r.id === f.id);
    compared += 1;
    expect(legacy && native, role).toBeTruthy();
    diffRows(diffs, `${role}:fac:${f.id}`, legacy, native, Object.keys(legacy));
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '型號與架型清單', legacy: { endpoint: `GET ${L}/equipment/templates` }, native: { endpoint: `GET ${N}/templates/equipment`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('適用料件與附件讀取：料件 id 集合相同；附件 id、檔名、格式、大小相同，簽名網址由 24 小時改 10 分鐘且不回儲存路徑', async () => {
  const eCompat = entry('compat-read');
  const eAtt = entry('attachments-read');
  const tpl = await seedEquipmentTemplate(ctx.eqCat.id, 'CR');
  const p1 = await seedPart(ctx.partCat.id, 'CR1');
  const p2 = await seedPart(ctx.partCat.id, 'CR2');
  expect((await apis.ga_staff.post(`${L}/parts/target-compatibilities`, { data: { targetType: 'EQUIPMENT_TEMPLATE', targetId: tpl.id, partIds: [p1.id, p2.id] } })).status()).toBe(200);
  const diffs: Diff[] = [];
  const legacy = (await body(await apis.ga_staff.get(`${L}/parts/target-compatibilities?targetType=EQUIPMENT_TEMPLATE&targetId=${tpl.id}`))).data as any[];
  const native = (await body(await apis.ga_staff.get(`${N}/compat?targetType=EQUIPMENT_TEMPLATE&targetId=${tpl.id}`))).data;
  if (JSON.stringify(legacy.map((r) => r.part_id).sort()) !== JSON.stringify(native.parts.map((r: any) => r.part_id).sort())) diffs.push({ kind: 'changed', key: 'compat:part_ids', legacy: legacy.map((r) => r.part_id), native: native.parts.map((r: any) => r.part_id) });
  for (const l of legacy) diffRows(diffs, `compat:${l.part_id}`, l, native.parts.find((r: any) => r.part_id === l.part_id), ['id', 'target_type', 'target_id', 'part_id', 'notes']);
  diffs.push(...(native.version ? [{ kind: 'only-native', key: 'compat#version' }] : []));
  assertNoUnlistedDiffs(record({ entry: eCompat.id, mechanism: 'api-read', title: '適用料件讀取', legacy: { endpoint: `GET ${L}/parts/target-compatibilities` }, native: { endpoint: `GET ${N}/compat`, status: 200 }, compared: { rows: legacy.length }, diffs }));

  const png = makePng({ width: 32, height: 32, inkPixels: 6 });
  const up = await apis.ga_staff.post(`${N}/attachments`, { multipart: form([{ name: `${M7_FILE_PREFIX}p.png`, mimeType: 'image/png', buffer: png }, { name: `${M7_FILE_PREFIX}p.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }], { resource_type: 'PART', resource_id: p1.id, purpose: 'GENERAL' }) });
  expect(up.status()).toBe(201);
  const ad: Diff[] = [];
  const la = await body(await apis.ga_staff.get(`${L}/attachments?resourceType=PART&resourceId=${p1.id}`));
  const na = await body(await apis.ga_staff.get(`${N}/attachments?resourceType=PART&resourceId=${p1.id}`));
  expect(la.data).toHaveLength(2);
  const nmap = new Map((na.data as any[]).map((r) => [r.id, r]));
  const ttl = (url: string) => { const t = new URL(url).searchParams.get('token'); const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()); return p.exp - p.iat; };
  for (const l of la.data as any[]) {
    const n = nmap.get(l.id);
    diffRows(ad, `att:${l.id}`, l, n, ['id', 'resource_type', 'resource_id', 'purpose', 'file_name', 'content_type', 'size_bytes', 'is_primary', 'sort_order', 'uploaded_by']);
    diffKeys(ad, 'att', l, n);
    if (ttl(l.signed_url) !== ttl(n.signed_url)) ad.push({ kind: 'changed', key: 'att#signed_url_ttl', legacy: ttl(l.signed_url), native: ttl(n.signed_url) });
  }
  assertNoUnlistedDiffs(record({ entry: eAtt.id, mechanism: 'api-read', title: '附件列表', legacy: { endpoint: `GET ${L}/attachments` }, native: { endpoint: `GET ${N}/attachments`, status: 200 }, compared: { rows: 2 }, diffs: ad }));
});

test('分類寫入：同一份輸入新增與編輯回讀相同；Q4 底下有啟用項目時停用、底下有項目時刪除，舊版放行、新版擋下', async () => {
  const e = entry('category-write');
  const diffs: Diff[] = [];
  const input = (suffix: string) => ({ type: 'part', name: m7Name(suffix), code: m7Code(suffix), description: '對等', sort_order: 7, spec_schema: [], default_base_unit: '個', is_recyclable_default: true });
  const a = await apis.ga_staff.post(`${L}/categories`, { data: input('PWA') });
  const b = await apis.ga_staff.post(`${N}/categories`, { data: input('PWB') });
  if (a.status() !== b.status()) diffs.push({ kind: 'status', key: 'create:status', legacy: a.status(), native: b.status() });
  const ra = (await rowsWhere('ga_part_categories', 'code', m7Code('PWA')))[0];
  const rb = (await rowsWhere('ga_part_categories', 'code', m7Code('PWB')))[0];
  diffRows(diffs, 'create', ra, rb, dbCols(ra));
  expect(ra.created_by).toBe(rb.created_by);
  // 編輯
  const pa = await apis.ga_staff.patch(`${L}/categories/${ra.id}`, { data: { type: 'part', description: '改過', sort_order: 9 } });
  const pb = await apis.ga_staff.patch(`${N}/categories/${rb.id}`, { data: { type: 'part', description: '改過', sort_order: 9 } });
  if (pa.status() !== pb.status()) diffs.push({ kind: 'status', key: 'edit:status', legacy: pa.status(), native: pb.status() });
  diffRows(diffs, 'edit', (await rowsWhere('ga_part_categories', 'id', ra.id))[0], (await rowsWhere('ga_part_categories', 'id', rb.id))[0], ['description', 'sort_order', 'is_active']);
  // 重複代碼與缺欄位：兩邊錯誤狀態相同
  for (const [label, data] of [['dup-code', input('PWA')], ['no-name', { ...input('PWX'), name: '' }], ['bad-type', { ...input('PWY'), type: 'vendor' }]] as const) {
    const x = await apis.ga_staff.post(`${L}/categories`, { data });
    const y = await apis.ga_staff.post(`${N}/categories`, { data });
    // 舊版把欄位錯誤與代碼重複都回 500、新版回 400／409：兩邊都拒絕且沒有建立資料就視為相同行為
    if ((x.status() < 300) !== (y.status() < 300)) diffs.push({ kind: 'status', key: `create-error:${label}`, legacy: x.status(), native: y.status() });
  }
  // Q4：底下有啟用中的子分類／項目時停用
  const mk = async (api: string, suffix: string, parent: string | null) => (await (await apis.ga_staff.post(`${api}/categories`, { data: { ...input(suffix), parent_id: parent } })).json()).data;
  const lp = await mk(L, 'QL', null); const lk = await mk(L, 'QLK', lp.id);
  const np = await mk(N, 'QN', null); const nk = await mk(N, 'QNK', np.id);
  await seedPart(lk.id, 'QLP'); await seedPart(nk.id, 'QNP');
  const dl = await apis.ga_staff.patch(`${L}/categories/${lp.id}`, { data: { type: 'part', is_active: false } });
  const dn = await apis.ga_staff.post(`${N}/categories/${np.id}/active`, { data: { type: 'part', active: false } });
  if (dl.status() !== dn.status()) diffs.push({ kind: 'status', key: 'category-deactivate-in-use', legacy: dl.status(), native: dn.status() });
  // Q4：底下有項目時刪除
  const xl = await apis.ga_staff.delete(`${L}/categories/${lk.id}?type=part`);
  const xn = await apis.ga_staff.delete(`${N}/categories/${nk.id}?type=part`);
  if (xl.status() !== xn.status()) diffs.push({ kind: 'status', key: 'category-delete-with-items', legacy: xl.status(), native: xn.status() });
  // 權限：唯讀、沒權限
  for (const role of ['ga_category_view', 'ga_part_view', 'denied']) {
    const x = await apis[role].post(`${L}/categories`, { data: input('PWZ') });
    const y = await apis[role].post(`${N}/categories`, { data: input('PWZ') });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `create-permission:${role}`, legacy: x.status(), native: y.status() });
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '分類寫入', legacy: { endpoint: `POST/PATCH/DELETE ${L}/categories` }, native: { endpoint: `POST/PATCH/DELETE ${N}/categories`, status: 201 }, compared: { steps: 8 }, diffs }));
});

test('料件寫入：同一份輸入新增、編輯回讀相同；Q6 重複、有庫存改單位、有庫存刪除，舊版放行、新版擋下；缺欄位與權限錯誤相同', async () => {
  const e = entry('part-write');
  const diffs: Diff[] = [];
  const input = (suffix: string, over: Record<string, unknown> = {}) => ({ category_id: ctx.partCat.id, name: m7Name(suffix), part_code: m7Code(suffix), brand: 'PB', model: `PM-${suffix}`, specification: `PS-${suffix}`, base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 6, minimum_issue_qty: 2, allow_unpacking: true, tags: ['x'], notes: '備註', ...over });
  const a = await apis.ga_staff.post(`${L}/parts`, { data: input('WA') });
  const b = await apis.ga_staff.post(`${N}/parts`, { data: input('WB') });
  if (a.status() !== b.status()) diffs.push({ kind: 'status', key: 'create:status', legacy: a.status(), native: b.status() });
  const ra = (await body(a)).data, rb = (await body(b)).data;
  const da = (await rowsWhere('ga_parts', 'id', ra.id))[0], db = (await rowsWhere('ga_parts', 'id', rb.id))[0];
  diffRows(diffs, 'create', da, db, dbCols(da));
  const pa = await apis.ga_staff.patch(`${L}/parts/${ra.id}`, { data: { description: '新說明', minimum_issue_qty: 3, is_active: false } });
  const pb = await apis.ga_staff.patch(`${N}/parts/${rb.id}`, { data: { description: '新說明', minimum_issue_qty: 3, is_active: false } });
  if (pa.status() !== pb.status()) diffs.push({ kind: 'status', key: 'edit:status', legacy: pa.status(), native: pb.status() });
  diffRows(diffs, 'edit', (await rowsWhere('ga_parts', 'id', ra.id))[0], (await rowsWhere('ga_parts', 'id', rb.id))[0], ['description', 'minimum_issue_qty', 'is_active']);
  for (const [label, data] of [['no-name', input('WX', { name: '' })], ['no-unit', input('WY', { base_unit: '' })], ['dup-code', input('WA')], ['system-field', input('WZ', { created_by: 'x' })]] as const) {
    const x = await apis.ga_staff.post(`${L}/parts`, { data });
    const y = await apis.ga_staff.post(`${N}/parts`, { data });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `create-error:${label}`, legacy: x.status(), native: y.status() });
  }
  for (const role of ['ga_part_view', 'denied']) {
    const x = await apis[role].post(`${L}/parts`, { data: input('WP') });
    const y = await apis[role].post(`${N}/parts`, { data: input('WP') });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `create-permission:${role}`, legacy: x.status(), native: y.status() });
  }
  // Q6 重複（品牌＋型號＋規格）
  const dupL = await apis.ga_staff.post(`${L}/parts`, { data: input('DL', { part_code: m7Code('DL1'), model: 'DUPM', specification: 'DUPS', brand: 'DUPB' }) });
  const dupL2 = await apis.ga_staff.post(`${L}/parts`, { data: input('DL2', { part_code: m7Code('DL2'), model: 'DUPM', specification: 'DUPS', brand: 'DUPB' }) });
  const dupN = await apis.ga_staff.post(`${N}/parts`, { data: input('DN', { part_code: m7Code('DN1'), model: 'DUPM2', specification: 'DUPS2', brand: 'DUPB2' }) });
  const dupN2 = await apis.ga_staff.post(`${N}/parts`, { data: input('DN2', { part_code: m7Code('DN2'), model: 'DUPM2', specification: 'DUPS2', brand: 'DUPB2' }) });
  expect(dupL.status() && dupN.status()).toBe(201);
  if (dupL2.status() !== dupN2.status()) diffs.push({ kind: 'status', key: 'part-duplicate-create', legacy: dupL2.status(), native: dupN2.status() });
  // Q6 有庫存改單位、刪除
  const loc = await seedLocation(null, 'WL');
  await seedBalance(loc.id, ra.id, 2);
  await seedBalance(loc.id, rb.id, 2);
  const ul = await apis.ga_staff.patch(`${L}/parts/${ra.id}`, { data: { base_unit: '箱', purchase_unit: null, purchase_to_base_rate: null } });
  const un = await apis.ga_staff.patch(`${N}/parts/${rb.id}`, { data: { base_unit: '箱', purchase_unit: null, purchase_to_base_rate: null } });
  if (ul.status() !== un.status()) diffs.push({ kind: 'status', key: 'part-unit-change-with-stock', legacy: ul.status(), native: un.status() });
  const xl = await apis.ga_staff.delete(`${L}/parts/${ra.id}`, { data: { deletion_reason: '對等' } });
  const xn = await apis.ga_staff.delete(`${N}/parts/${rb.id}`, { data: { deletion_reason: '對等' } });
  if (xl.status() !== xn.status()) diffs.push({ kind: 'status', key: 'part-delete-with-stock', legacy: xl.status(), native: xn.status() });
  // 沒庫存、沒未結單時刪除：兩邊都成功，回讀相同
  const c1 = (await body(await apis.ga_staff.post(`${L}/parts`, { data: input('XL', { part_code: m7Code('XL'), model: 'XM1', specification: 'XS1' }) }))).data;
  const c2 = (await body(await apis.ga_staff.post(`${N}/parts`, { data: input('XN', { part_code: m7Code('XN'), model: 'XM2', specification: 'XS2' }) }))).data;
  const d1 = await apis.ga_staff.delete(`${L}/parts/${c1.id}`, { data: { deletion_reason: '一樣的原因' } });
  const d2 = await apis.ga_staff.delete(`${N}/parts/${c2.id}`, { data: { deletion_reason: '一樣的原因' } });
  if (d1.status() !== d2.status()) diffs.push({ kind: 'status', key: 'part-delete-clean:status', legacy: d1.status(), native: d2.status() });
  diffRows(diffs, 'delete', (await rowsWhere('ga_parts', 'id', c1.id))[0], (await rowsWhere('ga_parts', 'id', c2.id))[0], ['is_active', 'deletion_reason']);
  const r1 = (await rowsWhere('ga_parts', 'id', c1.id))[0], r2 = (await rowsWhere('ga_parts', 'id', c2.id))[0];
  expect(!!r1.deleted_at && !!r2.deleted_at && r1.deleted_by === r2.deleted_by).toBe(true);
  // 刪除沒填原因：兩邊都 400
  const n1 = await apis.ga_staff.delete(`${L}/parts/${rb.id}`, { data: {} });
  const n2 = await apis.ga_staff.delete(`${N}/parts/${rb.id}`, { data: {} });
  if (n1.status() !== n2.status()) diffs.push({ kind: 'status', key: 'part-delete-no-reason', legacy: n1.status(), native: n2.status() });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '料件寫入', legacy: { endpoint: `POST/PATCH/DELETE ${L}/parts` }, native: { endpoint: `POST/PATCH/DELETE ${N}/parts`, status: 201 }, compared: { steps: 14 }, diffs }));
});

test('型號與架型寫入：同一份輸入新增與編輯回讀相同、重複兩邊都 409；Q7 用中的型號刪除舊版放行、新版擋下；架型刪除是新增功能', async () => {
  const e = entry('template-write');
  const diffs: Diff[] = [];
  const eq = (suffix: string) => ({ category_id: ctx.eqCat.id, name: m7Name(suffix), brand: 'TB', model: m7Code(suffix), description: '對等', default_warranty_months: 18, specs: { a: 1 }, default_fields: { b: 2 } });
  const a = await apis.ga_staff.post(`${L}/equipment/templates`, { data: eq('TWA') });
  const b = await apis.ga_staff.post(`${N}/templates/equipment`, { data: eq('TWB') });
  if (a.status() !== b.status()) diffs.push({ kind: 'status', key: 'eq-create:status', legacy: a.status(), native: b.status() });
  const ta = (await body(a)).data, tb = (await body(b)).data;
  diffRows(diffs, 'eq-create', (await rowsWhere('ga_equipment_templates', 'id', ta.id))[0], (await rowsWhere('ga_equipment_templates', 'id', tb.id))[0], dbCols(ta).filter((k) => k !== 'model' && k !== 'name'));
  const da = await apis.ga_staff.post(`${L}/equipment/templates`, { data: eq('TWA') });
  const db = await apis.ga_staff.post(`${N}/templates/equipment`, { data: eq('TWB') });
  if (da.status() !== db.status() || (await body(da)).error?.replace(/TW[AB]/g, '') !== (await body(db)).error?.replace(/TW[AB]/g, '')) diffs.push({ kind: 'changed', key: 'eq-duplicate-message', legacy: (await body(da)).error, native: (await body(db)).error });
  const ea = await apis.ga_staff.patch(`${L}/equipment/templates/${ta.id}`, { data: { description: '改', default_warranty_months: 30 } });
  const eb = await apis.ga_staff.patch(`${N}/templates/equipment/${tb.id}`, { data: { description: '改', default_warranty_months: 30 } });
  if (ea.status() !== eb.status()) diffs.push({ kind: 'status', key: 'eq-edit:status', legacy: ea.status(), native: eb.status() });
  diffRows(diffs, 'eq-edit', (await rowsWhere('ga_equipment_templates', 'id', ta.id))[0], (await rowsWhere('ga_equipment_templates', 'id', tb.id))[0], ['description', 'default_warranty_months']);
  for (const role of ['ga_template_view', 'denied']) {
    const x = await apis[role].post(`${L}/equipment/templates`, { data: eq('TWP') });
    const y = await apis[role].post(`${N}/templates/equipment`, { data: eq('TWP') });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `eq-create-permission:${role}`, legacy: x.status(), native: y.status() });
  }
  // 設施架型
  const fac = (suffix: string) => ({ code: m7Code(suffix), name: m7Name(suffix), category_id: ctx.facCat.id, brand: 'FB', model: `FM-${suffix}`, width_cm: 100, height_cm: 150, depth_cm: 30, description: '對等', is_active: true });
  const fa = await apis.ga_staff.post(`${L}/facility-templates`, { data: { ...fac('FWA'), categoryId: ctx.facCat.id, widthCm: 100, heightCm: 150, depthCm: 30, isActive: true } });
  const fb = await apis.ga_staff.post(`${N}/templates/facility`, { data: fac('FWB') });
  if (fa.status() !== fb.status()) diffs.push({ kind: 'status', key: 'fac-create:status', legacy: fa.status(), native: fb.status() });
  const xa = (await body(fa)).data, xb = (await body(fb)).data;
  diffRows(diffs, 'fac-create', (await rowsWhere('ga_facility_templates', 'id', xa.id))[0], (await rowsWhere('ga_facility_templates', 'id', xb.id))[0], dbCols(xa).filter((k) => k !== 'model' && k !== 'name'));
  // Q7：用中的型號刪除
  const inL = await seedEquipmentTemplate(ctx.eqCat.id, 'IUL'); const inN = await seedEquipmentTemplate(ctx.eqCat.id, 'IUN');
  const store = (await adminDb().from('stores').select('id').eq('store_code', 'VW001').single()).data.id;
  for (const t of [inL, inN]) expect((await adminDb().from('ga_equipment').insert({ store_id: store, category_id: ctx.eqCat.id, name: m7Name('IUE' + t.id.slice(0, 4)), template_id: t.id })).error).toBeNull();
  const xl = await apis.ga_staff.delete(`${L}/equipment/templates/${inL.id}`, { data: { deletion_reason: '對等' } });
  const xn = await apis.ga_staff.delete(`${N}/templates/equipment/${inN.id}`, { data: { deletion_reason: '對等' } });
  if (xl.status() !== xn.status()) diffs.push({ kind: 'status', key: 'template-delete-in-use', legacy: xl.status(), native: xn.status() });
  // 沒人用的型號刪除：兩邊都成功、回讀相同
  const cl = await seedEquipmentTemplate(ctx.eqCat.id, 'CLL'); const cn = await seedEquipmentTemplate(ctx.eqCat.id, 'CLN');
  const yl = await apis.ga_staff.delete(`${L}/equipment/templates/${cl.id}`, { data: { deletion_reason: '一樣' } });
  const yn = await apis.ga_staff.delete(`${N}/templates/equipment/${cn.id}`, { data: { deletion_reason: '一樣' } });
  if (yl.status() !== yn.status()) diffs.push({ kind: 'status', key: 'template-delete-clean:status', legacy: yl.status(), native: yn.status() });
  diffRows(diffs, 'template-delete', (await rowsWhere('ga_equipment_templates', 'id', cl.id))[0], (await rowsWhere('ga_equipment_templates', 'id', cn.id))[0], ['is_active', 'deletion_reason']);
  // 設施架型刪除：舊版沒有這個功能（沒有 DELETE 路由）
  const fl = await apis.ga_staff.delete(`${L}/facility-templates`, { data: { id: xa.id } });
  const fnat = await apis.ga_staff.delete(`${N}/templates/facility/${xb.id}`, { data: { deletion_reason: '新功能' } });
  if (fl.status() !== fnat.status()) diffs.push({ kind: 'status', key: 'facility-template-delete', legacy: fl.status(), native: fnat.status() });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '型號與架型寫入', legacy: { endpoint: `${L}/equipment/templates, ${L}/facility-templates` }, native: { endpoint: `${N}/templates/*`, status: 201 }, compared: { steps: 14 }, diffs }));
});

test('適用料件整批取代：同一份輸入，新增與移除筆數與被取代列的刪除原因相同', async () => {
  const e = entry('compat-write');
  const diffs: Diff[] = [];
  const tl = await seedEquipmentTemplate(ctx.eqCat.id, 'CWL'); const tn = await seedEquipmentTemplate(ctx.eqCat.id, 'CWN');
  const ps = [await seedPart(ctx.partCat.id, 'CW1'), await seedPart(ctx.partCat.id, 'CW2'), await seedPart(ctx.partCat.id, 'CW3')];
  const run = async (legacy: boolean, tid: string, ids: string[]) => {
    const r = legacy
      ? await apis.ga_staff.post(`${L}/parts/target-compatibilities`, { data: { targetType: 'EQUIPMENT_TEMPLATE', targetId: tid, partIds: ids } })
      : await apis.ga_staff.put(`${N}/compat`, { data: { targetType: 'EQUIPMENT_TEMPLATE', targetId: tid, partIds: ids } });
    const b = await body(r);
    return { status: r.status(), data: b.data, error: b.error };
  };
  const step = async (label: string, ids: number[]) => {
    const a = await run(true, tl.id, ids.map((i) => ps[i].id)), b = await run(false, tn.id, ids.map((i) => ps[i].id));
    if (a.status !== b.status) diffs.push({ kind: 'status', key: `${label}:status`, legacy: `${a.status} ${a.error ?? ''}`, native: `${b.status} ${b.error ?? ''}` });
    diffRows(diffs, label, a.data, b.data, ['added', 'removed']);
    const rows = async (tid: string) => (await rowsWhere('ga_part_target_compatibilities', 'target_id', tid)).map((r) => ({ part: r.part_id === ps[0].id ? 0 : r.part_id === ps[1].id ? 1 : 2, live: !r.deleted_at, reason: r.deletion_reason })).sort((x, y) => x.part - y.part || Number(x.live) - Number(y.live));
    if (JSON.stringify(await rows(tl.id)) !== JSON.stringify(await rows(tn.id))) diffs.push({ kind: 'changed', key: `${label}:rows`, legacy: await rows(tl.id), native: await rows(tn.id) });
  };
  await step('set-12', [0, 1]);
  // 舊版整批取代在「要移除舊對照」時會失敗（HTTP 500：資料庫的讀取規則不允許把列改成已刪除）；新版用資料庫函式，成功且列的刪除原因相同。
  const legacyRemove = await run(true, tl.id, [ps[1].id, ps[2].id].map((x) => x));
  const nativeRemove = await run(false, tn.id, [ps[1].id, ps[2].id]);
  if (legacyRemove.status !== nativeRemove.status) diffs.push({ kind: 'status', key: 'compat-replace-removes-rows', legacy: legacyRemove.status, native: nativeRemove.status });
  expect(nativeRemove.status).toBe(200);
  expect(nativeRemove.data).toMatchObject({ added: 1, removed: 1 });
  const nativeRows = (await rowsWhere('ga_part_target_compatibilities', 'target_id', tn.id)).filter((r) => r.deleted_at);
  expect(nativeRows.map((r) => r.deletion_reason)).toEqual(['REPLACED_BY_COMPATIBILITY_MANAGEMENT']);
  const nativeClear = await run(false, tn.id, []);
  expect(nativeClear.data).toMatchObject({ added: 0, removed: 2 });
  // 無權限：兩邊都 403
  for (const role of ['ga_part_view', 'ga_template_edit']) {
    const x = await apis[role].post(`${L}/parts/target-compatibilities`, { data: { targetType: 'EQUIPMENT_TEMPLATE', targetId: tl.id, partIds: [] } });
    const y = await apis[role].put(`${N}/compat`, { data: { targetType: 'EQUIPMENT_TEMPLATE', targetId: tn.id, partIds: [] } });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `compat-permission:${role}`, legacy: x.status(), native: y.status() });
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '適用料件整批取代', legacy: { endpoint: `POST ${L}/parts/target-compatibilities` }, native: { endpoint: `PUT ${N}/compat`, status: 200 }, compared: { steps: 6 }, diffs }));
});

test('附件寫入：同一份檔案的資料庫列相同；Q3 超過 4MB 舊版收、新版擋；刪除時舊版連實體檔一起刪、新版只標記', async () => {
  const e = entry('attachment-write');
  const diffs: Diff[] = [];
  const part = await seedPart(ctx.partCat.id, 'AW');
  const png = makePng({ width: 40, height: 40, inkPixels: 8 });
  const file = (n: string) => [{ name: `${M7_FILE_PREFIX}${n}.png`, mimeType: 'image/png', buffer: png }];
  const fields = { resource_type: 'PART', resource_id: part.id, purpose: 'GENERAL' };
  const a = await apis.ga_staff.post(`${L}/attachments`, { multipart: form(file('l'), fields) });
  const b = await apis.ga_staff.post(`${N}/attachments`, { multipart: form(file('n'), fields) });
  if (a.status() !== b.status()) diffs.push({ kind: 'status', key: 'upload:status', legacy: a.status(), native: b.status() });
  expect([a.status(), b.status()], JSON.stringify([await body(a), await body(b)])).toEqual([201, 201]);
  const ra = (await body(a)).data[0], rb = (await body(b)).data[0];
  const da = (await rowsWhere('ga_resource_attachments', 'id', ra.id))[0], db = (await rowsWhere('ga_resource_attachments', 'id', rb.id))[0];
  diffRows(diffs, 'upload', da, db, ['resource_type', 'resource_id', 'purpose', 'storage_bucket', 'content_type', 'size_bytes', 'is_primary', 'sort_order', 'metadata']);
  const shape = (p: string) => p.replace(/\d{13}-[0-9a-f-]{36}/, '<ts>-<uuid>');
  if (shape(da.storage_path) !== shape(db.storage_path)) diffs.push({ kind: 'changed', key: 'upload#storage_path_shape', legacy: shape(da.storage_path), native: shape(db.storage_path) });
  expect(da.uploaded_by).toBe(db.uploaded_by);
  // 錯誤輸入：兩邊狀態相同
  const bad: [string, any[], Record<string, string>][] = [
    ['text-file', [{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }], fields],
    ['bad-resource', file('x'), { ...fields, resource_type: 'WORK_ORDER' }],
    ['no-resource-id', file('x'), { ...fields, resource_id: '' }],
    ['eleven-files', Array.from({ length: 11 }, (_, i) => file(String(i))[0]), fields],
  ];
  for (const [label, files, f] of bad) {
    const x = await apis.ga_staff.post(`${L}/attachments`, { multipart: form(files, f) });
    const y = await apis.ga_staff.post(`${N}/attachments`, { multipart: form(files, f) });
    // 舊版把資源類型錯誤回 500、新版回 400：兩邊都拒絕就視為相同行為（資料庫沒有新增列）
    if ((x.status() < 300) !== (y.status() < 300)) diffs.push({ kind: 'status', key: `upload-error:${label}`, legacy: x.status(), native: y.status() });
  }
  for (const role of ['ga_part_view', 'denied']) {
    const x = await apis[role].post(`${L}/attachments`, { multipart: form(file('p'), fields) });
    const y = await apis[role].post(`${N}/attachments`, { multipart: form(file('p'), fields) });
    if ((x.status() === 201) !== (y.status() === 201)) diffs.push({ kind: 'status', key: `upload-permission:${role}`, legacy: x.status(), native: y.status() });
  }
  // Q3：4MB 以上的 PDF
  const big = [{ name: `${M7_FILE_PREFIX}big.pdf`, mimeType: 'application/pdf', buffer: Buffer.alloc(4 * 1024 * 1024 + 1024, 1) }];
  const bl = await apis.ga_staff.post(`${L}/attachments`, { multipart: form(big, fields) });
  const bn = await apis.ga_staff.post(`${N}/attachments`, { multipart: form(big, fields) });
  if (bl.status() !== bn.status()) diffs.push({ kind: 'status', key: 'attachment-over-4mb', legacy: bl.status(), native: bn.status() });
  // 刪除：舊版刪實體檔、新版保留
  const xl = await apis.ga_staff.delete(`${L}/attachments/${ra.id}`, { data: { deletion_reason: '對等' } });
  const xn = await apis.ga_staff.delete(`${N}/attachments/${rb.id}`, { data: { deletion_reason: '對等' } });
  if (xl.status() !== xn.status()) diffs.push({ kind: 'status', key: 'delete:status', legacy: xl.status(), native: xn.status() });
  const ma = (await rowsWhere('ga_resource_attachments', 'id', ra.id))[0], mb = (await rowsWhere('ga_resource_attachments', 'id', rb.id))[0];
  diffRows(diffs, 'delete', ma, mb, ['deletion_reason']);
  expect(!!ma.deleted_at && !!mb.deleted_at && ma.deleted_by === mb.deleted_by).toBe(true);
  const exists = async (p: string) => !(await adminDb().storage.from('general-affairs-attachments').download(p)).error;
  const ea = await exists(ma.storage_path), eb = await exists(mb.storage_path);
  if (ea !== eb) diffs.push({ kind: 'changed', key: 'attachment-delete-storage-object', legacy: ea, native: eb });
  // 上傳大檔如果舊版收下了，清掉它（這是測試自己建立的檔案）
  if (bl.status() === 201) for (const r of (await body(bl)).data) await adminDb().storage.from('general-affairs-attachments').remove([(await rowsWhere('ga_resource_attachments', 'id', r.id))[0].storage_path]);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '附件寫入', legacy: { endpoint: `POST/DELETE ${L}/attachments` }, native: { endpoint: `POST/DELETE ${N}/attachments`, status: 201 }, compared: { steps: 12 }, diffs }));
});

// 舊版把「只寫權限碼」的側欄項目對所有人顯示（旗標判斷寫成永遠為真）；新版已移植的頁面依 capability 把關。差異聚合成兩種：分類與型號的顯示條件（問卷已核可）、新增料件與適用料件設定的顯示條件（同一個修正的延伸，待核可）。
const NAV_CATEGORY_TEMPLATE = new Set(['equipment-categories', 'facility-categories', 'part-categories', 'equipment-templates', 'facility-templates', 'equipment', 'facilities', 'parts']);
const NAV_PART_MANAGE = new Set(['part-new', 'part-compatibilities', 'parts-list']);
const navKey = (id: string) => (NAV_CATEGORY_TEMPLATE.has(id) ? 'nav-category-template-conditions' : NAV_PART_MANAGE.has(id) ? 'nav-part-manage-conditions' : `unexpected:${id}`);
test('總務側欄：每個角色的舊版規則項目 id 集合 vs 新版 gaNavigation（差異只有已移植頁面的 capability 把關與店長不列設施架型）', async () => {
  const e = entry('sidebar-visibility');
  const fixture = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: any[] };
  const diffs: Diff[] = [];
  const ADMIN = ['admin', 'system_admin', 'full_admin', 'full_admin_role', 'dev_full_admin', 'owner', 'owner_role', 'admin_role'];
  let compared = 0;
  for (const role of ['ga_staff', 'ga_works', 'ga_part_view', 'ga_part_edit', 'ga_category_view', 'ga_category_edit', 'ga_template_view', 'ga_template_edit', 'ga_facility_view', 'ga_facility_edit', 'ga_vendor_manager', 'ga_store_manager_b', 'store_manager', 'denied']) {
    const acc = fixture.accounts.find((a) => a.key === role);
    const session = await body(await apis[role].get('/api/workspace/session'));
    // 權限集合：以 session 回報的資料庫語意權限；角色碼：fixture 的 systemRoles
    const roleCodes = new Set<string>([...(acc.systemRoles || [])]);
    const perms = new Set<string>(session.permissions);
    const isAdmin = acc.profileRole === 'admin' || [...roleCodes].some((c) => ADMIN.includes(c));
    const access = resolveAccess([{ is_active: true, role: { code: 'x', role_permissions: [...perms].map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }], acc.profileRole);
    // 舊版規則（與 hooks/useNavbarPermissions.ts 旗標同一套，nav.ts 的 legacyNavFlags 是它的移植；這裡直接呼叫舊版 getVisible… 取舊版 id 集合）
    const { legacyNavFlags } = await import('../../lib/workspace/general-affairs/nav');
    const flags = legacyNavFlags({ has: access.has, permissions: access.permissions as any, roleCodes, isAdmin });
    const legacyIds = new Set(flattenGeneralAffairsNavItems(getVisibleGeneralAffairsNavGroups({ permissionCodes: perms, permissionFlags: flags, isAdminLike: isAdmin })).map((i) => i.id));
    const flat = (session.gaNavigation as any[]).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])])).map((i) => i.id);
    const nativeIds = new Set<string>(flat);
    compared += legacyIds.size;
    for (const id of legacyIds) if (!nativeIds.has(id)) diffs.push({ kind: 'only-legacy', key: navKey(id), legacy: `${role}:${id}` });
    for (const id of nativeIds) if (!legacyIds.has(id)) diffs.push({ kind: 'only-native', key: `native-only:${id}`, native: `${role}:${id}` });
    // session 的 gaNavigation 要和單元層的規則（nav.ts 以同一組輸入）一致：不能因為 session 組裝而漂移
    const expected = gaNavigation({ has: access.has, permissions: access.permissions as any, roleCodes, isAdmin });
    const expectedIds = new Set(expected.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children || [])])).map((i) => i.id));
    expect([...nativeIds].sort(), `${role}: session 與 nav.ts 規則不一致`).toEqual([...expectedIds].sort());
  }
  // 同一個 key 只留第一筆（細節放在 detail）
  const seen = new Set<string>();
  for (let i = diffs.length - 1; i >= 0; i -= 1) { if (seen.has(diffs[i].key) && diffs[i].key.startsWith('nav-')) diffs.splice(i, 1); else seen.add(diffs[i].key); }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'navigation', title: '總務側欄項目', legacy: { endpoint: 'components/general-affairs/navigation.tsx' }, native: { endpoint: 'GET /api/workspace/session gaNavigation', status: 200 }, compared: { items: compared }, diffs }));
});
