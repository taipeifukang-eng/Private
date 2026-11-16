import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { adminDb } from '../support/m5-fixtures';
import { perfStoreIds, W03_YEAR, type W03StoreCode } from '../support/w03-fixtures';
import { legacyBuffer } from '../support/rx-fixtures';
import { RX_TOOLS, rxClearAliases, rxPost, rxSheetBuffer } from '../support/rx-helpers';

// W03 追加整合層：處方箋 Google Sheet 匯入（預覽／確認匯入／簡稱對照表）。
// 規格：使用者 2026-11-16 問卷（R1~R7）。資料：2038-10、VW／ZT 測試門市；簡稱用完自己刪；月報由 sweeper 清除。
// 涵蓋：角色與權限、預覽自動比對（自動／多候選／找不到／加總不符）、預覽不寫入、找不到月份、確認匯入時伺服端重驗（缺選擇、選到範圍外、同店選兩次）、
// 整批原子寫入（資料庫函式中途失敗整批還原，簡稱一併還原）、表上沒有的門市不動、對照表優先、對照表新增／重複／修改／刪除、舊格式自動判斷。

const MONTH = `${W03_YEAR}-10`;
let admin: APIRequestContext;
let ids: Record<W03StoreCode, string>;
const apis: APIRequestContext[] = [];
const buffer = rxSheetBuffer();

async function as(role: string) {
  const api = await apiAs(role);
  apis.push(api);
  return api;
}
const reports = (storeIds: string[]) => readRowsAsServiceRole('monthly_prescription_reports', { eq: { year_month: MONTH }, in: { store_id: storeIds } });
const aliasRows = (storeIds: string[]) => readRowsAsServiceRole('prescription_store_aliases', { in: { store_id: storeIds } });
const byLabel = (plan: { rows: { label: string }[] }) => Object.fromEntries(plan.rows.map((r) => [r.label, r as any]));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await apiAs('admin');
  ids = await perfStoreIds(admin);
  await rxClearAliases(admin);
});
test.afterAll(async () => {
  try {
    await rxClearAliases(admin);
  } finally {
    await admin?.dispose();
    await Promise.all(apis.map((a) => a.dispose()));
  }
});

test.describe('角色與存取', () => {
  test('未登入：401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: 'http://localhost:3002' });
    try {
      expect((await anon.get(`${RX_TOOLS}/prescription-aliases`)).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('只有查看權限：可看對照表，不能預覽匯入、不能新增修改刪除', async () => {
    const viewer = await as('performance_view');
    expect((await viewer.get(`${RX_TOOLS}/prescription-aliases`)).status()).toBe(200);
    expect((await rxPost(viewer, buffer, MONTH, 'preview')).status).toBe(403);
    expect((await rxPost(viewer, buffer, MONTH, 'commit')).status).toBe(403);
    const create = await viewer.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: '測試一', store_id: ids.VW001 } });
    expect(create.status()).toBe(403);
    const made = await admin.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: '測試二', store_id: ids.ZT01 } });
    const id = (await made.json()).alias.id;
    expect((await viewer.patch(`${RX_TOOLS}/prescription-aliases/${id}`, { data: { store_id: ids.ZT02 } })).status()).toBe(403);
    expect((await viewer.delete(`${RX_TOOLS}/prescription-aliases/${id}`)).status()).toBe(403);
    expect((await admin.delete(`${RX_TOOLS}/prescription-aliases/${id}`)).status()).toBe(200);
  });

  test('有編輯權限但沒有被指派任何門市：看不到可匯入的門市，確認匯入一律擋下', async () => {
    const editor = await as('performance_edit');
    const preview = await rxPost(editor, buffer, MONTH, 'preview');
    expect(preview.status).toBe(200);
    expect(preview.json.stores).toEqual([]);
    expect(preview.json.importable).toBe(false);
    const commit = await rxPost(editor, buffer, MONTH, 'commit', { 測試一: ids.VW001 });
    expect(commit.status).toBe(400);
    expect(await reports(Object.values(ids))).toHaveLength(0);
  });
});

test.describe('預覽（不寫入）', () => {
  test('自動對上、多候選、找不到、加總不符；一般箋與慢箋讀對月份那一組', async () => {
    const { status, json } = await rxPost(admin, buffer, MONTH, 'preview');
    expect(status).toBe(200);
    expect(json.plan.format).toBe('gsheet');
    expect(json.plan.monthLabel).toBe('十月');
    const rows = byLabel(json.plan);
    expect(rows['測試一'].status).toBe('auto');
    expect(rows['測試一'].store.store_code).toBe('VW001');
    expect(rows['測試一'].regular).toEqual({ count: 1200, points: 2600000 });
    expect(rows['測試一'].chronic).toEqual({ count: 550, points: 1250000 });
    expect(rows['測試一'].mismatches).toEqual([]);
    expect(rows['測試門市01'].store.store_code).toBe('ZT01');
    expect(rows['測試門市01'].mismatches).toHaveLength(1);
    expect(rows['測試'].status).toBe('ambiguous');
    expect(rows['測試'].candidates.length).toBeGreaterThan(1);
    expect(rows['義一'].status).toBe('unknown');
    expect(json.importable).toBe(false);
    expect(await reports(Object.values(ids))).toHaveLength(0);
    expect(await aliasRows(Object.values(ids))).toHaveLength(0);
  });

  test('找不到月份：清楚報錯並列出檔案內的月份', async () => {
    const r = await rxPost(admin, buffer, `${W03_YEAR}-03`, 'preview');
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('找不到');
    expect(r.json.error).toContain('九月');
    expect(r.json.error).toContain('十月');
  });

  test('壞檔、不是 Excel、年月格式不對、模式不對', async () => {
    const bad = await rxPost(admin, Buffer.from('not an excel'), MONTH, 'preview');
    expect(bad.status).toBe(400);
    expect((await rxPost(admin, buffer, '2038-13', 'preview')).status).toBe(400);
    const mode = await admin.post(`${RX_TOOLS}/prescription-import`, { multipart: { file: { name: 'x.xlsx', mimeType: 'application/octet-stream', buffer }, year_month: MONTH, mode: 'delete' } });
    expect(mode.status()).toBe(400);
  });
});

test.describe('確認匯入（伺服端重新驗證）', () => {
  test('缺選擇、選到不存在的門市、同一家門市選兩次：都 400 且完全不寫入', async () => {
    const missing = await rxPost(admin, buffer, MONTH, 'commit', {});
    expect(missing.status).toBe(400);
    expect(missing.json.error_count).toBeGreaterThan(0);
    const nonexistent = await rxPost(admin, buffer, MONTH, 'commit', { 測試: '00000000-0000-0000-0000-000000000000', 義一: ids.ZT03 });
    expect(nonexistent.status).toBe(400);
    const twice = await rxPost(admin, buffer, MONTH, 'commit', { 測試: ids.VW001, 義一: ids.ZT03 }); // VW001 已被「測試一」自動對上
    expect(twice.status).toBe(400);
    expect(await reports(Object.values(ids))).toHaveLength(0);
    expect(await aliasRows(Object.values(ids))).toHaveLength(0);
  });

  test('資料庫函式中途失敗：月報與簡稱整批還原', async () => {
    const db = adminDb();
    const admins = await readRowsAsServiceRole('profiles', { eq: { role: 'admin' }, select: 'id' });
    const bad = await db.rpc('import_prescription_report_batch', {
      p_year_month: MONTH,
      p_reports: [
        { store_id: ids.VW001, regular_prescription_count: 1, regular_prescription_point_value: 1, chronic_prescription_count: 1, chronic_prescription_point_value: 1 },
        { store_id: '00000000-0000-0000-0000-000000000000', regular_prescription_count: 1, regular_prescription_point_value: 1, chronic_prescription_count: 1, chronic_prescription_point_value: 1 },
      ],
      p_aliases: [{ alias: '測試原子', store_id: ids.VW001 }],
      p_user: admins[0]?.id ?? null,
    });
    expect(bad.error).toBeTruthy();
    expect(await reports([ids.VW001])).toHaveLength(0);
    expect(await aliasRows([ids.VW001])).toHaveLength(0);
  });

  test('完整匯入：月報寫入、簡稱存進對照表、加總不符照樣匯入、表上沒有的門市不動', async () => {
    // 先放一筆表上沒有的門市資料（ZT04），匯入後必須原封不動
    const keep = await admin.post(`${RX_TOOLS}/prescription`, {
      data: { year_month: MONTH, records: [{ store_id: ids.ZT04, regular_prescription_count: 7, regular_prescription_point_value: 70, chronic_prescription_count: 3, chronic_prescription_point_value: 30 }] },
    });
    expect(keep.status()).toBe(200);
    const { status, json } = await rxPost(admin, buffer, MONTH, 'commit', { 測試: ids.ZT02, 義一: ids.ZT03 });
    expect(status).toBe(200);
    expect(json.imported).toBe(4);
    expect(json.saved_aliases).toBe(2);
    expect(json.mismatch_count).toBe(1);
    const rows = Object.fromEntries((await reports(Object.values(ids))).map((r) => [r.store_id as string, r]));
    expect(rows[ids.VW001]).toMatchObject({ regular_prescription_count: 1200, chronic_prescription_count: 550 });
    expect(Number(rows[ids.VW001].regular_prescription_point_value)).toBe(2600000);
    expect(Number(rows[ids.ZT01].regular_prescription_point_value)).toBe(300.5); // 加總不符的那家照實匯入
    expect(rows[ids.ZT02]).toMatchObject({ regular_prescription_count: 10, chronic_prescription_count: 5 });
    expect(rows[ids.ZT03]).toMatchObject({ regular_prescription_count: 20, chronic_prescription_count: 6 });
    expect(rows[ids.ZT04]).toMatchObject({ regular_prescription_count: 7, chronic_prescription_count: 3 });
    const saved = Object.fromEntries((await aliasRows(Object.values(ids))).map((a) => [a.alias as string, a.store_id]));
    expect(saved).toEqual({ 測試: ids.ZT02, 義一: ids.ZT03 });
  });

  test('再預覽：對照表優先，全部對上就可以匯入', async () => {
    const { json } = await rxPost(admin, buffer, MONTH, 'preview');
    const rows = byLabel(json.plan);
    expect(rows['測試'].status).toBe('mapped');
    expect(rows['測試'].store.store_code).toBe('ZT02');
    expect(rows['義一'].status).toBe('mapped');
    expect(json.importable).toBe(true);
    // 對照表優先於自動比對：把「測試一」改指向 ZT04，預覽就跟著改
    const made = await admin.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: '測試一', store_id: ids.ZT04 } });
    expect(made.status()).toBe(200);
    const after = byLabel((await rxPost(admin, buffer, MONTH, 'preview')).json.plan);
    expect(after['測試一'].status).toBe('mapped');
    expect(after['測試一'].store.store_code).toBe('ZT04');
    await admin.delete(`${RX_TOOLS}/prescription-aliases/${(await made.json()).alias.id}`);
  });
});

test.describe('簡稱對照表', () => {
  test('新增（空白與全形會正規化）、重複 409、修改、刪除、不存在 404、壞資料 400', async () => {
    const ok = await admin.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: ' 測試 二 ', store_id: ids.ZT01 } });
    expect(ok.status()).toBe(200);
    const created = (await ok.json()).alias;
    expect(created.alias).toBe('測試二');
    expect((await admin.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: '測試二', store_id: ids.ZT02 } })).status()).toBe(409);
    expect((await admin.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: '', store_id: ids.ZT02 } })).status()).toBe(400);
    expect((await admin.post(`${RX_TOOLS}/prescription-aliases`, { data: { alias: '測試二二', store_id: 'not-a-store' } })).status()).toBe(400);
    expect((await admin.patch(`${RX_TOOLS}/prescription-aliases/${created.id}`, { data: { store_id: ids.ZT02 } })).status()).toBe(200);
    expect((await admin.patch(`${RX_TOOLS}/prescription-aliases/${created.id}`, { data: {} })).status()).toBe(400);
    const list = (await (await admin.get(`${RX_TOOLS}/prescription-aliases`)).json()).aliases as { id: string; store_code: string }[];
    expect(list.find((a) => a.id === created.id)?.store_code).toBe('ZT02');
    expect((await admin.patch(`${RX_TOOLS}/prescription-aliases/not-a-uuid`, { data: { store_id: ids.ZT02 } })).status()).toBe(400);
    expect((await admin.delete(`${RX_TOOLS}/prescription-aliases/${created.id}`)).status()).toBe(200);
    expect((await admin.delete(`${RX_TOOLS}/prescription-aliases/${created.id}`)).status()).toBe(404);
  });
});

test.describe('舊格式（一門市一列）', () => {
  test('自動判斷格式，預覽與匯入照舊；年月不符與找不到門市會擋', async () => {
    const good = legacyBuffer([[MONTH, 'VW001', 'Vue 測試一店', 11, 111, 2, '22.5'], [MONTH, 'ZT02', '', 5, 50, 1, 10]]);
    const pv = await rxPost(admin, good, MONTH, 'preview');
    expect(pv.json.plan.format).toBe('legacy');
    expect(pv.json.importable).toBe(true);
    const bad = await rxPost(admin, legacyBuffer([[`${W03_YEAR}-09`, 'VW001', '', 1, 1, 1, 1], [MONTH, 'NOPE99', '', 1, 1, 1, 1]]), MONTH, 'commit');
    expect(bad.status).toBe(400);
    const c = await rxPost(admin, good, MONTH, 'commit');
    expect(c.status).toBe(200);
    expect(c.json.saved_aliases).toBe(0);
    const row = (await reports([ids.VW001]))[0];
    expect(row).toMatchObject({ regular_prescription_count: 11, chronic_prescription_count: 2 });
    expect(Number(row.chronic_prescription_point_value)).toBe(22.5);
  });
});
