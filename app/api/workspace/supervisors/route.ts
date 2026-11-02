import { checked, checkOrigin, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { STORE_SCOPE_MANAGEMENT_PERMISSION_CODES, STORE_MANAGER_ASSIGN_PERMISSION_CODES, STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES } from '@/lib/admin/store-management-access';
export const dynamic='force-dynamic';
async function allRows(query: () => any) {
  const rows:any[]=[];
  for(let start=0;;start+=500){const batch:any[]=checked(await query().range(start,start+499)) || [];rows.push(...batch);if(batch.length<500)return rows;}
}
export async function GET(){try{
 const ctx=await context();requireCapability(ctx,[...STORE_SCOPE_MANAGEMENT_PERMISSION_CODES]);
 const [users,stores,assignments]=await Promise.all([
  allRows(()=>ctx.admin.from('profiles').select('id,email,full_name,employee_code,job_title').not('job_title','is',null).order('id')),
  allRows(()=>ctx.admin.from('stores').select('id,store_code,store_name,short_name,is_active').order('store_code').order('id')),
  allRows(()=>ctx.admin.from('store_managers').select('id,store_id,user_id,role_type,is_primary,created_at,user:profiles!store_managers_user_id_fkey(id,full_name,employee_code,job_title)').order('id')),
 ]);
 return respond({users:users.filter(u=>/(經理|督導|協理|總監|處長|部長|區經|店長)/.test(u.job_title||'')),stores:stores.map(s=>({...s,eligible:s.is_active&&s.store_code!=='0000'&&!/總部|总部|HQ/i.test([s.store_code,s.store_name,s.short_name].join(' '))})),assignments:assignments.map(a=>({...a,user:Array.isArray(a.user)?a.user[0]:a.user})),canSupervisor:ctx.has(...STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES),canManager:ctx.has(...STORE_MANAGER_ASSIGN_PERMISSION_CODES)});
}catch(e){return failed(e);}}
export async function PUT(request:Request){try{
 checkOrigin(request);const ctx=await context();const body=await request.json();
 if(!['supervisor','store_manager'].includes(body.roleType))throw new WorkspaceError(400,'指派角色不正確');
 requireCapability(ctx,[...(body.roleType==='supervisor'?STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES:STORE_MANAGER_ASSIGN_PERMISSION_CODES)]);
 if(!uuid(body.userId)||![body.storeIds].every(ids=>Array.isArray(ids)&&ids.length<=10000&&ids.every(uuid)&&new Set(ids).size===ids.length)||!Array.isArray(body.expected)||body.expected.length>50000||!body.expected.every((x:any)=>typeof x==='string'&&/^[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}:(supervisor|store_manager|area_manager):(true|false)$/.test(x)))throw new WorkspaceError(400,'指派資料格式不正確');
 if(!Array.isArray(body.primaryAssignments)||body.primaryAssignments.length>10000||!body.primaryAssignments.every((x:any)=>x&&uuid(x.storeId)&&uuid(x.userId))||new Set(body.primaryAssignments.map((x:any)=>x.storeId)).size!==body.primaryAssignments.length)throw new WorkspaceError(400,'請重新整理工作台後，確認各門市的主責督導');
 const primaries=Object.fromEntries(body.primaryAssignments.map((x:any)=>[x.storeId,x.userId]));
 const result=await ctx.admin.rpc('workspace_set_supervisor_choices',{p_user:body.userId,p_role:body.roleType,p_stores:body.storeIds,p_primaries:primaries,p_expected:body.expected});
 if(result.error){const message=result.error.message;
 if(message.includes('WORKSPACE_CONFLICT'))throw new WorkspaceError(409,'門市指派已被其他人更新。請重新載入並確認最新主責與代理狀態。');
 if(message.includes('WORKSPACE_PRIMARY_REQUIRED'))throw new WorkspaceError(409,'請明確指定主責督導或接任人後再儲存。');
 if(message.includes('WORKSPACE_USER_'))throw new WorkspaceError(400,'此人員不存在或職稱已不符合管理指派資格');
 if(message.includes('WORKSPACE_STORE_'))throw new WorkspaceError(400,'所選門市不存在、已停用或屬於總部');
 if(message.includes('WORKSPACE_INVALID_'))throw new WorkspaceError(400,'角色或主責督導設定不正確，請核對該店的督導名單');
 throw new WorkspaceError(503,'指派未完成，原有指派未變更，請稍後重試');}
 return respond({success:true});
}catch(e){return failed(e);}}
