import type { Context } from './server';
import { monthlyTools } from './monthly-tools';
import { CAMPAIGN_PERM, canEnterCampaignViewWith } from '@/lib/campaign-access';

const STAT_FIELDS = ['total_staff_count', 'admin_staff_count', 'newbie_count', 'business_days', 'total_gross_profit', 'total_customer_count', 'prescription_addon_only_count', 'regular_prescription_count', 'chronic_prescription_count'];
const SUPPORT_FIELDS = ['support_to_other_stores_hours', 'support_from_other_stores_hours'];

/**
 * 「每月人員狀態」工具列需要的 meta：統計、capabilities、版本。
 * 名冊 API（GET /api/workspace/monthly）直接附上，tools?op=meta 也走同一支，兩邊不會分歧。
 * 欄位權限過濾（viewStats／viewSupport）在這裡做，沒有權限的欄位不會出現在回應。
 * 活動檢視入口的權限碼直接用 context 已載入的角色權限判斷（等同 has_permission：有效指派、未過期、is_allowed、權限啟用），
 * 不再為這三個碼各打 profiles／user_roles／rpc 三趟。
 * 注意：這裡刻意用 ctx.permissions（角色明確授權），不用 ctx.has（isAdmin 對任何碼回 true）。
 * Production 的 has_permission 沒有 admin 繞過，只看 role_permissions；用 ctx.has 會讓 admin/owner 角色多出活動入口。
 * 已知殘餘差異：ctx 載入時略過 roles.is_active=false 的角色，Production has_permission 不檢查 roles.is_active（極端情況，入口顯示而已）。
 */
export async function buildMonthlyMeta(ctx: Context, summary: Record<string, any> | null | undefined) {
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
