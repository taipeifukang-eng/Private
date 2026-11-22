import { NextRequest } from 'next/server';
import { GET as published } from '@/app/api/campaigns/published/route';
import { GET as campaignView } from '@/app/api/campaigns/[id]/view/route';
import { GET as activityStores } from '@/app/api/stores-with-supervisors/route';
import { GET as activityEvents } from '@/app/api/event-dates/route';
import { canEnterCampaignView } from '@/lib/campaign-access';
import { campaignVisibleInView, taipeiToday } from '@/lib/workspace/campaign-rules';
import { computeActivityViewer, type ActivityViewer, type ManagedStore } from '@/lib/workspace/activity-view-rules';
import { activityPlan } from '@/lib/workspace/activity-plan';
import { checked, respond, WorkspaceError, type Context } from '@/lib/workspace/server';

// 活動檢視（W20）的共用伺服器邏輯：獨立頁 /api/workspace/activity-view 與月報工具 op=activity／activityDetail 共用。
// 可見活動、門市範圍、發布對象一律交給舊 API（lib/campaign-access.ts）；這裡只做 M5 Q2（停用隱藏）與 Q7（按鈕範圍）。

/** 入口與舊版相同（canEnterCampaignView）。 */
export async function requireCampaignView(ctx: Context) {
  if (!(await canEnterCampaignView(ctx.auth, ctx.user.id))) throw new WorkspaceError(403, '沒有此項操作權限');
}

/**
 * Q7（照舊版）：管轄門市與三個按鈕的條件。
 * 舊頁是用瀏覽器端 Supabase 查：角色代碼 admin 或持有對應權限碼；管理員看全部啟用門市，其他人看 store_managers 任命的門市（任何任命類型）。
 */
export async function loadActivityViewer(ctx: Context): Promise<ActivityViewer> {
  const isAdminRole = ctx.roleCodes.has('admin');
  const wantsStores = isAdminRole || ctx.permissions.has('activity.support_assign.edit') || ctx.permissions.has('activity.staff_overview.view');
  let appointed: ManagedStore[] = [];
  let all: ManagedStore[] = [];
  if (wantsStores) {
    if (isAdminRole) {
      all = (checked(await ctx.admin.from('stores').select('id,store_code,store_name').eq('is_active', true).order('store_code')) || []) as ManagedStore[];
    } else {
      const rows = (checked(await ctx.admin.from('store_managers').select('store:stores(id,store_code,store_name)').eq('user_id', ctx.user.id)) || []) as any[];
      appointed = rows.map((r) => (Array.isArray(r.store) ? r.store[0] : r.store)).filter(Boolean);
    }
  }
  return computeActivityViewer({ isAdminRole, permissions: ctx.permissions, appointedStores: appointed, allActiveStores: all });
}

/** 已發布活動列表（M5 Q2：停用的活動對活動檢視一律隱藏，含有「查看全部」權限者）。 */
export async function activityListResponse(ctx: Context) {
  await requireCampaignView(ctx);
  const response = await published();
  if (!response.ok) return response;
  const body = await response.json();
  return respond({ ...body, data: (body.data || []).filter(campaignVisibleInView), today: taipeiToday() });
}

/** 單一活動：排程、特殊日期、規劃資料（依門市範圍過濾）與 Q7 viewer。 */
export async function activityDetailResponse(ctx: Context, url: URL, id: string) {
  await requireCampaignView(ctx);
  const response = await campaignView(new NextRequest(url), { params: { id } });
  if (!response.ok) return response;
  const data = await response.json();
  if (!campaignVisibleInView(data.campaign || {})) throw new WorkspaceError(404, '找不到此活動，或活動已停用');
  const ids = Array.from(new Set<string>((data.schedules || []).map((s: any) => s.store_id)));
  const stores = ids.length ? checked(await ctx.auth.from('stores').select('id,store_code,store_name,short_name').in('id', ids)) || [] : [];
  const [plan, storeResult, eventResult, viewer] = await Promise.all([
    activityPlan(url, data.campaign.id, ids),
    activityStores().then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => null),
    activityEvents().then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => null),
    loadActivityViewer(ctx),
  ]);
  const enriched = storeResult?.ok && storeResult.body.success !== false ? storeResult.body.data || [] : [];
  if (!storeResult?.ok || storeResult.body.success === false) plan.errors.stores = '督導資訊讀取失敗，請重試';
  if (!eventResult?.ok || eventResult.body.success === false) plan.errors.events = '特殊日期讀取失敗，請重試';
  const events = (eventResult?.ok ? eventResult.body.events || eventResult.body.data || [] : []).filter((e: any) => e.event_date >= data.campaign.start_date && e.event_date <= data.campaign.end_date);
  for (const s of stores as any[]) {
    const info = enriched.find((r: any) => r.id === s.id);
    Object.assign(s, { supervisor_id: info?.supervisor_id, supervisor_code: info?.supervisor_code, supervisor_name: info?.supervisor_name });
  }
  plan.events = events;
  return respond({
    ...data,
    plan,
    viewer,
    // 舊版「總門市數」是 stores-with-supervisors 的全部門市數（不分可見範圍）。
    totalStores: enriched.length,
    today: taipeiToday(),
    schedules: (data.schedules || []).map((s: any) => ({ ...s, store: (stores as any[]).find((x) => x.id === s.store_id) })),
  });
}
