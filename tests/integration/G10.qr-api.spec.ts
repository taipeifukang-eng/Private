import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, m7Name, row, seedCategory, seedEquipment, seedFacility, seedRepairRequest, stores } from '../support/m7m8-fixtures';

// M7/M8 第 2 批 G10 整合層：QR 標籤資料 API（/qr/labels）與資產掃描 API（/assets/scan/:token）。
// 標籤：權限（設備／設施分開，店長與無權限者 403）、網址 = 設定網域 + 永久路徑 + 資料庫 token、伺服端 SVG、測試浮水印、
//      排除報廢／退役／刪除／找不到並說明、無編號警告、單次 300 張上限、搜尋含逗號括號不壞。
// 掃描：400／401／404 NOT_FOUND／404 REVOKED（友善說明、只給看得到這類資產的人資產名稱）／403 NO_ACCESS（白話說明＋該門市店長姓名，不含電話與帳號）／200，
//      Q5 欄位（店長只看基本欄位）、報修按鈕規則（canReport）、恢復 QR 後舊 token 又可掃、換店後 token 不變。
// 缺少 NEXT_PUBLIC_SITE_URL 的報錯由單元測試涵蓋（測試站固定設定該變數，無法在同一個站內切換）。
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_equipment_edit', 'ga_facility_view', 'ga_facility_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string };
let facCat: { id: string };
let sid: Record<string, string> = {};
let gaUserId = '';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqCat = await seedCategory('equipment', 'QC');
  facCat = await seedCategory('facility', 'QF');
  gaUserId = (await (await apis.ga_works.get('/api/workspace/session')).json()).user.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](`${BASE}/${p}`, data === undefined ? {} : { data }));
const labels = (k: string, qs: string) => get(k, `qr/labels?${qs}`);
const scan = (k: string, token: string) => get(k, `assets/scan/${token}`);
const SITE = TEST_ORIGIN; // 測試站固定把 NEXT_PUBLIC_SITE_URL 設為自己的網址（tests/support/start-test-server.cjs）
const urlOf = (token: string) => `${SITE}/general-affairs/assets/scan/${token}`;

// ------------------------------------------------------------------------------------------------ 標籤
test('G10 標籤權限：設備與設施分開；店長、無權限者 403；未登入 401；參數錯誤 400', async () => {
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get(`${BASE}/qr/labels?type=equipment`)).status()).toBe(401);
  await anon.dispose();
  for (const k of ['ga_works', 'ga_equipment_view', 'ga_equipment_edit']) expect((await labels(k, 'type=equipment&ids=')).status, k).toBe(200);
  for (const k of ['ga_works', 'ga_facility_view', 'ga_facility_edit']) expect((await labels(k, 'type=facility&ids=')).status, k).toBe(200);
  // 跨類別：設備權限看不到設施標籤，反之亦然
  expect((await labels('ga_equipment_view', 'type=facility')).status).toBe(403);
  expect((await labels('ga_facility_view', 'type=equipment')).status).toBe(403);
  for (const k of ['store_manager', 'ga_store_manager_b', 'denied']) {
    expect((await labels(k, 'type=equipment')).status, k).toBe(403);
    expect((await labels(k, 'type=facility')).status, k).toBe(403);
  }
  expect((await labels('ga_works', 'type=part')).status).toBe(400);
  expect((await labels('ga_works', '')).status).toBe(400);
  expect((await labels('ga_works', 'type=equipment&ids=not-a-uuid')).status).toBe(400);
  expect((await labels('ga_works', 'type=equipment&storeId=zzz')).status).toBe(400);
  const many = Array.from({ length: 151 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
  expect((await labels('ga_works', `type=equipment&ids=${many}`)).status).toBe(400);
});

test('G10 標籤內容：網址 = 設定網域 + 永久路徑 + 資料庫 token；伺服端 SVG；測試浮水印；依門市篩選；無編號警告；搜尋含逗號括號不壞', async () => {
  const a = await seedEquipment('ZT01', eqCat.id, 'LB-A', { asset_code: m7Code('LA') });
  const b = await seedEquipment('ZT01', eqCat.id, 'LB-B'); // 沒有編號
  const c = await seedEquipment('VW001', eqCat.id, 'LB-C', { asset_code: m7Code('LC') });
  const r = await labels('ga_works', `type=equipment&storeId=${sid.ZT01}&q=${encodeURIComponent('LB-')}`);
  expect(r.status).toBe(200);
  const items = r.body.items as any[];
  expect(items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  const ia = items.find((i) => i.id === a.id);
  expect(ia.qrUrl).toBe(urlOf(a.qr_token)); // token 與資料庫一致，網域取自設定
  expect(ia.svg.startsWith('<svg')).toBe(true);
  expect(ia).toMatchObject({ type: 'EQUIPMENT', code: a.asset_code, storeCode: 'ZT01', warnings: [] });
  expect(items.find((i) => i.id === b.id)).toMatchObject({ code: null, warnings: ['NO_CODE'] });
  expect(r.body).toMatchObject({ watermark: true, baseUrl: SITE, limit: 300, truncated: false, matched: 2, noCodeCount: 1 });
  // 不同門市只在被選到時出現
  const rc = await labels('ga_works', `type=equipment&storeId=${sid.VW001}&q=${encodeURIComponent('LB-C')}`);
  expect(rc.body.items.map((i: any) => i.id)).toEqual([c.id]);
  // 搜尋含逗號、括號、引號不會壞
  for (const q of ['a,b', '(x)', '"q"', "50%_"]) expect((await labels('ga_works', `type=equipment&q=${encodeURIComponent(q)}`)).status, q).toBe(200);
  // 指定 ids 只印那幾台
  const ids = await labels('ga_works', `type=equipment&ids=${a.id},${c.id}`);
  expect(ids.body.items.map((i: any) => i.id).sort()).toEqual([a.id, c.id].sort());
  expect(ids.body.matched).toBe(2);
});

test('G10 標籤排除：報廢設備、退役設施、已刪除、找不到的 id 都不印並說明原因；設備退役仍可印（QR 不作廢）', async () => {
  const ok = await seedEquipment('ZT01', eqCat.id, 'EX-OK', { asset_code: m7Code('XO') });
  const scrapped = await seedEquipment('ZT01', eqCat.id, 'EX-SC');
  const retiredEq = await seedEquipment('ZT01', eqCat.id, 'EX-RT');
  const deleted = await seedEquipment('ZT01', eqCat.id, 'EX-DEL');
  const fac = await seedFacility('ZT01', facCat.id, 'EX-FAC');
  const facRetired = await seedFacility('ZT01', facCat.id, 'EX-FRT');
  const admin = adminDb();
  await admin.from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', scrapped.id);
  await admin.from('ga_equipment').update({ status: 'RETIRED' }).eq('id', retiredEq.id);
  await admin.from('ga_equipment').update({ deleted_at: new Date().toISOString() }).eq('id', deleted.id);
  await admin.from('ga_facilities').update({ status: 'RETIRED' }).eq('id', facRetired.id);
  const missing = '00000000-0000-4000-8000-000000000001';

  const byIds = await labels('ga_works', `type=equipment&ids=${[ok, scrapped, retiredEq, deleted].map((x) => x.id).join(',')},${missing}`);
  expect(byIds.body.items.map((i: any) => i.id).sort()).toEqual([ok.id, retiredEq.id].sort());
  const ex = Object.fromEntries((byIds.body.excluded as any[]).map((x) => [x.id, x]));
  expect(ex[scrapped.id]).toMatchObject({ reason: 'SCRAPPED' });
  expect(ex[scrapped.id].message).toContain('已報廢');
  expect(ex[deleted.id]).toMatchObject({ reason: 'DELETED' });
  expect(ex[missing]).toMatchObject({ reason: 'NOT_FOUND' });
  expect(byIds.body.excludedTotal).toBe(3);

  // 依篩選（不指定 ids）：報廢者排除並計入 excludedTotal；已刪除不列
  const byFilter = await labels('ga_works', `type=equipment&storeId=${sid.ZT01}&q=${encodeURIComponent('EX-')}`);
  const printable = byFilter.body.items.map((i: any) => i.id);
  expect(printable).toEqual(expect.arrayContaining([ok.id, retiredEq.id]));
  expect(printable).not.toContain(scrapped.id);
  expect(printable).not.toContain(deleted.id);
  expect((byFilter.body.excluded as any[]).map((x) => x.id)).toContain(scrapped.id);

  // 設施：退役者排除
  const f = await labels('ga_facility_edit', `type=facility&ids=${fac.id},${facRetired.id}`);
  expect(f.body.items.map((i: any) => i.id)).toEqual([fac.id]);
  expect(f.body.items[0]).toMatchObject({ type: 'FACILITY', qrUrl: urlOf(fac.qr_token) });
  expect(f.body.excluded[0]).toMatchObject({ id: facRetired.id, reason: 'RETIRED' });
});

test('G10 標籤單次上限 300 張：超過時只回前 300、標示 truncated 與精確符合筆數', async () => {
  const s = await stores();
  const rows = Array.from({ length: 305 }, (_, i) => ({ store_id: s.ZT05.id, category_id: eqCat.id, name: m7Name(`LIM-${String(i).padStart(3, '0')}`), brand: 'LIM', model: 'LIM' }));
  for (let i = 0; i < rows.length; i += 100) {
    const r = await adminDb().from('ga_equipment').insert(rows.slice(i, i + 100));
    expect(r.error, '批次建立設備').toBeNull();
  }
  const r = await labels('ga_works', `type=equipment&storeId=${s.ZT05.id}&q=${encodeURIComponent('LIM-')}`);
  expect(r.status).toBe(200);
  expect(r.body.items).toHaveLength(300);
  expect(r.body).toMatchObject({ truncated: true, matched: 305, limit: 300 });
  const small = await labels('ga_works', `type=equipment&storeId=${s.ZT05.id}&q=${encodeURIComponent('LIM-00')}`);
  expect(small.body).toMatchObject({ truncated: false, matched: 10 });
});

// ------------------------------------------------------------------------------------------------ 掃描
test('G10 掃描：格式錯誤 400、未登入 401、不存在 404 NOT_FOUND', async () => {
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN });
  const a = await anon.get(`${BASE}/assets/scan/${'a'.repeat(30)}`);
  expect(a.status()).toBe(401);
  await anon.dispose();
  for (const bad of ['short', 'a'.repeat(65), 'has-dash-has-dash-has-dash-has']) expect((await scan('ga_works', bad)).status, bad).toBe(400);
  const nf = await scan('ga_works', 'f'.repeat(32));
  expect(nf.status).toBe(404);
  expect(nf.body.code).toBe('NOT_FOUND');
  expect(nf.body.error).toContain('找不到');
  expect(nf.body).not.toHaveProperty('asset');
});

test('G10 掃描成功與 Q5：總務看完整欄位但不含金額與備註；店長只看基本欄位；報修按鈕只給能替該門市建單的人', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'SC-OK', {
    asset_code: m7Code('SO'), serial_number: 'SN-SECRET', purchase_amount: 98765, notes: '內部備註-不外露', area: '前場營業區', location_detail: '收銀台旁', has_warranty: true, warranty_end_date: '2099-12-31',
  });
  await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'SC-REQ', 'IN_PROGRESS', gaUserId);

  const ga = await scan('ga_works', eq.qr_token);
  expect(ga.status).toBe(200);
  const d = ga.body.data;
  expect(d).toMatchObject({ id: eq.id, type: 'EQUIPMENT', name: eq.name, code: eq.asset_code, token: eq.qr_token, status: 'ACTIVE', brand: eq.brand, model: eq.model, serial_number: 'SN-SECRET' });
  expect(d.store).toMatchObject({ store_code: 'ZT01' });
  expect(d.warranty).toMatchObject({ state: 'active', end_date: '2099-12-31' });
  expect(d.access).toMatchObject({ level: 'full', scope: 'MANAGE' });
  expect(d.canReport).toBe(true);
  expect(d.reportPath).toBe(`/general-affairs/reports/new?assetToken=${eq.qr_token}`);
  expect(d.managementKind).toBe('ga-equipment');
  expect(d.repairs).toMatchObject({ visible: true, total: 1 });
  const text = JSON.stringify(ga.body);
  for (const secret of ['98765', '內部備註', 'qr_token_revoked_at', 'purchase_amount']) expect(text, secret).not.toContain(secret);

  // 店長（ZT01 名單內）：基本欄位，沒有品牌型號序號與主檔入口；仍能報修；看得到本店維修紀錄
  const sm = await scan('store_manager', eq.qr_token);
  expect(sm.status).toBe(200);
  const s = sm.body.data;
  expect(s.access).toMatchObject({ level: 'basic', scope: 'OWN_STORE' });
  for (const k of ['brand', 'model', 'serial_number', 'purchase_amount', 'notes', 'installed_at']) expect(s, k).not.toHaveProperty(k);
  expect(s).toMatchObject({ name: eq.name, code: eq.asset_code, location_detail: '收銀台旁' });
  expect(s.warranty.end_date).toBe('2099-12-31');
  expect(s.managementKind).toBeNull();
  expect(s.canReport).toBe(true);
  expect(s.repairs.visible).toBe(true);
  expect(JSON.stringify(sm.body)).not.toContain('SN-SECRET');

  // 設備查看者（沒有建單權限）：完整欄位、按鈕停用並說明原因
  const view = await scan('ga_equipment_view', eq.qr_token);
  expect(view.status).toBe(200);
  expect(view.body.data.access.level).toBe('full');
  expect(view.body.data.canReport).toBe(false);
  expect(view.body.data.reportPath).toBeNull();
  expect(view.body.data.reportReason).toContain('沒有建立報修單的權限');

  // 設施管理者掃設備：可看（舊版 manage 類權限可看全部），但只有基本欄位；沒有建單權限
  const fm = await scan('ga_facility_edit', eq.qr_token);
  expect(fm.status).toBe(200);
  expect(fm.body.data.access.level).toBe('basic');
  expect(fm.body.data.canReport).toBe(false);
});

test('G10 Q5 無權限者：白話說明＋該門市店長姓名（不含電話、帳號）；他店店長與無權限者都一樣；說明不洩漏資產內容', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'NA-1', { asset_code: m7Code('NA'), notes: '祕密' });
  const db = adminDb();
  const links = (await db.from('store_managers').select('user_id').eq('store_id', sid.ZT01).eq('role_type', 'store_manager')).data || [];
  const names = (await db.from('profiles').select('full_name').in('id', links.map((l: any) => l.user_id))).data || [];
  const expected = Array.from(new Set(names.map((n: any) => String(n.full_name).trim()).filter(Boolean))).sort();
  expect(expected.length).toBeGreaterThan(0);
  for (const k of ['ga_store_manager_b', 'denied']) {
    const r = await scan(k, eq.qr_token);
    expect(r.status, k).toBe(403);
    expect(r.body.code).toBe('NO_ACCESS');
    expect(r.body.error).toContain('沒有查看這個設備／設施的權限');
    expect(r.body.contacts.map((c: any) => c.name)).toEqual(expected);
    for (const c of r.body.contacts) expect(Object.keys(c)).toEqual(['name']);
    const text = JSON.stringify(r.body);
    for (const leak of [eq.name, eq.asset_code, '祕密', eq.qr_token]) expect(text, leak).not.toContain(leak);
  }
});

test('G10 Q8 作廢與恢復：報廢後掃描 404 REVOKED（總務看到資產名稱與可恢復，店長只看到說明）；恢復後舊 token 又可掃；刪除後 REVOKED 不可恢復', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'RV-1', { asset_code: m7Code('RV') });
  const token = eq.qr_token;
  let cur = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { status: 'SCRAPPED', expected_updated_at: cur.updated_at })).status).toBe(200);

  const ga = await scan('ga_works', token);
  expect(ga.status).toBe(404);
  expect(ga.body.code).toBe('REVOKED');
  expect(ga.body.error).toContain('已經作廢');
  expect(ga.body.asset).toMatchObject({ id: eq.id, name: eq.name, status: 'SCRAPPED', deleted: false });
  expect(ga.body.canRestore).toBe(true);
  const sm = await scan('store_manager', token);
  expect(sm.status).toBe(404);
  expect(sm.body.code).toBe('REVOKED');
  expect(sm.body).not.toHaveProperty('asset');
  expect(sm.body).not.toHaveProperty('canRestore');
  expect(JSON.stringify(sm.body)).not.toContain(eq.name);
  const view = await scan('ga_equipment_view', token);
  expect(view.body.asset).toBeTruthy(); // 看得到設備的人有資產名稱
  expect(view.body).not.toHaveProperty('canRestore'); // 沒有管理權限不提供恢復

  cur = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'post', `equipment/${eq.id}/restore`, { reason: '誤報廢', expected_updated_at: cur.updated_at })).status).toBe(200);
  const back = await scan('ga_works', token);
  expect(back.status).toBe(200);
  expect(back.body.data.token).toBe(token); // 沿用原標籤
  expect((await row('ga_equipment', eq.id)).qr_token).toBe(token);

  // 刪除：作廢，且不提供恢復
  cur = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: '重複建檔', expected_updated_at: cur.updated_at })).status).toBe(200);
  const del = await scan('ga_works', token);
  expect(del.status).toBe(404);
  expect(del.body.code).toBe('REVOKED');
  expect(del.body.asset.deleted).toBe(true);
  expect(del.body).not.toHaveProperty('canRestore');
});

test('G10 換店後 token 不變：原門市店長看不到（NO_ACCESS）、新門市店長看得到並可報修；設施同規則（品牌型號來自規格）', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'MV-1', { asset_code: m7Code('MV') });
  const token = eq.qr_token;
  expect((await scan('store_manager', token)).status).toBe(200);
  expect((await scan('ga_store_manager_b', token)).status).toBe(403);
  // 以管理端更正所屬門市（正式換店走轉移單，由轉移劇本驗證；這裡只驗證 token 不隨門市改變）
  const cur = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'post', `equipment/${eq.id}/correct-store`, { to_store_id: sid.VW001, reason: '建檔選錯', expected_updated_at: cur.updated_at })).status).toBe(200);
  expect((await row('ga_equipment', eq.id)).qr_token).toBe(token);
  const b = await scan('ga_store_manager_b', token);
  expect(b.status).toBe(200);
  expect(b.body.data.store.store_code).toBe('VW001');
  expect(b.body.data.canReport).toBe(true);
  const a = await scan('store_manager', token);
  expect(a.status).toBe(403);
  expect(a.body.code).toBe('NO_ACCESS');

  const fac = await seedFacility('ZT01', facCat.id, 'MV-F', { facility_code: m7Code('FM'), specs: { facility_brand: '設施品牌', facility_model: '設施型號', facility_has_warranty: true, facility_warranty_end_date: '2099-01-01', facility_warranty_note: '不外露' } });
  const fa = await scan('ga_works', fac.qr_token);
  expect(fa.status).toBe(200);
  expect(fa.body.data).toMatchObject({ type: 'FACILITY', brand: '設施品牌', model: '設施型號', code: fac.facility_code });
  expect(fa.body.data.warranty).toMatchObject({ state: 'active', end_date: '2099-01-01' });
  const fs = await scan('store_manager', fac.qr_token);
  expect(fs.body.data.access.level).toBe('basic');
  expect(fs.body.data).not.toHaveProperty('brand');
  expect(JSON.stringify(fs.body)).not.toContain('不外露');
  // 設施退役 -> 作廢
  const fcur = await row('ga_facilities', fac.id);
  expect((await send('ga_facility_edit', 'patch', `facilities/${fac.id}`, { status: 'RETIRED', expected_updated_at: fcur.updated_at })).status).toBe(200);
  const rv = await scan('ga_facility_edit', fac.qr_token);
  expect(rv.status).toBe(404);
  expect(rv.body.code).toBe('REVOKED');
});
