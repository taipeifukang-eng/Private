import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import {
  DEFAULT_MONTHLY,
  DEFAULT_QUARTERLY,
  W03_YEAR,
  bonusEmployeeCode,
  multipartFile,
  perfImportRow,
  perfStoreIds,
  readPerfRows,
  registerPerfRows,
  restoreDefaultThresholds,
  savePerf,
  thresholdBody,
  type W03StoreCode,
} from '../support/w03-fixtures';

// W03 整合層：績效獎金 /api/workspace/performance 與 performance-tools/*。
// 資料：2038 年、測試門市 ZT01／ZT02／VW001（sweeper 清除）。
// 涵蓋：角色與權限、W03-q3（後寫覆蓋、無版本鎖）、閾值驗證與後寫覆蓋、W03-q1（不選門市的多門市匯入，照舊版）、
// 匯入全成功或全失敗、處方箋驗證與整批原子性、每月獎金權限與合併規則。

const BASE = '/api/workspace/performance';
const TOOLS = '/api/workspace/performance-tools';
let admin: APIRequestContext;
let ids: Record<W03StoreCode, string>;
const apis: APIRequestContext[] = [];

async function as(role: string) {
  const api = await apiAs(role);
  apis.push(api);
  return api;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await apiAs('admin');
  ids = await perfStoreIds(admin);
});
test.afterAll(async () => {
  try {
    await registerPerfRows([ids.ZT01, ids.ZT02, ids.VW001]);
    for (const code of ['ZT01', 'ZT02'] as const) await restoreDefaultThresholds(admin, ids[code]);
    await registerPerfRows([ids.ZT01, ids.ZT02, ids.VW001]);
  } finally {
    await admin?.dispose();
    await Promise.all(apis.map((a) => a.dispose()));
  }
});

test.describe('角色與存取', () => {
  test('未登入：401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: 'http://localhost:3002' });
    try {
      expect((await anon.get(BASE, { params: { year: '2038' } })).status()).toBe(401);
      expect((await anon.get(`${TOOLS}/bonus`, { params: { year_month: '2038-01' } })).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('GET 年度資料：各角色（performance.view／edit 才可進入）', async () => {
    const expectation: Record<string, { status: number; canEdit?: boolean; canViewBonus?: boolean; canImportBonus?: boolean }> = {
      admin: { status: 200, canEdit: true, canViewBonus: true, canImportBonus: true },
      performance_edit: { status: 200, canEdit: true, canViewBonus: true, canImportBonus: true },
      performance_view: { status: 200, canEdit: false, canViewBonus: true, canImportBonus: false },
      ops_assistant: { status: 200, canEdit: false, canViewBonus: false, canImportBonus: true },
      ops_manager: { status: 200, canEdit: false, canViewBonus: true, canImportBonus: false },
      store_manager: { status: 403 },
      supervisor: { status: 403 },
      denied: { status: 403 },
    };
    for (const [role, exp] of Object.entries(expectation)) {
      const api = await as(role);
      const res = await api.get(BASE, { params: { year: String(W03_YEAR) } });
      expect(res.status(), role).toBe(exp.status);
      if (exp.status === 200) {
        const body = await res.json();
        expect(body.canEdit, `${role} canEdit`).toBe(exp.canEdit);
        expect(body.canViewBonus, `${role} canViewBonus`).toBe(exp.canViewBonus);
        expect(body.canImportBonus, `${role} canImportBonus`).toBe(exp.canImportBonus);
      }
    }
  });

  test('GET 年度資料：年度驗證；admin 看得到全部測試門市', async () => {
    expect((await admin.get(BASE, { params: { year: '1999' } })).status()).toBe(400);
    expect((await admin.get(BASE, { params: { year: 'abc' } })).status()).toBe(400);
    const body = await (await admin.get(BASE, { params: { year: String(W03_YEAR), store_id: ids.ZT01 } })).json();
    expect(body.store).toBe(ids.ZT01);
    expect((body.stores as any[]).map((s) => s.store_code)).toEqual(expect.arrayContaining(['ZT01', 'ZT02', 'VW001']));
  });

  test('非管理者沒有被指派門市：看不到門市、不能存特定門市（requireStore）', async () => {
    const api = await as('performance_edit');
    const read = await (await api.get(BASE, { params: { year: String(W03_YEAR) } })).json();
    expect(read.stores).toEqual([]);
    const res = await savePerf(api, ids.ZT01, 1);
    expect(res.status()).toBe(403);
    expect((await api.get(BASE, { params: { year: String(W03_YEAR), store_id: ids.ZT01 } })).status()).toBe(403);
  });
});

test.describe('業績寫入與 W03-q3（照舊版後寫覆蓋）', () => {
  test('新增、更新、回讀；欄位原樣寫入', async () => {
    const res = await savePerf(admin, ids.ZT01, 1);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.record).toMatchObject({ store_id: ids.ZT01, year: W03_YEAR, month: 1, business_days: 26, monthly_gross_profit_target: 780000 });
    const upd = await savePerf(admin, ids.ZT01, 1, { monthly_gross_profit_actual: 900_000, business_days: 25.5, activity_day_gross_profit: 12_345 });
    expect(upd.status()).toBe(200);
    const row = (await readPerfRows(ids.ZT01)).find((r) => r.month === 1)!;
    expect(Number(row.monthly_gross_profit_actual)).toBe(900_000);
    expect(Number(row.business_days)).toBe(25.5);
    expect(Number(row.activity_day_gross_profit)).toBe(12_345);
    const read = await (await admin.get(BASE, { params: { year: String(W03_YEAR), store_id: ids.ZT01 } })).json();
    expect(read.records.filter((r: any) => r.month === 1)).toHaveLength(1);
    expect(read.records[0]).not.toHaveProperty('updated_at'); // 樂觀鎖用的版本欄位已移除
  });

  test('非營業天數欄位輸入 0 照舊版（setField parseFloat || null）存成 NULL', async () => {
    const res = await savePerf(admin, ids.ZT01, 3, { monthly_gross_profit_actual: 0, activity_day_gross_profit: 0, last_month_rx_actual: 0 });
    expect(res.status(), await res.text()).toBe(200);
    const row = (await readPerfRows(ids.ZT01)).find((r) => r.month === 3)!;
    expect(row.monthly_gross_profit_actual).toBeNull();
    expect(row.activity_day_gross_profit).toBeNull();
    expect(row.last_month_rx_actual).toBeNull();
    expect(Number(row.business_days)).toBe(26);
  });

  test('權限與輸入驗證', async () => {
    const view = await as('performance_view');
    expect((await savePerf(view, ids.ZT01, 2)).status()).toBe(403);
    expect((await savePerf(admin, ids.ZT01, 2, { business_days: 0.4 })).status()).toBe(400);
    expect((await savePerf(admin, ids.ZT01, 2, { business_days: 32 })).status()).toBe(400);
    expect((await savePerf(admin, ids.ZT01, 2, { business_days: 1.2 })).status()).toBe(400);
    expect((await savePerf(admin, ids.ZT01, 2, { business_days: '26' })).status()).toBe(400);
    expect((await savePerf(admin, ids.ZT01, 2, { monthly_gross_profit_actual: 'abc' })).status()).toBe(400);
    expect((await admin.post(BASE, { data: { ...{}, store_id: ids.ZT01, year: 1999, month: 2, business_days: 26 } })).status()).toBe(400);
    expect((await admin.post(BASE, { data: { store_id: ids.ZT01, year: W03_YEAR, month: 13, business_days: 26 } })).status()).toBe(400);
    const noOrigin = await admin.post(BASE, { data: { store_id: ids.ZT01, year: W03_YEAR, month: 2 }, headers: { Origin: 'http://evil.example' } });
    expect(noOrigin.status()).toBe(403);
    expect((await readPerfRows(ids.ZT01)).some((r) => r.month === 2)).toBe(false);
  });

  test('W03-q3：舊版本、缺 id 的存檔不會 409，後寫覆蓋先寫', async () => {
    const first = await (await savePerf(admin, ids.ZT01, 3, { monthly_gross_profit_actual: 111_111 })).json();
    // 帶著過期的 updated_at 與錯誤的 id，舊版會 409；新版（照舊版）忽略版本資訊，直接覆蓋。
    const stale = await savePerf(admin, ids.ZT01, 3, { id: first.record.id, updated_at: '2000-01-01T00:00:00.000Z', monthly_gross_profit_actual: 222_222 });
    expect(stale.status(), await stale.text()).toBe(200);
    const noId = await savePerf(admin, ids.ZT01, 3, { monthly_gross_profit_actual: 333_333 }); // 沒帶 id 但該月已有資料：舊版 upsert 覆蓋
    expect(noId.status()).toBe(200);
    const rows = (await readPerfRows(ids.ZT01)).filter((r) => r.month === 3);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].monthly_gross_profit_actual)).toBe(333_333);
    expect(rows[0].id).toBe(first.record.id);
  });

  test('W03-q3：同時兩個存檔都成功，最後寫入者為準（結果是其中一筆）', async () => {
    const [a, b] = await Promise.all([
      savePerf(admin, ids.ZT01, 4, { monthly_gross_profit_actual: 410_000 }),
      savePerf(admin, ids.ZT01, 4, { monthly_gross_profit_actual: 420_000 }),
    ]);
    expect([a.status(), b.status()]).toEqual([200, 200]);
    const rows = (await readPerfRows(ids.ZT01)).filter((r) => r.month === 4);
    expect(rows).toHaveLength(1);
    expect([410_000, 420_000]).toContain(Number(rows[0].monthly_gross_profit_actual));
  });
});

test.describe('獎金閾值', () => {
  test('GET：預設 5 + 5 檻', async () => {
    const body = await (await admin.get(`${TOOLS}/thresholds`, { params: { store_id: ids.ZT02 } })).json();
    expect(body.monthly.map((t: any) => t.baseAmount)).toEqual(DEFAULT_MONTHLY);
    expect(body.quarterly.map((t: any) => t.baseAmount)).toEqual(DEFAULT_QUARTERLY);
  });

  test('POST 驗證：檻數、順序、非負整數、上限', async () => {
    const post = (data: unknown, api = admin) => api.post(`${TOOLS}/thresholds`, { data });
    const ok = thresholdBody(DEFAULT_MONTHLY, DEFAULT_QUARTERLY);
    expect((await post({ store_id: ids.ZT02, monthly: ok.monthly.slice(0, 4), quarterly: ok.quarterly })).status()).toBe(400);
    const shuffled = [1, 3, 2, 4, 5].map((level, i) => ({ level, base_amount: DEFAULT_MONTHLY[i] }));
    expect((await post({ store_id: ids.ZT02, monthly: shuffled, quarterly: ok.quarterly })).status()).toBe(400);
    for (const bad of [1.5, -1, 2147483648]) {
      const monthly = ok.monthly.map((t, i) => (i === 0 ? { ...t, base_amount: bad } : t));
      expect((await post({ store_id: ids.ZT02, monthly, quarterly: ok.quarterly })).status(), String(bad)).toBe(400);
    }
    const view = await as('performance_view');
    expect((await post({ store_id: ids.ZT02, ...ok }, view)).status()).toBe(403);
    const editNoStore = await as('performance_edit');
    expect((await post({ store_id: ids.ZT02, ...ok }, editNoStore)).status()).toBe(403); // 沒被指派該門市
    const body = await (await admin.get(`${TOOLS}/thresholds`, { params: { store_id: ids.ZT02 } })).json();
    expect(body.monthly.map((t: any) => t.baseAmount)).toEqual(DEFAULT_MONTHLY); // 驗證失敗不留任何寫入
  });

  test('儲存後讀回；W03-q3：兩次儲存後寫覆蓋（沒有版本檢查）', async () => {
    const a = thresholdBody([1000, 2000, 3000, 4000, 5000], [6000, 7000, 8000, 9000, 10000]);
    const b = thresholdBody([1100, 2100, 3100, 4100, 5100], [6100, 7100, 8100, 9100, 10100]);
    const [ra, rb] = await Promise.all([
      admin.post(`${TOOLS}/thresholds`, { data: { store_id: ids.ZT02, ...a } }),
      admin.post(`${TOOLS}/thresholds`, { data: { store_id: ids.ZT02, ...b } }),
    ]);
    expect([ra.status(), rb.status()]).toEqual([200, 200]);
    const third = await admin.post(`${TOOLS}/thresholds`, { data: { store_id: ids.ZT02, ...a } });
    expect(third.status()).toBe(200);
    const body = await (await admin.get(`${TOOLS}/thresholds`, { params: { store_id: ids.ZT02 } })).json();
    expect(body.monthly.map((t: any) => t.baseAmount)).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(body.quarterly.map((t: any) => t.baseAmount)).toEqual([6000, 7000, 8000, 9000, 10000]);
    await restoreDefaultThresholds(admin, ids.ZT02);
  });
});

test.describe('業績 Excel 匯入（W03-q1：照舊版，可不選門市）', () => {
  const post = (api: APIRequestContext, rows: Record<string, unknown>[] | null, fields: Record<string, string> = {}, file = rows ? multipartFile(rows) : undefined) =>
    api.post(`${TOOLS}/performance-import`, { multipart: { ...(file ? { file } : {}), ...fields } });

  test('不選門市：依 Excel 門市代號一次匯入多間門市', async () => {
    const res = await post(admin, [perfImportRow('ZT01', 5), perfImportRow('ZT02', 5, { 月實際毛利額: 810000 }), perfImportRow('VW001', 6)], { year: String(W03_YEAR) });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, imported: 3, skipped: 0 });
    expect(Number((await readPerfRows(ids.ZT01)).find((r) => r.month === 5)!.monthly_gross_profit_actual)).toBe(800000);
    expect(Number((await readPerfRows(ids.ZT02)).find((r) => r.month === 5)!.monthly_gross_profit_actual)).toBe(810000);
    expect((await readPerfRows(ids.VW001)).some((r) => r.month === 6)).toBe(true);
  });

  test('選了門市：Excel 沒有門市代號的列使用該門市（後備）；年份取表單年度', async () => {
    const res = await post(admin, [perfImportRow(null, 7, { 年月份: undefined, 月份: 7 })], { store_id: ids.ZT01, year: String(W03_YEAR) });
    expect(res.status(), await res.text()).toBe(200);
    expect((await readPerfRows(ids.ZT01)).some((r) => r.month === 7)).toBe(true);
  });

  test('不選門市且列沒有門市代號：400，沒有任何寫入', async () => {
    const res = await post(admin, [perfImportRow(null, 8)], { year: String(W03_YEAR) });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('沒有可匯入的有效資料');
    expect((await readPerfRows(ids.ZT01)).some((r) => r.month === 8)).toBe(false);
  });

  test('全失敗：全部列都無效（找不到門市、營業天數錯誤）→ 400，什麼都不寫', async () => {
    const res = await post(admin, [perfImportRow('NOPE99', 9), perfImportRow('ZT01', 9, { 營業天數: 40 })], { year: String(W03_YEAR) });
    expect(res.status()).toBe(400);
    expect(((await res.json()).errors as string[]).length).toBeGreaterThanOrEqual(2);
    expect((await readPerfRows(ids.ZT01)).some((r) => r.month === 9)).toBe(false);
  });

  test('有效列同一次寫入、無效列略過並回報（舊版行為）', async () => {
    const res = await post(admin, [perfImportRow('ZT01', 10), perfImportRow('NOPE99', 10), perfImportRow('ZT02', 10)], { year: String(W03_YEAR) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(1);
    expect((body.errors as string[]).join('；')).toContain('NOPE99');
  });

  test('全成功或全失敗（原子性）：資料庫拒絕其中一列時，整批都不寫入', async () => {
    // 第二列毛利為 1e30，超出資料庫欄位範圍；同一個 upsert 失敗，第一列也不得留下。
    const res = await post(admin, [perfImportRow('ZT01', 11), perfImportRow('ZT02', 11, { 月實際毛利額: 1e30 })], { year: String(W03_YEAR) });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect((await readPerfRows(ids.ZT01)).some((r) => r.month === 11)).toBe(false);
    expect((await readPerfRows(ids.ZT02)).some((r) => r.month === 11)).toBe(false);
  });

  test('權限與檔案檢查', async () => {
    const view = await as('performance_view');
    expect((await post(view, [perfImportRow('ZT01', 12)], { year: String(W03_YEAR) })).status()).toBe(403);
    expect((await post(admin, null, { year: String(W03_YEAR) })).status()).toBe(400); // 缺少檔案
    expect((await post(admin, [], { year: String(W03_YEAR) })).status()).toBe(400); // Excel 無資料
    expect((await readPerfRows(ids.ZT01)).some((r) => r.month === 12)).toBe(false);
    const noOrigin = await admin.post(`${TOOLS}/performance-import`, { multipart: { file: multipartFile([perfImportRow('ZT01', 12)]) }, headers: { Origin: 'http://evil.example' } });
    expect(noOrigin.status()).toBe(403);
  });

  test('有 performance.edit 的非管理者：沒有逐列門市權限檢查（W03-q1），結果與舊 API 相同', async () => {
    // 照舊版：API 本身不檢查逐列門市權限；非管理者能匯入哪些門市，取決於資料庫列級安全（stores 的可見範圍）。
    // 這個帳號沒有被指派任何門市，stores 對它不可見，所以門市代號找不到 → 400；新舊 API 必須同結果。
    const api = await as('performance_edit');
    const rows = [perfImportRow('VW001', 12)];
    const legacy = await api.post('/api/performance-data/import', { multipart: { file: multipartFile(rows), year: String(W03_YEAR) } });
    const native = await post(api, rows, { year: String(W03_YEAR) });
    expect(native.status(), await native.text()).toBe(legacy.status());
    expect((await native.json()).error).toBe((await legacy.json()).error);
    const written = (await readPerfRows(ids.VW001)).some((r) => r.month === 12);
    expect(written).toBe(native.status() === 200);
  });
});

test.describe('處方箋驗證', () => {
  // 其他層（e2e 用 03／04、parity 用 03／05／06／07）也會寫處方箋，所以整合層用自己的月份，避免同一次 run 內互相污染。
  const MONTH = `${W03_YEAR}-09`;
  const rec = (store: string, over: Record<string, unknown> = {}) => ({
    store_id: store,
    regular_prescription_count: 10,
    regular_prescription_point_value: 1.2345,
    chronic_prescription_count: 5,
    chronic_prescription_point_value: 2.5,
    ...over,
  });
  const save = (records: unknown[], api = admin, month = MONTH) => api.post(`${TOOLS}/prescription`, { data: { year_month: month, records } });
  const read = async (store: string) => {
    const body = await (await admin.get(`${TOOLS}/prescription`, { params: { year_month: MONTH } })).json();
    return (body.records as any[]).find((r) => r.store_id === store);
  };

  test('驗證：點值最多四位小數、張數非負整數、年月格式', async () => {
    expect((await save([rec(ids.ZT01, { regular_prescription_point_value: 1.23456 })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01, { chronic_prescription_point_value: '1.12345' })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01, { regular_prescription_count: -1 })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01, { chronic_prescription_count: 1.5 })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01, { regular_prescription_count: 'abc' })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01, { regular_prescription_count: 2147483648 })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01, { regular_prescription_point_value: 100000000 })])).status()).toBe(400);
    expect((await save([rec(ids.ZT01)], admin, '2038-13')).status()).toBe(400);
    expect((await save([])).status()).toBe(400);
    expect((await read(ids.ZT01)).regular_prescription_count).toBeNull();
  });

  test('整批原子：一列格式錯誤，其他有效列也不寫入；未知或重複門市 403', async () => {
    const bad = await save([rec(ids.ZT01), rec(ids.ZT02, { regular_prescription_count: -5 })]);
    expect(bad.status()).toBe(400);
    expect(((await bad.json()).error as string)).toContain('ZT02');
    expect((await read(ids.ZT01)).regular_prescription_count).toBeNull();
    expect((await save([rec(ids.ZT01), rec(ids.ZT01)])).status()).toBe(403);
    expect((await save([rec('00000000-0000-0000-0000-000000000000')])).status()).toBe(403);
    expect((await read(ids.ZT01)).regular_prescription_count).toBeNull();
  });

  test('成功儲存：回讀、總慢箋張數 = 一般箋 / 4（四捨五入到小數 1 位）+ 慢箋', async () => {
    const ok = await save([rec(ids.ZT01, { regular_prescription_count: 10, chronic_prescription_count: 0 }), rec(ids.ZT02, { regular_prescription_count: 7, chronic_prescription_count: 3 }), rec(ids.VW001, { regular_prescription_count: '', chronic_prescription_count: 4, regular_prescription_point_value: '' })]);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).saved).toBe(3);
    const a = await read(ids.ZT01);
    expect(Number(a.total_chronic_prescription_count)).toBe(2.5);
    expect(Number(a.regular_prescription_point_value)).toBe(1.2345);
    expect(Number((await read(ids.ZT02)).total_chronic_prescription_count)).toBe(4.8); // 7/4=1.75 -> 1.8，加 3
    const c = await read(ids.VW001);
    expect(c.regular_prescription_count).toBeNull();
    expect(c.total_chronic_prescription_count).toBeNull(); // 缺一般箋張數時不計算
    const rows = await readRowsAsServiceRole('monthly_prescription_reports', { in: { store_id: [ids.ZT01, ids.ZT02, ids.VW001] }, eq: { year_month: MONTH }, select: 'store_id' });
    expect(rows).toHaveLength(3);
  });

  test('年度檢視：每門市 12 個月；權限（view 唯讀）與範本下載', async () => {
    const year = await (await admin.get(`${TOOLS}/prescription`, { params: { year: String(W03_YEAR) } })).json();
    const mine = (year.records as any[]).filter((r) => r.store_id === ids.ZT01);
    expect(mine).toHaveLength(12);
    expect(mine.find((r) => r.year_month === MONTH).regular_prescription_count).toBe(10);
    expect((await admin.get(`${TOOLS}/prescription`, { params: { year: '1999' } })).status()).toBe(400);
    const view = await as('performance_view');
    expect((await view.get(`${TOOLS}/prescription`, { params: { year_month: MONTH } })).status()).toBe(200);
    expect((await save([rec(ids.ZT01)], view)).status()).toBe(403);
    const denied = await as('denied');
    expect((await denied.get(`${TOOLS}/prescription`, { params: { year_month: MONTH } })).status()).toBe(403);
    const tpl = await admin.get(`${TOOLS}/prescription-template`, { params: { year_month: MONTH } });
    expect(tpl.status()).toBe(200);
    expect(tpl.headers()['content-type']).toContain('spreadsheetml');
  });
});

test.describe('每月獎金', () => {
  const MONTH = `${W03_YEAR}-04`;
  const code = () => bonusEmployeeCode('B1');
  const importBonus = (api: APIRequestContext, rows: Record<string, unknown>[] | null) =>
    api.post(`${TOOLS}/bonus-import`, { multipart: { ...(rows ? { file: multipartFile(rows) } : {}), year: String(W03_YEAR) } });
  const readBonus = async (store: string) => (await readRowsAsServiceRole('monthly_bonus_records', { eq: { store_id: store, year_month: MONTH, employee_code: code() } }))[0];

  test('讀取只需 performance.bonus.view（不需 performance.view）；匯入需 performance.bonus.import', async () => {
    const expectView: Record<string, number> = { admin: 200, performance_edit: 200, performance_view: 200, navigation: 200, ops_manager: 200, ops_assistant: 403, denied: 403 };
    for (const [role, status] of Object.entries(expectView)) {
      const api = await as(role);
      for (const resource of ['bonus', 'bonus-averages', 'bonus-stores']) {
        const params: Record<string, string> = resource === 'bonus-stores' ? {} : { year_month: MONTH, year: String(W03_YEAR) };
        const res = await api.get(`${TOOLS}/${resource}`, { params });
        expect(res.status(), `${role} ${resource}`).toBe(status);
      }
    }
    const expectImport: Record<string, number> = { performance_view: 403, navigation: 403, ops_manager: 403, denied: 403 };
    for (const [role, status] of Object.entries(expectImport)) {
      const api = await as(role);
      expect((await importBonus(api, [{ 員編: code(), 門市代號: 'ZT01', 年月: MONTH, 團體獎金: 1 }])).status(), role).toBe(status);
    }
    expect((await readBonus(ids.ZT01))).toBeUndefined();
  });

  test('匯入、合併規則（新檔案未提供的欄位保留舊值；明確填 0 會更新）', async () => {
    const first = await importBonus(admin, [{ 員編: code(), 姓名: 'W03 獎金測試', 門市代號: 'ZT01', 年月: MONTH, 團體獎金: 5000, 單品獎金: 200 }]);
    expect(first.status(), await first.text()).toBe(200);
    let row = await readBonus(ids.ZT01);
    expect(Number(row.group_bonus)).toBe(5000);
    expect(Number(row.single_item_bonus)).toBe(200);
    const second = await importBonus(admin, [{ 員編: code(), 門市代號: 'ZT01', 年月: MONTH, 單品獎金: 0, 交通費: 80 }]);
    expect(second.status(), await second.text()).toBe(200);
    row = await readBonus(ids.ZT01);
    expect(Number(row.group_bonus)).toBe(5000); // 未提供：保留
    expect(Number(row.single_item_bonus)).toBe(0); // 明確填 0：更新
    expect(Number(row.transport_fee)).toBe(80);
  });

  test('全成功或全失敗：同員編同月份同項目數值衝突 → 400，整批不寫入', async () => {
    const other = bonusEmployeeCode('B2');
    const res = await importBonus(admin, [
      { 員編: other, 門市代號: 'ZT02', 年月: MONTH, 團體獎金: 100 },
      { 員編: code(), 門市代號: 'ZT01', 年月: MONTH, 團體獎金: 1 },
      { 員編: code(), 門市代號: 'ZT01', 年月: MONTH, 團體獎金: 2 },
    ]);
    expect(res.status()).toBe(400);
    expect(((await res.json()).conflicts as string[]).length).toBe(1);
    const none = await readRowsAsServiceRole('monthly_bonus_records', { eq: { store_id: ids.ZT02, year_month: MONTH, employee_code: other } });
    expect(none).toHaveLength(0);
    expect(Number((await readBonus(ids.ZT01)).group_bonus)).toBe(5000); // 原資料不受影響
  });

  test('缺檔案 400；resource 不存在 404；GET 寫入資源 404', async () => {
    expect((await importBonus(admin, null)).status()).toBe(400);
    expect((await admin.get(`${TOOLS}/no-such-resource`)).status()).toBe(404);
    expect((await admin.post(`${TOOLS}/no-such-resource`, { data: {} })).status()).toBe(404);
    expect((await admin.get(`${TOOLS}/performance-import`)).status()).toBe(404);
  });
});
