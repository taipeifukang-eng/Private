import { NextRequest } from 'next/server';
import { checked, checkOrigin, failed, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { moduleContext, requireStore, monthValue } from '@/lib/workspace/modules';
import { monthlyTools, toolFor, permit, editableMonth, validateAllowance } from '@/lib/workspace/monthly-tools';
import { getStoreMonthlySummary, exportMonthlyStatusForBonus } from '@/app/store/actions';
import { POST as pdfData } from '@/app/api/export-single-item-bonus-pdf/route';
import { GET as bonusDetails } from '@/app/api/monthly-status/bonus-details/route';
import { GET as quarterBonuses } from '@/app/api/monthly-status/bonus-quarter-summary/route';
import { monthlyQuarterSummary } from '@/lib/workspace/monthly-quarter';
import { MONTHLY_THRESHOLDS, QUARTERLY_THRESHOLDS } from '@/lib/performance/bonus-calc';
import { GET as performanceData } from '@/app/api/performance-data/route';
import { GET as published } from '@/app/api/campaigns/published/route';
import { GET as campaignView } from '@/app/api/campaigns/[id]/view/route';
import { GET as activityStores } from '@/app/api/stores-with-supervisors/route';
import { GET as activityEvents } from '@/app/api/event-dates/route';
import { canEnterCampaignView } from '@/lib/campaign-access';
import { activityPlan } from '@/lib/workspace/activity-plan';
import { POST as importPerformance } from '@/app/api/import-performance/route';
import { POST as importStats } from '@/app/api/import-store-stats/route';
import { canDoMonthlyAction, monthlyActionBlockedMessage, summaryStatusToMonthly } from '@/lib/workspace/monthly-status-rules';
import { MONTHLY_STATUS_OPTIONS, POSITION_OPTIONS, SPECIAL_ROLE_OPTIONS, NEWBIE_LEVEL_OPTIONS, ADMIN_LEVEL_OPTIONS } from '@/types/workflow';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const ctx = await moduleContext('monthly');
    const p = new URL(request.url).searchParams;
    const month = monthValue(p.get('month')), store = p.get('store') || '', op = p.get('op') || 'meta';
    await requireStore(ctx, 'monthly', store);
    if (op === 'meta') {
      const summary = await getStoreMonthlySummary(month, store);
      if (!summary.success) throw new WorkspaceError(503, '門市統計讀取失敗');
      const capabilities: Record<string, boolean> = {};
      for (const [kind, tool] of Object.entries(monthlyTools)) capabilities[kind] = ctx.has(tool.permission);
      const viewStats = ctx.has('monthly.status.view_stats'), viewSupport = ctx.has('monthly.allowance.view_support_hours', 'monthly.allowance.edit_support_hours');
      const fields = ['total_staff_count','admin_staff_count','newbie_count','business_days','total_gross_profit','total_customer_count','prescription_addon_only_count','regular_prescription_count','chronic_prescription_count'];
      const stats: Record<string, any> = {};
      for (const key of fields) if (viewStats) stats[key] = summary.data?.[key] ?? null;
      for (const key of ['support_to_other_stores_hours','support_from_other_stores_hours']) if (viewSupport) stats[key] = summary.data?.[key] ?? null;
      return respond({ stats, version: summary.data?.updated_at || null, storeStatus: summary.data?.store_status || 'not_started', capabilities: {
        ...capabilities, viewStats, viewSupport, editStats: viewStats && ctx.has('monthly.status.edit'), editSupport: ctx.has('monthly.allowance.edit_support_hours'), manual: ctx.has('monthly.status.add_employee'),
        pdf: ctx.has('monthly.export.download'), bonusDetails: ctx.has('monthly.status.bonus_detail.view'), performance: ctx.has('monthly.status.view_performance'), activity: await canEnterCampaignView(ctx.auth, ctx.user.id),
        importPerformance: ctx.has('monthly.import.performance') && ctx.has('monthly.status.view_all'), importStats: ctx.has('monthly.import.store_stats') && ctx.has('monthly.status.view_all'),
      }});
    }
    if (op === 'employees') {
      if (!ctx.has('monthly.status.add_employee', 'monthly.status.edit', ...Object.values(monthlyTools).map(t=>t.permission))) throw new WorkspaceError(403, '沒有選擇人員權限');
      const q = (p.get('q') || '').trim().slice(0,60).replace(/[%_,().]/g, '');
      if (!q) return respond({ records: [] });
      // Only a temporary, minimal picker; never expose the personnel master record.
      const records = checked(await ctx.admin.from('store_employees').select('employee_code,employee_name,position,is_pharmacist').or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`).order('employee_code').limit(30));
      const manual = checked(await ctx.admin.from('monthly_staff_status').select('employee_code,employee_name,position,is_pharmacist').eq('is_manually_added',true).or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`).limit(30)) || [];
      const byCode = new Map(); for (const r of [...(records || []),...manual]) if(r.employee_code && !byCode.has(r.employee_code)) byCode.set(r.employee_code,r);
      return respond({ records: Array.from(byCode.values()).slice(0,30) });
    }
    if (op === 'allowance') {
      const kind = p.get('kind') || '', tool = toolFor(kind); permit(ctx, tool.permission);
      const records = checked(await ctx.admin.from(tool.table).select('*').eq('store_id',store).eq('year_month',month).order('id')) || [];
      return respond({ records, expected: records });
    }
    const url = new URL(request.url);
    url.searchParams.set('year_month', month); url.searchParams.set('store_id', store);
    if (op === 'bonuses') { permit(ctx, 'monthly.status.bonus_detail.view'); return bonusDetails(new NextRequest(url)); }
    if (op === 'quarterBonuses') { permit(ctx,'monthly.status.bonus_detail.view'); return quarterBonuses(new NextRequest(url)); }
    if (op === 'quarterPerformance') {
      permit(ctx,'monthly.status.view_performance');
      url.searchParams.set('year',month.slice(0,4)); url.searchParams.delete('month');
      const response=await performanceData(new NextRequest(url));
      if (!response.ok) return response;
      const data=await response.json();
      if (!data.success) throw new WorkspaceError(503,data.error || '讀取季度業績失敗');
      const saved=checked(await ctx.auth.from('store_performance_thresholds').select('period_type,threshold_level,base_amount').eq('store_id',store)) || [];
      const thresholds=(type:string,defaults:typeof MONTHLY_THRESHOLDS)=>defaults.map((d,i)=>{
        const row=saved.find(r=>r.period_type===type && r.threshold_level===i+1);
        return {...d,baseAmount:row?Number(row.base_amount):d.baseAmount};
      });
      return respond(monthlyQuarterSummary(month,data.records || [],thresholds('monthly',MONTHLY_THRESHOLDS),thresholds('quarterly',QUARTERLY_THRESHOLDS)));
    }
    if (op === 'performance') {
      permit(ctx, 'monthly.status.view_performance');
      url.searchParams.set('year', month.slice(0,4)); url.searchParams.set('month', String(Number(month.slice(5))));
      return performanceData(new NextRequest(url));
    }
    if (op === 'activity') { await requireCampaignView(ctx); return published(); }
    if (op === 'excel') {
      permit(ctx, 'monthly.export.download');
      const result = await exportMonthlyStatusForBonus(month,store,true);
      if (!result.success) throw new WorkspaceError(400,result.error || '匯出失敗');
      return respond(result);
    }
    if (op === 'activityDetail') {
      await requireCampaignView(ctx);
      const response = await campaignView(new NextRequest(url), { params: { id: p.get('id') || '' } });
      if (!response.ok) return response;
      const data = await response.json();
      const ids = Array.from(new Set<string>((data.schedules || []).map((s: any)=>s.store_id)));
      const stores = ids.length ? checked(await ctx.auth.from('stores').select('id,store_code,store_name,short_name').in('id',ids)) || [] : [];
      const [plan, storeResult, eventResult] = await Promise.all([
        activityPlan(url, data.campaign.id, ids),
        activityStores().then(async r=>({ok:r.ok,body:await r.json()})).catch(()=>null),
        activityEvents().then(async r=>({ok:r.ok,body:await r.json()})).catch(()=>null),
      ]);
      const enriched = storeResult?.ok && storeResult.body.success !== false ? storeResult.body.data || [] : [];
      if (!storeResult?.ok || storeResult.body.success === false) plan.errors.stores='督導資訊讀取失敗，請重試';
      if (!eventResult?.ok || eventResult.body.success === false) plan.errors.events='特殊日期讀取失敗，請重試';
      const events = (eventResult?.ok ? eventResult.body.events || eventResult.body.data || [] : []).filter((e:any)=>e.event_date>=data.campaign.start_date && e.event_date<=data.campaign.end_date);
      for (const s of stores) { const info=enriched.find((r:any)=>r.id===s.id); Object.assign(s,{supervisor_id:info?.supervisor_id,supervisor_code:info?.supervisor_code,supervisor_name:info?.supervisor_name}); }
      plan.events=events;
      return respond({...data, plan, schedules:(data.schedules || []).map((s:any)=>({...s,store:stores.find(x=>x.id===s.store_id)}))});
    }
    throw new WorkspaceError(400, '不支援的操作');
  } catch (e) { return failed(e); }
}
// 活動檢視入口與舊版相同（canEnterCampaignView）；可見活動與門市範圍由舊 API（lib/campaign-access.ts）決定。
async function requireCampaignView(ctx: any) {
  if (!(await canEnterCampaignView(ctx.auth, ctx.user.id))) throw new WorkspaceError(403, '沒有此項操作權限');
}
// M1-x1：新增人員的狀態判斷走規則表（任一列或門市摘要不允許 add 即 409），不再只靠資料庫函式拋 locked。
async function guardManualAdd(ctx: any, store: string, month: string) {
  const summary = checked(await ctx.admin.from('monthly_store_summary').select('store_status').eq('store_id', store).eq('year_month', month).maybeSingle());
  const rows = (checked(await ctx.admin.from('monthly_staff_status').select('status').eq('store_id', store).eq('year_month', month)) || []) as { status: string }[];
  const states: unknown[] = rows.map((r) => r.status);
  const summaryState = summaryStatusToMonthly((summary as any)?.store_status);
  if (summaryState) states.push(summaryState);
  const blocked = states.find((st) => !canDoMonthlyAction(st, 'add'));
  if (blocked !== undefined) throw new WorkspaceError(409, monthlyActionBlockedMessage(blocked, 'add'));
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await moduleContext('monthly');
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData(), kind = String(form.get('kind')), month = monthValue(form.get('month'));
      if (!['performance','stats'].includes(kind)) throw new WorkspaceError(400,'匯入類型錯誤');
      permit(ctx, kind === 'performance' ? 'monthly.import.performance' : 'monthly.import.store_stats');
      permit(ctx, 'monthly.status.view_all');
      // These original importers are monthly/global, never pretend they are single-store imports.
      const files = kind === 'performance' ? ['file1','file2'] : ['file'];
      for (const key of files) {
        const file = form.get(key);
        if (!file && key === 'file2') continue;
        if (!(file instanceof File) || !/\.xlsx?$/i.test(file.name) || !file.size || file.size > 20*1024*1024) throw new WorkspaceError(400,'請選擇 20MB 以內的 Excel 檔案');
      }
      form.set('year_month', month); form.set('yearMonth', month);
      const forwarded = new NextRequest(request.url, { method: 'POST', body: form });
      return kind === 'performance' ? importPerformance(forwarded) : importStats(forwarded);
    }
    const b = await request.json(), month = monthValue(b.month), store = b.store;
    await requireStore(ctx, 'monthly', store);
    if (b.op === 'pdf') {
      permit(ctx, 'monthly.export.download');
      return pdfData(new NextRequest(request.url, { method:'POST', body:JSON.stringify({year_month:month, store_id:store}), headers:{'Content-Type':'application/json'} }));
    }
    if (b.op === 'manual') await guardManualAdd(ctx, store, month);
    else await editableMonth(ctx, store, month);
    if (b.op === 'allowance') {
      const tool = toolFor(b.kind); permit(ctx, tool.permission);
      const records = validateAllowance(b.kind, b.records, month);
      if (!Array.isArray(b.expected)) throw new WorkspaceError(400,'缺少原始版本，請重新載入');
      const result = await ctx.admin.rpc('workspace_save_monthly_allowance', {p_actor:ctx.user.id, p_store:store, p_month:month, p_kind:b.kind, p_rows:records, p_expected:b.expected});
      if (result.error) throw new WorkspaceError(result.error.message.includes('changed') || result.error.message.includes('locked') ? 409 : 400, result.error.message.includes('changed') ? '資料已由其他頁面更新。草稿已保留，請關閉後重新載入核對。' : result.error.message.includes('locked') ? '此月份已送審或確認，無法修改' : '儲存失敗，資料未變更，請確認員工及金額');
      return respond({ success:true, count:records.length });
    }
    if (b.op === 'stats' || b.op === 'supportHours') {
      permit(ctx, b.op === 'stats' ? 'monthly.status.edit' : 'monthly.allowance.edit_support_hours');
      if (b.op === 'stats') permit(ctx, 'monthly.status.view_stats');
      const keys = b.op === 'stats' ? ['total_staff_count','admin_staff_count','newbie_count','business_days','total_gross_profit','total_customer_count','prescription_addon_only_count','regular_prescription_count','chronic_prescription_count'] : ['support_to_other_stores_hours','support_from_other_stores_hours'];
      const updates: Record<string, number> = {};
      for (const key of keys) {
        const n = b.updates?.[key];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > (key === 'business_days' ? new Date(Number(month.slice(0,4)), Number(month.slice(5)),0).getDate() : 100000000)) throw new WorkspaceError(400,'統計數字不正確');
        updates[key] = n;
      }
      const result = await ctx.admin.rpc('workspace_save_monthly_summary', {p_store:store,p_month:month,p_updates:updates,p_version:b.version || null});
      if (result.error) throw new WorkspaceError(409,'統計已變更或月份已送審。草稿保留，請重新載入核對。');
      return respond({success:true});
    }
    if (b.op === 'manual') {
      permit(ctx,'monthly.status.add_employee');
      const d = b.employee || {};
      if (typeof d.employee_name !== 'string' || !d.employee_name.trim() || d.employee_name.length > 100 || ![...POSITION_OPTIONS,...SPECIAL_ROLE_OPTIONS].includes(d.position) || !['full_time','part_time'].includes(d.employment_type) || !MONTHLY_STATUS_OPTIONS.some(o=>o.value===d.monthly_status)) throw new WorkspaceError(400,'請填完整姓名、職位、僱用類型與本月狀態');
      if (d.newbie_level && ![...NEWBIE_LEVEL_OPTIONS,...ADMIN_LEVEL_OPTIONS].some(o=>o.value===d.newbie_level)) throw new WorkspaceError(400,'人員階段不正確');
      for (const [key,max] of [['work_days',31],['work_hours',744]] as const) if (typeof d[key] !== 'number' || !Number.isFinite(d[key]) || d[key]<0 || d[key]>max) throw new WorkspaceError(400,'工作天數／時數不正確');
      if (!uuid(b.requestId)) throw new WorkspaceError(400,'缺少新增識別，請重新開啟視窗');
      if(d.position==='行政' && !ADMIN_LEVEL_OPTIONS.some(o=>o.value===d.newbie_level)) throw new WorkspaceError(400,'行政人員須選擇行政階段');
      const result = await ctx.admin.rpc('workspace_add_monthly_employee',{p_store:store,p_month:month,p_id:b.requestId,p_employee:{employee_name:d.employee_name.trim(),employee_code:String(d.employee_code||'').trim().toUpperCase().slice(0,50),position:d.position,employment_type:d.employment_type,monthly_status:d.monthly_status,is_pharmacist:!!d.is_pharmacist,work_days:d.work_days,work_hours:d.work_hours,newbie_level:d.newbie_level || undefined,notes:String(d.notes||'').slice(0,2000)}});
      if (result.error) throw new WorkspaceError(409,result.error.message.includes('duplicated')?'此員工已在本月名冊，請編輯原有人員資料':'新增未完成，請重新查詢月份狀態後再試');
      return respond({success:true,data:result.data});
    }
    throw new WorkspaceError(400,'不支援的操作');
  } catch(e) { return failed(e); }
}
