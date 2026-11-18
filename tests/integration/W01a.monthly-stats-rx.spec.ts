import { expect, test, type APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs } from '../support/auth';
import { runIdOrThrow, testStoreIds } from '../support/w01a-fixtures';
import { RxFixture, rxTexts } from '../support/rx-link-fixtures';

// 每月人員狀態「該月營業狀態」接業績管理處方箋（新版）整合層。
// 規則（與舊版已上線一致）：處方箋有值（含 0）用處方箋；沒有時舊匯入非 0 才顯示並標「舊匯入」，否則暫無資料；
// 健保總點值＝一般＋慢箋點值（兩邊都有才算）；總公司 0000 一律暫無資料；即時讀取；權限 monthly.status.view_stats ＋門市範圍。
// 資料：測試門市 ZT01～ZT03（ZT04 當跨店對象）、保留月份 2099-03／2099-04（處方箋表已列入 sweeper 保留月份）。

const M1 = '2099-03';
const M2 = '2099-04';
const fx = new RxFixture();
let admin: APIRequestContext;
let ids: Record<string, string>;
const apis: APIRequestContext[] = [];

async function as(key: string) {
  const a = await apiAs(key);
  apis.push(a);
  return a;
}
const metaOf = async (api: APIRequestContext, store: string, month: string) => {
  const res = await api.get('/api/workspace/monthly/tools', { params: { month, store, op: 'meta' } });
  return { status: res.status(), json: await res.json().catch(() => ({})) };
};
const rosterOf = async (api: APIRequestContext, store: string, month: string) => {
  const res = await api.get('/api/workspace/monthly', { params: { month, store } });
  return { status: res.status(), json: await res.json().catch(() => ({})) };
};
const STATS = { total_staff_count: 3, admin_staff_count: 0, newbie_count: 0, business_days: 20, total_gross_profit: 1000, total_customer_count: 100, prescription_addon_only_count: 1 };

test.beforeAll(async () => {
  runIdOrThrow();
  admin = await apiAs('admin');
  ids = await testStoreIds(admin, M1);
});
test.afterAll(async () => {
  await fx.restore();
  for (const a of [admin, ...apis]) await a?.dispose();
});

test.describe('讀取規則（管理員，兩條路徑結果相同）', () => {
  test('處方箋有值含 0：三格用處方箋，總點值千分位整數，名冊 meta 與 op=meta 相同', async () => {
    await fx.legacy(ids.ZT01, M1, 9, 9); // 舊匯入值存在也不能蓋過處方箋
    await fx.report(admin, ids.ZT01, M1, { regular: 1200, regularPoint: 1500000.25, chronic: 0, chronicPoint: 642411.5 });
    const tools = await metaOf(admin, ids.ZT01, M1);
    expect(tools.status).toBe(200);
    expect(rxTexts(tools.json)).toEqual(['1,200', '0', '2,142,412']);
    expect(tools.json.rx.regular.legacy).toBe(false);
    expect(tools.json.rx.chronic.legacy).toBe(false);
    expect(tools.json.rx.totalPoint.value).toBe(2142411.75);
    const roster = await rosterOf(admin, ids.ZT01, M1);
    expect(roster.status).toBe(200);
    expect(roster.json.meta.rx).toEqual(tools.json.rx);
    // 兩個舊欄位不再出現在 meta.stats
    expect(tools.json.stats).not.toHaveProperty('regular_prescription_count');
    expect(tools.json.stats).not.toHaveProperty('chronic_prescription_count');
    expect(tools.json.stats).toHaveProperty('prescription_addon_only_count');
  });

  test('處方箋張數為空：只有該欄退回舊匯入（非 0 標舊匯入），另一欄照處方箋', async () => {
    await fx.legacy(ids.ZT02, M1, 5, 7);
    await fx.report(admin, ids.ZT02, M1, { regular: null, chronic: 0 });
    const m = (await metaOf(admin, ids.ZT02, M1)).json;
    expect(m.rx.regular).toMatchObject({ text: '5', legacy: true });
    expect(m.rx.chronic).toMatchObject({ text: '0', legacy: false }); // 0 是有值，不退回舊值 7
    expect(m.rx.totalPoint.text).toBe('暫無資料'); // 點值都沒有
  });

  test('沒有處方箋：舊匯入非 0 標舊匯入、舊匯入 0 顯示暫無資料；舊值不會寫成處方箋', async () => {
    await fx.legacy(ids.ZT03, M1, 5, 0);
    const m = (await metaOf(admin, ids.ZT03, M1)).json;
    expect(m.rx.regular).toMatchObject({ text: '5', legacy: true });
    expect(m.rx.chronic).toMatchObject({ text: '暫無資料', legacy: false });
    expect(m.rx.totalPoint).toMatchObject({ text: '暫無資料', value: null });
  });

  test('完全沒有任何資料：三格暫無資料（不是 0）', async () => {
    const m = (await metaOf(admin, ids.ZT03, M2)).json;
    expect(rxTexts(m)).toEqual(['暫無資料', '暫無資料', '暫無資料']);
  });

  test('總公司 0000：一律暫無資料', async () => {
    const list = await (await admin.get('/api/workspace/monthly', { params: { month: M1 } })).json();
    const hq = (list.allStores as { id: string; store_code: string; is_active?: boolean }[]).find((s) => s.store_code === '0000' && s.is_active !== false);
    test.skip(!hq, 'DEV 沒有有效的 0000 門市');
    const m = (await metaOf(admin, hq!.id, M1)).json;
    expect(rxTexts(m)).toEqual(['暫無資料', '暫無資料', '暫無資料']);
    expect(m.rx.isHeadOffice).toBe(true);
  });

  test('即時讀取：處方箋修改後 meta 立即變動，月度統計表沒有被複製寫入；已送審月份也跟著變', async () => {
    await fx.legacy(ids.ZT01, M2, 0, 0, 'submitted');
    const before = await fx.legacyOf(ids.ZT01, M2);
    await fx.report(admin, ids.ZT01, M2, { regular: 10, regularPoint: 1000, chronic: 2, chronicPoint: 200 });
    expect(rxTexts((await metaOf(admin, ids.ZT01, M2)).json)).toEqual(['10', '2', '1,200']);
    await fx.report(admin, ids.ZT01, M2, { regular: 11, regularPoint: 1100, chronic: 3, chronicPoint: 300 });
    expect(rxTexts((await metaOf(admin, ids.ZT01, M2)).json)).toEqual(['11', '3', '1,400']);
    const roster = (await rosterOf(admin, ids.ZT01, M2)).json;
    expect(roster.storeStatus).toBe('submitted');
    expect(rxTexts(roster.meta)).toEqual(['11', '3', '1,400']);
    expect(await fx.legacyOf(ids.ZT01, M2)).toEqual(before); // 舊欄位完全沒被動
    // 處方箋清空（張數 NULL）後退回舊匯入；舊值 0 則暫無資料
    await fx.report(admin, ids.ZT01, M2, { regular: null, chronic: null });
    expect(rxTexts((await metaOf(admin, ids.ZT01, M2)).json)).toEqual(['暫無資料', '暫無資料', '暫無資料']);
  });
});

test.describe('權限與門市範圍', () => {
  test('沒有 view_stats 的角色：meta 不含 stats 也不含 rx（名冊與 op=meta 都是）', async () => {
    await fx.report(admin, ids.ZT01, M1, { regular: 1200, regularPoint: 1, chronic: 300, chronicPoint: 2 });
    for (const key of ['monthly_view', 'ops_assistant', 'navigation']) {
      const api = await as(key);
      const tools = await metaOf(api, ids.ZT01, M1);
      const roster = await rosterOf(api, ids.ZT01, M1);
      if (tools.status !== 200) {
        expect([403]).toContain(tools.status);
        continue;
      }
      expect(tools.json.capabilities.viewStats, key).toBe(false);
      expect(tools.json, key).not.toHaveProperty('rx');
      expect(tools.json.stats, key).toEqual({});
      expect(roster.json.meta, key).not.toHaveProperty('rx');
      expect(JSON.stringify(roster.json), key).not.toContain('1,200');
    }
  });

  test('view_all + view_stats（店長）與應用層管理員：看得到', async () => {
    await fx.report(admin, ids.ZT01, M1, { regular: 1200, regularPoint: 1, chronic: 300, chronicPoint: 2 });
    for (const key of ['store_manager', 'admin']) {
      const api = key === 'admin' ? admin : await as(key);
      const m = await metaOf(api, ids.ZT01, M1);
      expect(m.status, key).toBe(200);
      expect(rxTexts(m.json), key).toEqual(['1,200', '300', '3']);
    }
  });

  test('只有 view_own 的督導：被指派門市看得到、非指派門市 403 且不洩漏處方箋值', async () => {
    await fx.report(admin, ids.ZT01, M1, { regular: 1200, regularPoint: 1, chronic: 300, chronicPoint: 2 });
    const sup = await as('supervisor');
    const mine = await metaOf(sup, ids.ZT01, M1);
    expect(mine.status).toBe(200);
    expect(rxTexts(mine.json)).toEqual(['1,200', '300', '3']);
    test.skip(!ids.ZT04, 'DEV 缺少 ZT04（跨店對象）');
    await fx.report(admin, ids.ZT04, M1, { regular: 777, regularPoint: 1, chronic: 1, chronicPoint: 1 });
    const other = await metaOf(sup, ids.ZT04, M1);
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.json)).not.toContain('777');
    const roster = await rosterOf(sup, ids.ZT04, M1);
    expect(roster.status).toBe(403);
    expect(JSON.stringify(roster.json)).not.toContain('777');
  });
});

test.describe('寫入端：兩個張數欄位不再被寫入', () => {
  test('op=stats：多送兩欄被忽略（200、不寫入）；只送其餘 7 欄也成功', async () => {
    await fx.legacy(ids.ZT02, M2, 5, 6);
    const version = (await metaOf(admin, ids.ZT02, M2)).json.version;
    const res = await admin.post('/api/workspace/monthly/tools', { data: { op: 'stats', store: ids.ZT02, month: M2, version, updates: { ...STATS, regular_prescription_count: 999, chronic_prescription_count: 888 } } });
    expect(res.status(), await res.text()).toBe(200);
    expect(await fx.legacyOf(ids.ZT02, M2)).toEqual({ regular_prescription_count: 5, chronic_prescription_count: 6 });
    const m = (await metaOf(admin, ids.ZT02, M2)).json;
    expect(m.stats.total_staff_count).toBe(3);
    const res2 = await admin.post('/api/workspace/monthly/tools', { data: { op: 'stats', store: ids.ZT02, month: M2, version: m.version, updates: { ...STATS, total_staff_count: 4 } } });
    expect(res2.status(), await res2.text()).toBe(200);
    expect((await metaOf(admin, ids.ZT02, M2)).json.stats.total_staff_count).toBe(4);
    expect(await fx.legacyOf(ids.ZT02, M2)).toEqual({ regular_prescription_count: 5, chronic_prescription_count: 6 });
    // 其餘 7 欄仍必填：少一欄仍是 400（行為不變）
    const { total_staff_count: _drop, ...partial } = STATS;
    const bad = await admin.post('/api/workspace/monthly/tools', { data: { op: 'stats', store: ids.ZT02, month: M2, version: (await metaOf(admin, ids.ZT02, M2)).json.version, updates: partial } });
    expect(bad.status()).toBe(400);
  });

  test('匯入門市統計（kind=stats）：Excel 即使帶兩欄也不寫入，既有舊值保留', async () => {
    await fx.legacy(ids.ZT03, M2, 5, 6);
    const sheet = XLSX.utils.json_to_sheet([{ 門市代號: 'ZT03', 門市人數: 6, 行政人數: 1, 新人人數: 0, 營業天數: 20, 毛利: 5000, 總來客數: 300, 單純處方加購來客數: 2, 一般箋張數: 999, 慢箋張數: 888 }]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '統計');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const res = await admin.post('/api/workspace/monthly/tools', {
      multipart: { kind: 'stats', month: M2, file: { name: 'stats.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const m = (await metaOf(admin, ids.ZT03, M2)).json;
    expect(m.stats.total_staff_count).toBe(6);
    expect(await fx.legacyOf(ids.ZT03, M2)).toEqual({ regular_prescription_count: 5, chronic_prescription_count: 6 });
    expect(m.rx.regular).toMatchObject({ text: '5', legacy: true });
  });
});
