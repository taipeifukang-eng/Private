import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { canonicalWorkbook, seedExportMonth, W02_MONTHS, type SeededMonth } from '../support/w02-fixtures';

// W02 整合層：workspace 匯出 API（包裝舊 /api/export-monthly-status/*）。
// 資料只用 ZT03（草稿）、ZT04（已送審）、ZT05（已確認）與保留月份 2099-02，由 sweeper 清除。
// 檢查：門市狀態、九種匯出的內容與檔案格式、W02-q3（含未提交門市回 400 並列出）、
// W02-q2（單品獎金只檢查登入、支援時數照舊版角色判斷、其餘需 monthly.export.download）、Origin 與方法限制。

const MONTH = W02_MONTHS.integration;
const BASE = '/api/workspace/monthly-export';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const POST_KEYS = ['download', 'actual-staff-points', 'roster', 'transport', 'single-item-bonus', 'talent-cultivation-bonus', 'meal-allowance', 'spring-festival-bonus'] as const;
const GENERAL_KEYS = POST_KEYS.filter((k) => k !== 'single-item-bonus');

let admin: APIRequestContext;
let seed: SeededMonth;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await apiAs('admin');
  seed = await seedExportMonth(admin, MONTH);
});
test.afterAll(async () => {
  await admin?.dispose();
});

async function sheetRows(res: { body(): Promise<Buffer> }) {
  const wb = canonicalWorkbook(await res.body());
  return { names: wb.sheetNames, sheets: wb.sheets };
}
const selected = () => [seed.ids.submitted, seed.ids.confirmed];

test.describe('門市列表與存取', () => {
  test('三種提交狀態與員工人數', async () => {
    const res = await admin.get(`${BASE}/stores`, { params: { year_month: MONTH } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const by = Object.fromEntries((body.stores as any[]).map((s) => [s.store_code, s]));
    expect(by.ZT03).toMatchObject({ store_status: 'pending', total_employees: 2 });
    expect(by.ZT04).toMatchObject({ store_status: 'submitted', total_employees: 3 });
    expect(by.ZT05).toMatchObject({ store_status: 'confirmed', total_employees: 3 });
    expect(by.ZT05.confirmed_count).toBe(3);
    expect(by.ZT04.submitted_count).toBe(3);
  });

  test('年月參數檢查', async () => {
    expect((await admin.get(`${BASE}/stores`)).status()).toBe(400);
    expect((await admin.get(`${BASE}/stores`, { params: { year_month: '2099-13' } })).status()).toBe(400);
  });

  test('access：admin 全開；方法與資源檢查', async () => {
    const access = await (await admin.get(`${BASE}/access`)).json();
    expect(access).toMatchObject({ general: true, singleItem: true, supportHours: true, canOpen: true });
    expect((await admin.post(`${BASE}/access`, { data: {} })).status()).toBe(405);
    expect((await admin.post(`${BASE}/stores`, { data: {} })).status()).toBe(405);
    expect((await admin.get(`${BASE}/download`)).status()).toBe(405);
    expect((await admin.post(`${BASE}/no-such-export`, { data: { year_month: MONTH, store_ids: selected() } })).status()).toBe(404);
    expect((await admin.post(`${BASE}/support-hours`, { data: {} })).status()).toBe(405);
  });
});

test.describe('九種匯出（admin、已送審＋已確認門市）', () => {
  for (const key of POST_KEYS) {
    test(`${key}：200、xlsx、非空`, async () => {
      const res = await admin.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: selected() } });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      expect(res.headers()['content-type']).toContain(XLSX_TYPE);
      const { names, sheets } = await sheetRows(res);
      expect(names.length).toBeGreaterThan(0);
      expect(sheets[0].rowCount).toBeGreaterThanOrEqual(2);
    });
  }

  test('support-hours：一律全部門市（不受所選門市影響）', async () => {
    const res = await admin.get(`${BASE}/support-hours`, { params: { year_month: MONTH } });
    expect(res.status()).toBe(200);
    const { names, sheets } = await sheetRows(res);
    expect(names).toEqual(['門市支援時數']);
    expect(sheets[0].headers).toEqual(['門市代號', '門市名稱', '分店支援時數', '支援分店時數']);
    const codes = Object.keys(sheets[0].cells).filter((a) => /^A\d+$/.test(a)).map((a) => sheets[0].cells[a].v);
    for (const code of ['ZT03', 'ZT04', 'ZT05']) expect(codes).toContain(code); // 草稿門市也在
  });

  test('欄位與內容：單品獎金、交通費、名冊', async () => {
    const single = await sheetRows(await admin.post(`${BASE}/single-item-bonus`, { data: { year_month: MONTH, store_ids: selected() } }));
    expect(single.names).toEqual(['單品獎金']);
    expect(single.sheets[0].headers).toEqual(['門市代號', '月份', '員編', '姓名', '單品獎金總額']);
    expect(single.sheets[0].rowCount).toBe(3); // 兩間門市各一筆支援獎金
    const transport = await sheetRows(await admin.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: selected() } }));
    expect(transport.sheets[0].headers).toEqual(['門市代號', '月份', '員編', '姓名', '交通費', '備註原因']);
    expect(transport.sheets[0].rowCount).toBe(3);
    const roster = await sheetRows(await admin.post(`${BASE}/roster`, { data: { year_month: MONTH, store_ids: selected() } }));
    expect(roster.names).toEqual(['每月門市人員名冊']);
    expect(roster.sheets[0].rowCount).toBe(7); // 表頭 + 6 人（含調出、調入各一）
    const preview = await admin.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: selected().join(',') } });
    expect(preview.status()).toBe(200);
    const rows = (await preview.json()).rows as any[];
    expect(rows.length).toBe(6);
    expect(rows.map((r) => r.monthly_status).sort()).toEqual(['full_month', 'full_month', 'full_month', 'full_month', 'transferred_in', 'transferred_out'].sort());
  });
});

test.describe('W02-q3：含未提交門市直接拒絕', () => {
  for (const key of POST_KEYS) {
    test(`${key}：含草稿門市 → 400 並列出`, async () => {
      const res = await admin.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: [seed.ids.draft, seed.ids.submitted] } });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('ZT03');
      expect(body.error).not.toContain('ZT04');
      expect((body.unsubmitted as any[]).map((s) => s.store_code)).toEqual(['ZT03']);
    });
  }

  test('名冊預覽（GET）同樣拒絕；全部已提交則通過；空門市清單交給舊 handler（400）', async () => {
    const res = await admin.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: [seed.ids.draft, seed.ids.confirmed].join(',') } });
    expect(res.status()).toBe(400);
    expect((await res.json()).unsubmitted[0].store_code).toBe('ZT03');
    const empty = await admin.post(`${BASE}/roster`, { data: { year_month: MONTH, store_ids: [] } });
    expect(empty.status()).toBe(400);
  });

  test('大寫 UUID 不能繞過守衛：含草稿門市仍 400（POST 與名冊預覽）', async () => {
    const upper = [seed.ids.draft.toUpperCase(), seed.ids.submitted.toUpperCase()];
    for (const key of POST_KEYS) {
      const res = await admin.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: upper } });
      expect(res.status(), key).toBe(400);
      expect((await res.json()).unsubmitted.map((s: any) => s.store_code)).toEqual(['ZT03']);
    }
    const preview = await admin.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: upper.join(',') } });
    expect(preview.status()).toBe(400);
  });

  test('非標準 UUID 寫法（大括號、無連字號）與非陣列一律 400', async () => {
    const id = seed.ids.draft;
    for (const bad of [`{${id}}`, id.replace(/-/g, ''), 'not-a-uuid']) {
      const res = await admin.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: [bad, seed.ids.submitted] } });
      expect(res.status(), bad).toBe(400);
    }
    expect((await admin.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: id } })).status()).toBe(400);
  });

  test('大寫 UUID 的已提交門市可正常匯出（送給舊 handler 的是正規化 id）', async () => {
    const res = await admin.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: selected().map((s) => s.toUpperCase()) } });
    expect(res.status()).toBe(200);
    expect((await sheetRows(res)).sheets[0].rowCount).toBe(3);
  });

  test('不在可匯出集合內的門市（不存在／停用）與不合格年月一律 400', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    for (const key of POST_KEYS) {
      const res = await admin.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: [ghost, seed.ids.submitted] } });
      expect(res.status(), key).toBe(400);
      const bad = await admin.post(`${BASE}/${key}`, { data: { year_month: '2099-1', store_ids: selected() } });
      expect(bad.status(), `${key} year_month`).toBe(400);
    }
    const preview = await admin.get(`${BASE}/roster`, { params: { year_month: '2099-1', store_ids: selected().join(',') } });
    expect(preview.status()).toBe(400);
  });

  test('支援時數不受選取影響：草稿門市月份照樣 200', async () => {
    expect((await admin.get(`${BASE}/support-hours`, { params: { year_month: MONTH } })).status()).toBe(200);
  });

  test('多個未提交門市全部列出', async () => {
    const stores = await (await admin.get(`${BASE}/stores`, { params: { year_month: MONTH } })).json();
    const pending = (stores.stores as any[]).filter((s) => s.store_status === 'pending').slice(0, 3);
    const res = await admin.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: pending.map((s) => s.id) } });
    expect(res.status()).toBe(400);
    expect((await res.json()).unsubmitted.length).toBe(pending.length);
  });
});

test.describe('請求檢查', () => {
  test('Origin 不符 → 403（POST）', async () => {
    const res = await admin.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: selected() }, headers: { Origin: 'http://evil.example' } });
    expect(res.status()).toBe(403);
  });
  test('壞 JSON → 400；缺參數由舊 handler 回 400', async () => {
    const bad = await admin.post(`${BASE}/transport`, { headers: { 'Content-Type': 'application/json' }, data: '{not json' });
    expect(bad.status()).toBe(400);
    const missing = await admin.post(`${BASE}/transport`, { data: { year_month: MONTH } });
    expect(missing.status()).toBe(400);
  });
});

test.describe('權限：W02-q1／q2', () => {
  test('ops_assistant（有每月人員狀態、沒有 monthly.export.download）：只有單品獎金可用', async () => {
    const api = await apiAs('ops_assistant');
    try {
      const access = await (await api.get(`${BASE}/access`)).json();
      expect(access).toMatchObject({ general: false, singleItem: true, supportHours: false, canOpen: true });
      for (const key of GENERAL_KEYS) {
        const res = await api.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: selected() } });
        expect(res.status(), key).toBe(403);
      }
      expect((await api.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: selected().join(',') } })).status()).toBe(403);
      const single = await api.post(`${BASE}/single-item-bonus`, { data: { year_month: MONTH, store_ids: selected() } });
      expect(single.status()).toBe(200); // 舊版只檢查登入
      expect((await api.get(`${BASE}/support-hours`, { params: { year_month: MONTH } })).status()).toBe(403);
      const stores = await api.get(`${BASE}/stores`, { params: { year_month: MONTH } });
      expect(stores.status()).toBe(200); // 單品獎金需要選門市（白名單 w02-stores-scoped-for-single-item）
    } finally {
      await api.dispose();
    }
  });

  test('ops_manager（monthly.export.download）：一般匯出全部 200', async () => {
    const api = await apiAs('ops_manager');
    try {
      for (const key of POST_KEYS) {
        const res = await api.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: selected() } });
        expect(res.status(), key).toBe(200);
      }
      expect((await api.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: selected().join(',') } })).status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test('supportHours：照舊版角色判斷（supervisor 角色可、店長不可）', async () => {
    const sup = await apiAs('supervisor');
    const mgr = await apiAs('store_manager');
    try {
      expect((await sup.get(`${BASE}/support-hours`, { params: { year_month: MONTH } })).status()).toBe(200);
      expect((await (await sup.get(`${BASE}/access`)).json()).supportHours).toBe(true);
      // 沒有指派門市的支援時數角色：單品獎金要選得到門市（清單非空）
      const listed = await sup.get(`${BASE}/stores`, { params: { year_month: MONTH } });
      expect(listed.status()).toBe(200);
      expect(((await listed.json()).stores as any[]).length).toBeGreaterThan(0);
      expect((await mgr.get(`${BASE}/support-hours`, { params: { year_month: MONTH } })).status()).toBe(403);
      expect((await (await mgr.get(`${BASE}/access`)).json()).supportHours).toBe(false);
      // 店長看得到入口與單品獎金，一般匯出一律 403
      expect((await (await mgr.get(`${BASE}/access`)).json())).toMatchObject({ general: false, singleItem: true, canOpen: true });
      expect((await mgr.post(`${BASE}/transport`, { data: { year_month: MONTH, store_ids: selected() } })).status()).toBe(403);
    } finally {
      await sup.dispose();
      await mgr.dispose();
    }
  });

  test('denied（無任何權限）：入口關閉、門市列表 403、一般匯出 403；單品獎金與舊版相同只檢查登入', async () => {
    const api = await apiAs('denied');
    try {
      expect(await (await api.get(`${BASE}/access`)).json()).toMatchObject({ general: false, singleItem: false, supportHours: false, canOpen: false });
      expect((await api.get(`${BASE}/stores`, { params: { year_month: MONTH } })).status()).toBe(403);
      expect((await api.post(`${BASE}/download`, { data: { year_month: MONTH, store_ids: selected() } })).status()).toBe(403);
      expect((await api.post(`${BASE}/talent-cultivation-bonus`, { data: { year_month: MONTH, store_ids: selected() } })).status()).toBe(403);
      const session = await (await api.get('/api/workspace/session')).json();
      expect(session.capabilities.monthlyExport).toBe(false);
      expect(session.navigation.flatMap((g: any) => g.items).some((i: any) => i.href === '/admin/export-monthly-status')).toBe(false);
    } finally {
      await api.dispose();
    }
  });

  test('session：資料匯出導覽帶 kind=monthly-export，有權限者才可用', async () => {
    const session = await (await admin.get('/api/workspace/session')).json();
    const item = session.navigation.flatMap((g: any) => g.items).find((i: any) => i.href === '/admin/export-monthly-status');
    expect(item).toMatchObject({ label: '資料匯出', kind: 'monthly-export' });
    expect(session.capabilities.monthlyExport).toBe(true);
  });
});
