import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Code, m7Name, row, rowsWhere, seedBalance, seedCategory, seedEquipment, seedEquipmentTemplate,
  seedFacilityTemplate, seedLocation, seedPart, seedServiceRequest, seedTransfer, setupM7Users, M7_FILE_PREFIX, type M7User,
} from '../support/m7m8-fixtures';
import { makePng } from '../support/png';

// M7/M8 第 1 批（G01-G05）整合層：/api/workspace/general-affairs/**。
// 涵蓋：權限與資料庫語意（Q5 店長看料件不含備註、管理員後備只在導覽）、Q4 分類停用／刪除、Q6 料件新增（重複確認）／編輯（單位鎖定）／停用／刪除、
//      Q7 型號與架型（用中只能停用、歸戶前後比對與同時修改保護）、G05 適用料件整批取代（版本碼、失敗全部回復）、Q3 附件（4MB、數量、格式、只標記刪除）、選擇器搜尋分頁。
// 資料只用測試門市 VW／ZT 與帶標記的總務資料；測試結束只刪自己建立的資料。
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const ROLES = ['ga_staff', 'ga_works', 'ga_part_view', 'ga_part_edit', 'ga_category_view', 'ga_category_edit', 'ga_template_view', 'ga_template_edit', 'ga_facility_view', 'ga_facility_edit', 'ga_store_manager_b', 'denied'];
let ctx: { partCat: any; eqCat: any; facCat: any };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  const s = await setupM7Users(['real_store_manager', 'admin_ungranted']);
  users = s.users;
  teardownUsers = s.teardown;
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k]);
  ctx = { partCat: await seedCategory('part', 'PC'), eqCat: await seedCategory('equipment', 'EC'), facCat: await seedCategory('facility', 'FC') };
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const form = (files: { name: string; mimeType: string; buffer: Buffer }[], fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('files', new Blob([new Uint8Array(f.buffer)], { type: f.mimeType }), f.name);
  return fd;
};
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const send = async (k: string, method: 'post' | 'patch' | 'put' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](`${BASE}/${p}`, data === undefined ? {} : { data }));

// ----------------------------------------------------------------------------- 權限與入口
test('G01 未登入 401；沒有任何總務權限的帳號一律 403，且 session 看不到任何總務頁', async () => {
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get(`${BASE}/parts`)).status()).toBe(401);
  await anon.dispose();
  for (const p of ['parts', 'categories?type=part', 'templates/equipment', 'compat?targetType=EQUIPMENT_TEMPLATE&targetId=3f2b8c1e-5b0e-4f6a-9d3e-0a1b2c3d4e5f', 'sites?type=store']) {
    expect((await get('denied', p)).status, p).toBe(403);
  }
  const session = await (await apis.denied.get('/api/workspace/session')).json();
  expect(Object.entries(session.capabilities).filter(([k, v]) => k.startsWith('ga') && v)).toEqual([]);
  const kinds = (session.gaNavigation || []).flatMap((g: any) => g.items.flatMap((i: any) => [i, ...(i.children || [])])).filter((i: any) => i.kind);
  expect(kinds).toEqual([]);
});

test('G01 總務角色的 session：服務中心側欄照舊版分組，已移植頁面帶 kind；Q25 工務與總務完全相同', async () => {
  const staff = await (await apis.ga_staff.get('/api/workspace/session')).json();
  const works = await (await apis.ga_works.get('/api/workspace/session')).json();
  expect(works.gaNavigation).toEqual(staff.gaNavigation);
  const ga = Object.fromEntries(Object.entries(staff.capabilities).filter(([k]) => k.startsWith('ga')));
  expect(ga).toEqual({ gaCenter: true, gaEquipmentCategories: true, gaFacilityCategories: true, gaPartCategories: true, gaParts: true, gaPartCreate: true, gaPartCompat: true, gaEquipmentTemplates: true, gaFacilityTemplates: true, gaEquipment: true, gaEquipmentCreate: true, gaFacilities: true, gaFacilityCreate: true, gaEquipmentWarranties: true, gaFacilityWarranties: true, gaEquipmentHistory: true, gaFacilityHistory: true, gaOnboardingTasks: true, gaOnboardingReview: true, gaEquipmentLabels: true, gaFacilityLabels: true, gaTransfers: true, gaOnboardingProgress: true, gaAssetImport: true, gaInventoryLocations: true, gaInventory: true });
  const groups = staff.gaNavigation.map((g: any) => g.label);
  expect(groups).toEqual(expect.arrayContaining(['工作台', '作業管理', '資產與庫存', '費用管理', '合作廠商']));
  const flat = staff.gaNavigation.flatMap((g: any) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
  const kinds = flat.filter((i: any) => i.kind).map((i: any) => i.kind).sort();
  expect(kinds).toEqual(['ga-asset-import', 'ga-center', 'ga-equipment', 'ga-equipment-categories', 'ga-equipment-create', 'ga-equipment-history', 'ga-equipment-labels', 'ga-equipment-templates', 'ga-equipment-warranties', 'ga-facilities', 'ga-facility-categories', 'ga-facility-create', 'ga-facility-history', 'ga-facility-labels', 'ga-facility-templates', 'ga-facility-warranties', 'ga-inventory', 'ga-inventory', 'ga-inventory-locations', 'ga-onboarding-progress', 'ga-onboarding-review', 'ga-onboarding-tasks', 'ga-part-categories', 'ga-part-compat', 'ga-part-create', 'ga-parts', 'ga-transfers']);
  // 全域導覽的服務中心首頁入口改為新版頁籤（網址維持 /general-affairs）
  const home = staff.navigation.flatMap((g: any) => g.items).find((i: any) => i.href === '/general-affairs');
  expect(home).toMatchObject({ kind: 'ga-center' });
});

test('G01 舊式管理員（沒掛任何角色）：導覽與旗標看得到，但資料庫語意沒權限，API 一律 403 並說明（不是空清單）', async () => {
  const session = await (await apis.admin_ungranted.get('/api/workspace/session')).json();
  expect(session.capabilities).toMatchObject({ gaCenter: true, gaParts: true, gaPartCreate: true, gaPartCategories: true });
  for (const p of ['parts', 'categories?type=part', 'templates/equipment']) {
    const r = await get('admin_ungranted', p);
    expect(r.status, p).toBe(403);
    expect(r.body.error).toMatch(/沒有/);
  }
  const create = await send('admin_ungranted', 'post', 'parts', { category_id: ctx.partCat.id, name: m7Name('adm'), base_unit: '個' });
  expect(create.status).toBe(403);
  expect(await rowsWhere('ga_parts', 'name', m7Name('adm'))).toEqual([]);
});

test('G01 access 端點回報可見旗標與資料庫端實際可操作旗標', async () => {
  const a = await get('admin_ungranted', 'access');
  expect(a.body.flags.gaParts).toBe(true);
  expect(a.body.actual.categories.part).toEqual({ read: false, manage: false });
  const s = await get('ga_category_edit', 'access');
  expect(s.body.actual.categories.part).toEqual({ read: true, manage: true });
  const v = await get('ga_category_view', 'access');
  expect(v.body.actual.categories.equipment).toEqual({ read: true, manage: false });
});

// ----------------------------------------------------------------------------- G02 分類
test('G02 分類：新增、重複代碼、類型錯誤、只有查看權限不能寫入、沒有分類權限不能讀', async () => {
  const code = m7Code('A1');
  const created = await send('ga_category_edit', 'post', 'categories', { type: 'part', name: m7Name('A1'), code: code.toLowerCase(), description: '測試' });
  expect(created.status).toBe(201);
  expect(created.body.data.code).toBe(code); // 代碼一律轉大寫
  expect(created.body.data.created_by).toBeTruthy();
  const dup = await send('ga_category_edit', 'post', 'categories', { type: 'part', name: m7Name('A1b'), code });
  expect(dup.status).toBe(409);
  expect((await send('ga_category_edit', 'post', 'categories', { type: 'vendor', name: 'x', code: 'X' })).status).toBe(400);
  expect((await send('ga_category_edit', 'post', 'categories', { type: 'part', name: '', code: 'X' })).status).toBe(400);
  expect((await send('ga_category_view', 'post', 'categories', { type: 'part', name: m7Name('v'), code: m7Code('V') })).status).toBe(403);
  expect((await send('ga_part_view', 'post', 'categories', { type: 'part', name: m7Name('v2'), code: m7Code('V2') })).status).toBe(403);
  expect((await get('ga_part_view', 'categories?type=part')).status).toBe(403);
  // 設施分類權限不能寫設備分類
  expect((await send('ga_facility_edit', 'post', 'categories', { type: 'equipment', name: m7Name('x'), code: m7Code('XX') })).status).toBe(403);
  expect(await rowsWhere('ga_part_categories', 'code', m7Code('V'))).toEqual([]);
});

test('G02 分類清單：逐層瀏覽、跨層搜尋帶完整路徑、精確筆數、逗號括號引號不壞、分頁', async () => {
  const root = (await send('ga_category_edit', 'post', 'categories', { type: 'equipment', name: m7Name('R(1),"x"'), code: m7Code('R1') })).body.data;
  const child = (await send('ga_category_edit', 'post', 'categories', { type: 'equipment', name: m7Name('C1'), code: m7Code('C1'), parent_id: root.id })).body.data;
  await send('ga_category_edit', 'post', 'categories', { type: 'equipment', name: m7Name('C2'), code: m7Code('C2'), parent_id: root.id });
  const q = (p: string) => get('ga_category_view', `categories?type=equipment&${p}`);
  const byMarker = await q(`search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=2`);
  expect(byMarker.status).toBe(200);
  const dbCount = (await adminDb().from('ga_equipment_categories').select('id', { count: 'exact', head: true }).is('deleted_at', null).like('name', '[自動測試]M7M8%').or('name.ilike.%[自動測試]M7M8%,code.ilike.%[自動測試]M7M8%,description.ilike.%[自動測試]M7M8%')).count;
  expect(byMarker.body.meta.total).toBe(dbCount); // 精確筆數（不是前 100 筆）
  expect(byMarker.body.data.length).toBeLessThanOrEqual(2);
  expect(byMarker.body.meta.totalPages).toBe(Math.ceil(dbCount! / 2));
  const special = await q(`search=${encodeURIComponent('R(1),"x"')}`);
  expect(special.status).toBe(200);
  expect(special.body.data.map((r: any) => r.id)).toEqual([root.id]);
  expect(special.body.data[0].child_count).toBe(2);
  const kids = await q(`parentId=${root.id}`);
  expect(kids.body.data.map((r: any) => r.id).sort()).toHaveLength(2);
  expect(kids.body.data.find((r: any) => r.id === child.id).path).toBe(`${root.name} › ${child.name}`);
  const search = await q(`search=${encodeURIComponent(m7Name('C1'))}`);
  expect(search.body.data[0].path).toBe(`${root.name} › ${m7Name('C1')}`);
  // 沒有搜尋也沒有 parentId：只列最上層
  const top = await q('pageSize=100');
  expect(top.body.data.every((r: any) => r.parent_id === null)).toBe(true);
  expect((await q('parentId=zzz')).status).toBe(400);
  const one = await get('ga_category_view', `categories/${child.id}?type=equipment`);
  expect(one.body.data.path).toContain('›');
});

test('Q4 分類停用：底下還有啟用中的子分類或項目就擋下（精確筆數）；沒有就可以；啟用回復', async () => {
  const parent = await seedCategory('part', 'P4');
  const kid = (await send('ga_category_edit', 'post', 'categories', { type: 'part', name: m7Name('P4K'), code: m7Code('P4K'), parent_id: parent.id })).body.data;
  const usage = await get('ga_category_edit', `categories/${parent.id}/usage?type=part`);
  expect(usage.body.data).toEqual({ children_total: 1, children_active: 1, items_total: 0, items_active: 0 });
  expect(usage.body.text.disable).toContain('1 個啟用中的子分類');
  const blocked = await send('ga_category_edit', 'post', `categories/${parent.id}/active`, { type: 'part', active: false });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('IN_USE');
  expect(blocked.body.usage.children_active).toBe(1);
  expect((await row('ga_part_categories', parent.id)).is_active).toBe(true);
  // 子分類有啟用中料件：子分類也不能停用
  const part = await seedPart(kid.id, 'P4-part');
  const blocked2 = await send('ga_category_edit', 'post', `categories/${kid.id}/active`, { type: 'part', active: false });
  expect(blocked2.status).toBe(409);
  expect(blocked2.body.usage.items_active).toBe(1);
  // 料件停用後，子分類可以停用；父分類之後也可以
  await adminDb().from('ga_parts').update({ is_active: false }).eq('id', part.id);
  expect((await send('ga_category_edit', 'post', `categories/${kid.id}/active`, { type: 'part', active: false })).status).toBe(200);
  expect((await row('ga_part_categories', kid.id)).is_active).toBe(false);
  expect((await send('ga_category_edit', 'post', `categories/${parent.id}/active`, { type: 'part', active: false })).status).toBe(200);
  // 重新啟用
  expect((await send('ga_category_edit', 'post', `categories/${parent.id}/active`, { type: 'part', active: true })).status).toBe(200);
  expect((await row('ga_part_categories', parent.id)).is_active).toBe(true);
  // 一般編輯不能夾帶 is_active 繞過檢查
  const patch = await send('ga_category_edit', 'patch', `categories/${parent.id}`, { type: 'part', name: m7Name('P4-renamed'), is_active: false });
  expect(patch.status).toBe(200);
  expect((await row('ga_part_categories', parent.id)).is_active).toBe(true);
  expect((await row('ga_part_categories', parent.id)).name).toBe(m7Name('P4-renamed'));
  // 唯讀帳號不能停用
  expect((await send('ga_category_view', 'post', `categories/${parent.id}/active`, { type: 'part', active: false })).status).toBe(403);
});

test('Q4 刪除分類：限完全沒有子分類與項目（含已停用的）；成功後代碼釋出；編輯遇同時修改回 409', async () => {
  const p = await seedCategory('facility', 'D1');
  const k = (await send('ga_category_edit', 'post', 'categories', { type: 'facility', name: m7Name('D1K'), code: m7Code('D1K'), parent_id: p.id })).body.data;
  const withChild = await send('ga_category_edit', 'delete', `categories/${p.id}?type=facility`);
  expect(withChild.status).toBe(409);
  expect(withChild.body.usage.children_total).toBe(1);
  // 底下有已停用的項目（架型）也不能刪
  const tpl = await seedFacilityTemplate('D1T', { category_id: k.id, is_active: false });
  const withItem = await send('ga_category_edit', 'delete', `categories/${k.id}?type=facility`);
  expect(withItem.status).toBe(409);
  expect(withItem.body.usage.items_total).toBe(1);
  expect(withItem.body.usage.items_active).toBe(0);
  await adminDb().from('ga_facility_templates').delete().eq('id', tpl.id);
  const ok = await send('ga_category_edit', 'delete', `categories/${k.id}?type=facility`);
  expect(ok.status).toBe(200);
  const gone = await row('ga_facility_categories', k.id);
  expect(gone.deleted_at).toBeTruthy();
  expect(gone.deleted_by).toBeTruthy();
  expect((await get('ga_category_view', `categories/${k.id}?type=facility`)).status).toBe(404);
  // 代碼釋出：同代碼可再建
  expect((await send('ga_category_edit', 'post', 'categories', { type: 'facility', name: m7Name('D1K2'), code: m7Code('D1K'), parent_id: p.id })).status).toBe(201);
  // 同時修改保護
  const cur = (await get('ga_category_edit', `categories/${p.id}?type=facility`)).body.data;
  expect((await send('ga_category_edit', 'patch', `categories/${p.id}`, { type: 'facility', name: m7Name('D1-a'), expected_updated_at: cur.updated_at })).status).toBe(200);
  const stale = await send('ga_category_edit', 'patch', `categories/${p.id}`, { type: 'facility', name: m7Name('D1-b'), expected_updated_at: cur.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await row('ga_facility_categories', p.id)).name).toBe(m7Name('D1-a'));
  expect((await send('ga_category_view', 'delete', `categories/${p.id}?type=facility`)).status).toBe(403);
});

// ----------------------------------------------------------------------------- G03 料件
const partBody = (suffix: string, over: Record<string, unknown> = {}) => ({ category_id: ctx.partCat.id, name: m7Name(suffix), base_unit: '個', ...over });

test('G03 料件新增：欄位驗證、單位換算、寫入欄位回讀；只有管理權限能新增', async () => {
  const ok = await send('ga_part_edit', 'post', 'parts', partBody('N1', { part_code: m7Code('p1').toLowerCase(), brand: 'B', model: 'M', specification: 'S1', purchase_unit: '箱', purchase_to_base_rate: 12, notes: '內部備註 N1', tags: ['a', 'b'] }));
  expect(ok.status).toBe(201);
  const db = await row('ga_parts', ok.body.data.id);
  expect(db).toMatchObject({ part_code: m7Code('p1'), base_unit: '個', purchase_unit: '箱', is_active: true, notes: '內部備註 N1', tags: ['a', 'b'] });
  expect(Number(db.purchase_to_base_rate)).toBe(12);
  expect(db.created_by).toBeTruthy();
  expect((await send('ga_part_edit', 'post', 'parts', partBody('N2', { name: '' }))).status).toBe(400);
  expect((await send('ga_part_edit', 'post', 'parts', partBody('N3', { base_unit: '' }))).status).toBe(400);
  expect((await send('ga_part_edit', 'post', 'parts', partBody('N4', { purchase_unit: '箱' }))).status).toBe(400); // 沒有換算率
  expect((await send('ga_part_edit', 'post', 'parts', partBody('N5', { category_id: 'zz' }))).status).toBe(400);
  expect((await send('ga_part_edit', 'post', 'parts', partBody('N6', { created_by: ok.body.data.created_by }))).status).toBe(400); // 系統欄位不可由前端指定
  expect((await send('ga_part_edit', 'post', 'parts', partBody('N7', { part_code: m7Code('p1') }))).status).toBe(409); // 代碼重複
  expect((await send('ga_part_view', 'post', 'parts', partBody('N8'))).status).toBe(403);
  expect((await send('ga_store_manager_b', 'post', 'parts', partBody('N9'))).status).toBe(403);
  expect(await rowsWhere('ga_parts', 'name', m7Name('N2'))).toEqual([]);
});

test('Q6 新增遇重複：先回傳既有料件，確認後才建立（舊版直接建立）', async () => {
  const first = await send('ga_part_edit', 'post', 'parts', partBody('DUP1', { brand: 'DupB', model: 'DupM', specification: 'DupS' }));
  expect(first.status).toBe(201);
  const second = await send('ga_part_edit', 'post', 'parts', partBody('DUP2', { brand: 'DupB', model: 'DupM', specification: 'DupS' }));
  expect(second.status).toBe(409);
  expect(second.body.code).toBe('DUPLICATE');
  expect(second.body.duplicates.map((d: any) => d.id)).toEqual([first.body.data.id]);
  expect(await rowsWhere('ga_parts', 'name', m7Name('DUP2'))).toEqual([]); // 沒確認前不建立
  const confirmed = await send('ga_part_edit', 'post', 'parts', partBody('DUP2', { brand: 'DupB', model: 'DupM', specification: 'DupS', confirm_duplicate: true }));
  expect(confirmed.status).toBe(201);
  expect(confirmed.body.duplicates).toHaveLength(1);
  // 三欄沒有填齊就不比對
  expect((await send('ga_part_edit', 'post', 'parts', partBody('DUP3', { brand: 'DupB', model: 'DupM' }))).status).toBe(201);
});

test('G03 料件清單：伺服端搜尋（逗號、括號不壞）、分類與狀態篩選、精確筆數與分頁', async () => {
  await send('ga_part_edit', 'post', 'parts', partBody('S1', { name: m7Name('S1 螺絲(M4),長'), brand: 'SB' }));
  await send('ga_part_edit', 'post', 'parts', partBody('S2', { name: m7Name('S2 螺帽'), brand: 'SB', is_active: false }));
  const list = async (k: string, p: string) => get(k, `parts?${p}`);
  const sp = await list('ga_part_edit', `search=${encodeURIComponent('螺絲(M4),長')}`);
  expect(sp.status).toBe(200);
  expect(sp.body.meta.total).toBe(1);
  expect((await list('ga_part_edit', `search=${encodeURIComponent('"')}`)).status).toBe(200);
  const mark = encodeURIComponent('[自動測試]M7M8');
  const all = await list('ga_part_edit', `search=${mark}&pageSize=3`);
  const dbTotal = (await adminDb().from('ga_parts').select('id', { count: 'exact', head: true }).is('deleted_at', null).like('name', '[自動測試]M7M8%')).count;
  expect(all.body.meta.total).toBe(dbTotal);
  expect(all.body.meta.totalPages).toBe(Math.ceil(dbTotal! / 3));
  expect(all.body.data).toHaveLength(3);
  const p2 = await list('ga_part_edit', `search=${mark}&pageSize=3&page=2`);
  expect(p2.body.data.map((r: any) => r.id)).not.toEqual(expect.arrayContaining(all.body.data.map((r: any) => r.id)));
  expect((await list('ga_part_edit', `search=${mark}&isActive=false`)).body.data.every((r: any) => r.is_active === false)).toBe(true);
  const dbCat = (await adminDb().from('ga_parts').select('id', { count: 'exact', head: true }).is('deleted_at', null).like('name', '[自動測試]M7M8%').eq('category_id', ctx.partCat.id)).count;
  expect((await list('ga_part_edit', `search=${mark}&categoryId=${ctx.partCat.id}`)).body.meta.total).toBe(dbCat);
  // 只有查看權限看不到停用的料件（資料庫規則），管理權限看得到
  const viewInactive = await list('ga_part_view', `search=${mark}&isActive=false`);
  expect(viewInactive.status).toBe(200);
  expect(viewInactive.body.meta.total).toBe(0);
  expect((await list('ga_part_edit', `search=${mark}&isActive=false`)).body.meta.total).toBeGreaterThan(0);
  expect(all.body.permissions).toEqual({ manage: true, seeNotes: true });
  expect((await list('ga_part_view', `search=${mark}`)).body.permissions).toEqual({ manage: false, seeNotes: true });
});

test('Q5 店長看料件但不含內部備註；有料件權限的人看得到備註；沒有任何身分的人不能看', async () => {
  const part = await seedPart(ctx.partCat.id, 'Q5', { notes: '採購價 99 元，廠商交涉中' });
  const mark = encodeURIComponent(part.name);
  for (const k of ['real_store_manager', 'ga_store_manager_b']) {
    const r = await get(k, `parts?search=${mark}`);
    expect(r.status, k).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).not.toHaveProperty('notes');
    expect(JSON.stringify(r.body)).not.toContain('採購價');
    expect(r.body.permissions).toEqual({ manage: false, seeNotes: false });
    const one = await get(k, `parts/${part.id}`);
    expect(one.status).toBe(200);
    expect(one.body.data).not.toHaveProperty('notes');
    expect(JSON.stringify(one.body)).not.toContain('採購價');
    expect((await get(k, `parts/${part.id}/usage`)).status).toBe(403);
  }
  const staff = await get('ga_part_view', `parts/${part.id}`);
  expect(staff.body.data.notes).toBe('採購價 99 元，廠商交涉中');
  expect((await get('denied', `parts/${part.id}`)).status).toBe(403);
  expect((await get('real_store_manager', `parts?search=${mark}`)).body.meta.total).toBe(1);
  // 店長不能寫
  expect((await send('real_store_manager', 'patch', `parts/${part.id}`, { name: 'x' })).status).toBe(403);
  expect((await send('real_store_manager', 'delete', `parts/${part.id}`, { deletion_reason: 'x' })).status).toBe(403);
});

test('Q6 單位鎖定的另一半：只有庫存流水、餘額為 0 也鎖定（交易內暫時流水，驗完整個回復，不留資料）', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = path.resolve(__dirname, '..', '..');
  const guard = require('../support/env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root });
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const linked = fs.existsSync(path.join(root, 'supabase/.temp/project-ref')) ? fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim() : '';
  test.skip(linked !== ref, 'supabase CLI 未連結到 DEV，無法在交易內驗證流水鎖定');
  const part = (await send('ga_part_edit', 'post', 'parts', partBody('TX1'))).body.data;
  const loc = await seedLocation(null, 'L-TX1');
  // 前置：沒有流水、沒有庫存時單位可改（API）
  expect((await get('ga_part_edit', `parts/${part.id}/usage`)).body.data).toMatchObject({ stock_locations: 0, transactions: 0, unit_locked: false });
  // 庫存流水不可刪除（append-only），所以只在資料庫交易內插入一筆，驗完用 RAISE EXCEPTION 整個回復
  const sql = `DO $$
DECLARE u jsonb; r jsonb; r2 jsonb; cnt integer;
BEGIN
  INSERT INTO public.ga_inventory_transactions (transaction_no, transaction_type, location_id, part_id, quantity_input, input_unit_type, unit_conversion_rate, quantity_base, balance_before, balance_after, reason, created_by)
  VALUES ('ZT-M7M8-TX-' || gen_random_uuid(), 'RECEIPT', '${loc.id}', '${part.id}', 1, 'BASE', 1, 1, 0, 1, 'ZT M7M8 unit lock', '${part.created_by}');
  PERFORM set_config('request.jwt.claim.sub', '${part.created_by}', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"${part.created_by}","role":"authenticated"}', true);
  u := ga_ws_part_usage('${part.id}');
  r := ga_ws_update_part_guarded('${part.id}', '{"base_unit":"ZTX"}'::jsonb, NULL);
  r2 := ga_ws_update_part_guarded('${part.id}', '{"description":"ZT only"}'::jsonb, NULL);
  SELECT count(*) INTO cnt FROM public.ga_inventory_balances WHERE part_id = '${part.id}';
  RAISE EXCEPTION 'G01RESULT:%', jsonb_build_object('stock', u->'data'->'stock_locations', 'tx', u->'data'->'transactions', 'locked', u->'data'->'unit_locked', 'status', r->'status', 'code', r->'code', 'other_ok', r2->'ok', 'balances', cnt);
END $$;`;
  const file = path.join(os.tmpdir(), `g01-tx-lock-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const run = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', shell: true });
    const out = `${run.stdout}
${run.stderr}`.replace(/\\"/g, '"');
    const m = /G01RESULT:(\{[^}]*\})/.exec(out);
    expect(m, out.slice(0, 800)).not.toBeNull();
    expect(JSON.parse(m![1])).toMatchObject({ stock: 0, tx: 1, locked: true, status: 409, code: 'UNIT_LOCKED', other_ok: true, balances: 0 });
  } finally {
    fs.rmSync(file, { force: true });
  }
  // 整個交易已回復：沒有留下流水，單位仍可改
  const usage = await get('ga_part_edit', `parts/${part.id}/usage`);
  expect(usage.body.data).toMatchObject({ transactions: 0, unit_locked: false });
  expect((await row('ga_parts', part.id)).base_unit).not.toBe('ZTX');
});

test('Q6 料件編輯與停用：欄位更新、同時修改保護、停用後啟用回復；單位在有庫存或交易後鎖定', async () => {
  const part = (await send('ga_part_edit', 'post', 'parts', partBody('E1', { notes: '舊備註' }))).body.data;
  const edit = await send('ga_part_edit', 'patch', `parts/${part.id}`, { name: m7Name('E1-new'), brand: 'NB', description: '新說明', notes: '新備註', expected_updated_at: part.updated_at });
  expect(edit.status).toBe(200);
  expect(await row('ga_parts', part.id)).toMatchObject({ name: m7Name('E1-new'), brand: 'NB', notes: '新備註', updated_by: expect.any(String) });
  const stale = await send('ga_part_edit', 'patch', `parts/${part.id}`, { name: m7Name('E1-late'), expected_updated_at: part.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await row('ga_parts', part.id)).name).toBe(m7Name('E1-new'));
  // 單位：沒有庫存時可以改
  const cur = (await get('ga_part_edit', `parts/${part.id}`)).body.data;
  expect((await send('ga_part_edit', 'patch', `parts/${part.id}`, { base_unit: '箱', expected_updated_at: cur.updated_at })).status).toBe(200);
  expect((await row('ga_parts', part.id)).base_unit).toBe('箱');
  // 有庫存後鎖定單位，但其他欄位照樣可以改
  const loc = await seedLocation(null, 'L-E1');
  const bal = await seedBalance(loc.id, part.id, 5);
  const usage = await get('ga_part_edit', `parts/${part.id}/usage`);
  expect(usage.body.data).toMatchObject({ stock_locations: 1, unit_locked: true });
  const locked = await send('ga_part_edit', 'patch', `parts/${part.id}`, { base_unit: '個' });
  expect(locked.status).toBe(409);
  expect(locked.body.code).toBe('UNIT_LOCKED');
  expect(locked.body.fields).toEqual(['base_unit']);
  expect((await row('ga_parts', part.id)).base_unit).toBe('箱');
  expect((await send('ga_part_edit', 'patch', `parts/${part.id}`, { purchase_unit: '袋', purchase_to_base_rate: 3 })).status).toBe(409);
  expect((await send('ga_part_edit', 'patch', `parts/${part.id}`, { base_unit: '箱', description: '同值不算變更' })).status).toBe(200);
  // 停用與啟用（第 3 批 C2：料件在任何位置仍有庫存時不能停用；清空庫存後才可以）
  const blocked = await send('ga_part_edit', 'patch', `parts/${part.id}`, { is_active: false });
  expect(blocked.status).toBe(400);
  expect(blocked.body.error).toContain('仍有庫存');
  expect((await row('ga_parts', part.id)).is_active).toBe(true);
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
  expect((await send('ga_part_edit', 'patch', `parts/${part.id}`, { is_active: false })).status).toBe(200);
  expect((await row('ga_parts', part.id)).is_active).toBe(false);
  expect((await send('ga_part_edit', 'patch', `parts/${part.id}`, { is_active: true })).status).toBe(200);
  expect((await send('ga_part_view', 'patch', `parts/${part.id}`, { name: 'x' })).status).toBe(403);
});

test('Q6 料件刪除：須填原因；有庫存或未結單（需求單、調撥單）就擋下；結案後可刪；刪除連帶清庫存位置設定；已刪除不能再刪', async () => {
  const mk = async (s: string) => (await send('ga_part_edit', 'post', 'parts', partBody(s))).body.data;
  const noReason = await mk('DEL0');
  expect((await send('ga_part_edit', 'delete', `parts/${noReason.id}`, {})).status).toBe(400);
  expect((await send('ga_part_edit', 'delete', `parts/${noReason.id}`, { deletion_reason: '   ' })).status).toBe(400);
  expect((await send('ga_part_edit', 'delete', `parts/${noReason.id}`, { deletion_reason: 'x'.repeat(201) })).status).toBe(400);
  expect((await send('ga_part_view', 'delete', `parts/${noReason.id}`, { deletion_reason: 'x' })).status).toBe(403);
  // 有庫存
  const a = await mk('DEL1');
  const loc = await seedLocation(null, 'L-D1');
  const bal = await seedBalance(loc.id, a.id, 3);
  const withStock = await send('ga_part_edit', 'delete', `parts/${a.id}`, { deletion_reason: '測試' });
  expect(withStock.status).toBe(409);
  expect(withStock.body.code).toBe('HAS_STOCK');
  expect(withStock.body.error).toContain('仍有庫存');
  expect((await row('ga_parts', a.id)).deleted_at).toBeNull();
  // 庫存歸零後：沒有未結單可以刪；刪除時連帶軟刪除庫存位置設定
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
  const lp = await adminDb().from('ga_inventory_location_parts').insert({ location_id: loc.id, part_id: a.id }).select('id').single();
  expect(lp.error).toBeNull();
  const del = await send('ga_part_edit', 'delete', `parts/${a.id}`, { deletion_reason: '建錯了' });
  expect(del.status).toBe(200);
  expect(await row('ga_parts', a.id)).toMatchObject({ is_active: false, deletion_reason: '建錯了' });
  expect((await row('ga_parts', a.id)).deleted_at).toBeTruthy();
  expect((await row('ga_inventory_location_parts', lp.data.id)).deleted_at).toBeTruthy();
  expect((await get('ga_part_edit', `parts/${a.id}`)).status).toBe(404);
  expect((await send('ga_part_edit', 'delete', `parts/${a.id}`, { deletion_reason: '再刪' })).status).toBe(409);
  // 未結需求單
  const b = await mk('DEL2');
  const req = await seedServiceRequest('VW001', b.id, 'REQ', 'IN_PROGRESS', users.real_store_manager.id);
  const withReq = await send('ga_part_edit', 'delete', `parts/${b.id}`, { deletion_reason: '測試' });
  expect(withReq.status).toBe(409);
  expect(withReq.body.code).toBe('HAS_OPEN_ORDERS');
  expect(withReq.body.usage.open_requests).toBe(1);
  expect((await get('ga_part_edit', `parts/${b.id}/usage`)).body.deleteBlock).toContain('需求單 1 張');
  await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED' }).eq('id', req.id);
  // 未結調撥單
  const loc2 = await seedLocation(null, 'L-D2');
  const transfer = await seedTransfer(loc.id, loc2.id, b.id, 'TR');
  const withTr = await send('ga_part_edit', 'delete', `parts/${b.id}`, { deletion_reason: '測試' });
  expect(withTr.status).toBe(409);
  expect(withTr.body.usage.open_transfers).toBe(1);
  await adminDb().from('ga_inventory_transfers').update({ status: 'RECEIVED' }).eq('id', transfer.id);
  expect((await send('ga_part_edit', 'delete', `parts/${b.id}`, { deletion_reason: '都結案了' })).status).toBe(200);
});

// ----------------------------------------------------------------------------- G04 型號與架型
test('G04 設備型號：新增、重複擋下、查看／管理權限、清單搜尋與使用筆數、編輯與停用', async () => {
  const body = { name: m7Name('T1'), category_id: ctx.eqCat.id, brand: 'TB', model: m7Code('TM1'), description: '測試', default_warranty_months: 12 };
  const created = await send('ga_template_edit', 'post', 'templates/equipment', body);
  expect(created.status).toBe(201);
  expect(await row('ga_equipment_templates', created.body.data.id)).toMatchObject({ brand: 'TB', default_warranty_months: 12, is_active: true });
  const dup = await send('ga_template_edit', 'post', 'templates/equipment', { ...body, name: m7Name('T1-dup') });
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('DUPLICATE');
  expect(dup.body.duplicate.id).toBe(created.body.data.id);
  expect((await send('ga_template_view', 'post', 'templates/equipment', { ...body, model: m7Code('TM2') })).status).toBe(403);
  expect((await send('ga_template_edit', 'post', 'templates/equipment', { ...body, model: m7Code('TM3'), category_id: '' })).status).toBe(400);
  expect((await send('ga_template_edit', 'post', 'templates/equipment', { ...body, model: m7Code('TM4'), default_warranty_months: -1 })).status).toBe(400);
  const list = await get('ga_template_view', `templates/equipment?search=${encodeURIComponent(m7Code('TM1'))}`);
  expect(list.status).toBe(200);
  expect(list.body.data.map((r: any) => r.id)).toEqual([created.body.data.id]);
  expect(list.body.permissions).toMatchObject({ manage: false });
  expect((await get('denied', 'templates/equipment')).status).toBe(403);
  expect((await get('ga_facility_view', 'templates/equipment')).status).toBe(403); // 設施權限看不到設備型號
  // 同一種搜尋，特殊字元不壞
  expect((await get('ga_template_view', `templates/equipment?search=${encodeURIComponent('a,b)(')}`)).status).toBe(200);
  const edit = await send('ga_template_edit', 'patch', `templates/equipment/${created.body.data.id}`, { name: m7Name('T1-edit'), expected_updated_at: created.body.data.updated_at });
  expect(edit.status).toBe(200);
  const stale = await send('ga_template_edit', 'patch', `templates/equipment/${created.body.data.id}`, { name: m7Name('T1-stale'), expected_updated_at: created.body.data.updated_at });
  expect(stale.status).toBe(409);
  expect((await send('ga_template_edit', 'patch', `templates/equipment/${created.body.data.id}`, { is_active: false })).status).toBe(200);
  expect((await row('ga_equipment_templates', created.body.data.id)).is_active).toBe(false);
});

test('G04 設施架型：新增（代碼轉大寫）、尺寸檢查、重複、分頁搜尋、停用', async () => {
  const body = { code: m7Code('F1').toLowerCase(), name: m7Name('F1'), category_id: ctx.facCat.id, brand: 'FB', model: 'FM1', width_cm: 120, height_cm: 200, depth_cm: 40 };
  const created = await send('ga_facility_edit', 'post', 'templates/facility', body);
  expect(created.status).toBe(201);
  expect(await row('ga_facility_templates', created.body.data.id)).toMatchObject({ code: m7Code('F1'), brand: 'FB' });
  expect(Number((await row('ga_facility_templates', created.body.data.id)).width_cm)).toBe(120);
  expect((await send('ga_facility_edit', 'post', 'templates/facility', { ...body, code: m7Code('F2'), width_cm: 0 })).status).toBe(400);
  expect((await send('ga_facility_edit', 'post', 'templates/facility', { ...body, code: '' })).status).toBe(400);
  const dup = await send('ga_facility_edit', 'post', 'templates/facility', { ...body, name: m7Name('F1-dup') });
  expect(dup.status).toBe(409);
  expect((await send('ga_facility_view', 'post', 'templates/facility', { ...body, code: m7Code('F3'), brand: 'x2', model: 'y2', name: m7Name('F3') })).status).toBe(403);
  const list = await get('ga_facility_view', `templates/facility?search=${encodeURIComponent(m7Code('F1'))}`);
  expect(list.body.data).toHaveLength(1);
  expect(list.body.data[0].asset_count).toBe(0);
  expect((await send('ga_facility_edit', 'patch', `templates/facility/${created.body.data.id}`, { is_active: false })).status).toBe(200);
  expect((await row('ga_facility_templates', created.body.data.id)).is_active).toBe(false);
  expect((await get('ga_template_view', 'templates/facility')).status).toBe(403); // 設備型號權限看不到架型
});

test('Q7 刪除型號：須填原因；有設備在用只能停用，沒人用才能刪；架型同理', async () => {
  const tpl = await seedEquipmentTemplate(ctx.eqCat.id, 'Q7T');
  const eq = await seedEquipment('VW001', ctx.eqCat.id, 'Q7E', { template_id: tpl.id });
  const list = await get('ga_template_edit', `templates/equipment?search=${encodeURIComponent(tpl.name)}`);
  expect(list.body.data[0]).toMatchObject({ asset_count: 1, site_count: 1 });
  expect((await send('ga_template_edit', 'delete', `templates/equipment/${tpl.id}`, {})).status).toBe(400);
  const inUse = await send('ga_template_edit', 'delete', `templates/equipment/${tpl.id}`, { deletion_reason: '測試' });
  expect(inUse.status).toBe(409);
  expect(inUse.body.code).toBe('IN_USE');
  expect(inUse.body.in_use_count).toBe(1);
  expect((await row('ga_equipment_templates', tpl.id)).deleted_at).toBeNull();
  // 停用仍可（用中的只能停用）
  expect((await send('ga_template_edit', 'patch', `templates/equipment/${tpl.id}`, { is_active: false })).status).toBe(200);
  await adminDb().from('ga_equipment').delete().eq('id', eq.id);
  expect((await send('ga_template_view', 'delete', `templates/equipment/${tpl.id}`, { deletion_reason: 'x' })).status).toBe(403);
  const ok = await send('ga_template_edit', 'delete', `templates/equipment/${tpl.id}`, { deletion_reason: '沒人用' });
  expect(ok.status).toBe(200);
  expect(await row('ga_equipment_templates', tpl.id)).toMatchObject({ is_active: false, deletion_reason: '沒人用' });
  expect((await get('ga_template_edit', `templates/equipment/${tpl.id}`)).status).toBe(404);
  // 架型：用中的設施擋下
  const ft = await seedFacilityTemplate('Q7F');
  const fac = await adminDb().from('ga_facilities').insert({ store_id: (await adminDb().from('stores').select('id').eq('store_code', 'VW001').single()).data.id, category_id: ctx.facCat.id, name: m7Name('Q7FAC'), facility_template_id: ft.id }).select('id').single();
  expect(fac.error).toBeNull();
  const fIn = await send('ga_facility_edit', 'delete', `templates/facility/${ft.id}`, { deletion_reason: '測試' });
  expect(fIn.status).toBe(409);
  expect(fIn.body.error).toContain('設施');
  await adminDb().from('ga_facilities').delete().eq('id', fac.data.id);
  expect((await send('ga_facility_edit', 'delete', `templates/facility/${ft.id}`, { deletion_reason: '沒人用' })).status).toBe(200);
});

// ----------------------------------------------------------------------------- G05 適用料件
test('G05 型號與適用料件一次儲存：成功同時寫入；失敗（停用料件）全部回復；版本碼偵測他人修改；沒有料件管理權限不能設定適用料件', async () => {
  const p1 = await seedPart(ctx.partCat.id, 'CP1');
  const p2 = await seedPart(ctx.partCat.id, 'CP2');
  const pOff = await seedPart(ctx.partCat.id, 'CP-off', { is_active: false });
  const body = { name: m7Name('CT'), category_id: ctx.eqCat.id, brand: 'CB', model: m7Code('CM'), part_ids: [p1.id, p2.id] };
  expect((await send('ga_template_edit', 'post', 'templates/equipment', body)).status).toBe(403); // 只有型號權限、沒有料件管理
  expect(await rowsWhere('ga_equipment_templates', 'name', body.name)).toEqual([]);
  const created = await send('ga_staff', 'post', 'templates/equipment', body);
  expect(created.status).toBe(201);
  const tid = created.body.data.id;
  const compat = (await get('ga_staff', `templates/equipment/${tid}`)).body.compat;
  expect(compat.parts.map((r: any) => r.part_id).sort()).toEqual([p1.id, p2.id].sort());
  // 失敗全部回復：加入停用料件 -> 觸發器擋下，型號欄位與原適用料件都不變
  const before = await row('ga_equipment_templates', tid);
  const fail = await send('ga_staff', 'patch', `templates/equipment/${tid}`, { name: m7Name('CT-changed'), part_ids: [p1.id, pOff.id], expected_updated_at: before.updated_at, expected_compat_version: compat.version });
  expect(fail.status).toBe(400);
  expect((await row('ga_equipment_templates', tid)).name).toBe(m7Name('CT'));
  const after = (await get('ga_staff', `compat?targetType=EQUIPMENT_TEMPLATE&targetId=${tid}`)).body.data;
  expect(after.parts.map((r: any) => r.part_id).sort()).toEqual([p1.id, p2.id].sort());
  expect(after.version).toBe(compat.version);
  // 成功：取代為只有 p2
  const put = await send('ga_staff', 'put', 'compat', { targetType: 'EQUIPMENT_TEMPLATE', targetId: tid, partIds: [p2.id], expectedVersion: compat.version });
  expect(put.status).toBe(200);
  expect(put.body.data).toMatchObject({ added: 0, removed: 1 });
  const live = await rowsWhere('ga_part_target_compatibilities', 'target_id', tid);
  expect(live.filter((r) => !r.deleted_at).map((r) => r.part_id)).toEqual([p2.id]);
  const removed = live.find((r) => r.part_id === p1.id);
  expect(removed.deleted_at).toBeTruthy();
  expect(removed.deletion_reason).toBe('REPLACED_BY_COMPATIBILITY_MANAGEMENT');
  // 他人同時修改：用舊版本碼儲存被擋，也不覆蓋別人的結果
  const stale = await send('ga_staff', 'put', 'compat', { targetType: 'EQUIPMENT_TEMPLATE', targetId: tid, partIds: [p1.id], expectedVersion: compat.version });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await rowsWhere('ga_part_target_compatibilities', 'target_id', tid)).filter((r) => !r.deleted_at).map((r) => r.part_id)).toEqual([p2.id]);
  // 權限：查看者可讀不可寫；沒有料件權限不可讀
  const cur = (await get('ga_part_view', `compat?targetType=EQUIPMENT_TEMPLATE&targetId=${tid}`)).body.data;
  expect((await send('ga_part_view', 'put', 'compat', { targetType: 'EQUIPMENT_TEMPLATE', targetId: tid, partIds: [], expectedVersion: cur.version })).status).toBe(403);
  expect((await get('ga_template_view', `compat?targetType=EQUIPMENT_TEMPLATE&targetId=${tid}`)).status).toBe(403);
  expect((await send('ga_part_edit', 'put', 'compat', { targetType: 'VENDOR', targetId: tid, partIds: [] })).status).toBe(400);
  expect((await send('ga_part_edit', 'put', 'compat', { targetType: 'EQUIPMENT_TEMPLATE', targetId: tid, partIds: ['x'] })).status).toBe(400);
  // 刪除料件後，對照列不再顯示
  expect((await send('ga_part_edit', 'delete', `parts/${p2.id}`, { deletion_reason: '測試刪除' })).status).toBe(200);
  expect((await get('ga_staff', `compat?targetType=EQUIPMENT_TEMPLATE&targetId=${tid}`)).body.data.parts).toEqual([]);
});

test('G05 設施架型的適用料件同樣一次儲存', async () => {
  const p = await seedPart(ctx.partCat.id, 'FP1');
  const created = await send('ga_staff', 'post', 'templates/facility', { code: m7Code('FC1'), name: m7Name('FC1'), part_ids: [p.id] });
  expect(created.status).toBe(201);
  const compat = (await get('ga_staff', `templates/facility/${created.body.data.id}`)).body.compat;
  expect(compat.parts.map((r: any) => r.part_id)).toEqual([p.id]);
  const cleared = await send('ga_staff', 'patch', `templates/facility/${created.body.data.id}`, { part_ids: [], expected_compat_version: compat.version });
  expect(cleared.status).toBe(200);
  expect((await get('ga_staff', `templates/facility/${created.body.data.id}`)).body.compat.parts).toEqual([]);
});

// ----------------------------------------------------------------------------- Q7 歸戶
test('Q7 既有設備歸戶：預覽逐台列出原值與新值；確認後才改；預覽後被改動整批不變；已歸戶不能再歸', async () => {
  const eqCat2 = await seedCategory('equipment', 'RH');
  const tpl = await seedEquipmentTemplate(eqCat2.id, 'RHT', { name: m7Name('RHT 新名稱') });
  const e1 = await seedEquipment('VW001', eqCat2.id, 'RH1', { brand: '舊品牌' });
  const e2 = await seedEquipment('ZT01', eqCat2.id, 'RH2');
  const unlinked = await get('ga_staff', `unlinked-equipment?search=${encodeURIComponent('RH')}`);
  expect(unlinked.status).toBe(200);
  expect(unlinked.body.data.map((r: any) => r.id)).toEqual(expect.arrayContaining([e1.id, e2.id]));
  expect((await get('ga_template_edit', 'unlinked-equipment')).status).toBe(403); // 還需要設備管理權限
  const prev = await get('ga_staff', `templates/equipment/${tpl.id}/link-preview?ids=${e1.id},${e2.id}`);
  expect(prev.status).toBe(200);
  expect(prev.body.irreversible).toBe(true);
  const item = prev.body.items.find((i: any) => i.id === e1.id);
  expect(item.diff.find((d: any) => d.field === 'name')).toMatchObject({ from: e1.name, to: tpl.name, changed: true });
  expect(item.diff.find((d: any) => d.field === 'brand')).toMatchObject({ from: '舊品牌', to: tpl.brand });
  // 預覽不改資料
  expect((await row('ga_equipment', e1.id)).template_id).toBeNull();
  // 沒勾確認不能送
  const items = prev.body.items.map((i: any) => ({ id: i.id, updated_at: i.updated_at }));
  expect((await send('ga_staff', 'post', `templates/equipment/${tpl.id}/link`, { items, template_updated_at: prev.body.template.updated_at })).status).toBe(400);
  // 預覽後 e2 被別人改了 -> 整批不變
  await adminDb().from('ga_equipment').update({ area: '被改過' }).eq('id', e2.id);
  const stale = await send('ga_staff', 'post', `templates/equipment/${tpl.id}/link`, { items, template_updated_at: prev.body.template.updated_at, confirmed: true });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect(stale.body.stale.map((s: any) => s.id)).toEqual([e2.id]);
  expect((await row('ga_equipment', e1.id)).template_id).toBeNull();
  expect((await row('ga_equipment', e1.id)).name).toBe(e1.name);
  // 重新預覽後成功
  const prev2 = await get('ga_staff', `templates/equipment/${tpl.id}/link-preview?ids=${e1.id},${e2.id}`);
  const ok = await send('ga_staff', 'post', `templates/equipment/${tpl.id}/link`, { items: prev2.body.items.map((i: any) => ({ id: i.id, updated_at: i.updated_at })), template_updated_at: prev2.body.template.updated_at, confirmed: true });
  expect(ok.status).toBe(200);
  expect(ok.body.data.linked_count).toBe(2);
  for (const id of [e1.id, e2.id]) expect(await row('ga_equipment', id)).toMatchObject({ template_id: tpl.id, name: tpl.name, brand: tpl.brand, model: tpl.model });
  // 已歸戶不能再歸
  const again = await send('ga_staff', 'post', `templates/equipment/${tpl.id}/link`, { items: prev2.body.items.map((i: any) => ({ id: i.id, updated_at: i.updated_at })), template_updated_at: prev2.body.template.updated_at, confirmed: true });
  expect(again.status).toBe(409);
  // 預覽後型號被改名：用舊型號版本確認 -> 409 STALE，設備不被改成沒看過的值
  const e4 = await seedEquipment('ZT02', eqCat2.id, 'RH4');
  const tpl2 = await seedEquipmentTemplate(eqCat2.id, 'RHT2');
  const prev4 = await get('ga_staff', `templates/equipment/${tpl2.id}/link-preview?ids=${e4.id}`);
  expect(prev4.status).toBe(200);
  await adminDb().from('ga_equipment_templates').update({ name: m7Name('RH-T2-renamed') }).eq('id', tpl2.id);
  const staleTpl = await send('ga_staff', 'post', `templates/equipment/${tpl2.id}/link`, { items: prev4.body.items.map((i: any) => ({ id: i.id, updated_at: i.updated_at })), template_updated_at: prev4.body.template.updated_at, confirmed: true });
  expect(staleTpl.status).toBe(409);
  expect(staleTpl.body.code).toBe('STALE');
  expect((await row('ga_equipment', e4.id)).template_id).toBeNull();
  expect((await send('ga_staff', 'post', `templates/equipment/${tpl2.id}/link`, { items: prev4.body.items.map((i: any) => ({ id: i.id, updated_at: i.updated_at })), confirmed: true })).status).toBe(400);
  // 上限 100 台、停用型號不可用
  expect((await get('ga_staff', `templates/equipment/${tpl.id}/link-preview?ids=${Array(101).fill(e1.id).join(',')}`)).status).toBe(400);
  await adminDb().from('ga_equipment_templates').update({ is_active: false }).eq('id', tpl.id);
  const e3 = await seedEquipment('ZT02', eqCat2.id, 'RH3');
  expect((await get('ga_staff', `templates/equipment/${tpl.id}/link-preview?ids=${e3.id}`)).status).toBe(409);
});

// ----------------------------------------------------------------------------- Q3 附件
test('Q3 附件：上傳、列表（短效期連結）、每次開啟重新簽發、只標記刪除（實體檔保留）；4MB、格式、數量與權限', async () => {
  const part = await seedPart(ctx.partCat.id, 'ATT');
  const png = makePng({ width: 64, height: 64, inkPixels: 10 });
  const upload = (k: string, files: { name: string; mimeType: string; buffer: Buffer }[], extra: Record<string, string> = {}, resourceId = part.id) =>
    apis[k].post(`${BASE}/attachments`, { multipart: form(files, { resource_type: 'PART', resource_id: resourceId, purpose: 'GENERAL', ...extra }) });
  const ok = await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}a.png`, mimeType: 'image/png', buffer: png }, { name: `${M7_FILE_PREFIX}b.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]);
  expect(ok.status()).toBe(201);
  const created = (await ok.json()).data as any[];
  expect(created).toHaveLength(2);
  const dbRows = await rowsWhere('ga_resource_attachments', 'resource_id', part.id);
  expect(dbRows.map((r) => r.file_name).sort()).toEqual([`${M7_FILE_PREFIX}a.png`, `${M7_FILE_PREFIX}b.pdf`]);
  expect(dbRows[0].storage_bucket).toBe('general-affairs-attachments');
  expect(dbRows[0].storage_path).toMatch(new RegExp(`^part/${part.id}/general/\\d+-[0-9a-f-]{36}\\.(png|pdf)$`));
  expect(dbRows[0].uploaded_by).toBeTruthy();
  const list = await get('ga_part_edit', `attachments?resourceType=PART&resourceId=${part.id}`);
  expect(list.body.data).toHaveLength(2);
  expect(list.body.data.every((a: any) => typeof a.signed_url === 'string' && !('storage_path' in a))).toBe(true);
  expect(list.body.limits).toEqual({ maxFileBytes: 4 * 1024 * 1024, maxFiles: 10 });
  const img = list.body.data.find((a: any) => a.content_type === 'image/png');
  const fetched = await fetch(img.signed_url);
  expect(fetched.status).toBe(200);
  const open1 = await get('ga_part_edit', `attachments/${img.id}/url`);
  await new Promise((r) => setTimeout(r, 1100)); // 簽名連結的發行時間以秒計，同一秒內兩次會相同
  const open2 = await get('ga_part_edit', `attachments/${img.id}/url`);
  expect(open1.status).toBe(200);
  expect(open1.body.expires_in).toBe(300);
  expect(open1.body.url).not.toBe(open2.body.url); // 每次開啟重新簽發
  // 驗證：超過 4MB、不支援格式、空檔案、超過 10 個、缺資源 id、資源類型錯誤 -> 全部不留下任何紀錄
  const before = (await rowsWhere('ga_resource_attachments', 'resource_id', part.id)).length;
  const big = await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}big.pdf`, mimeType: 'application/pdf', buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 1) }]);
  expect(big.status()).toBe(400);
  expect((await big.json()).error).toContain('4MB');
  expect((await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}x.txt`, mimeType: 'text/plain', buffer: Buffer.from('hi') }])).status()).toBe(400);
  expect((await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}e.pdf`, mimeType: 'application/pdf', buffer: Buffer.alloc(0) }])).status()).toBe(400);
  // 一個好、一個壞：整批不留任何紀錄（全成或全不變）
  expect((await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}good.png`, mimeType: 'image/png', buffer: png }, { name: `${M7_FILE_PREFIX}bad.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') }])).status()).toBe(400);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `${M7_FILE_PREFIX}${i}.png`, mimeType: 'image/png', buffer: png }));
  expect((await upload('ga_part_edit', eleven)).status()).toBe(400);
  expect((await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}o.png`, mimeType: 'image/png', buffer: png }], { resource_type: 'WORK_ORDER' })).status()).toBe(400);
  expect((await upload('ga_part_edit', [{ name: `${M7_FILE_PREFIX}o.png`, mimeType: 'image/png', buffer: png }], {}, 'not-a-uuid')).status()).toBe(400);
  expect((await rowsWhere('ga_resource_attachments', 'resource_id', part.id)).length).toBe(before);
  // 權限：沒有料件管理權限的人（資料庫規則）不能上傳、也看不到
  expect((await upload('ga_part_view', [{ name: `${M7_FILE_PREFIX}v.png`, mimeType: 'image/png', buffer: png }])).status()).toBe(403);
  expect((await upload('denied', [{ name: `${M7_FILE_PREFIX}d.png`, mimeType: 'image/png', buffer: png }])).status()).not.toBe(201);
  expect((await get('denied', `attachments?resourceType=PART&resourceId=${part.id}`)).body.data ?? []).toEqual([]);
  expect((await get('denied', `attachments/${img.id}/url`)).status).toBe(404);
  // 刪除：必須有原因、只標記、實體檔保留（Q3）
  expect((await send('ga_part_edit', 'delete', `attachments/${img.id}`, {})).status).toBe(400);
  expect((await send('ga_part_view', 'delete', `attachments/${img.id}`, { deletion_reason: '測試' })).status).toBe(403);
  const del = await send('ga_part_edit', 'delete', `attachments/${img.id}`, { deletion_reason: '拍錯了' });
  expect(del.status).toBe(200);
  const marked = await row('ga_resource_attachments', img.id);
  expect(marked).toMatchObject({ deletion_reason: '拍錯了' });
  expect(marked.deleted_at).toBeTruthy();
  const stillThere = await adminDb().storage.from('general-affairs-attachments').download(marked.storage_path);
  expect(stillThere.error).toBeNull(); // 實體檔仍在
  expect((await get('ga_part_edit', `attachments?resourceType=PART&resourceId=${part.id}`)).body.data).toHaveLength(1);
  expect((await send('ga_part_edit', 'delete', `attachments/${img.id}`, { deletion_reason: '再刪' })).status).toBe(409);
  expect((await get('ga_part_edit', `attachments/${img.id}/url`)).status).toBe(404);
});

test('Q3 水電帳單附件只認費用權限：總務可，沒有費用權限的人不行；帳單不存在 404', async () => {
  const fake = '3f2b8c1e-5b0e-4f6a-9d3e-0a1b2c3d4e5f';
  const r = await apis.ga_part_edit.get(`${BASE}/attachments?resourceType=UTILITY_BILL&resourceId=${fake}`);
  expect(r.status()).toBe(403);
  const r2 = await apis.ga_staff.get(`${BASE}/attachments?resourceType=UTILITY_BILL&resourceId=${fake}`);
  expect(r2.status()).toBe(404);
});

// ----------------------------------------------------------------------------- 選擇器
test('G01 據點選擇器：伺服端搜尋與分頁、精確筆數、scope=mine 只列自己管的門市、位置需要庫存權限', async () => {
  const all = await get('ga_staff', 'sites?type=store&pageSize=3');
  expect(all.status).toBe(200);
  const dbCount = (await adminDb().from('stores').select('id', { count: 'exact', head: true }).eq('is_active', true)).count;
  expect(all.body.meta.total).toBe(dbCount);
  expect(all.body.data).toHaveLength(3);
  const p2 = await get('ga_staff', 'sites?type=store&pageSize=3&page=2');
  expect(p2.body.data.map((s: any) => s.id)).not.toEqual(expect.arrayContaining([all.body.data[0].id]));
  const vw = await get('ga_staff', 'sites?type=store&search=VW001');
  expect(vw.body.data.map((s: any) => s.store_code)).toEqual(['VW001']);
  expect((await get('ga_staff', `sites?type=store&search=${encodeURIComponent('a,b)(")')}`)).status).toBe(200);
  const mine = await get('real_store_manager', 'sites?type=store&scope=mine');
  expect(mine.body.data.map((s: any) => s.store_code)).toEqual(['VW001']);
  const mineB = await get('ga_store_manager_b', 'sites?type=store&scope=mine');
  expect(mineB.body.data.map((s: any) => s.store_code)).toEqual(['VW001']);
  expect((await get('denied', 'sites?type=store&scope=mine')).body.data).toEqual([]); // 沒指派門市
  expect((await get('denied', 'sites?type=store')).status).toBe(403);
  const loc = await seedLocation('VW001', 'LOC');
  expect((await get('ga_staff', `sites?type=location&search=${encodeURIComponent(loc.code)}`)).body.data.map((l: any) => l.id)).toEqual([loc.id]);
  expect((await get('ga_part_view', 'sites?type=location')).status).toBe(403);
  expect((await get('ga_staff', 'sites?type=bogus')).status).toBe(400);
});

test('G01 分類選擇器資料：只列啟用中、可搜尋、可逐層；沒有分類查看權限但有服務中心入口的人（選擇器）可讀', async () => {
  const active = await get('ga_category_view', `categories?type=part&active=true&search=${encodeURIComponent(m7Code('PC'))}`);
  expect(active.body.data.map((c: any) => c.id)).toEqual([ctx.partCat.id]);
  await adminDb().from('ga_part_categories').update({ is_active: false }).eq('id', ctx.partCat.id);
  expect((await get('ga_category_edit', `categories?type=part&active=true&search=${encodeURIComponent(m7Code('PC'))}`)).body.data).toEqual([]);
  expect((await get('ga_category_view', `categories?type=part&search=${encodeURIComponent(m7Code('PC'))}`)).body.data).toEqual([]); // 只有查看權限看不到停用的
  await adminDb().from('ga_part_categories').update({ is_active: true }).eq('id', ctx.partCat.id);
});
