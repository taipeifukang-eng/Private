import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMonthlyMeta, buildRxMeta, fetchMonthlyRx } from '../../../lib/workspace/monthly-meta';

// 每月人員狀態接業績管理處方箋（新版）：meta.rx 區塊、讀取函式、路由接線。純單元，不連資料庫。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function ctx(perms: string[], admin: any = {}, isAdmin = false) {
  const permissions = new Set(perms);
  return { permissions, isAdmin, has: (...c: string[]) => isAdmin || c.some((x) => permissions.has(x)), user: { id: 'u1' }, auth: {}, admin } as any;
}
/** 假的 admin client：記錄查了哪些表與條件。 */
function fakeAdmin(result: { data?: any; error?: any; throws?: boolean }) {
  const calls: { table: string; eq: [string, unknown][] }[] = [];
  return {
    calls,
    from(table: string) {
      const c = { table, eq: [] as [string, unknown][] };
      calls.push(c);
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (c.eq.push([k, v]), q),
        maybeSingle: async () => {
          if (result.throws) throw new Error('boom');
          return { data: result.data ?? null, error: result.error ?? null };
        },
      };
      return q;
    },
  };
}
const REPORT = { regular_prescription_count: 1200, regular_prescription_point_value: '1500000.2500', chronic_prescription_count: 0, chronic_prescription_point_value: '642411.5000' };
const P = { storeId: 's1', storeCode: 'ZT01', month: '2099-03' };

describe('fetchMonthlyRx：權限、0000、失敗', () => {
  it('沒有 view_stats：不碰處方箋表、回 undefined', async () => {
    const admin = fakeAdmin({ data: REPORT });
    expect(await fetchMonthlyRx(ctx(['monthly.status.view_all'], admin), P)).toBeUndefined();
    expect(admin.calls).toEqual([]);
  });
  it('有 view_stats：以年月與門市讀一筆', async () => {
    const admin = fakeAdmin({ data: REPORT });
    const r = await fetchMonthlyRx(ctx(['monthly.status.view_stats'], admin), P);
    expect(r).toEqual({ isHeadOffice: false, report: REPORT });
    expect(admin.calls).toHaveLength(1);
    expect(admin.calls[0].table).toBe('monthly_prescription_reports');
    expect(admin.calls[0].eq).toEqual([['year_month', '2099-03'], ['store_id', 's1']]);
  });
  it('應用層 admin（isAdmin）視同有 view_stats', async () => {
    const admin = fakeAdmin({ data: null });
    expect(await fetchMonthlyRx(ctx([], admin, true), P)).toEqual({ isHeadOffice: false, report: null });
  });
  it('總公司 0000 不查表', async () => {
    const admin = fakeAdmin({ data: REPORT });
    expect(await fetchMonthlyRx(ctx(['monthly.status.view_stats'], admin), { ...P, storeCode: '0000' })).toEqual({ isHeadOffice: true, report: null });
    expect(admin.calls).toEqual([]);
  });
  it('讀取錯誤或丟例外：只標 failed，不丟錯', async () => {
    expect(await fetchMonthlyRx(ctx(['monthly.status.view_stats'], fakeAdmin({ error: { message: 'x' } })), P)).toEqual({ failed: true });
    expect(await fetchMonthlyRx(ctx(['monthly.status.view_stats'], fakeAdmin({ throws: true })), P)).toEqual({ failed: true });
  });
});

describe('buildRxMeta：顯示規則（與舊版同一組純函式）', () => {
  it('處方箋有值含 0 用處方箋；總點值千分位整數', () => {
    const m: any = buildRxMeta({ isHeadOffice: false, report: REPORT }, { regular_prescription_count: 9, chronic_prescription_count: 9 });
    expect(m.failed).toBe(false);
    expect([m.regular.text, m.regular.legacy]).toEqual(['1,200', false]);
    expect([m.chronic.text, m.chronic.legacy]).toEqual(['0', false]);
    expect(m.totalPoint).toEqual({ value: 2142411.75, text: '2,142,412' });
  });
  it('沒有處方箋：舊匯入非 0 標舊匯入、0 暫無資料', () => {
    const m: any = buildRxMeta({ isHeadOffice: false, report: null }, { regular_prescription_count: 5, chronic_prescription_count: 0 });
    expect([m.regular.text, m.regular.legacy]).toEqual(['5', true]);
    expect([m.chronic.text, m.chronic.legacy]).toEqual(['暫無資料', false]);
    expect(m.totalPoint.text).toBe('暫無資料');
  });
  it('0000 一律暫無資料，不退回舊值', () => {
    const m: any = buildRxMeta({ isHeadOffice: true, report: null }, { regular_prescription_count: 5, chronic_prescription_count: 7 });
    expect([m.regular.text, m.chronic.text, m.totalPoint.text]).toEqual(['暫無資料', '暫無資料', '暫無資料']);
    expect(m.isHeadOffice).toBe(true);
  });
  it('failed 不帶任何數值（不退回舊值）', () => {
    expect(buildRxMeta({ failed: true }, { regular_prescription_count: 5 })).toEqual({ failed: true });
  });
});

describe('buildMonthlyMeta：rx 區塊與欄位權限', () => {
  const summary = { total_staff_count: 8, regular_prescription_count: 2, chronic_prescription_count: 3, updated_at: 'V1', store_status: 'draft' };
  it('有 view_stats 才有 rx；沒有時 rx 與 stats 都不出現（即使呼叫端傳了 rx）', async () => {
    const withPerm: any = await buildMonthlyMeta(ctx(['monthly.status.view_stats']), summary, { isHeadOffice: false, report: REPORT });
    expect(withPerm.rx.regular.text).toBe('1,200');
    expect(withPerm.stats).not.toHaveProperty('regular_prescription_count');
    expect(withPerm.stats).not.toHaveProperty('chronic_prescription_count');
    const without: any = await buildMonthlyMeta(ctx(['monthly.status.view_all']), summary, { isHeadOffice: false, report: REPORT });
    expect(without).not.toHaveProperty('rx');
    expect(without.stats).toEqual({});
  });
  it('rx 讀取失敗：只標 failed，其餘 meta 照常', async () => {
    const meta: any = await buildMonthlyMeta(ctx(['monthly.status.view_stats', 'monthly.status.edit']), summary, { failed: true });
    expect(meta.rx).toEqual({ failed: true });
    expect(meta.stats.total_staff_count).toBe(8);
    expect(meta.version).toBe('V1');
    expect(meta.capabilities.editStats).toBe(true);
  });
});

describe('路由與畫面接線', () => {
  const roster = read('app/api/workspace/monthly/route.ts');
  const tools = read('app/api/workspace/monthly/tools/route.ts');
  it('名冊 GET：rx 讀取放在既有 Promise.all，不在 buildMonthlyMeta 內序列執行', () => {
    expect(roster).toMatch(/const \[page, summaries, assigned, rx\] = await Promise\.all\(\[/);
    expect(roster).toMatch(/fetchMonthlyRx\(ctx, \{/);
    expect(read('lib/workspace/monthly-meta.ts')).not.toMatch(/buildMonthlyMeta[^]*await fetchMonthlyRx/);
  });
  it('tools op=meta：統計與處方箋並行；門市代碼取自 requireStore 回傳', () => {
    expect(tools).toMatch(/const storeRow = await requireStore\(ctx, 'monthly', store\)/);
    expect(tools).toMatch(/Promise\.all\(\[\s*getStoreMonthlySummary[^]*fetchMonthlyRx\(ctx, \{ storeId: store, storeCode: storeRow\.store_code, month \}\)/);
  });
  it('op=stats 的欄位清單不含兩個張數欄位（多送的鍵不被讀取、不寫入、不回 400）', () => {
    const line = tools.split('\n').find((l) => l.includes("const keys = b.op === 'stats'"))!;
    expect(line).toBeTruthy();
    expect(line).not.toContain('regular_prescription_count');
    expect(line).not.toContain('chronic_prescription_count');
  });
  it('編輯統計沒有兩個張數欄位；統計卡有唯讀三格、提示與切回分頁重讀', () => {
    const vue = read('vue-workspace/src/components/MonthlyTools.vue');
    const statsFields = vue.split('\n').find((l) => l.startsWith('const statsFields'))!;
    expect(statsFields).not.toContain('regular_prescription_count');
    expect(statsFields).not.toContain('chronic_prescription_count');
    expect(statsFields).toContain('prescription_addon_only_count');
    expect(vue).toContain('資料來自業績管理處方箋，如需修改請至業績管理處方箋頁');
    expect(vue).toContain('一般箋、慢箋張數改由業績管理處方箋提供');
    expect(vue).toMatch(/watch\(\(\)=>work\.active/);
  });
  it('匯入統計走共用路由，payload 由純函式組成（不含兩欄）', () => {
    expect(read('app/api/import-store-stats/route.ts')).toContain('buildStoreStatsImportPayload');
  });
});
