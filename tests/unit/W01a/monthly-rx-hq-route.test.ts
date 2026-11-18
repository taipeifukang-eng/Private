import { beforeEach, describe, expect, it, vi } from 'vitest';

// 總公司 0000：路由層不依賴 DEV 資料的測試（DEV 的 stores 表沒有 0000，e2e 與整合的 0000 案例會被略過）。
// 用假 ctx（管理員）與含 0000 的門市清單，直接呼叫名冊 GET 與 tools?op=meta，驗證回應的 meta.rx 為暫無資料、
// 而且處方箋表完全沒有被查詢（0000 不查表）。對照組：一般門市會查表並顯示數字。

const HQ = { id: 'hq-id', store_code: '0000', store_name: '總公司', is_active: true };
const ZT = { id: 'zt-id', store_code: 'ZT01', store_name: 'ZT 測試門市 01', is_active: true };
const touched: string[] = [];
const REPORT = { regular_prescription_count: 321, regular_prescription_point_value: '1000', chronic_prescription_count: 45, chronic_prescription_point_value: '500' };

/** 可鏈接、可 await 的假查詢：記錄查了哪張表；處方箋表回一筆資料，其餘回空陣列。 */
function chain(table: string): any {
  const result = table === 'monthly_prescription_reports' ? { data: REPORT, error: null } : { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      if (prop === 'maybeSingle' || prop === 'single') return async () => result;
      return () => q;
    },
    apply: () => q,
  });
  return q;
}
function fakeCtx() {
  const admin = { from: (t: string) => (touched.push(t), chain(t)) };
  const auth = { from: (t: string) => chain(t), rpc: async () => ({ data: { records: [], summary: { store_status: 'draft', updated_at: 'V1' } }, error: null }) };
  return { isAdmin: true, permissions: new Set<string>(), has: () => true, user: { id: 'u1' }, auth, admin, prefetched: undefined } as any;
}

vi.mock('@/lib/workspace/modules', () => ({
  moduleContext: async () => fakeCtx(),
  moduleStores: async () => [HQ, ZT],
  requireStore: async (_c: unknown, _m: string, id: string) => {
    const s = [HQ, ZT].find((x) => x.id === id);
    if (!s) throw new Error('403');
    return s;
  },
  isAssignedTo: async () => false,
  monthValue: (v: string | null) => v || '2099-03',
}));
vi.mock('@/app/store/actions', () => ({
  getStoreMonthlySummary: async () => ({ success: true, data: { total_staff_count: 3, regular_prescription_count: 5, chronic_prescription_count: 7, updated_at: 'V1', store_status: 'draft' } }),
  getMonthlyStaffStatus: async () => ({ success: true, data: [] }),
  initializeMonthlyStatus: vi.fn(),
  submitStoreStatus: vi.fn(),
  confirmStoreStatus: vi.fn(),
  revertSubmitStatus: vi.fn(),
  unconfirmStoreStatus: vi.fn(),
  exportMonthlyStatusForBonus: vi.fn(),
}));
vi.mock('@/app/api/export-single-item-bonus-pdf/route', () => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/app/api/monthly-status/bonus-details/route', () => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/app/api/monthly-status/bonus-quarter-summary/route', () => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/app/api/performance-data/route', () => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/app/api/import-performance/route', () => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/app/api/import-store-stats/route', () => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/lib/workspace/monthly-quarter', () => ({ monthlyQuarterSummary: vi.fn() }));
vi.mock('@/lib/workspace/activity-view', () => ({ activityDetailResponse: vi.fn(), activityListResponse: vi.fn() }));
vi.mock('@/lib/workspace/monthly-tools', () => ({ monthlyTools: vi.fn(), toolFor: vi.fn(), permit: vi.fn(), editableMonth: vi.fn(), validateAllowance: vi.fn() }));

const NODATA = '暫無資料';
const texts = (rx: any) => [rx.regular.text, rx.chronic.text, rx.totalPoint.text];
const url = (path: string, store: string) => new Request(`http://localhost${path}?month=2099-03&store=${store}`);

describe('總公司 0000 路由層（假 ctx，不連資料庫）', () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it('名冊 GET：0000 的 meta.rx 三格暫無資料、isHeadOffice 為 true，且沒有查處方箋表', async () => {
    const { GET } = await import('@/app/api/workspace/monthly/route');
    const res = await GET(url('/api/workspace/monthly', HQ.id));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(texts(json.meta.rx)).toEqual([NODATA, NODATA, NODATA]);
    expect(json.meta.rx.isHeadOffice).toBe(true);
    expect(touched).not.toContain('monthly_prescription_reports');
  });

  it('tools?op=meta：0000 三格暫無資料（不退回舊匯入的 5／7），且沒有查處方箋表', async () => {
    const { GET } = await import('@/app/api/workspace/monthly/tools/route');
    const res = await GET(url('/api/workspace/monthly/tools', HQ.id));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(texts(json.rx)).toEqual([NODATA, NODATA, NODATA]);
    expect(json.rx.isHeadOffice).toBe(true);
    expect(touched).not.toContain('monthly_prescription_reports');
  });

  it('對照組：一般門市兩條路徑都會查處方箋表並顯示數字', async () => {
    const roster = await (await (await import('@/app/api/workspace/monthly/route')).GET(url('/api/workspace/monthly', ZT.id))).json() as any;
    expect(texts(roster.meta.rx)).toEqual(['321', '45', '1,500']);
    const tools = await (await (await import('@/app/api/workspace/monthly/tools/route')).GET(url('/api/workspace/monthly/tools', ZT.id))).json() as any;
    expect(texts(tools.rx)).toEqual(['321', '45', '1,500']);
    expect(touched.filter((t) => t === 'monthly_prescription_reports')).toHaveLength(2);
  });
});
