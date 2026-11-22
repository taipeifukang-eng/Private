import {checkOrigin,context,failed,respond,uuid,WorkspaceError,requireCapability} from '@/lib/workspace/server';
import {MOVEMENT_DELETE_CODES,MOVEMENT_EDIT_CODES} from '@/lib/workspace/employee-movements';
import {getMovementDateError} from '@/lib/employee-movement-date';
export const dynamic='force-dynamic';
type C={params:{id:string}};
// M2 規格 C：修改（C.1 範圍照舊版）與刪除（只能刪該員工最新一筆，刪除後恢復主檔與名冊）。權限在伺服器端檢查（C.2）。
const messages:Record<string,string>={
 WORKSPACE_NOT_FOUND:'找不到該異動記錄，可能已被刪除，請重新整理。',
 WORKSPACE_DUPLICATE:'同員工、同日期、同異動類型的紀錄已存在',
 WORKSPACE_INVALID:'欄位不正確，請檢查姓名、日期、升職職位與階級。',
 WORKSPACE_FORBIDDEN:'沒有此功能的操作權限',
};
async function visible(ctx:Awaited<ReturnType<typeof context>>,id:string){
 if(!uuid(id))throw new WorkspaceError(404,'找不到該異動記錄');
 // C.2 legacy_perms：與舊版相同，先檢查權限（呼叫端已做），再用管理端讀取，不受門市範圍（RLS）影響。
 const r=await ctx.admin.from('employee_movement_history').select('id,employee_code,employee_name,movement_type,movement_date').eq('id',id).maybeSingle();
 if(r.error)throw new WorkspaceError(503,'異動紀錄讀取失敗，請重試');
 if(!r.data)throw new WorkspaceError(404,'找不到該異動記錄');
 return r.data;
}
export async function PATCH(request:Request,{params}:C){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,[...MOVEMENT_EDIT_CODES]);
 const movement=await visible(ctx,params.id);
 const b=await request.json().catch(()=>null);
 if(!b||typeof b!=='object'||Array.isArray(b))throw new WorkspaceError(400,'請提供要修改的欄位');
 const fields:Record<string,unknown>={};
 for(const key of ['employee_name','movement_date','notes','position','newbie_level'] as const)if(b[key]!==undefined){if(typeof b[key]!=='string')throw new WorkspaceError(400,'欄位格式須為文字');fields[key]=String(b[key]).trim();}
 if(b.onboarding_is_pharmacist!==undefined){if(typeof b.onboarding_is_pharmacist!=='boolean')throw new WorkspaceError(400,'入職藥師身分格式不正確');fields.onboarding_is_pharmacist=b.onboarding_is_pharmacist;}
 if(fields.employee_name!==undefined&&(!fields.employee_name||String(fields.employee_name).length>100))throw new WorkspaceError(400,'請填寫姓名（100 字內）');
 if(fields.movement_date!==undefined){const e=getMovementDateError(fields.movement_date);if(e)throw new WorkspaceError(400,e);}
 if(typeof fields.notes==='string'&&fields.notes.length>5000)throw new WorkspaceError(400,'備註不得超過 5000 字');
 if(movement.movement_type!=='promotion'){delete fields.position;delete fields.newbie_level;}
 if(movement.movement_type!=='onboarding')delete fields.onboarding_is_pharmacist;
 const r=await ctx.admin.rpc('workspace_movement_update',{p_actor:ctx.user.id,p_id:params.id,p_fields:fields});
 if(r.error){
  const key=Object.keys(messages).find(k=>r.error!.message.includes(k));
  if(key)throw new WorkspaceError(key==='WORKSPACE_NOT_FOUND'?404:key==='WORKSPACE_DUPLICATE'?409:400,messages[key]);
  throw new WorkspaceError(503,'尚無法確認修改結果，請重新整理後再確認。');
 }
 return respond({success:true,...r.data,message:movement.movement_type==='promotion'?'已更新升職異動，並同步重算生效月份後的月度職位':'已更新人員異動記錄，並同步受影響月份的每月人員狀態'});
}catch(e){return failed(e);}}
export async function DELETE(request:Request,{params}:C){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,[...MOVEMENT_DELETE_CODES]);
 await visible(ctx,params.id);
 const r=await ctx.admin.rpc('workspace_movement_delete',{p_actor:ctx.user.id,p_id:params.id});
 if(r.error){
  if(r.error.message.includes('WORKSPACE_NOT_LATEST')){
   const d=/date=([0-9-]+);type=(\w+)/.exec(r.error.details||'');
   throw new WorkspaceError(409,`此員工有更晚的異動紀錄${d?`（${d[1]}）`:''}，請先刪除較新的那一筆。`);
  }
  const key=Object.keys(messages).find(k=>r.error!.message.includes(k));
  if(key)throw new WorkspaceError(key==='WORKSPACE_NOT_FOUND'?404:400,messages[key]);
  throw new WorkspaceError(503,'尚無法確認刪除結果，請重新整理後再確認。');
 }
 return respond({success:true,...r.data,message:`已刪除 ${r.data.employee_name} (${r.data.employee_code}) 的異動記錄，並恢復員工主檔與每月人員狀態`});
}catch(e){return failed(e);}}
