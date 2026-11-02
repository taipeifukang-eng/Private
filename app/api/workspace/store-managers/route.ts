import { checked, checkOrigin, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { STORE_MANAGER_ASSIGN_PERMISSION_CODES } from '@/lib/admin/store-management-access';
export const dynamic='force-dynamic';
async function allRows(query: () => any) {
  const rows:any[]=[];
  for(let start=0;;start+=500){const batch:any[]=checked(await query().range(start,start+499)) || [];rows.push(...batch);if(batch.length<500)return rows;}
}
export async function GET(){try{
 const ctx=await context();requireCapability(ctx,[...STORE_MANAGER_ASSIGN_PERMISSION_CODES]);
 const [users,stores,assignments]=await Promise.all([
  allRows(()=>ctx.admin.from('profiles').select('id,email,full_name,employee_code,job_title').or('job_title.ilike.%店長%,job_title.ilike.%督導%').order('id')),
  allRows(()=>ctx.admin.from('stores').select('id,store_code,store_name,is_active').order('store_code').order('id')),
  allRows(()=>ctx.admin.from('store_managers').select('id,store_id,user_id,user:profiles!store_managers_user_id_fkey(id,full_name,employee_code,job_title)').eq('role_type','store_manager').eq('is_primary',true).order('id')),
 ]);
 return respond({users,stores,assignments:assignments.map(a=>({...a,user:Array.isArray(a.user)?a.user[0]:a.user}))});
}catch(e){return failed(e);}}
export async function PUT(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,[...STORE_MANAGER_ASSIGN_PERMISSION_CODES]);const body=await request.json();
 if(!uuid(body.userId)||!Array.isArray(body.storeIds)||body.storeIds.length>10000||!body.storeIds.every(uuid)||new Set(body.storeIds).size!==body.storeIds.length||!Array.isArray(body.expected)||body.expected.length>10000||!body.expected.every((x:any)=>typeof x==='string'&&x.split(':').length===2&&x.split(':').every(uuid)))throw new WorkspaceError(400,'指派資料格式不正確');
 const result=await ctx.admin.rpc('workspace_set_store_manager',{p_user:body.userId,p_stores:body.storeIds,p_expected:body.expected});
 if(result.error){const message=result.error.message;
 if(message.includes('WORKSPACE_CONFLICT'))throw new WorkspaceError(409,'此人員的指派已被更新。請保留目前選擇，重新載入後再確認。');
 if(message.includes('WORKSPACE_USER_'))throw new WorkspaceError(400,'此人員不存在或職稱已不符合店長指派資格');
 if(message.includes('WORKSPACE_STORE_'))throw new WorkspaceError(400,'所選門市不存在或已停用');
 throw new WorkspaceError(503,'指派未完成，原有指派未變更，請稍後重試');}
 return respond({success:true});
}catch(e){return failed(e);}}
