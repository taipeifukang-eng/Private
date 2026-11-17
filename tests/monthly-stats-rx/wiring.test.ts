// 接線測試：呼叫實際的匯入 API 路由與 server action（mock supabase），
// 確認寫入內容不含一般箋/慢箋兩欄，以及處方箋讀取的門市範圍把關。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

const state: {
  calls: Array<{ table: string; op: string; payload?: any }>;
  snapshotCodes: string[];
  visibleStoreIds: string[];
  existingSummaryId: string | null;
  rxRead: number;
} = { calls: [], snapshotCodes: [], visibleStoreIds: [], existingSummaryId: null, rxRead: 0 };

function makeChain(table: string) {
  let op = 'select';
  const result = (): any => {
    if (table === 'profiles') return { data: { role: 'admin', department: '營業部', job_title: 'x' }, error: null };
    if (table === 'stores') {
      const ids = Array.from(new Set(['st1', ...state.visibleStoreIds]));
      return { data: ids.map((i) => ({ id: i, store_code: i === 'st1' ? 'ZT01' : i, store_name: i, is_active: true })), error: null };
    }
    if (table === 'store_managers') {
      return { data: state.visibleStoreIds.map((i) => ({ id: 'm' + i, store_id: i, role_type: 'store_manager', store: { id: i, store_code: i, is_active: true } })), error: null };
    }
    if (table === 'monthly_store_summary' && op === 'select') {
      return { data: state.existingSummaryId ? [{ id: state.existingSummaryId, store_id: 'st1' }] : [], error: null };
    }
    if (table === 'monthly_staff_status') return { data: [], error: null };
    return { data: { id: 'new1' }, error: null };
  };
  const q: any = {
    select: () => q, eq: () => q, in: () => q, order: () => q,
    insert: (p: any) => { op = 'insert'; state.calls.push({ table, op, payload: p }); return q; },
    update: (p: any) => { op = 'update'; state.calls.push({ table, op, payload: p }); return q; },
    single: async () => result(),
    maybeSingle: async () => (table === 'monthly_store_summary'
      ? { data: state.existingSummaryId ? { id: state.existingSummaryId } : null, error: null }
      : result()),
    then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
  };
  return q;
}

const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from: (t: string) => makeChain(t),
};
const fakeAdmin = {
  from: (t: string) => {
    if (t === 'monthly_prescription_reports') state.rxRead++;
    const q: any = {
      select: () => q, eq: () => q,
      maybeSingle: async () => (t === 'stores'
        ? { data: { id: 'st1', store_code: 'ZT01' }, error: null }
        : { data: { regular_prescription_count: 1, regular_prescription_point_value: 1, chronic_prescription_count: 1, chronic_prescription_point_value: 1 }, error: null }),
    };
    return q;
  },
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => fakeSupabase,
  createAdminClient: () => fakeAdmin,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/permissions/snapshot', () => ({
  loadPermissionSnapshot: async () => ({ has: (c: string) => state.snapshotCodes.includes(c), profile: { role: 'member' } }),
  loadLegacyPermissionSnapshot: async () => ({ has: (c: string) => state.snapshotCodes.includes(c), profile: { role: 'member' } }),
}));

beforeEach(() => {
  state.calls = []; state.snapshotCodes = []; state.visibleStoreIds = []; state.existingSummaryId = null; state.rxRead = 0;
});

const RX_KEYS = ['regular_prescription_count', 'chronic_prescription_count'];
const hasRx = (p: any) => RX_KEYS.some((k) => k in (p ?? {}));
const summaryWrites = () => state.calls.filter((c) => c.table === 'monthly_store_summary' && (c.op === 'insert' || c.op === 'update'));

function importRequest() {
  const ws = XLSX.utils.json_to_sheet([{
    門市代號: 'ZT01', 門市人數: 5, 行政人數: 1, 新人人數: 0, 營業天數: 30, 毛利: 1000, 總來客數: 800,
    單純處方加購來客數: 3, 一般箋張數: 999, 慢箋張數: 888,
  }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 's');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const file = new File([buf], 'x.xlsx');
  return { formData: async () => ({ get: (k: string) => (k === 'file' ? file : k === 'yearMonth' ? '2038-01' : null) }) } as any;
}

describe('匯入門市統計路由', () => {
  for (const existing of [null, 'sum1']) {
    it(`${existing ? '更新既有列' : '新增列'}：寫入內容不含一般箋/慢箋（即使 Excel 有這兩欄）`, async () => {
      state.existingSummaryId = existing;
      const { POST } = await import('@/app/api/import-store-stats/route');
      await POST(importRequest());
      const writes = summaryWrites();
      expect(writes.length).toBe(1);
      expect(writes[0].op).toBe(existing ? 'update' : 'insert');
      expect(hasRx(writes[0].payload)).toBe(false);
      expect(writes[0].payload.total_staff_count).toBe(5);
    });
  }
});

describe('updateStoreMonthlySummary（支援時數存檔）', () => {
  for (const existing of [null, 'sum1']) {
    it(`${existing ? '更新' : '新增'}：呼叫端多帶兩欄也不寫入`, async () => {
      state.existingSummaryId = existing;
      const { updateStoreMonthlySummary } = await import('@/app/store/actions');
      const r = await updateStoreMonthlySummary('2038-01', 'st1', {
        total_staff_count: 1, admin_staff_count: 0, newbie_count: 0, business_days: 1, total_gross_profit: 1,
        total_customer_count: 1, prescription_addon_only_count: 0, support_to_other_stores_hours: 2,
        regular_prescription_count: 77, chronic_prescription_count: 66,
      } as any);
      expect(r.success).toBe(true);
      const writes = summaryWrites();
      expect(writes.length).toBe(1);
      expect(hasRx(writes[0].payload)).toBe(false);
      expect(writes[0].payload.support_to_other_stores_hours).toBe(2);
    });
  }
});

describe('getStoreMonthlyRxLink 權限與門市範圍', () => {
  it('有 view_stats 但門市不在可見範圍：拒絕，且不讀處方箋表', async () => {
    state.snapshotCodes = ['monthly.status.view_stats', 'monthly.status.view_own'];
    state.visibleStoreIds = ['other-store'];
    const { getStoreMonthlyRxLink } = await import('@/app/store/actions');
    const r: any = await getStoreMonthlyRxLink('2038-01', 'st1');
    expect(r.success).toBe(false);
    expect(state.rxRead).toBe(0);
  });
  it('有 view_stats 且門市在被指派範圍：可讀', async () => {
    state.snapshotCodes = ['monthly.status.view_stats', 'monthly.status.view_own'];
    state.visibleStoreIds = ['st1'];
    const { getStoreMonthlyRxLink } = await import('@/app/store/actions');
    const r: any = await getStoreMonthlyRxLink('2038-01', 'st1');
    expect(r.success).toBe(true);
    expect(state.rxRead).toBe(1);
  });
  it('有 view_all：任何門市可讀', async () => {
    state.snapshotCodes = ['monthly.status.view_stats', 'monthly.status.view_all'];
    const { getStoreMonthlyRxLink } = await import('@/app/store/actions');
    expect(((await getStoreMonthlyRxLink('2038-01', 'st1')) as any).success).toBe(true);
  });
  it('沒有 view_stats（只有 view_all）：拒絕', async () => {
    state.snapshotCodes = ['monthly.status.view_all'];
    const { getStoreMonthlyRxLink } = await import('@/app/store/actions');
    expect(((await getStoreMonthlyRxLink('2038-01', 'st1')) as any).success).toBe(false);
    expect(state.rxRead).toBe(0);
  });
  it('有 view_stats 但沒有任何門市檢視權限：拒絕', async () => {
    state.snapshotCodes = ['monthly.status.view_stats'];
    const { getStoreMonthlyRxLink } = await import('@/app/store/actions');
    expect(((await getStoreMonthlyRxLink('2038-01', 'st1')) as any).success).toBe(false);
    expect(state.rxRead).toBe(0);
  });
});
