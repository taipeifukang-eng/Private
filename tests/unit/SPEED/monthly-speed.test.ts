import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleStores, isAssignedTo } from '../../../lib/workspace/modules';
import { buildMonthlyMeta } from '../../../lib/workspace/monthly-meta';

// 每月人員狀態加速（monthly-speed-spec A／B／C）單元層：門市預取過濾、meta 欄位權限、舊版共用 helper 向下相容、SQL 結構。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const STORES = [
  { id: 's1', store_code: '0001', store_name: 'A', short_name: 'a', is_active: true },
  { id: 's2', store_code: '0002', store_name: 'B', short_name: 'b', is_active: false },
  { id: 's3', store_code: '0003', store_name: 'C', short_name: 'c', is_active: true },
  { id: 's4', store_code: '0004', store_name: 'D', short_name: 'd', is_active: null },
];
function fakeCtx(perms: string[], assigned: string[], admin = false) {
  const permissions = new Set(perms);
  return {
    permissions,
    isAdmin: admin,
    has: (...codes: string[]) => admin || codes.some((c) => permissions.has(c)),
    user: { id: 'u1' },
    auth: {},
    prefetched: { stores: { data: STORES, error: null }, assigned: { data: assigned.map((store_id) => ({ store_id })), error: null } },
  } as any;
}

describe('A／B 門市預取：與逐步查詢相同的過濾結果', () => {
  it('view_all：有效門市不含 is_active 欄位且只留 is_active=true；includeInactive 全留並帶 is_active', async () => {
    const ctx = fakeCtx(['monthly.status.view_all'], []);
    expect(await moduleStores(ctx, 'monthly')).toEqual([
      { id: 's1', store_code: '0001', store_name: 'A', short_name: 'a' },
      { id: 's3', store_code: '0003', store_name: 'C', short_name: 'c' },
    ]);
    const all = await moduleStores(ctx, 'monthly', { includeInactive: true });
    expect(all.map((s: any) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(all[1]).toHaveProperty('is_active', false);
  });
  it('沒有 view_all：只留被指派的門市；沒有指派就是空', async () => {
    const some = await moduleStores(fakeCtx(['monthly.status.view_own'], ['s3', 's2']), 'monthly', { includeInactive: true });
    expect(some.map((s: any) => s.id)).toEqual(['s2', 's3']);
    expect(await moduleStores(fakeCtx(['monthly.status.view_own'], []), 'monthly')).toEqual([]);
  });
  it('管理員視同 view_all；isAssignedTo 用預取的指派清單', async () => {
    expect((await moduleStores(fakeCtx([], [], true), 'monthly')).map((s: any) => s.id)).toEqual(['s1', 's3']);
    expect(await isAssignedTo(fakeCtx([], ['s3']), 's3')).toBe(true);
    expect(await isAssignedTo(fakeCtx([], ['s3']), 's1')).toBe(false);
  });
  it('預取查詢失敗時與原本一樣回 503', async () => {
    const ctx = fakeCtx(['monthly.status.view_all'], []);
    ctx.prefetched.stores = { data: null, error: { message: 'x' } };
    await expect(moduleStores(ctx, 'monthly')).rejects.toMatchObject({ status: 503 });
  });
});

describe('A meta：欄位權限過濾與 op=meta 同一支', () => {
  const summary = { total_staff_count: 8, admin_staff_count: 1, newbie_count: 0, business_days: 30, total_gross_profit: 100, total_customer_count: 50, prescription_addon_only_count: 1, regular_prescription_count: 2, chronic_prescription_count: 3, support_to_other_stores_hours: 4, support_from_other_stores_hours: 5, updated_at: 'V1', store_status: 'draft' };
  it('沒有 viewStats／viewSupport 時對應欄位完全不出現', async () => {
    const meta = await buildMonthlyMeta(fakeCtx(['monthly.status.view_all', 'activity.campaign.view_all'], []), summary);
    expect(meta.stats).toEqual({});
    expect(meta.capabilities).toMatchObject({ viewStats: false, viewSupport: false, editStats: false, activity: true });
    expect(meta.version).toBe('V1');
    expect(meta.storeStatus).toBe('draft');
  });
  it('有權限才帶欄位；沒有統計列時值為 null、狀態 not_started', async () => {
    const ctx = fakeCtx(['monthly.status.view_stats', 'monthly.status.edit', 'monthly.allowance.view_support_hours', 'activity.campaign.view_all'], []);
    const withRow = await buildMonthlyMeta(ctx, summary);
    expect(Object.keys(withRow.stats)).toHaveLength(11);
    expect(withRow.stats.support_to_other_stores_hours).toBe(4);
    expect(withRow.capabilities).toMatchObject({ viewStats: true, viewSupport: true, editStats: true, editSupport: false });
    const none = await buildMonthlyMeta(ctx, null);
    expect(none.stats.total_staff_count).toBeNull();
    expect(none.version).toBeNull();
    expect(none.storeStatus).toBe('not_started');
  });
  it('capabilities 欄位順序與舊 op=meta 相同', async () => {
    const meta = await buildMonthlyMeta(fakeCtx([], [], true), summary);
    expect(Object.keys(meta.capabilities)).toEqual(['support', 'transport', 'talent', 'spring', 'meal', 'viewStats', 'viewSupport', 'editStats', 'editSupport', 'manual', 'pdf', 'bonusDetails', 'performance', 'activity', 'importPerformance', 'importStats']);
  });
});

describe('B 舊版共用 helper 向下相容、context 並行', () => {
  const actions = read('app/store/actions.ts');
  it('getMonthlyStaffStatus／getStoreMonthlySummary 新增的第三個參數有預設值，舊的兩參數呼叫不變', () => {
    expect(actions).toMatch(/export async function getMonthlyStaffStatus\(yearMonth: string, storeId: string, caller: VerifiedCaller = \{\}\)/);
    expect(actions).toMatch(/export async function getStoreMonthlySummary\(yearMonth: string, storeId: string, caller: VerifiedCaller = \{\}\)/);
    // 只有同時提供 server 端 supabase client 才相信 caller.user（Server Action 不能被瀏覽器偽造使用者）。
    expect(actions).toMatch(/if \(caller\.supabase && caller\.user\)/);
  });
  it('名冊 helper 的四個互不相依查詢並行', () => {
    expect(actions).toMatch(/const \[staffRes, bonusRes, franchiseRes, currentStoreRes\] = await Promise\.all\(/);
  });
  it('context：user_roles、profiles、預取並行，profile 可略過', () => {
    const server = read('lib/workspace/server.ts');
    expect(server).toMatch(/const \[assignmentsResult, profileResult, prefetched\] = await Promise\.all\(/);
    expect(server).toMatch(/options\.profile === false/);
  });
  it('名冊 API 不查 profiles、直接附 meta，工具列有 meta 就不再另打 op=meta', () => {
    const roster = read('app/api/workspace/monthly/route.ts');
    expect(roster).toMatch(/moduleContext\("monthly", \{ profile: false, prefetchStores: true \}\)/);
    expect(roster).toMatch(/buildMonthlyMeta\(ctx, page\.summary\)/);
    const vue = read('vue-workspace/src/components/MonthlyTools.vue');
    expect(vue).toMatch(/props\.meta && !props\.disabled/);
  });
});

describe('C 名冊頁 RPC 結構', () => {
  const sql = read('supabase/workspace-dev/20261107110000_monthly_roster_page.sql');
  const rollback = read('supabase/workspace-dev/20261107110000_monthly_roster_page.rollback.sql');
  it('以使用者身分執行（RLS 照舊），REVOKE PUBLIC／anon，不給 anon 執行權', () => {
    expect(sql).toMatch(/workspace_monthly_roster_page\(p_store uuid, p_month text\)\s+RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER/);
    expect(sql).not.toMatch(/SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$\$\s+DECLARE\s+cur_code/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.workspace_monthly_roster_page\(uuid, text\) FROM PUBLIC, anon;/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/);
  });
  it('rollback 會移除新函式與草稿簽章', () => {
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.workspace_monthly_roster_page\(uuid, text\);/);
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.workspace_extract_store_code\(text\);/);
  });
  it('業績扣除與 TypeScript 相同：四捨五入公式一致', () => {
    expect(sql).toMatch(/floor\(a\.sales \* 100 \+ 0\.5\) \/ 100/);
    expect(sql).toMatch(/floor\(\(a\.gp \/ a\.sales\) \* 10000 \+ 0\.5\) \/ 100/);
    expect(read('app/store/actions.ts')).toMatch(/Math\.round\(acc\.sales \* 100\) \/ 100/);
  });
});

describe('活動入口權限：等同 Production has_permission（無 admin 繞過）', () => {
  const mk = (perms: string[], admin: boolean) => {
    const c = fakeCtx(perms, [], admin);
    c.auth = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [] }), maybeSingle: async () => ({ data: { department: 'x' } }) }) }) }) };
    return c;
  };
  it('admin 角色沒有明確授權 -> activity=false', async () => {
    const meta = await buildMonthlyMeta(mk([], true), {});
    expect(meta.capabilities.activity).toBe(false);
  });
  it('明確持有 view_all -> activity=true（含 admin）', async () => {
    expect((await buildMonthlyMeta(mk(['activity.campaign.view_all'], false), {})).capabilities.activity).toBe(true);
    expect((await buildMonthlyMeta(mk(['activity.campaign.view_all'], true), {})).capabilities.activity).toBe(true);
  });
  it('roster RPC 失敗退回時會記錄 console.error', () => {
    expect(read('app/api/workspace/monthly/route.ts')).toMatch(/console\.error\([^)]*roster RPC failed/);
  });
});
