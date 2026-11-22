import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Products, productCode, productPrefix, runIdOrThrow, setupM6Users, type M6User } from '../support/m6-fixtures';

/**
 * M6 第二批 W27/W28：商品主檔 workspace API 的角色與權限劇本（正式區 has_permission 語意）。
 * 帳號：admin、pm_manage（只有 store.products_master.manage、非 admin）、pm_plain（一般帳號）、store_manager、denied、employee。
 * 規則：搜尋登入即可（B1）；清單、新增、編輯、停用、重新啟用、匯入預覽與匯入只有管理權限（B2、B3）。
 * 測試商品編號 ZT2038-<runId>-…，只刪自己的；匯入與停用的操作紀錄以 actor 與編號驗證。
 */
const API = '/api/workspace/products-master';
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
const apis: Record<string, APIRequestContext> = {};
let anon: APIRequestContext;
const db = adminDb();

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Products();
  ({ users, teardown } = await setupM6Users(['pm_manage', 'pm_plain']));
  for (const key of ['admin', 'store_manager', 'denied', 'employee']) apis[key] = await apiAs(key);
  apis.pm_manage = await apiForUser(users.pm_manage);
  apis.pm_plain = await apiForUser(users.pm_plain);
  anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  await anon.dispose();
  await cleanupM6Products();
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});

const MANAGERS = ['admin', 'pm_manage'];
const NON_MANAGERS = ['pm_plain', 'store_manager', 'denied', 'employee'];
const rowsOf = (codes: [string, string, string?][]) => codes.map(([code, name, unit], i) => ({ row: i + 2, code, name, unit: unit ?? '' }));
const productByCode = async (code: string) => (await db.from('products_master').select('*').eq('product_code', code).maybeSingle()).data;
const logsFor = async (pattern: string) => ((await db.from('products_master_operation_logs').select('*').like('product_code', pattern)).data || []) as any[];

test('導覽與 capabilities：只有管理權限者看得到「商品主檔」且在工作頁內開啟（kind）', async () => {
  for (const key of [...MANAGERS, ...NON_MANAGERS]) {
    const session = await (await apis[key].get('/api/workspace/session')).json();
    const expected = MANAGERS.includes(key);
    expect(session.capabilities.productsMaster, `${key} capabilities`).toBe(expected);
    const items = session.navigation.flatMap((g: { items: { href: string; kind?: string }[] }) => g.items);
    const item = items.find((i: { href: string }) => i.href === '/cross-dept/products-master');
    expect(!!item, `${key} 導覽「商品主檔」`).toBe(expected);
    if (item) expect(item.kind).toBe('products-master');
    for (const i of items) expect(JSON.stringify(i)).not.toContain('併購');
  }
});

test('未登入：全部 401；寫入 API 檢查 Origin（403）', async () => {
  const bare = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await bare.get(`${API}/search?q=a`)).status()).toBe(401);
    expect((await bare.get(API)).status()).toBe(401);
    expect((await bare.post(API, { data: {} })).status()).toBe(401);
    expect((await bare.post(`${API}/import/preview`, { data: { rows: [] } })).status()).toBe(401);
  } finally {
    await bare.dispose();
  }
  const bad = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.pm_manage.storageState(), extraHTTPHeaders: { Origin: 'http://invalid.test' } });
  try {
    expect((await bad.post(API, { data: { product_code: productCode('ORIG'), product_name: 'x' } })).status()).toBe(403);
    expect((await bad.post(`${API}/import`, { data: { rows: rowsOf([[productCode('ORIG'), 'x']]) } })).status()).toBe(403);
    expect((await bad.patch(`${API}/00000000-0000-4000-8000-000000000000`, { data: { product_name: 'x' } })).status()).toBe(403);
  } finally {
    await bad.dispose();
  }
  expect(await productByCode(productCode('ORIG'))).toBeNull();
});

test('搜尋：登入就能用（含無商品主檔權限者）；只含啟用商品；編號開頭優先；特殊字元被跳脫', async () => {
  const p = productPrefix();
  const A = productCode('S-A'); // 編號含 S-A
  const seeds = [
    { product_code: A, product_name: '搜尋甲 100% 純', unit: '瓶', is_active: true },
    { product_code: productCode('S-B'), product_name: '搜尋乙 100X 純', unit: '盒', is_active: true },
    { product_code: productCode('S-C'), product_name: '含逗號,與(括號)', unit: '', is_active: true },
    { product_code: productCode('S-D'), product_name: '停用的搜尋丁', unit: '', is_active: false },
    { product_code: productCode('S-U'), product_name: '底線_商品', unit: '', is_active: true },
    { product_code: productCode('S-V'), product_name: '底線X商品', unit: '', is_active: true },
  ];
  expect((await db.from('products_master').insert(seeds)).error).toBeNull();
  const search = async (key: string, q: string) => {
    const r = await apis[key].get(`${API}/search`, { params: { q } });
    expect(r.status(), `${key} 搜尋 ${q}`).toBe(200);
    const body = await r.json();
    expect(body.success).toBe(true);
    return body.data as { product_code: string; product_name: string; unit: string }[];
  };
  for (const key of [...MANAGERS, ...NON_MANAGERS]) {
    const hits = await search(key, `${p}-S-`);
    expect(hits.map((h) => h.product_code).sort(), `${key} 編號開頭`).toEqual(seeds.filter((s) => s.is_active).map((s) => s.product_code).sort());
    // 回傳只有編號、名稱、單位
    expect(Object.keys(hits[0]).sort()).toEqual(['product_code', 'product_name', 'unit']);
  }
  // 名稱包含（編號不是開頭）
  expect((await search('pm_plain', '搜尋甲')).map((h) => h.product_code)).toEqual([A]);
  // 停用的不會出現
  expect(await search('pm_plain', '停用的搜尋丁')).toEqual([]);
  // % 是字面字元：100% 只命中甲，不會把乙（100X）也撈出來
  expect((await search('pm_plain', '100%')).map((h) => h.product_code)).toEqual([A]);
  // _ 是字面字元
  expect((await search('pm_plain', '底線_')).map((h) => h.product_code)).toEqual([productCode('S-U')]);
  // 逗號、括號當一般文字，不會改寫條件
  expect((await search('pm_plain', '含逗號,與(括號)')).map((h) => h.product_code)).toEqual([productCode('S-C')]);
  expect(await search('pm_plain', 'x,product_name.ilike.%')).toEqual([]);
  expect(await search('pm_plain', '),(product_code.ilike.%')).toEqual([]);
  expect(await search('pm_plain', '')).toEqual([]);
  // 編號開頭優先於「名稱包含」
  const prefixFirst = await search('pm_plain', `${p}-S-A`);
  expect(prefixFirst[0].product_code).toBe(A);
  // 最多 20 筆
  const bulk = Array.from({ length: 30 }, (_, i) => ({ product_code: productCode(`LIM-${String(i).padStart(2, '0')}`), product_name: `上限測試${i}`, unit: '', is_active: true }));
  expect((await db.from('products_master').insert(bulk)).error).toBeNull();
  expect((await search('pm_plain', `${p}-LIM-`)).length).toBe(20);
  expect((await search('pm_plain', '上限測試')).length).toBeLessThanOrEqual(20);
});

test('清單：只有管理權限；每頁 50、分頁、搜尋、「顯示已停用」', async () => {
  for (const key of NON_MANAGERS) expect((await apis[key].get(API)).status(), `${key} 清單`).toBe(403);
  const p = productPrefix();
  const bulk = Array.from({ length: 120 }, (_, i) => ({ product_code: `${p}-L-${String(i).padStart(3, '0')}`, product_name: `清單測試${i}`, unit: '', is_active: i % 10 !== 0 }));
  expect((await db.from('products_master').insert(bulk)).error).toBeNull();
  for (const key of MANAGERS) {
    const list = async (params: Record<string, string>) => {
      const r = await apis[key].get(API, { params });
      expect(r.status()).toBe(200);
      return r.json();
    };
    const all = await list({ q: `${p}-L-`, include_inactive: '1' });
    expect(all).toMatchObject({ total: 120, page: 1, pageSize: 50, pageCount: 3, capabilities: { manage: true } });
    expect(all.items).toHaveLength(50);
    expect((await list({ q: `${p}-L-`, include_inactive: '1', page: '3' })).items).toHaveLength(20);
    const activeOnly = await list({ q: `${p}-L-` });
    expect(activeOnly.total).toBe(108);
    expect(activeOnly.items.every((i: { is_active: boolean }) => i.is_active)).toBe(true);
    expect(Object.keys(all.items[0]).sort()).toEqual(['id', 'is_active', 'product_code', 'product_name', 'unit']);
    // 搜尋特殊字元不會改寫條件也不出錯
    for (const q of ['a,b', '(x)', '"q"', "o'k", '50%', 'a*b', '清單測試5']) expect((await apis[key].get(API, { params: { q } })).status(), `${key} q=${q}`).toBe(200);
    expect((await list({ q: '清單測試5', include_inactive: '1' })).items.every((i: { product_name: string }) => i.product_name.includes('清單測試5'))).toBe(true);
  }
  // 超出頁數：回最後一頁、不報錯
  const beyond = await (await apis.pm_manage.get(API, { params: { q: `${p}-L-`, page: '99' } })).json();
  expect(beyond).toMatchObject({ page: 3, pageCount: 3 });
  expect(beyond.items).toHaveLength(8);
});

test('新增、編輯（編號不可改）、停用、重新啟用：管理者可，其他角色 403；留操作紀錄', async () => {
  const code = productCode('CRUD');
  for (const key of NON_MANAGERS) {
    expect((await apis[key].post(API, { data: { product_code: code, product_name: '不該建立' } })).status(), `${key} 新增`).toBe(403);
    expect((await apis[key].patch(`${API}/00000000-0000-4000-8000-000000000000`, { data: { product_name: 'x' } })).status(), `${key} 編輯`).toBe(403);
    expect((await apis[key].post(`${API}/00000000-0000-4000-8000-000000000000/deactivate`)).status(), `${key} 停用`).toBe(403);
    expect((await apis[key].post(`${API}/00000000-0000-4000-8000-000000000000/reactivate`)).status(), `${key} 重新啟用`).toBe(403);
  }
  expect(await productByCode(code)).toBeNull();
  const api = apis.pm_manage;
  // 驗證
  expect((await api.post(API, { data: { product_name: 'x' } })).status()).toBe(400);
  expect((await api.post(API, { data: { product_code: code } })).status()).toBe(400);
  expect((await api.post(API, { data: { product_code: 'x'.repeat(65), product_name: 'x' } })).status()).toBe(400);
  expect((await api.post(API, { data: { product_code: code, product_name: 'n'.repeat(201) } })).status()).toBe(400);
  // 新增
  const created = await api.post(API, { data: { product_code: ` ${code} `, product_name: ' 測試商品 ', unit: ' 瓶 ' } });
  expect(created.status()).toBe(201);
  const product = (await created.json()).product;
  expect(product).toMatchObject({ product_code: code, product_name: '測試商品', unit: '瓶', is_active: true });
  expect((await api.post(API, { data: { product_code: code, product_name: '重複' } })).status()).toBe(409);
  // 編輯：編號不可改，名稱單位可改
  const bad = await api.patch(`${API}/${product.id}`, { data: { product_code: `${code}-X`, product_name: '改名' } });
  expect(bad.status()).toBe(400);
  expect(await productByCode(code)).toMatchObject({ product_name: '測試商品' });
  expect((await api.patch(`${API}/${product.id}`, { data: { product_name: '' } })).status()).toBe(400);
  const edited = await api.patch(`${API}/${product.id}`, { data: { product_code: code, product_name: '改過的名稱', unit: '盒' } });
  expect(edited.status()).toBe(200);
  expect(await productByCode(code)).toMatchObject({ product_code: code, product_name: '改過的名稱', unit: '盒', is_active: true });
  expect((await api.patch(`${API}/not-a-uuid`, { data: { product_name: 'x' } })).status()).toBe(400);
  expect((await api.patch(`${API}/00000000-0000-4000-8000-000000000000`, { data: { product_name: 'x' } })).status()).toBe(404);
  // 停用：搜尋不再出現、清單預設不顯示、勾「顯示已停用」才看得到
  const off = await api.post(`${API}/${product.id}/deactivate`);
  expect(off.status()).toBe(200);
  expect((await off.json()).changed).toBe(true);
  expect(await productByCode(code)).toMatchObject({ is_active: false });
  expect(((await (await apis.pm_plain.get(`${API}/search`, { params: { q: code } })).json()).data as unknown[]).length).toBe(0);
  expect((await (await api.get(API, { params: { q: code } })).json()).total).toBe(0);
  expect((await (await api.get(API, { params: { q: code, include_inactive: '1' } })).json()).total).toBe(1);
  expect((await (await api.post(`${API}/${product.id}/deactivate`)).json()).changed).toBe(false); // 重複停用不重複寫入
  // 重新啟用
  const on = await api.post(`${API}/${product.id}/reactivate`);
  expect(on.status()).toBe(200);
  expect(await productByCode(code)).toMatchObject({ is_active: true });
  expect(((await (await apis.pm_plain.get(`${API}/search`, { params: { q: code } })).json()).data as unknown[]).length).toBe(1);
  // 操作紀錄：誰、何時、動作
  const logs = await logsFor(code);
  expect(logs.map((l) => l.action).sort()).toEqual(['create', 'deactivate', 'reactivate', 'update']);
  expect(logs.every((l) => l.actor_id === users.pm_manage.id && l.created_at)).toBe(true);
});

test('Excel 匯入：預覽不寫入；確認後寫入；停用商品復活；超過 5000 筆與格式錯誤被擋；寫操作紀錄', async () => {
  const api = apis.pm_manage;
  const c = (t: string) => productCode(`I-${t}`);
  expect((await db.from('products_master').insert([
    { product_code: c('OLD'), product_name: '舊名稱', unit: '瓶', is_active: true },
    { product_code: c('SAME'), product_name: '相同', unit: '盒', is_active: true },
    { product_code: c('OFF'), product_name: '停用商品', unit: '條', is_active: false },
  ])).error).toBeNull();
  for (const key of NON_MANAGERS) {
    expect((await apis[key].post(`${API}/import/preview`, { data: { rows: rowsOf([[c('NEW'), 'x']]) } })).status(), `${key} 預覽`).toBe(403);
    expect((await apis[key].post(`${API}/import`, { data: { rows: rowsOf([[c('NEW'), 'x']]) } })).status(), `${key} 匯入`).toBe(403);
  }
  const rows = rowsOf([
    [c('OLD'), '新名稱', '瓶'],
    [c('SAME'), '相同', '盒'],
    [c('OFF'), '停用商品', '條'],
    [c('NEW'), '全新商品', '個'],
    ['', '缺編號', ''],
    [c('NONAME'), '', ''],
    [c('DUP'), '第一列', ''],
    [c('DUP'), '第二列', '包'],
  ]);
  const before = await db.from('products_master').select('product_code', { count: 'exact', head: true }).like('product_code', `${productPrefix()}-I-%`);
  const preview = await api.post(`${API}/import/preview`, { data: { rows } });
  expect(preview.status()).toBe(200);
  const pv = await preview.json();
  expect(pv.counts).toEqual({ total: 8, inserted: 2, updated: 2, reactivated: 1, skipped: 4 });
  expect(pv.updates.find((u: { code: string }) => u.code === c('OFF')).reactivate).toBe(true);
  expect(pv.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual(['duplicate_in_file', 'missing_code', 'missing_name', 'unchanged']);
  // 預覽完全沒有寫入，也沒有操作紀錄
  const after = await db.from('products_master').select('product_code', { count: 'exact', head: true }).like('product_code', `${productPrefix()}-I-%`);
  expect(after.count).toBe(before.count);
  expect(await productByCode(c('NEW'))).toBeNull();
  expect(await productByCode(c('OFF'))).toMatchObject({ is_active: false });
  const importLogsBefore = ((await db.from('products_master_operation_logs').select('id').eq('action', 'import').eq('actor_id', users.pm_manage.id)).data || []).length;
  expect(importLogsBefore).toBe(0);
  // 確認匯入
  const done = await api.post(`${API}/import`, { data: { rows } });
  expect(done.status()).toBe(200);
  expect(await done.json()).toMatchObject({ success: true, count: 4, counts: { inserted: 2, updated: 2, reactivated: 1, skipped: 4 } });
  expect(await productByCode(c('OLD'))).toMatchObject({ product_name: '新名稱' });
  expect(await productByCode(c('OFF'))).toMatchObject({ is_active: true, product_name: '停用商品' });
  expect(await productByCode(c('NEW'))).toMatchObject({ product_name: '全新商品', unit: '個', is_active: true });
  expect(await productByCode(c('DUP'))).toMatchObject({ product_name: '第二列', unit: '包' });
  expect(await productByCode(c('NONAME'))).toBeNull();
  const imp = ((await db.from('products_master_operation_logs').select('*').eq('action', 'import').eq('actor_id', users.pm_manage.id)).data || []) as any[];
  expect(imp).toHaveLength(1);
  expect(imp[0]).toMatchObject({ row_count: 4 });
  expect(imp[0].detail.counts.reactivated).toBe(1);
  // 再匯入同一份：全部相同或略過，不再寫入
  const again = await (await api.post(`${API}/import/preview`, { data: { rows } })).json();
  expect(again.counts).toMatchObject({ inserted: 0, updated: 0 });

  // 大量：1100 筆（分 3 批 500/500/100 寫入）
  const big = Array.from({ length: 1100 }, (_, i) => ({ row: i + 2, code: productCode(`B-${String(i).padStart(4, '0')}`), name: `大量${i}`, unit: '個' }));
  const bigRes = await api.post(`${API}/import`, { data: { rows: big }, timeout: 120_000 });
  expect(bigRes.status()).toBe(200);
  expect((await bigRes.json()).count).toBe(1100);
  const written = await db.from('products_master').select('product_code', { count: 'exact', head: true }).like('product_code', `${productPrefix()}-B-%`);
  expect(written.count).toBe(1100);
  // 5000 筆上限
  const tooMany = Array.from({ length: 5001 }, (_, i) => ({ row: i + 2, code: `X${i}`, name: 'x', unit: '' }));
  const capped = await api.post(`${API}/import/preview`, { data: { rows: tooMany }, timeout: 60_000 });
  expect(capped.status()).toBe(400);
  expect((await capped.json()).error).toContain('5000');
  // 格式錯誤
  expect((await api.post(`${API}/import/preview`, { data: { rows: [] } })).status()).toBe(400);
  expect((await api.post(`${API}/import/preview`, { data: {} })).status()).toBe(400);
  expect((await api.post(`${API}/import/preview`, { data: { rows: rowsOf([['', '', '']]) } })).status()).toBe(400);
  expect((await api.post(`${API}/import/preview`, { data: [] })).status()).toBe(400);
});

test('權限語意（正式區 has_permission）：不看 roles.is_active；user_roles 失效即失去；app 層 admin 後備才可繞過', async () => {
  const uid = users.pm_manage.id;
  const roleId = (await db.from('roles').select('id').eq('code', 'm6_test_pm_manage').single()).data.id as string;
  try {
    // roles.is_active=false 仍有權限（正式區不檢查）
    await db.from('roles').update({ is_active: false }).eq('id', roleId);
    expect((await apis.pm_manage.get(API)).status()).toBe(200);
    // user_roles 失效 -> 403
    await db.from('user_roles').update({ is_active: false }).eq('user_id', uid).eq('role_id', roleId);
    expect((await apis.pm_manage.get(API)).status()).toBe(403);
    await db.from('user_roles').update({ is_active: true }).eq('user_id', uid).eq('role_id', roleId);
    // role_permissions.is_allowed=false -> 403
    await db.from('role_permissions').update({ is_allowed: false }).eq('role_id', roleId);
    expect((await apis.pm_manage.get(API)).status()).toBe(403);
    await db.from('role_permissions').update({ is_allowed: true }).eq('role_id', roleId);
    expect((await apis.pm_manage.get(API)).status()).toBe(200);
    // 一般帳號：profiles.role=admin 的應用層後備
    expect((await apis.pm_plain.get(API)).status()).toBe(403);
    await db.from('profiles').update({ role: 'admin' }).eq('id', users.pm_plain.id);
    expect((await apis.pm_plain.get(API)).status()).toBe(200);
  } finally {
    await db.from('profiles').update({ role: 'member' }).eq('id', users.pm_plain.id);
    await db.from('roles').update({ is_active: true }).eq('id', roleId);
    await db.from('user_roles').update({ is_active: true }).eq('user_id', uid).eq('role_id', roleId);
    await db.from('role_permissions').update({ is_allowed: true }).eq('role_id', roleId);
  }
  expect((await apis.pm_plain.get(API)).status()).toBe(403);
});
