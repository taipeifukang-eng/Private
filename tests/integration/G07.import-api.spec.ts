import { expect, test, type APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, m7Name, seedCategory, seedEquipment, stores } from '../support/m7m8-fixtures';
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../../lib/workspace/general-affairs/import-columns';

// M7/M8 第 2 批 Q29 Excel 匯入 API（/api/workspace/general-affairs/asset-import/**）整合層：
//   範本下載、伺服端解析（2MB、500 列、副檔名與格式）、逐列預檢（錯誤列標出原因）、整批寫入全成或全不變、重送不重複、
//   寫入後讀回資料庫（含自動進入貼標待辦與進度）、權限（設備／設施管理分開、查看者、店長、無權限者做不到）。
// 匯入的檔名要帶測試標記，批次紀錄才會被清理程式找到（ga_asset_import_batches.file_name）。
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_edit', 'ga_facility_edit', 'ga_equipment_view', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string; code: string };
let facCat: { id: string; code: string };
let sid: Record<string, string> = {};
let seq = 0;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqCat = await seedCategory('equipment', 'IE');
  facCat = await seedCategory('facility', 'IF');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

type Line = Record<string, string | number>;
function xlsx(lines: Line[], head: string[] = IMPORT_COLUMNS.map((c) => c.header)): Buffer {
  const aoa = [head, ...lines.map((l) => head.map((h) => (h in l ? l[h] : '')))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '匯入資料');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const eqLine = (tag: string, over: Line = {}): Line => ({ 類型: '設備', 門市代碼: 'ZT01', 分類代碼: eqCat.code, 名稱: m7Name(tag), 品牌: 'IB', 型號: 'IM', 資產編號: m7Code(tag), ...over });
const facLine = (tag: string, over: Line = {}): Line => ({ 類型: '設施', 門市代碼: 'ZT01', 分類代碼: facCat.code, 名稱: m7Name(tag), ...over });
const fileName = (tag: string) => `${m7Name(tag)}.xlsx`;
const send = async (role: string, path: string, buffer: Buffer, name: string, extra: Record<string, string> = {}) => {
  const r = await apis[role].post(`${BASE}/asset-import/${path}`, { multipart: { file: { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }, ...extra } });
  return { status: r.status(), body: (await r.json().catch(() => ({}))) as any };
};
const check = (role: string, buffer: Buffer, tag = 'chk') => send(role, 'check', buffer, fileName(tag));
const commit = (role: string, buffer: Buffer, key: string, tag = 'cmt') => send(role, 'commit', buffer, fileName(tag), { idempotencyKey: key });
const newKey = () => `m7m8-import-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const eqByName = async (names: string[]) => ((await adminDb().from('ga_equipment').select('*').in('name', names)).data || []) as any[];
const facByName = async (names: string[]) => ((await adminDb().from('ga_facilities').select('*').in('name', names)).data || []) as any[];

test('範本與代碼對照：總務與設施管理者可下載，內容是第一列表頭＋說明＋代碼對照；店長、設備查看者、無權限者 403', async () => {
  const ref = await apis.ga_works.get(`${BASE}/asset-import/reference`);
  expect(ref.status()).toBe(200);
  const body = await ref.json();
  expect(body.stores.map((s: any) => s.store_code)).toEqual(expect.arrayContaining(['ZT01', 'VW001']));
  expect(body.equipmentCategories.map((c: any) => c.code)).toContain(eqCat.code);
  expect(body.facilityCategories.map((c: any) => c.code)).toContain(facCat.code);
  expect(body.limits).toEqual({ maxRows: 500, maxBytes: 2 * 1024 * 1024 });
  expect(body.columns.map((c: any) => c.header)).toEqual(IMPORT_COLUMNS.map((c) => c.header));

  const t = await apis.ga_works.get(`${BASE}/asset-import/template`);
  expect(t.status()).toBe(200);
  expect(t.headers()['content-type']).toContain('spreadsheetml');
  expect(t.headers()['content-disposition']).toContain('attachment');
  const wb = XLSX.read(await t.body(), { type: 'buffer' });
  expect(wb.SheetNames).toEqual(['匯入資料', '填寫說明', '代碼對照']);
  const head = (XLSX.utils.sheet_to_json(wb.Sheets['匯入資料'], { header: 1 }) as string[][])[0];
  expect(head).toEqual(IMPORT_COLUMNS.map((c) => c.header));
  const codes = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets['代碼對照'], { header: 1 }));
  expect(codes).toContain('ZT01');
  expect(codes).toContain(eqCat.code);
  // 範本本身可以直接當檔案上傳（只有表頭 -> 說明「沒有任何資料列」）
  const empty = await send('ga_works', 'check', await t.body(), fileName('tpl'));
  expect(empty.status).toBe(400);
  expect(empty.body.error).toMatch(/沒有任何資料列/);

  expect((await apis.ga_facility_edit.get(`${BASE}/asset-import/reference`)).status()).toBe(200);
  expect((await apis.ga_equipment_edit.get(`${BASE}/asset-import/template`)).status()).toBe(200);
  for (const k of ['ga_equipment_view', 'store_manager', 'ga_store_manager_b', 'denied']) {
    expect((await apis[k].get(`${BASE}/asset-import/reference`)).status(), `${k} reference`).toBe(403);
    expect((await apis[k].get(`${BASE}/asset-import/template`)).status(), `${k} template`).toBe(403);
  }
});

test('預檢：全部通過回逐列結果與統計，不寫入任何資料；有錯的列標出 Excel 列號與原因，並且不能提交', async () => {
  const a = eqLine('CK-A'), b = eqLine('CK-B', { 門市代碼: 'VW001' }), c = facLine('CK-C', { 數量: 2, 單位: '座', 是否保固: '是', 保固到期日: '2030-01-31' });
  const ok = await check('ga_works', xlsx([a, b, c]));
  expect(ok.status).toBe(200);
  expect(ok.body).toMatchObject({ dryRun: true, committed: false, canCommit: true, summary: { total: 3, okCount: 3, errorCount: 0, equipmentCount: 2, facilityCount: 1, storeCount: 2 } });
  expect(ok.body.rows.map((r: any) => [r.row_no, r.kind, r.ok])).toEqual([[2, 'EQUIPMENT', true], [3, 'EQUIPMENT', true], [4, 'FACILITY', true]]);
  expect(ok.body.rows[0].code).toBe(a.資產編號); // 預檢回傳預計編號
  expect(await eqByName([a.名稱 as string, b.名稱 as string])).toEqual([]);
  expect(await facByName([c.名稱 as string])).toEqual([]);

  const bad = await check('ga_works', xlsx([
    eqLine('CK-D'),
    eqLine('CK-E', { 門市代碼: 'NOPE99' }), // 資料庫才知道的錯：門市不存在
    eqLine('CK-F', { 分類代碼: 'NOCAT' }), // 分類不存在
    eqLine('CK-G', { 購置日期: '2026-13-45' }), // 格式錯
    eqLine('CK-H', { 狀態: '飛走了' }),
    facLine('CK-I', { 品牌: 'x' }), // 設施不能填設備欄位
    eqLine('CK-J', { 資產編號: m7Code('CK-D') }), // 與第 2 列編號重複
  ]));
  expect(bad.status).toBe(200);
  expect(bad.body.canCommit).toBe(false);
  expect(bad.body.summary).toMatchObject({ total: 7, okCount: 1, errorCount: 6 });
  const by = Object.fromEntries(bad.body.rows.map((r: any) => [r.row_no, r]));
  expect(by[2].ok).toBe(true);
  expect(by[3].errors[0]).toMatch(/找不到門市代碼「NOPE99」/);
  expect(by[4].errors[0]).toMatch(/找不到分類代碼「NOCAT」/);
  expect(by[5].errors[0]).toMatch(/「購置日期」.*不是有效日期/);
  expect(by[6].errors[0]).toMatch(/「狀態」.*不是設備的狀態/);
  expect(by[7].errors[0]).toMatch(/「品牌」只有設備使用/);
  expect(by[8].errors[0]).toMatch(/編號重複/);
  expect((await eqByName([m7Name('CK-D')])).length).toBe(0);
});

test('檔案限制：不是 xlsx、副檔名不對、空檔、缺欄位、超過 500 列、超過 2MB、缺識別碼都擋下（400）', async () => {
  const notXlsx = await send('ga_works', 'check', Buffer.from('a,b\n1,2\n'), fileName('bad1'));
  expect(notXlsx.status).toBe(400);
  const fakeXlsx = await send('ga_works', 'check', Buffer.from('this is not a zip file'), fileName('bad2'));
  expect(fakeXlsx.status).toBe(400);
  expect(fakeXlsx.body.error).toMatch(/不是 Excel/);
  const wrongExt = await send('ga_works', 'check', xlsx([eqLine('X1')]), `${m7Name('bad3')}.csv`);
  expect(wrongExt.status).toBe(400);
  const noHead = await send('ga_works', 'check', xlsx([{ 類型: '設備', 名稱: 'x' }], ['類型', '名稱']), fileName('bad4'));
  expect(noHead.status).toBe(400);
  expect(noHead.body.error).toMatch(/缺少：門市代碼、分類代碼/);
  const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => eqLine(`M${i}`));
  const tooMany = await check('ga_works', xlsx(many));
  expect(tooMany.status).toBe(400);
  expect(tooMany.body.error).toMatch(/最多匯入 500 列/);
  const big = await send('ga_works', 'check', Buffer.concat([xlsx([eqLine('BIG')]), Buffer.alloc(2 * 1024 * 1024)]), fileName('big'));
  expect(big.status).toBe(400);
  expect(big.body.error).toMatch(/2MB/);
  const noKey = await send('ga_works', 'commit', xlsx([eqLine('NK')]), fileName('nokey'));
  expect(noKey.status).toBe(400);
  expect((await send('ga_works', 'commit', xlsx([eqLine('NK2')]), fileName('nokey'), { idempotencyKey: 'x' })).status).toBe(400);
  expect((await eqByName([m7Name('NK'), m7Name('NK2'), m7Name('BIG')])).length).toBe(0);
});

test('有錯就整批不寫入：預檢沒發現的資料庫衝突（預檢後編號被別人用掉）在正式寫入時整批撤回，好的列也不會留下', async () => {
  const good1 = eqLine('AT-1'), good2 = facLine('AT-2'), clash = eqLine('AT-3');
  const buffer = xlsx([good1, good2, clash]);
  expect((await check('ga_works', buffer)).body.canCommit).toBe(true);
  // 預檢之後，別人先用掉了第 3 列的資產編號
  await seedEquipment('ZT01', eqCat.id, 'AT-OTHER', { asset_code: clash.資產編號 });
  const r = await commit('ga_works', buffer, newKey());
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ committed: false, summary: { errorCount: 1 } });
  expect(r.body.rows.find((x: any) => x.row_no === 4).errors[0]).toMatch(/編號重複/);
  expect(await eqByName([good1.名稱 as string])).toEqual([]);
  expect(await facByName([good2.名稱 as string])).toEqual([]);
  expect(((await adminDb().from('ga_asset_import_batches').select('id').like('file_name', `${m7Name('cmt')}%`)).data || []).length).toBe(0);
  // 格式有錯的檔案：commit 一律不寫入（不信任預檢）
  const fmt = await commit('ga_works', xlsx([eqLine('AT-4'), eqLine('AT-5', { 購置金額: '很貴' })]), newKey());
  expect(fmt.body).toMatchObject({ committed: false, summary: { errorCount: 1 } });
  expect(await eqByName([m7Name('AT-4')])).toEqual([]);
});

test('整批寫入：設備與設施、兩間門市一次寫入，讀回資料庫逐欄相同；自動進入貼標待辦；重送同一識別碼不重複；批次紀錄與進度完成率正確', async () => {
  const lines = [
    eqLine('OK-1', { 狀態: '備品', 重要程度: '高', 區域: '調劑區', 位置說明: '左側', 購置金額: '12,000', 是否保固: '是', 保固到期日: '2030-06-30', 購置日期: '2026-01-05', 序號: 'SN-1', 備註: '匯入測試' }),
    eqLine('OK-2', { 門市代碼: 'VW001' }),
    facLine('OK-3', { 狀態: '整修中', 數量: 3, 單位: '組', 設施代碼: m7Code('OK3'), 是否保固: '是', 保固到期日: '2031-02-28', 安裝日期: '2025-12-01' }),
    facLine('OK-4', { 門市代碼: 'VW001' }),
  ];
  const buffer = xlsx(lines);
  const key = newKey();
  const done = await commit('ga_works', buffer, key, 'okfile');
  expect(done.status).toBe(200);
  expect(done.body).toMatchObject({ dryRun: false, committed: true, alreadyImported: false, summary: { total: 4, okCount: 4, errorCount: 0, equipmentCount: 2, facilityCount: 2, storeCount: 2 } });
  expect(done.body.batchId).toBeTruthy();

  const eq = await eqByName([lines[0].名稱 as string, lines[1].名稱 as string]);
  const e1 = eq.find((x) => x.name === lines[0].名稱), e2 = eq.find((x) => x.name === lines[1].名稱);
  expect(e1).toMatchObject({
    store_id: sid.ZT01, category_id: eqCat.id, status: 'SPARE', criticality: 'HIGH', area: '調劑區', location_detail: '左側', purchase_amount: 12000, has_warranty: true,
    warranty_end_date: '2030-06-30', purchased_at: '2026-01-05', serial_number: 'SN-1', notes: '匯入測試', asset_code: lines[0].資產編號, brand: 'IB', model: 'IM',
  });
  expect(e1.specs.import_batch_id).toBe(done.body.batchId);
  expect(e2).toMatchObject({ store_id: sid.VW001, status: 'ACTIVE', criticality: 'NORMAL', has_warranty: false, deleted_at: null });
  const fac = await facByName([lines[2].名稱 as string, lines[3].名稱 as string]);
  const f1 = fac.find((x) => x.name === lines[2].名稱), f2 = fac.find((x) => x.name === lines[3].名稱);
  expect(f1).toMatchObject({ store_id: sid.ZT01, category_id: facCat.id, status: 'UNDER_RENOVATION', quantity: 3, unit: '組', facility_code: m7Code('OK3'), installed_at: '2025-12-01' });
  expect(f1.specs).toMatchObject({ facility_has_warranty: true, facility_warranty_end_date: '2031-02-28', import_batch_id: done.body.batchId });
  expect(f2.store_id).toBe(sid.VW001);
  // 匯入後自動產生貼標待辦：設備與設施都從「待上傳照片」開始
  for (const x of [e1, e2, f1, f2]) expect(x.onboarding_status).toBe('NEEDS_EQUIPMENT_PHOTO');
  const batch = (await adminDb().from('ga_asset_import_batches').select('*').eq('id', done.body.batchId).single()).data as any;
  expect(batch).toMatchObject({ total_rows: 4, equipment_count: 2, facility_count: 2, store_count: 2, idempotency_key: key });
  expect(batch.file_name).toContain(m7Name('okfile'));
  expect(batch.created_by_name).toBeTruthy();

  // 重送同一識別碼（連按兩次或重新整理後再送）：不重複新增
  const again = await commit('ga_works', buffer, key, 'okfile');
  expect(again.body).toMatchObject({ committed: true, alreadyImported: true, batchId: done.body.batchId, summary: { total: 4, equipmentCount: 2, facilityCount: 2 } });
  expect((await eqByName([lines[0].名稱 as string])).length).toBe(1);
  // 同一個檔案換新識別碼再送：資產編號已存在，整批被擋（不會重複建立）
  const dup = await commit('ga_works', buffer, newKey(), 'okfile');
  expect(dup.body.committed).toBe(false);
  expect((await eqByName([lines[0].名稱 as string])).length).toBe(1);

  // 店長待辦：A 店店長看到 ZT01 的兩筆、看不到 VW001 的；B 店反過來
  const tasks = async (k: string) => ((await (await apis[k].get(`${BASE}/onboarding/tasks?pageSize=100&statuses=NEEDS_EQUIPMENT_PHOTO`)).json()).data as any[]).map((r) => r.id);
  expect(await tasks('store_manager')).toEqual(expect.arrayContaining([e1.id, f1.id]));
  expect(await tasks('store_manager')).not.toEqual(expect.arrayContaining([e2.id]));
  expect(await tasks('store_manager')).not.toContain(f2.id);
  expect(await tasks('ga_store_manager_b')).toEqual(expect.arrayContaining([e2.id, f2.id]));
  expect(await tasks('ga_store_manager_b')).not.toContain(e1.id);
  // 進度：兩店各有資產，完成率 0
  const prog = (await (await apis.ga_works.get(`${BASE}/onboarding/progress?includeEmpty=false`)).json()).data as any[];
  const zt = prog.find((s) => s.store_code === 'ZT01'), vw = prog.find((s) => s.store_code === 'VW001');
  expect(zt.equipment.needs_photo).toBeGreaterThanOrEqual(1);
  expect(zt.facility.needs_photo).toBeGreaterThanOrEqual(1);
  expect(vw.completion_rate === null || Number(vw.completion_rate) < 100).toBe(true);
});

test('權限：設備管理只能匯入設備、設施管理只能匯入設施（資料庫判斷，被擋時整批不寫入）；查看者、店長、無權限者都不能預檢也不能提交', async () => {
  const eqOnly = xlsx([eqLine('PM-E1')]);
  const facOnly = xlsx([facLine('PM-F1')]);
  const both = xlsx([eqLine('PM-E2'), facLine('PM-F2')]);
  expect((await check('ga_equipment_edit', eqOnly)).status).toBe(200);
  expect((await check('ga_facility_edit', facOnly)).status).toBe(200);
  expect((await check('ga_equipment_edit', facOnly)).status).toBe(403);
  expect((await check('ga_facility_edit', eqOnly)).status).toBe(403);
  expect((await check('ga_equipment_edit', both)).status).toBe(403);
  expect((await commit('ga_equipment_edit', both, newKey())).status).toBe(403);
  expect((await commit('ga_facility_edit', both, newKey())).status).toBe(403);
  expect((await eqByName([m7Name('PM-E2')])).length).toBe(0);
  expect((await facByName([m7Name('PM-F2')])).length).toBe(0);
  for (const k of ['ga_equipment_view', 'store_manager', 'ga_store_manager_b', 'denied']) {
    expect((await check(k, eqOnly)).status, `${k} check`).toBe(403);
    expect((await commit(k, eqOnly, newKey())).status, `${k} commit`).toBe(403);
  }
  expect((await eqByName([m7Name('PM-E1')])).length).toBe(0);
  // 管理權限者可以實際匯入自己那一類
  const real = await commit('ga_equipment_edit', eqOnly, newKey(), 'pmfile');
  expect(real.body.committed).toBe(true);
  expect((await eqByName([m7Name('PM-E1')])).length).toBe(1);
});

test('未登入、跨站請求：401、403', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  try {
    expect((await anon.get(`${BASE}/asset-import/reference`)).status()).toBe(401);
    const r = await anon.post(`${BASE}/asset-import/check`, { multipart: { file: { name: 'a.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') } } });
    expect([401, 403]).toContain(r.status());
  } finally {
    await anon.dispose();
  }
});

test('B10 可能重複：沒填編號且同類型同門市同名（與既有資料、同檔其他列）→ 預檢標提醒並計數，不擋提交；有填編號、他店、他類型不標；正式寫入照常成功', async () => {
  const existing = await seedEquipment('ZT01', eqCat.id, 'dupEx');
  await seedEquipment('ZT02', eqCat.id, 'dupOther'); // 他店同名：不算
  const nm = existing.name as string;
  const lines: Line[] = [
    eqLine('d1', { 名稱: `  ${nm.toUpperCase()}　`, 資產編號: '' }), // 第 2 列：與既有同名（大小寫、頭尾空白、全形空白）
    eqLine('d2', { 名稱: nm, 資產編號: m7Code('dupHasCode') }), // 第 3 列：有填編號，不標記
    eqLine('d3', { 名稱: m7Name('dupOther'), 資產編號: '' }), // 第 4 列：只有他店有同名，不標記
    eqLine('d4', { 名稱: m7Name('dupFile'), 資產編號: '' }), // 第 5 列
    eqLine('d5', { 名稱: ` ${m7Name('dupFile')} `, 資產編號: '' }), // 第 6 列：與第 5 列同名
    facLine('d6', { 名稱: nm }), // 第 7 列：設施同名但類型不同，不標記
  ];
  const buf = xlsx(lines);
  const r = await check('ga_works', buf, 'dup');
  expect(r.status).toBe(200);
  expect(r.body.canCommit).toBe(true);
  expect(r.body.summary.errorCount).toBe(0);
  expect(r.body.summary.duplicateCount).toBe(3);
  const byNo = Object.fromEntries(r.body.rows.map((x: any) => [x.row_no, x]));
  expect(byNo[2].ok).toBe(true);
  expect(byNo[2].warnings[0]).toMatch(/^可能重複：與既有「.+」（尚無編號，建立 \d{4}-\d{2}-\d{2}）同名$/);
  expect(byNo[2].duplicate.type).toBe('existing');
  expect(byNo[3].warnings).toEqual([]);
  expect(byNo[4].warnings).toEqual([]);
  expect(byNo[5].warnings).toEqual(['可能重複：與第 6 列同名']);
  expect(byNo[6].warnings).toEqual(['可能重複：與第 5 列同名']);
  expect(byNo[7].warnings).toEqual([]);
  // 預檢不寫入
  expect((await eqByName([lines[3].名稱 as string])).length).toBe(0);
  // 不擋：正式寫入成功（全部 6 列），回應不再帶提醒計算
  const c = await commit('ga_works', buf, newKey(), 'dup');
  expect(c.status).toBe(200);
  expect(c.body.committed).toBe(true);
  expect(c.body.summary.total).toBe(6);
  expect((await eqByName([m7Name('dupFile')])).length).toBe(2);
  // 匯入後再預檢同一份：同檔重複仍標記，且多了與剛匯入（已有同名）的既有資料
  const again = await check('ga_works', xlsx([eqLine('d9', { 名稱: m7Name('dupFile'), 資產編號: '' })]), 'dup2');
  expect(again.body.summary.duplicateCount).toBe(1);
  expect(again.body.rows[0].warnings[0]).toContain('共 2 筆');
});
