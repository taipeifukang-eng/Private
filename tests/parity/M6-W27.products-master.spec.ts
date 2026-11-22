import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs, loginAs } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Products, productPrefix, runIdOrThrow, setupM6Users } from '../support/m6-fixtures';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';

/**
 * M6 第二批 W27/W28 對等：舊 /api/products-master 與新 /api/workspace/products-master 對同一份資料各跑一遍。
 *  - 搜尋（管理者）：編號開頭優先、包含補足、最多 20 筆，回傳逐筆相同；
 *  - 同一份 Excel：舊版一步直接寫入、新版先預覽再確認，最後資料表內容相同（新增、更新、停用商品重新啟用）；
 *  - 已核可或待核可的差異：非管理者搜尋（舊版被資料表權限擋成空）、特殊字元搜尋、清單分頁、檔內重複編號、略過相同內容、
 *    停用權限、單筆新增編輯與重新啟用、不含併購藥局商品整理。
 * 測試商品 ZT2038-<runId>-…，只刪自己的。
 */
const recorder = new ParityRecorder('products-master');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY = '/api/products-master';
const NATIVE = '/api/workspace/products-master';
const db = adminDb();
const sheet = (aoa: (string | number)[][]) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), '商品');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const rec = (entry: string, title: string, role: string, diffs: Diff[], compared: Record<string, number | string | boolean>, mechanism: 'api-read' | 'write-readback' | 'ui-extract' = 'api-read') => {
  const r = recorder.record({ entry, mechanism, role, title, legacy: { endpoint: `${LEGACY}（舊）` }, native: { endpoint: `${NATIVE}（新）` }, compared, diffs });
  assertNoUnlistedDiffs(r);
  expect(['pass', 'allowed', 'pending-approval'], `${entry}：${JSON.stringify(r.diffs)}`).toContain(r.status);
  return r;
};
const sameRows = (key: string, l: unknown, n: unknown): Diff[] => (JSON.stringify(l) === JSON.stringify(n) ? [] : [{ kind: 'changed', key, legacy: l, native: n }]);

/**
 * 舊版匯入（POST /api/products-master）。DEV 的舊版權限檢查用登入者身分去讀 user_roles／role_permissions，
 * DEV 的資料表權限規則讓這個查詢查不到任何列，所以連有商品主檔管理權限的帳號也會回 403（舊版在 DEV 實際無法匯入）。
 * 因此先打真的舊 API；若回 403，改用「逐字複製舊版邏輯」的等價寫入（第一個工作表、舊版欄位別名、upsert onConflict product_code、is_active:true）。
 */
async function legacyImport(api: APIRequestContext, buffer: Buffer): Promise<{ status: number; body: any; via: 'api' | 'replica' }> {
  const res = await api.post(LEGACY, { multipart: { file: { name: 'legacy.xlsx', mimeType: XLSX_MIME, buffer } } });
  if (res.status() !== 403) return { status: res.status(), body: await res.json().catch(() => ({})), via: 'api' };
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
  if (rows.length === 0) return { status: 400, body: { error: 'Excel 無資料' }, via: 'replica' };
  const normalize = (row: any, keys: string[]): string => {
    for (const k of keys) {
      const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
      if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
    }
    return '';
  };
  const records = rows
    .map((row) => ({
      product_code: normalize(row, ['商品編號', 'product_code', 'ProductCode', '編號']),
      product_name: normalize(row, ['商品名稱', 'product_name', 'ProductName', '品名', '名稱']),
      unit: normalize(row, ['單位', 'unit', 'Unit']) || '',
      is_active: true,
    }))
    .filter((r) => r.product_code && r.product_name);
  if (records.length === 0) return { status: 400, body: { error: '找不到有效資料' }, via: 'replica' };
  const up = await db.from('products_master').upsert(records, { onConflict: 'product_code' });
  if (up.error) return { status: 500, body: { error: up.error.message }, via: 'replica' };
  return { status: 200, body: { success: true, count: records.length }, via: 'replica' };
}

let admin: APIRequestContext;
let manager: APIRequestContext; // 只有商品主檔管理權限的帳號（舊版匯入與停用只認明確授權，不認管理員後備）
let storeManager: APIRequestContext;
let teardown: () => Promise<string[]>;
test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Products();
  const setup = await setupM6Users(['pm_manage']);
  teardown = setup.teardown;
  manager = await apiForUser(setup.users.pm_manage);
  admin = await apiAs('admin');
  storeManager = await apiAs('store_manager');
});
test.afterAll(async () => {
  await admin.dispose();
  await manager.dispose();
  await storeManager.dispose();
  await cleanupM6Products();
  expect(await teardown()).toEqual([]);
});

const legacySearch = async (api: APIRequestContext, q: string) => {
  const r = await api.get(LEGACY, { params: { q } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
const nativeSearch = async (api: APIRequestContext, q: string) => {
  const r = await api.get(`${NATIVE}/search`, { params: { q } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};

test('搜尋（管理者）：新舊逐筆相同（含編號開頭優先、20 與 10 的上限）；非管理者與特殊字元為已登記差異', async () => {
  test.setTimeout(240_000);
  const p = productPrefix();
  const seeds = [
    ...Array.from({ length: 25 }, (_, i) => ({ product_code: `${p}-P-${String(i).padStart(2, '0')}`, product_name: `對等商品${i}`, unit: '瓶', is_active: true })),
    ...Array.from({ length: 14 }, (_, i) => ({ product_code: `${p}-N-${String(i).padStart(2, '0')}`, product_name: `含關鍵字帕里${i}`, unit: '盒', is_active: true })),
    { product_code: `${p}-X-OFF`, product_name: '含關鍵字帕里停用', unit: '', is_active: false },
    { product_code: `${p}-S-1`, product_name: '含逗號,與(括號)商品', unit: '', is_active: true },
    { product_code: `${p}-S-2`, product_name: '百分之100%與100X', unit: '', is_active: true },
  ];
  expect((await db.from('products_master').insert(seeds)).error).toBeNull();
  const diffs: Diff[] = [];
  const queries = [`${p}-P-`, `${p}-P-1`, `${p}-N-`, '帕里', `${p.toLowerCase()}-p-0`, '對等商品2', `${p}-ZZZ`, 'ZT2038-T'];
  for (const q of queries) {
    const l = await legacySearch(admin, q);
    const n = await nativeSearch(admin, q);
    expect(l.status, `舊 ${q}`).toBe(200);
    expect(n.status, `新 ${q}`).toBe(200);
    diffs.push(...sameRows(`search:${q}`, l.body.data.map((r: any) => [r.product_code, r.product_name, r.unit]), n.body.data.map((r: any) => [r.product_code, r.product_name, r.unit])));
    expect(n.body.data.length).toBeLessThanOrEqual(20);
  }
  const r = rec('search-manager', '商品搜尋（管理者）：新舊逐筆（含順序）相同', 'admin', diffs, { queries: queries.length });
  expect(r.status).toBe('pass');

  // 非管理者：舊版被資料表權限（RLS）擋成空；新版登入即可搜尋（B1）
  const ln = await legacySearch(storeManager, `${p}-P-0`);
  const nn = await nativeSearch(storeManager, `${p}-P-0`);
  expect(nn.status).toBe(200);
  expect(nn.body.data.length).toBeGreaterThan(0);
  const d2: Diff[] = ln.status === 200 && ln.body.data.length === 0 ? [{ kind: 'changed', key: 'search-non-manager', legacy: '0 筆（資料表權限擋下）', native: `${nn.body.data.length} 筆` }] : sameRows('search-non-manager', ln.body.data, nn.body.data);
  rec('search-non-manager', '商品搜尋（無商品主檔權限的店長）：舊版查不到，新版登入即可搜尋', 'store_manager', d2, { legacyRows: ln.body?.data?.length ?? -1, nativeRows: nn.body.data.length });

  // 特殊字元：舊版把 q 直接組進 or() 字串
  const d3: Diff[] = [];
  const special = ['含逗號,與(括號)', '100%', 'x,product_name.ilike.%', '),(product_code.ilike.%'];
  for (const q of special) {
    const l = await legacySearch(admin, q);
    const n = await nativeSearch(admin, q);
    expect(n.status, `新 ${q}`).toBe(200);
    const lrows = l.status === 200 ? l.body.data.map((x: any) => x.product_code) : `HTTP ${l.status}`;
    const nrows = n.body.data.map((x: any) => x.product_code);
    d3.push(...sameRows(`special:${q}`, lrows, nrows));
  }
  // 確認新版對 % 是字面字元：只命中「百分之100%與100X」
  expect((await nativeSearch(admin, '100%')).body.data.map((x: any) => x.product_code)).toEqual([`${p}-S-2`]);
  expect((await nativeSearch(admin, 'x,product_name.ilike.%')).body.data).toEqual([]);
  rec('search-special-chars', '商品搜尋含逗號、括號、百分比：舊版改寫條件，新版當一般文字', 'admin', d3, { queries: special.length });
});

test('清單：舊版一次全部（無分頁）；新版每頁 50 筆，所有頁合起來的編號集合與舊版相同', async () => {
  test.setTimeout(180_000);
  const p = productPrefix();
  const bulk = Array.from({ length: 130 }, (_, i) => ({ product_code: `${p}-A-${String(i).padStart(3, '0')}`, product_name: `清單對等${i}`, unit: '', is_active: i % 13 !== 0 }));
  expect((await db.from('products_master').insert(bulk)).error).toBeNull();
  const l = await admin.get(LEGACY, { params: { all: '1' } });
  expect(l.status()).toBe(200);
  const legacyCodes: string[] = (await l.json()).data.map((r: any) => r.product_code);
  const nativeCodes: string[] = [];
  let page = 1;
  for (;;) {
    const body = await (await admin.get(NATIVE, { params: { page: String(page) } })).json();
    nativeCodes.push(...body.items.map((r: any) => r.product_code));
    if (page >= body.pageCount) break;
    page += 1;
  }
  const diffs: Diff[] = [...sameRows('list-codes', [...legacyCodes].sort(), [...nativeCodes].sort())];
  diffs.push({ kind: 'changed', key: 'list-pagination', legacy: `一次回傳全部 ${legacyCodes.length} 筆`, native: `每頁 50 筆，共 ${page} 頁` });
  expect(page).toBeGreaterThanOrEqual(3);
  rec('list-all', '商品主檔清單：舊版無分頁，新版每頁 50 筆（編號集合相同）', 'admin', diffs, { legacyRows: legacyCodes.length, nativeRows: nativeCodes.length });
});

test('同一份 Excel：舊版一步寫入、新版預覽後確認，資料表最後相同；檔內重複與相同內容為已登記差異', async () => {
  test.setTimeout(240_000);
  const p = productPrefix();
  const code = (side: 'L' | 'N', t: string) => `${p}-I${side}-${t}`;
  const seed = (side: 'L' | 'N') => [
    { product_code: code(side, 'UPD'), product_name: '舊名稱', unit: '瓶', is_active: true },
    { product_code: code(side, 'OFF'), product_name: '停用商品', unit: '條', is_active: false },
    { product_code: code(side, 'SAME'), product_name: '相同', unit: '盒', is_active: true },
  ];
  expect((await db.from('products_master').insert([...seed('L'), ...seed('N')])).error).toBeNull();
  const aoa = (side: 'L' | 'N', extra: (string | number)[][] = []) => [
    ['商品編號', '品名', 'unit'],
    [code(side, 'UPD'), '新名稱', '瓶'],
    [code(side, 'OFF'), '停用商品', '條'],
    [code(side, 'SAME'), '相同', '盒'],
    [code(side, 'NEW'), '全新商品', ''],
    [code(side, 'NEW2'), '第二個新商品', '個'],
    ...extra,
  ];
  const rowsOf = (data: (string | number)[][]) => {
    const [head, ...body] = data;
    const x = XLSX.read(sheet([head, ...body]), { type: 'buffer' });
    return (XLSX.utils.sheet_to_json(x.Sheets[x.SheetNames[0]], { defval: '' }) as Record<string, unknown>[]).map((r, i) => ({ row: i + 2, code: String(r['商品編號'] ?? '').trim(), name: String(r['品名'] ?? '').trim(), unit: String(r['unit'] ?? '').trim() }));
  };
  // 舊版
  const lr = await legacyImport(manager, sheet(aoa('L')));
  const lbody = lr.body;
  expect(lr.status, JSON.stringify(lbody)).toBe(200);
  // 新版：預覽（不寫入）後確認
  const nrows = rowsOf(aoa('N'));
  const pv = await (await manager.post(`${NATIVE}/import/preview`, { data: { rows: nrows } })).json();
  expect((await db.from('products_master').select('product_code').eq('product_code', code('N', 'NEW')).maybeSingle()).data).toBeNull();
  const nr = await manager.post(`${NATIVE}/import`, { data: { rows: nrows } });
  expect(nr.status()).toBe(200);
  const nbody = await nr.json();
  const snapshot = async (side: 'L' | 'N') =>
    ((await db.from('products_master').select('product_code,product_name,unit,is_active').like('product_code', `${p}-I${side}-%`).order('product_code')).data || []).map((r: any) => [r.product_code.slice(`${p}-I${side}-`.length), r.product_name, r.unit, r.is_active]);
  const lsnap = await snapshot('L');
  const nsnap = await snapshot('N');
  expect(lsnap.length).toBe(5);
  const diffs: Diff[] = sameRows('final-table', lsnap, nsnap);
  const r1 = rec('import-final-state', '同一份 Excel（別名欄位、更新、停用商品、新增）匯入後的資料表內容', 'pm_manage', diffs, { rows: lsnap.length }, 'write-readback');
  expect(r1.status).toBe('pass');
  expect(lsnap.find((x) => x[0] === 'OFF')![3]).toBe(true); // 停用商品被重新啟用（兩版相同）

  // 流程與計數差異
  rec('import-flow-preview', '匯入流程：舊版選檔後直接寫入；新版先顯示預覽（新增、更新、略過、重新啟用）再確認', 'pm_manage', [
    { kind: 'changed', key: 'preview-step', legacy: '一步直接寫入', native: `預覽：新增 ${pv.counts.inserted}、更新 ${pv.counts.updated}（重新啟用 ${pv.counts.reactivated}）、略過 ${pv.counts.skipped}，確認後才寫入` },
  ], { previewInserted: pv.counts.inserted, previewUpdated: pv.counts.updated }, 'write-readback');
  rec('import-count-semantics', '匯入結果數字：舊版回「處理幾筆」（含相同內容），新版把內容相同的列算略過', 'pm_manage', [
    { kind: 'changed', key: 'result-count', legacy: `count=${lbody.count}`, native: `寫入 ${nbody.count} 筆，略過 ${nbody.counts.skipped} 筆（內容相同）` },
  ], { legacyCount: lbody.count, nativeCount: nbody.count, legacyVia: lr.via }, 'write-readback');
  expect(lbody.count).toBe(5);
  expect(nbody.count).toBe(4);

  // 檔內重複編號與缺名稱列
  const dupAoa = (side: 'L' | 'N') => [['商品編號', '商品名稱', '單位'], [code(side, 'DUP'), '第一列', ''], [code(side, 'DUP'), '第二列', '包'], [code(side, 'OK'), '正常商品', ''], [code(side, 'NONAME'), '', '']];
  const ld = await legacyImport(manager, sheet(dupAoa('L')));
  const dupRows = rowsOf(dupAoa('N').map((r, i) => (i === 0 ? ['商品編號', '品名', 'unit'] : r)));
  const nd = await manager.post(`${NATIVE}/import`, { data: { rows: dupRows } });
  expect(nd.status()).toBe(200);
  const afterL = await snapshot('L');
  const afterN = await snapshot('N');
  const legacyDup = { status: ld.status, dup: afterL.find((x) => x[0] === 'DUP') || null, ok: afterL.some((x) => x[0] === 'OK') };
  const nativeDup = { status: nd.status(), dup: afterN.find((x) => x[0] === 'DUP') || null, ok: afterN.some((x) => x[0] === 'OK') };
  expect(nativeDup.dup).toEqual(['DUP', '第二列', '包', true]); // 檔內重複：只採用最後一列
  expect(nativeDup.ok).toBe(true);
  expect(afterN.some((x) => x[0] === 'NONAME')).toBe(false);
  expect(afterL.some((x) => x[0] === 'NONAME')).toBe(false); // 缺名稱列兩版都不寫入（舊版默默丟掉、新版會列在預覽的略過原因）
  rec('import-duplicate-in-file', '檔內有重複商品編號：舊版同批 upsert 出錯，新版採用最後一列並在預覽列出', 'pm_manage', sameRows('dup-in-file', legacyDup, nativeDup), { legacyStatus: legacyDup.status, nativeStatus: nativeDup.status }, 'write-readback');
});

test('停用與重新啟用、單筆新增與編輯：停用最終狀態相同；舊版無權限檢查但被資料表權限擋下；新增編輯與重新啟用為新版新增', async () => {
  test.setTimeout(180_000);
  const p = productPrefix();
  const mk = (t: string) => `${p}-D-${t}`;
  expect((await db.from('products_master').insert([mk('1'), mk('2'), mk('3')].map((c) => ({ product_code: c, product_name: `停用對等${c}`, unit: '', is_active: true })))).error).toBeNull();
  const state = async (c: string) => (await db.from('products_master').select('is_active').eq('product_code', c).single()).data.is_active as boolean;
  const idOf = async (c: string) => (await db.from('products_master').select('id').eq('product_code', c).single()).data.id as string;
  // 管理者：舊版 DELETE、新版 deactivate，結果相同
  expect((await manager.delete(LEGACY, { params: { product_code: mk('1') } })).status()).toBe(200);
  expect((await manager.post(`${NATIVE}/${await idOf(mk('2'))}/deactivate`)).status()).toBe(200);
  const r1 = rec('deactivate-manager', '停用商品（管理者）：最終狀態相同', 'pm_manage', sameRows('is_active', await state(mk('1')), await state(mk('2'))), { legacy: String(await state(mk('1'))), native: String(await state(mk('2'))) }, 'write-readback');
  expect(r1.status).toBe('pass');
  // 非管理者（店長，無商品主檔權限）
  const l = await storeManager.delete(LEGACY, { params: { product_code: mk('3') } });
  const legacyAfter = await state(mk('3'));
  const n = await storeManager.post(`${NATIVE}/${await idOf(mk('3'))}/deactivate`);
  const nativeAfter = await state(mk('3'));
  expect(n.status()).toBe(403);
  expect(nativeAfter).toBe(true);
  rec('deactivate-non-manager', '停用商品（無商品主檔權限的店長）：舊版沒有權限檢查（靠資料表權限默默擋下仍回成功），新版明確回 403', 'store_manager', [
    { kind: 'status', key: 'http-status', legacy: l.status(), native: n.status(), detail: `舊版回傳 ${l.status()}，商品是否被停用：${legacyAfter ? '否' : '是'}` },
  ], { legacyStatus: l.status(), legacyStillActive: legacyAfter, nativeStatus: n.status() }, 'write-readback');

  // 新版才有：單筆新增、編輯、重新啟用
  rec('reactivate-edit-create-new', '單筆新增、編輯（編號不可改）與重新啟用：舊版沒有，新版新增', 'pm_manage', [
    { kind: 'only-native', key: 'create-product', native: 'POST /api/workspace/products-master' },
    { kind: 'only-native', key: 'edit-product', native: 'PATCH /api/workspace/products-master/:id' },
    { kind: 'only-native', key: 'reactivate-product', native: 'POST /api/workspace/products-master/:id/reactivate' },
  ], {}, 'write-readback');
});

test('畫面：舊頁有「併購藥局商品主檔整理」分頁，新頁沒有任何併購內容', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const lp = await ctx.newPage();
    await lp.goto('/cross-dept/products-master', { waitUntil: 'networkidle' });
    const legacyText = await lp.locator('body').innerText();
    await lp.close();
    const np = await ctx.newPage();
    await np.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await np.click('.menu-toggle');
    const menuText = await np.locator('.workspace-menu').innerText();
    await np.locator('.workspace-menu button.catalog-item[title="商品主檔"]').click();
    await expect(np.getByRole('heading', { name: '商品主檔', exact: true })).toBeVisible();
    const nativeText = await np.locator('.products-master-page').innerText();
    const diffs: Diff[] = [];
    if (legacyText.includes('併購') && !nativeText.includes('併購') && !menuText.includes('併購'))
      diffs.push({ kind: 'only-legacy', key: 'acquisition-tab', legacy: '併購藥局商品主檔整理分頁', native: '無' });
    else if (legacyText.includes('併購') !== nativeText.includes('併購')) diffs.push({ kind: 'changed', key: 'acquisition-tab', legacy: legacyText.includes('併購'), native: nativeText.includes('併購') });
    expect(nativeText).not.toContain('併購');
    expect(menuText).not.toContain('併購');
    expect(legacyText).toContain('併購');
    rec('acquisition-tab', '併購藥局商品主檔整理分頁：新版不移植（B5）', 'admin', diffs, { legacyHasTab: legacyText.includes('併購'), nativeHasTab: nativeText.includes('併購') }, 'ui-extract');
  } finally {
    await ctx.close();
  }
});
