import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
import {getMovementDateError} from '@/lib/employee-movement-date';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 checkOrigin(request);const access=await transferAccess(),{ctx}=access;let body:any;
 try{body=await request.json();}catch{throw new WorkspaceError(400,'確認資料格式不正確');}
 if(!uuid(body?.id)||typeof body?.version!=='string'||!/^[a-f0-9]{32}$/.test(body.version))throw new WorkspaceError(400,'請先核對本次調店影響');
 const dateError=getMovementDateError(body.effective_date);if(dateError)throw new WorkspaceError(400,dateError);
 const row=checked(await ctx.auth.from('store_transfer_requests').select('from_store_id,to_store_id').eq('id',body.id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的調店申請');
 if(!access.canReject(row))throw new WorkspaceError(403,'沒有確認此調店申請的權限');
 const result=await ctx.admin.rpc('workspace_transfer_confirm',{p_actor:ctx.user.id,p_id:body.id,p_date:body.effective_date,p_version:body.version});
 if(result.error){const messages:Record<string,string>={WORKSPACE_STALE:'核對後資料已變更，請重新核對調店影響',WORKSPACE_CONFLICT:'此申請已被處理，請重新整理',WORKSPACE_STORE_CHANGED:'門市已停用或變更，請重新核對',WORKSPACE_DUPLICATE:'同日已有調店紀錄',WORKSPACE_LATER_MOVEMENT:'此員工已有較晚的異動，請先核對完整歷程',WORKSPACE_EMPLOYEE_CHANGED:'員工主檔與申請不符，請核對姓名及原任職門市',WORKSPACE_MONTH_LOCKED:'受影響月資料不是草稿，請先處理該月份狀態',WORKSPACE_MONTH_DUPLICATE:'同一門市月份有重複員工資料，請先核對'};
  if(result.error.message.includes('WORKSPACE_FORBIDDEN'))throw new WorkspaceError(403,'目前沒有確認此申請的權限');
  for(const [key,message] of Object.entries(messages))if(result.error.message.includes(key))throw new WorkspaceError(409,message);
  throw new WorkspaceError(503,'調店確認未完成，請稍後重試');
 }
 return respond(result.data);
}catch(e){return failed(e);}}
