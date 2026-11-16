import { expect, test, type APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { buildPrescriptionTemplateWorkbook, writePrescriptionTemplate } from '../../lib/performance/prescription-template';
import { apiAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { adminDb } from '../support/m5-fixtures';
import { perfStoreIds, W03_YEAR, type W03StoreCode } from '../support/w03-fixtures';
import { legacyBuffer } from '../support/rx-fixtures';
import { RX_TOOLS, rxClearAliases, rxPost, rxSheetBuffer } from '../support/rx-helpers';

// W03 追加整合層：處方箋 Google Sheet 匯入（預覽／確認匯入／簡稱對照表）。
// 規格：使用者 2026-11-16 問卷（R1~R7）。資料：2038-10、VW／ZT 測試門市；簡稱用完自己刪；月報由 sweeper 清除。
// 涵蓋：角色與權限、預覽自動比對（自動／多候選／找不到／加總不符）、預覽不寫入、找不到月份、確認匯入時伺服端重驗（缺選擇、選到範圍外、同店選兩次）、
// 整批原子寫入（資料庫函式中途失敗整批還原，簡稱一併還原）、表上沒有的門市不動、對照表優先、對照表新增／重複／修改／刪除、本月範本（代號對門市）與舊格式停用。

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

test.describe('本月範本與舊格式停用', () => {
  const TM = `${W03_YEAR}-08`; // 與上面各組（10 月）及 e2e（02、07、11、12 月）用不同月份，互不影響
  const reportsIn = (month: string, storeIds: string[]) => readRowsAsServiceRole('monthly_prescription_reports', { eq: { year_month: month }, in: { store_id: storeIds } });
  const sheetName = '處方箋月報';
  const codes = ['VW001', 'ZT01', 'ZT02'] as const;

  /** 只留 VW／ZT 測試門市的範本檔（用同一個產生器），再改 D/E 欄模擬「從 Google Sheet 貼上」。 */
  async function pastedTemplate(mutate?: (sheet: XLSX.WorkSheet) => void) {
    const res = await admin.get(`${RX_TOOLS}/prescription-template`, { params: { year_month: TM } });
    expect(res.status()).toBe(200);
    const names = new Map<string, string>();
    const sheet = XLSX.read(await res.body(), { type: 'buffer' }).Sheets[sheetName];
    for (let r = 3; sheet[`A${r}`]; r += 3) names.set(String(sheet[`A${r}`].v), String(sheet[`B${r}`]?.v ?? ''));
    const stores = codes.map((code) => ({ id: ids[code], store_code: code, store_name: names.get(code) || code }));
    const wb = buildPrescriptionTemplateWorkbook(TM, stores, new Map());
    const out = wb.Sheets[sheetName];
    out['D3'] = { t: 'n', v: 11 }; out['E3'] = { t: 's', v: '1,111.5' };
    out['D4'] = { t: 'n', v: 2 }; out['E4'] = { t: 'n', v: 22.5 };
    out['D5'] = { t: 'n', v: 13 }; out['E5'] = { t: 'n', v: 1134 };
    out['D6'] = { t: 'n', v: 5 }; out['E6'] = { t: 'n', v: 50 };
    out['D7'] = { t: 'n', v: 1 }; out['E7'] = { t: 'n', v: 10 };
    out['D8'] = { t: 'n', v: 7 }; out['E8'] = { t: 'n', v: 60 }; // ZT01 加總不符（張數 6 ≠ 7）
    out['D9'] = { t: 'n', v: 3 }; out['E9'] = { t: 'n', v: 30 };
    out['D10'] = { t: 'n', v: 4 }; out['E10'] = { t: 'n', v: 40 };
    out['D11'] = { t: 'n', v: 7 }; out['E11'] = { t: 'n', v: 70 };
    mutate?.(out);
    return Buffer.from(writePrescriptionTemplate(wb));
  }

  test('下載的範本：標題、三列一店、順序與公式；整份下載檔直接匯入預覽全部以代號對上', async () => {
    const res = await admin.get(`${RX_TOOLS}/prescription-template`, { params: { year_month: TM } });
    expect(res.status()).toBe(200);
    const body = await res.body();
    const wb = XLSX.read(body, { type: 'buffer' });
    expect(wb.SheetNames).toEqual([sheetName]);
    const sheet = wb.Sheets[sheetName];
    expect([sheet['A1'].v, sheet['B1'].v, sheet['C1'].v, sheet['D1'].v, sheet['D2'].v, sheet['E2'].v]).toEqual(['門市代號', '店別', '項目', '8月', '張數', '金額']);
    const codeList: string[] = [];
    for (let r = 3; sheet[`A${r}`]; r += 3) {
      codeList.push(String(sheet[`A${r}`].v));
      expect([sheet[`C${r}`].v, sheet[`C${r + 1}`].v, sheet[`C${r + 2}`].v]).toEqual(['一般', '連續', '加總']);
      expect(sheet[`D${r + 2}`].f).toBe(`D${r}+D${r + 1}`);
    }
    expect(codeList).toEqual(expect.arrayContaining([...codes]));
    expect(codeList).not.toContain('0000');
    expect(new Set(codeList).size).toBe(codeList.length);
    const pv = await rxPost(admin, Buffer.from(body), TM, 'preview');
    expect(pv.status).toBe(200);
    expect(pv.json.plan.hasCodeColumn).toBe(true);
    expect(pv.json.plan.rows).toHaveLength(codeList.length);
    expect(pv.json.plan.rows.every((r: { status: string }) => r.status === 'coded')).toBe(true);
    expect(pv.json.importable).toBe(true);
  });

  test('貼上數字後匯入：以代號對門市（不寫簡稱）、加總不符只提醒、資料寫入正確', async () => {
    const file = await pastedTemplate();
    const pv = await rxPost(admin, file, TM, 'preview');
    expect(pv.status).toBe(200);
    expect(pv.json.plan.rows.map((r: { status: string }) => r.status)).toEqual(['coded', 'coded', 'coded']);
    expect(pv.json.plan.rows.map((r: { mismatches: string[] }) => r.mismatches.length)).toEqual([0, 1, 0]);
    expect(pv.json.importable).toBe(true);
    expect((await reportsIn(TM, [ids.VW001, ids.ZT01, ids.ZT02])).length).toBe(0);
    const c = await rxPost(admin, file, TM, 'commit');
    expect(c.status).toBe(200);
    expect(c.json.imported).toBe(3);
    expect(c.json.saved_aliases).toBe(0);
    expect(c.json.mismatch_count).toBe(1);
    const rows = Object.fromEntries((await reportsIn(TM, [ids.VW001, ids.ZT01, ids.ZT02])).map((r) => [r.store_id as string, r]));
    expect(rows[ids.VW001]).toMatchObject({ regular_prescription_count: 11, chronic_prescription_count: 2 });
    expect(Number(rows[ids.VW001].regular_prescription_point_value)).toBe(1111.5);
    expect(Number(rows[ids.VW001].chronic_prescription_point_value)).toBe(22.5);
    expect(rows[ids.ZT01]).toMatchObject({ regular_prescription_count: 5, chronic_prescription_count: 1 });
    expect(rows[ids.ZT02]).toMatchObject({ regular_prescription_count: 3, chronic_prescription_count: 4 });
  });

  test('代號找不到：預覽標錯誤、確認匯入被擋且不寫入', async () => {
    const file = await pastedTemplate((s) => { s['A3'] = { t: 's', v: 'NOPE99' }; });
    const pv = await rxPost(admin, file, TM, 'preview');
    expect(pv.json.plan.rows[0].status).toBe('error');
    expect(pv.json.importable).toBe(false);
    const c = await rxPost(admin, file, TM, 'commit');
    expect(c.status).toBe(400);
    expect(String(c.json.errors?.[0])).toContain('NOPE99');
  });

  test('舊格式（一門市一列）：預覽與確認都回停用錯誤，不寫入', async () => {
    const old = legacyBuffer([[TM, 'ZT03', '', 99, 99, 9, '9.5']]);
    for (const mode of ['preview', 'commit'] as const) {
      const r = await rxPost(admin, old, TM, mode);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('這是舊版範本格式，已停用，請重新下載本月範本');
    }
    expect((await reportsIn(TM, [ids.ZT03])).length).toBe(0);
  });
});
