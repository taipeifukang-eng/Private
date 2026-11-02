import {NextRequest} from 'next/server';
import {context,checkOrigin,requireCapability,respond,failed,WorkspaceError,CAMPAIGN_READ_CODES,checked,uuid} from '@/lib/workspace/server';
import * as schedules from '@/app/api/campaign-schedules/route';
import * as settings from '@/app/api/store-activity-settings/route';
import * as events from '@/app/api/event-dates/route';
import * as stores from '@/app/api/stores-with-supervisors/route';
import * as details from '@/app/api/campaign-store-details/route';
import * as ownStaff from '@/app/api/campaign-store-own-staff/route';
import * as requests from '@/app/api/campaign-support-requests/route';
import * as supportStaff from '@/app/api/campaign-support-staff/route';
import * as headcount from '@/app/api/campaign-store-headcount/route';
import * as checklist from '@/app/api/campaign-checklist-items/route';
import * as completions from '@/app/api/campaign-checklist-completions/route';
import * as trips from '@/app/api/campaign-equipment-trips/route';
import * as departments from '@/app/api/campaign-department-publish/route';
import * as assets from '@/app/api/campaign-department-assets/route';
import * as publish from '@/app/api/campaigns/publish/route';
import * as employees from '@/app/api/monthly-staff-by-store/route';
import * as search from '@/app/api/monthly-staff-by-store/search/route';
export const dynamic='force-dynamic';
const handlers:Record<string,any>={schedules,settings,events,stores,details,ownStaff,requests,supportStaff,headcount,checklist,completions,trips,departments,assets,publish,employees,search};
const edits:Record<string,string[]>={schedules:['activity.campaign.edit','activity.manage'],settings:['activity.campaign.edit','activity.manage'],events:['activity.campaign.edit','activity.manage'],details:['activity.store_detail.edit'],ownStaff:['activity.store_detail.edit'],requests:['activity.support_request.edit'],supportStaff:['activity.support_assign.edit'],headcount:['activity.store_detail.edit'],'checklist-order':['activity.checklist.edit'],checklist:['activity.checklist.edit'],completions:['activity.checklist.edit','activity.store_detail.edit'],trips:['activity.equipment_trip.edit'],departments:['activity.marketing.publish','activity.merchandise.publish','activity.checklist.edit'],assets:['activity.marketing.publish','activity.checklist.edit'],publish:['activity.campaign.edit']};
const readCodes=[...CAMPAIGN_READ_CODES,...Object.values(edits).flat(),'activity.staff_overview.view'];
async function handle(request:NextRequest){try{
 const ctx=await context();requireCapability(ctx,readCodes);
 const resource=request.nextUrl.searchParams.get('resource')||'';
 if(resource==='permissions'&&request.method==='GET')return respond({permissions:Object.fromEntries(Object.entries(edits).map(([k,v])=>[k,ctx.has(...v)])),marketing:ctx.has('activity.marketing.publish','activity.checklist.edit'),merchandise:ctx.has('activity.merchandise.publish','activity.checklist.edit')});
 const handler=handlers[resource]?.[request.method];if(!handler&&!(request.method==='PUT'&&['schedules','ownStaff','supportStaff','checklist-order'].includes(resource)))throw new WorkspaceError(404,'找不到活動操作');
 if(request.method!=='GET'){checkOrigin(request);requireCapability(ctx,edits[resource]||[]);}
 if(resource==='checklist-order'&&request.method==='PUT'){const b=await request.json();if(!uuid(b.campaign_id)||!Array.isArray(b.ids)||b.ids.some((id:any)=>!uuid(id)))throw new WorkspaceError(400,'排序格式不正確');return respond(checked(await ctx.admin.rpc('workspace_campaign_checklist_order',{p_actor:ctx.user.id,p_campaign:b.campaign_id,p_ids:b.ids})));}
 if(resource==='details'&&request.method==='POST'){
  const b=await request.json();if(!uuid(b.campaign_id)||!uuid(b.store_id))throw new WorkspaceError(400,'活動或門市識別不正確');
  const allowed=['outdoor_vendor','red_bean_cake','circulation','quantum','bone_density','supervisor','manager','tasting','activity_team','sales1','sales2','sales3','sales4','sales5','sales6','indoor_pt1','indoor_pt2','notes','has_external_inventory_company','planned_inventory_time','inventory_staff'];
  const values:Record<string,any>={campaign_id:b.campaign_id,store_id:b.store_id,updated_by:ctx.user.id};
  for(const key of allowed)if(key in b){if(b[key]!==null&&(typeof b[key]!=='string'||b[key].length>10000))throw new WorkspaceError(400,'配置欄位格式不正確');values[key]=b[key]||null;}
  return respond({success:true,data:checked(await ctx.admin.from('campaign_store_details').upsert(values,{onConflict:'campaign_id,store_id'}).select().single())});
 }
 if(resource==='requests'&&request.method==='DELETE'){const b=await request.json();if(!uuid(b.id))throw new WorkspaceError(400,'支援需求識別不正確');checked(await ctx.admin.from('campaign_support_requests').delete().eq('id',b.id));return respond({success:true});}
 if(resource==='assets'&&request.method==='POST'){const b=await request.clone().formData();const files=b.getAll('files');if(!files.length||files.length>8||files.some(f=>!(f instanceof File)||f.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type)))throw new WorkspaceError(400,'請選擇最多 8 張、每張 5MB 以下的 PNG、JPEG 或 WebP 圖片');}
 if(resource==='settings'&&request.method==='POST'){
  const b=await request.json(),days=(v:any)=>Array.isArray(v)&&v.every(d=>Number.isInteger(d)&&d>=1&&d<=7);
  if(!uuid(b.store_id)||!days(b.allowed_days)||!days(b.forbidden_days)||b.allowed_days.some((d:number)=>b.forbidden_days.includes(d))||typeof b.notes!=='string'||b.notes.length>5000)throw new WorkspaceError(400,'請確認門市、星期限制及備註');
  return respond({success:true,setting:checked(await ctx.admin.from('store_activity_settings').upsert({store_id:b.store_id,allowed_days:b.allowed_days,forbidden_days:b.forbidden_days,notes:b.notes},{onConflict:'store_id'}).select().single())});
 }
 if(resource==='events'&&request.method==='POST'){
  const b=await request.json();if(typeof b.event_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.event_date)||!Number.isFinite(Date.parse(b.event_date))||new Date(b.event_date).toISOString().slice(0,10)!==b.event_date||!['holiday','company_event','other'].includes(b.event_type)||typeof b.is_blocked!=='boolean'||typeof b.description!=='string'||b.description.length>1000)throw new WorkspaceError(400,'請確認特殊日期與說明');
  return respond({success:true,event:checked(await ctx.admin.from('event_dates').upsert({event_date:b.event_date,description:b.description,event_type:b.event_type,is_blocked:b.is_blocked},{onConflict:'event_date'}).select().single())});
 }
 if(resource==='events'&&request.method==='DELETE'){const id=request.nextUrl.searchParams.get('id');if(!uuid(id))throw new WorkspaceError(400,'日期識別不正確');checked(await ctx.admin.from('event_dates').delete().eq('id',id));return respond({success:true});}
 const atomic=['schedules','ownStaff','supportStaff'].includes(resource);
 const p=request.nextUrl.searchParams;
 if(atomic&&request.method==='PUT'){
  const b=await request.json(),scope=resource==='schedules'?null:b.scope;
  if(!uuid(b.campaign_id)||!uuid(b.requestId)||scope!==null&&!uuid(scope)||!Array.isArray(b.rows)||b.rows.length>1000)throw new WorkspaceError(400,'提交格式不正確');
  const r=await ctx.admin.rpc('workspace_campaign_replace',{p_actor:ctx.user.id,p_request:b.requestId,p_kind:resource,p_campaign:b.campaign_id,p_scope:scope,p_rows:b.rows,p_version:b.version});
  if(r.error)throw new WorkspaceError(409,r.error.message==='WORKSPACE_STALE'?'資料已變更，草稿保留，請重新讀取核對。':'儲存未完成，請核對門市、人員及日期。整批資料未部分更新。');return respond(r.data);
 }
 let version:string|null=null;
 if(atomic&&request.method==='GET'&&uuid(p.get('campaign_id'))&&(resource==='schedules'||uuid(p.get(resource==='ownStaff'?'store_id':'support_request_id'))))version=checked(await ctx.admin.rpc('workspace_campaign_state',{p_kind:resource,p_campaign:p.get('campaign_id'),p_scope:resource==='schedules'?null:p.get(resource==='ownStaff'?'store_id':'support_request_id')}));
 // Retain each established handler's audience/RBAC and business validation.
 const response=await handler(request);if(version&&response.ok)return respond({...await response.json(),version});return response;
}catch(e){return failed(e);}}
export const GET=handle,POST=handle,PUT=handle,PATCH=handle,DELETE=handle;
