import { describe, it, expect } from 'vitest';
import {
  resolveRxLinkDisplay, sumPointValues, formatPointValue, stripRxDerivedKeys,
  buildStoreStatsImportPayload, buildSupportHoursUpdate, NO_DATA_TEXT, isHeadOfficeStoreCode,
} from '@/lib/monthly-stats/rx-link';
import { loadRxLinkForStore } from '@/lib/monthly-stats/rx-link-server';

const full = {
  regular_prescription_count: 1200, regular_prescription_point_value: '1500000.2500',
  chronic_prescription_count: 300, chronic_prescription_point_value: '642411.5000',
};

describe('顯示規則', () => {
  it('完整資料：張數與健保總點值', () => {
    const d = resolveRxLinkDisplay({ report: full, legacySummary: { regular_prescription_count: 9, chronic_prescription_count: 9 } });
    expect(d.regular).toMatchObject({ value: 1200, text: '1,200', source: 'prescription', legacy: false });
    expect(d.chronic).toMatchObject({ value: 300, text: '300', legacy: false });
    expect(d.totalPoint.value).toBe(2142411.75);
    expect(d.totalPoint.text).toBe('2,142,412');
  });
  it('張數 0 是有值，不退回舊值', () => {
    const d = resolveRxLinkDisplay({ report: { ...full, regular_prescription_count: 0 }, legacySummary: { regular_prescription_count: 55 } });
    expect(d.regular).toMatchObject({ value: 0, text: '0', legacy: false });
  });
  it('部分填寫：有值照常顯示，缺的暫無資料，總點值需兩邊都有', () => {
    const d = resolveRxLinkDisplay({
      report: { regular_prescription_count: 10, regular_prescription_point_value: 5000, chronic_prescription_count: null, chronic_prescription_point_value: null },
      legacySummary: null,
    });
    expect(d.regular.text).toBe('10');
    expect(d.chronic.text).toBe(NO_DATA_TEXT);
    expect(d.totalPoint).toEqual({ value: null, text: NO_DATA_TEXT });
  });
  it('無資料：三欄皆暫無資料', () => {
    const d = resolveRxLinkDisplay({ report: null, legacySummary: null });
    expect([d.regular.text, d.chronic.text, d.totalPoint.text]).toEqual([NO_DATA_TEXT, NO_DATA_TEXT, NO_DATA_TEXT]);
  });
  it('退回舊匯入值：處方箋無該月資料時張數用舊值並標示，點值仍暫無資料', () => {
    const d = resolveRxLinkDisplay({ report: null, legacySummary: { regular_prescription_count: 800, chronic_prescription_count: 120 } });
    expect(d.regular).toMatchObject({ text: '800', source: 'legacy', legacy: true });
    expect(d.chronic).toMatchObject({ text: '120', source: 'legacy', legacy: true });
    expect(d.totalPoint.text).toBe(NO_DATA_TEXT);
  });
  it('退回舊匯入值：處方箋該張數為 NULL 時只退回那一欄', () => {
    const d = resolveRxLinkDisplay({
      report: { ...full, chronic_prescription_count: null },
      legacySummary: { regular_prescription_count: 1, chronic_prescription_count: 77 },
    });
    expect(d.regular.legacy).toBe(false);
    expect(d.chronic).toMatchObject({ text: '77', legacy: true });
  });
  it('舊值 0 且處方箋無資料：暫無資料，不顯示 0 舊匯入', () => {
    const d = resolveRxLinkDisplay({ report: null, legacySummary: { regular_prescription_count: 0, chronic_prescription_count: 0 } });
    expect(d.regular).toMatchObject({ value: null, text: '暫無資料', source: 'none', legacy: false });
    expect(d.chronic).toMatchObject({ value: null, text: '暫無資料', source: 'none', legacy: false });
  });
  it('舊值 0 且處方箋張數為 NULL：暫無資料', () => {
    const d = resolveRxLinkDisplay({ report: { ...full, regular_prescription_count: null }, legacySummary: { regular_prescription_count: 0 } });
    expect(d.regular).toMatchObject({ text: '暫無資料', source: 'none', legacy: false });
  });
  it('舊值 0 且處方箋張數 0：顯示 0（處方箋值）', () => {
    const d = resolveRxLinkDisplay({ report: { ...full, regular_prescription_count: 0 }, legacySummary: { regular_prescription_count: 0 } });
    expect(d.regular).toMatchObject({ value: 0, text: '0', source: 'prescription', legacy: false });
  });
  it('舊值 5 且處方箋無資料：5 舊匯入', () => {
    const d = resolveRxLinkDisplay({ report: null, legacySummary: { regular_prescription_count: 5 } });
    expect(d.regular).toMatchObject({ value: 5, text: '5', source: 'legacy', legacy: true });
  });
  it('0000 總公司：一律暫無資料，不退回舊值', () => {
    const d = resolveRxLinkDisplay({ report: full, legacySummary: { regular_prescription_count: 5, chronic_prescription_count: 5 }, isHeadOffice: true });
    expect([d.regular.text, d.chronic.text, d.totalPoint.text]).toEqual([NO_DATA_TEXT, NO_DATA_TEXT, NO_DATA_TEXT]);
    expect(isHeadOfficeStoreCode(' 0000 ')).toBe(true);
    expect(isHeadOfficeStoreCode('0001')).toBe(false);
  });
});

describe('點值相加與格式', () => {
  it('四位小數不產生浮點誤差', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumPointValues('0.1000', '0.2000')).toBe(0.3);
    expect(sumPointValues(1234567.1234, 0.0001)).toBe(1234567.1235);
  });
  it('任一為空不相加', () => {
    expect(sumPointValues(null, 1)).toBeNull();
    expect(sumPointValues(1, '')).toBeNull();
    expect(sumPointValues(undefined, undefined)).toBeNull();
  });
  it('顯示整數千分位，內部保留精度', () => {
    expect(formatPointValue(2142411.4999)).toBe('2,142,411');
    expect(formatPointValue(2142411.5)).toBe('2,142,412');
    expect(formatPointValue(0)).toBe('0');
    expect(formatPointValue(null)).toBe(NO_DATA_TEXT);
    const d = resolveRxLinkDisplay({ report: { ...full, regular_prescription_point_value: '1.0001', chronic_prescription_point_value: '2.0002' }, legacySummary: null });
    expect(d.totalPoint.value).toBe(3.0003);
    expect(d.totalPoint.text).toBe('3');
  });
});

describe('寫入端不再碰兩欄', () => {
  it('匯入 payload 不含一般箋、慢箋，其餘欄位照舊', () => {
    const p = buildStoreStatsImportPayload(
      { 門市人數: '8', 行政人數: '1', 新人人數: '2', 營業天數: '30.5', 毛利: '123456.5', 總來客數: '900', 單純處方加購來客數: '40', 一般箋張數: '777', 慢箋張數: '888' },
      { store_code: 'ZT01', store_name: '測試店' }
    );
    expect(Object.keys(p)).not.toContain('regular_prescription_count');
    expect(Object.keys(p)).not.toContain('chronic_prescription_count');
    expect(p).toEqual({
      store_name: '測試店', store_code: 'ZT01', total_staff_count: 8, admin_staff_count: 1, newbie_count: 2,
      business_days: 30.5, total_gross_profit: 123456.5, total_customer_count: 900, prescription_addon_only_count: 40,
    });
  });
  it('支援時數存檔內容不帶兩欄，且保留其他既有值', () => {
    const u = buildSupportHoursUpdate(
      { total_staff_count: 5, business_days: 30, regular_prescription_count: 10, chronic_prescription_count: 20 },
      { support_to_other_stores_hours: 3, support_from_other_stores_hours: 4 }
    );
    expect('regular_prescription_count' in u).toBe(false);
    expect('chronic_prescription_count' in u).toBe(false);
    expect(u).toMatchObject({ total_staff_count: 5, business_days: 30, support_to_other_stores_hours: 3, support_from_other_stores_hours: 4 });
    expect(buildSupportHoursUpdate(null, { support_to_other_stores_hours: 0, support_from_other_stores_hours: 0 }).total_staff_count).toBe(0);
  });
  it('stripRxDerivedKeys 會濾掉呼叫端多帶的兩欄', () => {
    const out = stripRxDerivedKeys({ a: 1, regular_prescription_count: 5, chronic_prescription_count: 6 } as Record<string, unknown>);
    expect(out).toEqual({ a: 1 });
  });
});

function fakeAdmin(opts: { storeCode?: string | null; report?: any; calls?: string[] }) {
  const calls = opts.calls ?? [];
  return {
    from(table: string) {
      calls.push(table);
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => table === 'stores'
          ? { data: opts.storeCode === null ? null : { id: 's1', store_code: opts.storeCode ?? 'ZT01' }, error: null }
          : { data: opts.report ?? null, error: null },
      };
      return q;
    },
  };
}

describe('伺服端權限把關', () => {
  it('沒有 monthly.status.view_stats：拒絕，且完全不碰資料表', async () => {
    const calls: string[] = [];
    const r = await loadRxLinkForStore({ canViewStats: false, canAccessStore: true, admin: fakeAdmin({ calls, report: full }), yearMonth: '2038-01', storeId: 's1' });
    expect(r.success).toBe(false);
    expect(calls).toEqual([]);
  });
  it('有權限：回傳處方箋資料', async () => {
    const r = await loadRxLinkForStore({ canViewStats: true, canAccessStore: true, admin: fakeAdmin({ report: full }), yearMonth: '2038-01', storeId: 's1' });
    expect(r).toEqual({ success: true, isHeadOffice: false, report: full });
  });
  it('有權限但該月無資料：report 為 null', async () => {
    const r = await loadRxLinkForStore({ canViewStats: true, canAccessStore: true, admin: fakeAdmin({}), yearMonth: '2038-01', storeId: 's1' });
    expect(r).toEqual({ success: true, isHeadOffice: false, report: null });
  });
  it('0000 不查處方箋表', async () => {
    const calls: string[] = [];
    const r = await loadRxLinkForStore({ canViewStats: true, canAccessStore: true, admin: fakeAdmin({ storeCode: '0000', calls, report: full }), yearMonth: '2038-01', storeId: 's1' });
    expect(r).toEqual({ success: true, isHeadOffice: true, report: null });
    expect(calls).toEqual(['stores']);
  });
  it('年月格式錯誤、找不到門市皆失敗', async () => {
    expect((await loadRxLinkForStore({ canViewStats: true, canAccessStore: true, admin: fakeAdmin({}), yearMonth: '2038-13', storeId: 's1' })).success).toBe(false);
    expect((await loadRxLinkForStore({ canViewStats: true, canAccessStore: true, admin: fakeAdmin({ storeCode: null }), yearMonth: '2038-01', storeId: 's1' })).success).toBe(false);
  });
});

describe('門市範圍把關（伺服端函式）', () => {
  it('不在可見門市：拒絕，不碰任何資料表', async () => {
    const calls: string[] = [];
    const r = await loadRxLinkForStore({ canViewStats: true, canAccessStore: false, admin: fakeAdmin({ calls, report: full }), yearMonth: '2038-01', storeId: 's1' });
    expect(r.success).toBe(false);
    expect(calls).toEqual([]);
  });
});
