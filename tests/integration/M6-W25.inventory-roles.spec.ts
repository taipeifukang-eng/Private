import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { apiForUser, cleanupM6InventoryResults, inventoryResultFileName, inventoryResultXlsx, runIdOrThrow, setupM6Users, type M6User } from '../support/m6-fixtures';

/**
 * M6 第一批 W25 盤點：角色劇本（盤點組、店長、督導、無權限）下，workspace /api/workspace/inventory 與舊 /api/inventory/result-analysis
 * 的狀態碼與回傳逐項相同；並驗證 2026-11-22 盤點權限問卷：匯入只認 inventory.result_analysis.import、刪除只認 .delete（檢視權限與 inventory.manage 不隱含），新舊 API 一致。
 * 分析端（匯入、查詢、報表視圖、差異原因、門檻、刪除批次）只做新舊對等與權限測試，不改邏輯。
 * 除「真的匯入與刪除」一組外只讀或只送一定會被拒絕的請求；真實匯入用 2038-03、VW001、檔名 m6w25perm-<runId>-…，只刪自己的。
 */
type Account = { key: string; kind: string; expected: { capabilities: Record<string, boolean> } };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
const SUBJECTS = ['admin', 'inventory_team', 'inventory_view', 'inventory_edit', 'inventory_delete', 'navigation', 'store_manager', 'acting_manager', 'supervisor', 'ga_staff', 'denied', 'employee'];
const LEGACY = '/api/inventory/result-analysis';
const NATIVE = '/api/workspace/inventory';
const ZERO = '00000000-0000-4000-8000-000000000000';

const apis: Record<string, APIRequestContext> = {};
test.beforeAll(async () => {
  for (const key of SUBJECTS) apis[key] = await apiAs(key);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
});

const json = async (r: { json(): Promise<unknown>; text(): Promise<string> }) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

test('查詢：新舊 API 對每個角色狀態碼相同；有權限者回傳 deep equal；無權限被擋（無入口）', async () => {
  test.setTimeout(180_000);
  for (const key of SUBJECTS) {
    const legacy = await apis[key].get(LEGACY);
    const native = await apis[key].get(NATIVE);
    expect(native.status(), `${key} 狀態碼`).toBe(legacy.status());
    if (legacy.status() === 200) expect(await json(native), `${key} 回傳`).toEqual(await json(legacy));
    // 有導覽入口 <=> 舊版 API 回 200 或有 view_own（navigation 帳號）
    const session = await (await apis[key].get('/api/workspace/session')).json();
    const expected = accounts.find((a) => a.key === key)!.expected.capabilities.inventory;
    expect(session.capabilities.inventory, `${key} capabilities.inventory`).toBe(expected);
    const hrefs: string[] = session.navigation.flatMap((g: { items: { href: string }[] }) => g.items.map((i) => i.href));
    expect(hrefs.includes('/inventory'), `${key} 導覽「盤點管理」`).toBe(expected);
    if (!expected) {
      expect(native.status(), `${key} 無入口者直接打 API`).toBe(403);
    }
  }
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await anon.get(NATIVE)).status()).toBe(401);
    expect((await anon.get(LEGACY)).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('報表視圖與篩選參數：新舊回傳相同（盤點組）', async () => {
  const q = [{ view: 'recount_changes' }, { view: 'difference_reason' }, { store: 'VW001' }, { year_month: '2038-03' }, { order_no: 'NO-SUCH' }];
  for (const params of q) {
    const l = await apis.inventory_team.get(LEGACY, { params });
    const n = await apis.inventory_team.get(NATIVE, { params });
    expect(n.status(), JSON.stringify(params)).toBe(l.status());
    expect(await json(n), JSON.stringify(params)).toEqual(await json(l));
  }
});

test('盤點權限分開（2026-11-22 問卷）：session 旗標與新舊 API 對每個角色一致；只有檢視權限者不可匯入、刪除', async () => {
  test.setTimeout(300_000);
  const cap = (key: string, name: string) => accounts.find((a) => a.key === key)!.expected.capabilities[name];
  for (const key of SUBJECTS) {
    // 匯入：沒有檔案。有權限 => 400（缺少匯入檔案）；沒權限 => 403
    const form = { multipart: { year_month: '2038-03' } };
    const l = await apis[key].post(LEGACY, form);
    const n = await apis[key].post(NATIVE, form);
    expect(n.status(), `${key} 匯入`).toBe(l.status());
    expect([400, 403], `${key} 匯入（舊版）`).toContain(l.status());
    // 刪除：不存在的批次 id。有權限 => 404；沒權限 => 403
    const ld = await apis[key].delete(LEGACY, { params: { batch_id: ZERO } });
    const nd = await apis[key].delete(NATIVE, { params: { batch_id: ZERO } });
    expect(nd.status(), `${key} 刪除`).toBe(ld.status());
    expect([404, 403], `${key} 刪除（舊版）`).toContain(ld.status());
    const session = await (await apis[key].get('/api/workspace/session')).json();
    expect(session.capabilities.importInventory, `${key} session importInventory`).toBe(l.status() !== 403);
    expect(session.capabilities.deleteInventory, `${key} session deleteInventory`).toBe(ld.status() !== 403);
    // role-matrix 預期值
    expect(session.capabilities.importInventory, `${key} role-matrix importInventory`).toBe(cap(key, 'importInventory'));
    expect(session.capabilities.deleteInventory, `${key} role-matrix deleteInventory`).toBe(cap(key, 'deleteInventory'));
  }
  // 結論：只有檢視權限（含 inventory.inventory.access、店長、代理店長、navigation）者新舊 API 都 403。
  for (const key of ['inventory_view', 'navigation', 'store_manager', 'acting_manager', 'denied', 'supervisor']) {
    expect((await apis[key].post(LEGACY, { multipart: { year_month: '2038-03' } })).status(), `${key} 舊版匯入`).toBe(403);
    expect((await apis[key].delete(LEGACY, { params: { batch_id: ZERO } })).status(), `${key} 舊版刪除`).toBe(403);
  }
});

type Who = { name: string; api: () => APIRequestContext; canImport: boolean; canDelete: boolean; canView: boolean };
const importOnce = async (api: APIRequestContext, url: string, tag: string) =>
  api.post(url, {
    multipart: {
      file: { name: inventoryResultFileName(tag), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: inventoryResultXlsx(tag) },
      year_month: '2038-03',
    },
  });

test.describe('盤點權限分開：真的匯入與刪除（舊 API 與 workspace API 各跑一次）', () => {
  let users: Record<string, M6User>;
  let teardown: () => Promise<string[]>;
  let manageOnly: APIRequestContext;
  test.beforeAll(async () => {
    runIdOrThrow();
    await cleanupM6InventoryResults();
    ({ users, teardown } = await setupM6Users(['inv_manage_only']));
    manageOnly = await apiForUser(users.inv_manage_only);
  });
  test.afterAll(async () => {
    await manageOnly?.dispose();
    await cleanupM6InventoryResults();
    expect(await teardown()).toEqual([]);
  });

  const WHO: Who[] = [
    { name: 'admin', api: () => apis.admin, canImport: true, canDelete: true, canView: true },
    { name: 'inventory_team', api: () => apis.inventory_team, canImport: true, canDelete: true, canView: true },
    { name: 'inventory_edit', api: () => apis.inventory_edit, canImport: true, canDelete: false, canView: true },
    { name: 'inventory_delete', api: () => apis.inventory_delete, canImport: false, canDelete: true, canView: true },
    { name: 'inventory_view', api: () => apis.inventory_view, canImport: false, canDelete: false, canView: true },
    { name: 'navigation', api: () => apis.navigation, canImport: false, canDelete: false, canView: true },
    { name: 'store_manager', api: () => apis.store_manager, canImport: false, canDelete: false, canView: true },
    { name: 'acting_manager', api: () => apis.acting_manager, canImport: false, canDelete: false, canView: true },
    { name: 'manage_only', api: () => manageOnly, canImport: false, canDelete: false, canView: true },
  ];

  for (const [apiName, url] of [['舊 API', LEGACY], ['workspace API', NATIVE]] as const) {
    test(`${apiName}：各角色匯入與刪除的實際結果`, async () => {
      test.setTimeout(300_000);
      const seeder = apis.inventory_team;
      for (const who of WHO) {
        const api = who.api();
        const tag = `${apiName === '舊 API' ? 'L' : 'N'}-${who.name.replace(/[^a-z_]/g, '')}`;
        // 匯入
        const imp = await importOnce(api, url, `${tag}-imp`);
        if (who.canImport) {
          expect(imp.status(), `${who.name} 匯入`).toBe(200);
          expect((await json(imp)).imported_batches, `${who.name} 匯入批次數`).toBe(1);
        } else {
          expect(imp.status(), `${who.name} 匯入應 403`).toBe(403);
        }
        // 刪除：由有權限者（盤點組）先建一批，再由該角色嘗試刪
        const seeded = await importOnce(seeder, LEGACY, `${tag}-del`);
        expect(seeded.status(), '備料批次').toBe(200);
        const batchId = (await json(seeded)).batches[0].id as string;
        const del = await api.delete(url, { params: { batch_id: batchId } });
        if (who.canDelete) expect(del.status(), `${who.name} 刪除`).toBe(200);
        else {
          expect(del.status(), `${who.name} 刪除應 403`).toBe(403);
          // 被拒絕後批次仍在
          const still = await seeder.get(LEGACY, { params: { year_month: '2038-03', batch_id: batchId } });
          expect(still.status()).toBe(200);
          expect((await json(still)).batches.some((b: { id: string }) => b.id === batchId), `${who.name} 被拒後批次仍在`).toBe(true);
          expect((await seeder.delete(LEGACY, { params: { batch_id: batchId } })).status()).toBe(200);
        }
        // 仍可檢視
        expect((await api.get(url)).status(), `${who.name} 仍可檢視`).toBe(who.canView ? 200 : 403);
        // 該角色匯入成功的批次由盤點組清掉
        if (imp.status() === 200) {
          const id = (await json(imp)).batches[0].id as string;
          const r = await seeder.delete(LEGACY, { params: { batch_id: id } });
          expect([200, 404]).toContain(r.status());
        }
      }
    });
  }
});

test('門檻與差異原因：權限與驗證在新舊兩邊一致（只送會被拒絕的請求，不寫入）', async () => {
  test.setTimeout(300_000);
  const hasModule = (key: string) => accounts.find((a) => a.key === key)!.expected.capabilities.inventory;
  for (const key of SUBJECTS) {
    for (const body of [{ action: 'update_threshold', amount: -1 }, { action: 'update_reason', item_id: ZERO, reason: 'x' }, { action: 'update_reason' }, { action: 'unknown' }]) {
      const n = await apis[key].patch(NATIVE, { data: body });
      if (hasModule(key)) {
        const l = await apis[key].patch(LEGACY, { data: body });
        expect(n.status(), `${key} ${JSON.stringify(body)}`).toBe(l.status());
        expect(await json(n), `${key} ${JSON.stringify(body)}`).toEqual(await json(l));
      } else {
        // 沒有盤點模組入口的帳號：workspace 外層一律先擋 403（舊版對格式不正確的請求會先回 400，屬已知的外層差異）
        expect(n.status(), `${key} 無入口`).toBe(403);
      }
    }
  }
  // 門檻只有 inventory.manage（盤點組、管理員）能調整：負數時有權限回 400，沒權限回 403
  const manage = await apis.inventory_team.patch(NATIVE, { data: { action: 'update_threshold', amount: -1 } });
  expect(manage.status()).toBe(400);
  expect((await apis.inventory_view.patch(NATIVE, { data: { action: 'update_threshold', amount: -1 } })).status()).toBe(403);
});

test('寫入防護：新版寫入 API 檢查 Origin、未登入 401', async () => {
  const bad = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.inventory_team.storageState(), extraHTTPHeaders: { Origin: 'http://invalid.test' } });
  try {
    expect((await bad.delete(NATIVE, { params: { batch_id: ZERO } })).status()).toBe(403);
    expect((await bad.patch(NATIVE, { data: { action: 'update_threshold', amount: 1 } })).status()).toBe(403);
  } finally {
    await bad.dispose();
  }
});
