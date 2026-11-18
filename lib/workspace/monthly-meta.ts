import type { Context } from './server';
import { monthlyTools } from './monthly-tools';
import { CAMPAIGN_PERM, canEnterCampaignViewWith } from '@/lib/campaign-access';
import { isHeadOfficeStoreCode, resolveRxLinkDisplay, type RxReportRow } from '@/lib/monthly-stats/rx-link';


const STAT_FIELDS = ['total_staff_count', 'admin_staff_count', 'newbie_count', 'business_days', 'total_gross_profit', 'total_customer_count', 'prescription_addon_only_count'];
const SUPPORT_FIELDS = ['support_to_other_stores_hours', 'support_from_other_stores_hours'];

/** 處方箋連動的原始讀取結果（尚未套用舊匯入退回規則）。讀取失敗只標 failed，不丟錯。 */
export type RxFetch = { failed: true } | { failed?: false; isHeadOffice: boolean; report: RxReportRow };

/**
 * 讀取該門市該月的處方箋（monthly_prescription_reports 只有 service_role 可讀，所以用 ctx.admin）。
 * 只有 monthly.status.view_stats 才會碰資料表；門市範圍檢查由呼叫端（requireStore／名冊 GET 的 allStores）先做。
 * 總公司 0000 不查表。讀取失敗回 { failed: true }，不拖垮名冊。
 * 名冊 GET 要把它放進既有 Promise.all，與名冊 RPC 並行；buildMonthlyMeta 再用 summary 套舊匯入退回規則。
 */
export async function fetchMonthlyRx(
  ctx: Context,
  p: { storeId: string; storeCode: string | null | undefined; month: string },
): Promise<RxFetch | undefined> {
  if (!ctx.has('monthly.status.view_stats')) return undefined;
  if (isHeadOfficeStoreCode(p.storeCode)) return { isHeadOffice: true, report: null };
  try {
    const { data, error } = await ctx.admin
      .from('monthly_prescription_reports')
      .select('regular_prescription_count, regular_prescription_point_value, chronic_prescription_count, chronic_prescription_point_value')
      .eq('year_month', p.month)
      .eq('store_id', p.storeId)
      .maybeSingle();
    if (error) return { failed: true };
    return { isHeadOffice: false, report: (data as RxReportRow) ?? null };
  } catch {
    return { failed: true };
  }
}

/** 顯示用 rx 區塊：已套用規則（處方箋優先、舊匯入非 0 才退回並標示、0000 暫無資料）。 */
export function buildRxMeta(rx: RxFetch, summary: Record<string, any> | null | undefined) {
  if (rx.failed) return { failed: true as const };
  const d = resolveRxLinkDisplay({
    report: rx.report,
    legacySummary: summary ? { regular_prescription_count: summary.regular_prescription_count, chronic_prescription_count: summary.chronic_prescription_count } : null,
    isHeadOffice: rx.isHeadOffice,
  });
  return { failed: false as const, isHeadOffice: rx.isHeadOffice, regular: d.regular, chronic: d.chronic, totalPoint: d.totalPoint };
}

/**
 * 「每月人員狀態」工具列需要的 meta：統計、capabilities、版本。
 * 名冊 API（GET /api/workspace/monthly）直接附上，tools?op=meta 也走同一支，兩邊不會分歧。
 * 欄位權限過濾（viewStats／viewSupport）在這裡做，沒有權限的欄位不會出現在回應。
 * 活動檢視入口的權限碼直接用 context 已載入的角色權限判斷（等同 has_permission：有效指派、未過期、is_allowed、權限啟用），
 * 不再為這三個碼各打 profiles／user_roles／rpc 三趟。
 * 注意：這裡刻意用 ctx.permissions（角色明確授權），不用 ctx.has（isAdmin 對任何碼回 true）。
 * Production 的 has_permission 沒有 admin 繞過，只看 role_permissions；用 ctx.has 會讓 admin/owner 角色多出活動入口。
 * ctx.permissions 的解析（lib/workspace/permission-semantics.ts）與 Production has_permission 一致：看 user_roles 有效且未過期、is_allowed、權限啟用，
 * 不檢查 roles.is_active（原先 ctx 會略過停用角色造成的殘餘差異已消除）；profiles.role==='admin' 的應用層保底只影響 ctx.has／isAdmin，不會進 ctx.permissions。
 */
export async function buildMonthlyMeta(ctx: Context, summary: Record<string, any> | null | undefined, rx?: RxFetch) {
  const capabilities: Record<string, boolean> = {};
  for (const [kind, tool] of Object.entries(monthlyTools)) capabilities[kind] = ctx.has(tool.permission);
  const viewStats = ctx.has('monthly.status.view_stats');
  const viewSupport = ctx.has('monthly.allowance.view_support_hours', 'monthly.allowance.edit_support_hours');
  const stats: Record<string, any> = {};
  for (const key of STAT_FIELDS) if (viewStats) stats[key] = summary?.[key] ?? null;
  for (const key of SUPPORT_FIELDS) if (viewSupport) stats[key] = summary?.[key] ?? null;
  const activity = await canEnterCampaignViewWith(ctx.auth, ctx.user.id, {
    viewAll: ctx.permissions.has(CAMPAIGN_PERM.viewAll),
    viewOwn: ctx.permissions.has(CAMPAIGN_PERM.viewOwn) || ctx.permissions.has(CAMPAIGN_PERM.legacyView),
  });
  return {
    stats,
    // 處方箋連動（一般箋、慢箋、健保總點值）：只給有 view_stats 的角色；沒有權限時完全不出現。
    ...(viewStats && rx ? { rx: buildRxMeta(rx, summary) } : {}),
    version: summary?.updated_at || null,
    storeStatus: summary?.store_status || 'not_started',
    capabilities: {
      ...capabilities,
      viewStats,
      viewSupport,
      editStats: viewStats && ctx.has('monthly.status.edit'),
      editSupport: ctx.has('monthly.allowance.edit_support_hours'),
      manual: ctx.has('monthly.status.add_employee'),
      pdf: ctx.has('monthly.export.download'),
      bonusDetails: ctx.has('monthly.status.bonus_detail.view'),
      performance: ctx.has('monthly.status.view_performance'),
      activity,
      importPerformance: ctx.has('monthly.import.performance') && ctx.has('monthly.status.view_all'),
      importStats: ctx.has('monthly.import.store_stats') && ctx.has('monthly.status.view_all'),
    },
  };
}
