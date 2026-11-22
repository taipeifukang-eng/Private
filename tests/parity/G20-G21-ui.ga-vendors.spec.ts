import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';
import { freshValidTaxId, ga6Code, ga6Name, seedGa6Vendor, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G20-G21-ui 對等層：舊版廠商、服務分類、服務區域頁沒有專屬 API，而是登入者的瀏覽器直接用 supabase client 讀寫資料表
// （components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx：新增廠商 insert、分類 insert／update、區域 insert、列表 select）。
// 這裡用同一個登入者（總務全套）、同一份輸入：舊版路徑＝使用者身分直接寫入資料表（原樣送舊版 payload），新版＝ /api/workspace/general-affairs/vendors 等 API；
// 兩邊都以 service role 回讀資料列逐欄比對。差異都登記在 tests/parity/allowlist.json（page: ga-vendors／ga-service-categories／ga-service-regions，id 以 m7m8-b6- 開頭）；未登記的差異一律失敗。
const map = loadMap('ga-vendors');
const rec = new ParityRecorder('ga-vendors');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const N = '/api/workspace/general-affairs';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let api: APIRequestContext;
let seq = 0;
const db = () => adminDb();
const j = async (r: any) => r.json().catch(() => ({}));
const TIME = /(_at|_since)$/;
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME.test(key)) return !!a === !!b;
  const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
};
const cmp = (diffs: Diff[], label: string, l: any, n: any, cols: string[]) => {
  for (const c of cols) if (!same(l?.[c], n?.[c], c)) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: l?.[c], native: n?.[c] });
};
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });

test.describe.configure({ mode: 'default' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(['ga_all']);
  users = made.users;
  teardown = made.teardown;
  api = await apiForUser(users.ga_all as any);
});
test.afterAll(async () => {
  await api?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

const VENDOR_COLS = ['name', 'vendor_type', 'tax_id', 'alias', 'founded_date', 'status', 'phone', 'fax', 'website', 'city', 'district', 'address', 'service_city', 'service_district', 'service_address',
  'same_service_address', 'contact_name', 'contact_phone', 'line_id', 'email', 'description', 'service_capability_note', 'billing_title', 'billing_address', 'invoice_type', 'payment_terms',
  'payment_methods', 'accounting_notes', 'cooperation_start_date', 'contract_end_date', 'contract_required', 'preferred_vendor', 'cooperation_notes', 'attachment_names', 'tags', 'brands', 'equipment_types',
  'service_category_ids', 'service_region_ids', 'rating', 'review_count', 'work_order_count', 'monthly_order_count', 'total_amount', 'updated_by'];

test('新增廠商：同一份輸入，舊版（使用者身分直接 insert，原樣送舊版欄位）與新版 POST /vendors 寫入後的資料列逐欄相同；差異＝服務地址不複製、統編必填與檢查、預設值、不再寫假績效與假附件、留修改者', async () => {
  const e = entry('vendor-create-write-readback');
  const diffs: Diff[] = [];
  const cat = (await db().from('ga_service_categories').insert({ name: ga6Name('PV-分類'), code: ga6Code('PV1'), status: 'active', sort_order: 800 }).select('*').single()).data as any;
  const tag = String((seq += 1));
  const input = {
    type: 'company', taxId: await freshValidTaxId(), alias: '對等別名', city: '台北市', district: '大安區', address: '某路 1 號', phone: '02-1111-2222', contactName: '王聯絡', contactPhone: '0912-111-222', email: 'p@example.test',
    description: '對等測試簡介', billingTitle: '對等抬頭', invoiceType: '三聯式', paymentTerms: '月結30天', paymentMethods: ['匯款'], tags: ['冷氣', '水電'], brands: ['A牌'], contractRequired: true, contractEnd: '2038-12-31',
  };
  // 舊版 payload（GeneralAffairsServiceCenterClient.tsx saveVendor）
  const legacyName = ga6Name(`PV-L${tag}`);
  const legacyPayload = {
    name: legacyName, vendor_type: input.type, tax_id: input.taxId, alias: input.alias, founded_date: null, status: 'active', phone: input.phone, fax: null, website: null,
    city: input.city, district: input.district, address: input.address, service_city: input.city, service_district: input.district, service_address: input.address, same_service_address: true,
    contact_name: input.contactName, contact_phone: input.contactPhone, line_id: null, email: input.email, description: input.description, service_capability_note: null,
    billing_title: input.billingTitle, billing_address: null, invoice_type: input.invoiceType, payment_terms: input.paymentTerms, payment_methods: input.paymentMethods, accounting_notes: null,
    cooperation_start_date: null, contract_end_date: input.contractEnd, contract_required: input.contractRequired, preferred_vendor: false, cooperation_notes: null, attachment_names: [],
    tags: input.tags, brands: input.brands, equipment_types: [], service_category_ids: [cat.id], service_region_ids: [], rating: 0, review_count: 0, work_order_count: 0, monthly_order_count: 0,
  };
  // 舊版統編不唯一：同一個統編可以再新增；新版要先把舊版那筆的統編換掉，避免被新版擋下而干擾逐欄比對（統編重複另列差異）
  const lr = await users.ga_all.client.from('ga_vendors').insert(legacyPayload).select('*').single();
  expect(lr.error?.message ?? '').toBe('');
  await db().from('ga_vendors').update({ tax_id: null }).eq('id', lr.data.id);
  const nativeName = ga6Name(`PV-N${tag}`);
  const nr = await api.post(`${N}/vendors`, {
    data: {
      name: nativeName, vendor_type: input.type, tax_id: input.taxId, alias: input.alias, city: input.city, district: input.district, address: input.address, phone: input.phone, same_service_address: true,
      contact_name: input.contactName, contact_phone: input.contactPhone, email: input.email, description: input.description, billing_title: input.billingTitle, invoice_type: input.invoiceType,
      payment_terms: input.paymentTerms, payment_methods: input.paymentMethods, contract_end_date: input.contractEnd, contract_required: input.contractRequired, preferred_vendor: false,
      tags: input.tags, brands: input.brands, service_category_ids: [cat.id],
    },
  });
  expect(nr.status(), JSON.stringify(await j(nr))).toBe(201);
  statusDiff(diffs, 'create-status', 201, nr.status());
  const lrow = (await db().from('ga_vendors').select('*').eq('id', lr.data.id).single()).data as any;
  lrow.tax_id = input.taxId; // 上面為了避免唯一性干擾暫時清掉，比對時還原成原送的值
  const nrow = (await db().from('ga_vendors').select('*').eq('name', nativeName).single()).data as any;
  cmp(diffs, 'vendor', { ...lrow, name: 'X' }, { ...nrow, name: 'X' }, VENDOR_COLS);
  // 舊版統編可重複（同一個統編再新增一筆成功）；新版擋下並指出既有廠商（409）
  const dupL = await users.ga_all.client.from('ga_vendors').insert({ ...legacyPayload, name: ga6Name(`PV-LD${tag}`), tax_id: input.taxId }).select('id').single();
  const dupN = await api.post(`${N}/vendors`, { data: { name: ga6Name(`PV-ND${tag}`), vendor_type: 'company', tax_id: input.taxId } });
  statusDiff(diffs, 'duplicate-tax-status', dupL.error ? 409 : 201, dupN.status());
  expect(dupN.status()).toBe(409);
  expect((await j(dupN)).existing?.name).toBe(nativeName);
  // 舊版沒有必填統編：公司不填統編也能新增；新版擋下（400）
  const noTaxN = await api.post(`${N}/vendors`, { data: { name: ga6Name(`PV-NT${tag}`), vendor_type: 'company' } });
  statusDiff(diffs, 'no-tax-status', 201, noTaxN.status());
  expect(noTaxN.status()).toBe(400);
  // 新版需版本才能編輯；舊版沒有編輯入口：新版編輯後回讀留修改者
  const edit = await api.patch(`${N}/vendors/${nrow.id}`, { data: { contact_name: '改過的聯絡人', expected_updated_at: nrow.updated_at } });
  expect(edit.status(), JSON.stringify(await j(edit))).toBe(200);
  expect(((await db().from('ga_vendors').select('contact_name,updated_by').eq('id', nrow.id).single()).data as any)).toMatchObject({ contact_name: '改過的聯絡人', updated_by: users.ga_all.id });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '新增廠商', legacy: { endpoint: 'supabase client insert ga_vendors（GeneralAffairsServiceCenterClient.tsx）' }, native: { endpoint: `POST ${N}/vendors`, status: 201 }, compared: { columns: VENDOR_COLS.length }, diffs }));
});

test('廠商列表與統計：同一個登入者、同一批測試廠商，舊版直接讀 ga_vendors（select *）與新版 GET /vendors 的共同欄位逐筆比對；統計卡數字（全部、合作中、暫停、停用）相同', async () => {
  const e = entry('vendor-list-read');
  const diffs: Diff[] = [];
  const a = await seedGa6Vendor('PL-A', { tax_id: await freshValidTaxId(), contact_name: '甲', contact_phone: '02-1', alias: '甲別名', tags: ['x'] });
  const b = await seedGa6Vendor('PL-B', { status: 'paused', tax_id: await freshValidTaxId(), contact_name: '乙' });
  const c = await seedGa6Vendor('PL-C', { status: 'inactive', tax_id: await freshValidTaxId(), contract_required: true, contract_end_date: '2038-01-01' });
  const lr = await users.ga_all.client.from('ga_vendors').select('*').ilike('name', `${ga6Name('V-PL-')}%`).order('name');
  const nr = await api.get(`${N}/vendors?search=${encodeURIComponent(ga6Name('V-PL-'))}&pageSize=100`);
  statusDiff(diffs, 'list-status', lr.error ? 500 : 200, nr.status());
  expect(nr.status()).toBe(200);
  const nb = await j(nr);
  const legacy = (lr.data || []) as any[];
  const native = nb.data as any[];
  expect(legacy.map((v) => v.id).sort()).toEqual([a.id, b.id, c.id].sort());
  expect(native.map((v) => v.id).sort()).toEqual([a.id, b.id, c.id].sort());
  const cols = ['name', 'alias', 'vendor_type', 'status', 'tax_id', 'contact_name', 'contact_phone', 'phone', 'email', 'tags', 'service_category_ids', 'service_region_ids', 'contract_required', 'contract_end_date', 'updated_at'];
  for (const l of legacy) cmp(diffs, l.id, l, native.find((n) => n.id === l.id), cols);
  // 統計卡：舊版在瀏覽器端對全部廠商算；新版伺服端精確統計
  const all = ((await users.ga_all.client.from('ga_vendors').select('status,contract_required,contract_end_date')).data || []) as any[];
  const legacyStats = { total: all.length, active: all.filter((v) => v.status === 'active').length, paused: all.filter((v) => v.status === 'paused').length, inactive: all.filter((v) => v.status === 'inactive').length };
  for (const k of Object.keys(legacyStats) as Array<keyof typeof legacyStats>) if (legacyStats[k] !== nb.stats[k]) diffs.push({ kind: 'changed', key: `stats#${k}`, legacy: legacyStats[k], native: nb.stats[k] });
  // 新版多回 contract_due 與 stats.contract_due（舊版沒有）
  if (!('contract_due' in legacy[0])) diffs.push({ kind: 'only-native', key: 'row#contract_due' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '廠商列表與統計', legacy: { endpoint: 'supabase client select ga_vendors' }, native: { endpoint: `GET ${N}/vendors`, status: 200 }, compared: { rows: 3 }, diffs }));
});

test('服務分類與服務區域：舊版 insert／update 與新版 POST／PATCH 寫入後逐欄相同；差異＝代碼重複與循環上層擋下、區域可編輯、新版必帶版本', async () => {
  const e = entry('svc-category-region-write-readback');
  const diffs: Diff[] = [];
  const tag = String((seq += 1));
  // 分類：舊版 payload
  const cInput = { description: '說明', icon_key: 'wrench', sort_order: 12, common_items: ['換燈管', '補漏'] };
  const lc = await users.ga_all.client.from('ga_service_categories').insert({ name: ga6Name(`PC-L${tag}`), code: ga6Code(`PCL${tag}`), parent_id: null, status: 'active', ...cInput }).select('*').single();
  expect(lc.error?.message ?? '').toBe('');
  const nc = await api.post(`${N}/service-categories`, { data: { name: ga6Name(`PC-N${tag}`), code: ga6Code(`pcn${tag}`), status: 'active', ...cInput } });
  expect(nc.status(), JSON.stringify(await j(nc))).toBe(201);
  statusDiff(diffs, 'category-create-status', 201, nc.status());
  const ncRow = (await db().from('ga_service_categories').select('*').eq('name', ga6Name(`PC-N${tag}`)).single()).data as any;
  cmp(diffs, 'category', lc.data, ncRow, ['parent_id', 'description', 'icon_key', 'status', 'sort_order', 'common_items']);
  if (ncRow.code !== ga6Code(`PCN${tag}`)) diffs.push({ kind: 'changed', key: 'category#code', legacy: ga6Code(`PCN${tag}`), native: ncRow.code });
  // 代碼重複：舊版資料庫 UNIQUE 擋下（英文錯誤），新版白話 409
  const dupL = await users.ga_all.client.from('ga_service_categories').insert({ name: ga6Name(`PC-LD${tag}`), code: lc.data.code, status: 'active', sort_order: 1 }).select('id').single();
  const dupN = await api.post(`${N}/service-categories`, { data: { name: ga6Name(`PC-ND${tag}`), code: ncRow.code } });
  statusDiff(diffs, 'category-dup-code', dupL.error ? 409 : 201, dupN.status());
  // 區域：舊版 payload（GeneralAffairsServiceCenterClient.tsx saveVendorRegion）
  const rInput = { region_type: 'city', description: '縣市說明', sort_order: 15, included_locations: ['甲地', '乙地'] };
  const lr = await users.ga_all.client.from('ga_service_regions').insert({ name: ga6Name(`PR-L${tag}`), code: ga6Code(`PRL${tag}`), parent_id: null, status: 'active', ...rInput }).select('*').single();
  expect(lr.error?.message ?? '').toBe('');
  const nr = await api.post(`${N}/service-regions`, { data: { name: ga6Name(`PR-N${tag}`), code: ga6Code(`PRN${tag}`), status: 'active', ...rInput } });
  expect(nr.status(), JSON.stringify(await j(nr))).toBe(201);
  const nrRow = (await db().from('ga_service_regions').select('*').eq('name', ga6Name(`PR-N${tag}`)).single()).data as any;
  cmp(diffs, 'region', lr.data, nrRow, ['parent_id', 'region_type', 'description', 'status', 'sort_order', 'included_locations']);
  // 舊版區域只能新增、不能編輯；新版可編輯（版本不符 409）
  const edit = await api.patch(`${N}/service-regions/${nrRow.id}`, { data: { name: ga6Name(`PR-N${tag}改`), expected_updated_at: nrRow.updated_at } });
  expect(edit.status(), JSON.stringify(await j(edit))).toBe(200);
  const stale = await api.patch(`${N}/service-regions/${nrRow.id}`, { data: { name: 'x', expected_updated_at: nrRow.updated_at } });
  expect(stale.status()).toBe(409);
  diffs.push({ kind: 'changed', key: 'region#edit-supported', legacy: 'insert only', native: 'PATCH 200 / STALE 409' });
  // 循環上層：舊版直接 update 可以把上層設成子孫（形成循環）；新版 400
  const child = await api.post(`${N}/service-regions`, { data: { name: ga6Name(`PR-C${tag}`), code: ga6Code(`PRC${tag}`), region_type: 'district', parent_id: nrRow.id } });
  expect(child.status()).toBe(201);
  const cur = (await db().from('ga_service_regions').select('updated_at').eq('id', nrRow.id).single()).data as any;
  const cyc = await api.patch(`${N}/service-regions/${nrRow.id}`, { data: { parent_id: (await j(child)).data.id, expected_updated_at: cur.updated_at } });
  expect(cyc.status()).toBe(400);
  diffs.push({ kind: 'changed', key: 'region#cycle-parent', legacy: 'allowed by direct update', native: 'rejected (400)' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '服務分類與區域', legacy: { endpoint: 'supabase client insert ga_service_categories／ga_service_regions' }, native: { endpoint: `POST ${N}/service-categories／service-regions`, status: 201 }, compared: { columns: 12 }, diffs }));
});
