import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { canonicalWorkbook, seedExportMonth, W02_MONTHS, type SeededMonth } from '../support/w02-fixtures';

// W02 整合層：workspace 匯出 API（包裝舊 /api/export-monthly-status/*）。
// 資料只用 ZT03（草稿）、ZT04（已送審）、ZT05（已確認）與保留月份 2099-02，由 sweeper 清除。
// 檢查：門市狀態、九種匯出的內容與檔案格式、規格 A（含未提交門市照舊版產檔、不再回 400；
// 入口與 9 支匯出、門市清單都只看 monthly.export.download）、Origin 與方法限制。

const MONTH = W02_MONTHS.integration;
const BASE = '/api/workspace/monthly-export';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const POST_KEYS = ['download', 'actual-staff-points', 'roster', 'transport', 'single-item-bonus', 'talent-cultivation-bonus', 'meal-allowance', 'spring-festival-bonus'] as const;

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
    expect(access).toMatchObject({ general: true, canOpen: true });
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

test.describe('規格 A.3：含未提交門市照舊版產檔', () => {
  for (const key of POST_KEYS) {
    test(`${key}：含草稿門市 → 200 產檔`, async () => {
      const res = await admin.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: [seed.ids.draft, seed.ids.submitted] } });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      expect(res.headers()['content-type']).toContain(XLSX_TYPE);
    });
  }

  test('名冊預覽（GET）含草稿門市也回 200 且含草稿門市人員；空門市清單交給舊 handler（400）', async () => {
    const res = await admin.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: [seed.ids.draft, seed.ids.confirmed].join(',') } });
    expect(res.status()).toBe(200);
    expect(((await res.json()).rows as any[]).length).toBeGreaterThan(0);
    const empty = await admin.post(`${BASE}/roster`, { data: { year_month: MONTH, store_ids: [] } });
    expect(empty.status()).toBe(400);
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

  test('不存在的門市與不合格年月一律 400（基本格式檢查；已停用門市交給舊 handler，以單元測試驗證）', async () => {
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

test.describe('權限：規格 A.1（全部只看 monthly.export.download）', () => {
  for (const role of ['ops_assistant', 'store_manager', 'denied'] as const) {
    test(`${role}（沒有 monthly.export.download）：入口關閉，10 支匯出與門市清單全部 403`, async () => {
      const api = await apiAs(role);
      try {
        expect(await (await api.get(`${BASE}/access`)).json()).toMatchObject({ general: false, canOpen: false });
        for (const key of POST_KEYS) {
          const res = await api.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: selected() } });
          expect(res.status(), key).toBe(403);
        }
        expect((await api.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: selected().join(',') } })).status()).toBe(403);
        expect((await api.get(`${BASE}/support-hours`, { params: { year_month: MONTH } })).status()).toBe(403);
        expect((await api.get(`${BASE}/stores`, { params: { year_month: MONTH } })).status()).toBe(403);
        const session = await (await api.get('/api/workspace/session')).json();
        expect(session.capabilities.monthlyExport).toBe(false);
        expect(session.navigation.flatMap((g: any) => g.items).some((i: any) => i.href === '/admin/export-monthly-status')).toBe(false);
      } finally {
        await api.dispose();
      }
    });
  }

  test('ops_manager（monthly.export.download）：9 支匯出（含單品獎金）與支援時數全部 200', async () => {
    const api = await apiAs('ops_manager');
    try {
      for (const key of POST_KEYS) {
        const res = await api.post(`${BASE}/${key}`, { data: { year_month: MONTH, store_ids: selected() } });
        expect(res.status(), key).toBe(200);
      }
      expect((await api.get(`${BASE}/roster`, { params: { year_month: MONTH, store_ids: selected().join(',') } })).status()).toBe(200);
      expect((await api.get(`${BASE}/support-hours`, { params: { year_month: MONTH } })).status()).toBe(200);
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

test.describe('規格 A.2：不限門市', () => {
  test('ops_manager：門市清單為全部啟用門市（含沒有任命的門市），含草稿門市的單品獎金可匯出', async () => {
    const api = await apiAs('ops_manager');
    try {
      const listed = await api.get(`${BASE}/stores`, { params: { year_month: MONTH } });
      expect(listed.status()).toBe(200);
      const adminList = await (await admin.get(`${BASE}/stores`, { params: { year_month: MONTH } })).json();
      const codes = ((await listed.json()).stores as any[]).map((s) => s.store_code).sort();
      expect(codes).toEqual((adminList.stores as any[]).map((s) => s.store_code).sort());
      const res = await api.post(`${BASE}/single-item-bonus`, { data: { year_month: MONTH, store_ids: [seed.ids.draft, ...selected()] } });
      expect(res.status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });
});
