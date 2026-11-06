import {checkOrigin,failed,respond,uuid,checked,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
import {getMovementDateError} from '@/lib/employee-movement-date';
export const dynamic='force-dynamic';
/**
 * M2 H.1／H.7：調店由原店或新店任一位督導（主責或代理）確認即成立；系統管理員可代確認（留下紀錄）；店長不能確認。
 * 確認時需要生效日期與核對版本（先呼叫 transfers/preview）；確認紀錄記下哪一方、哪位督導（或管理員代確認）。
 */
export async function POST(request:Request){try{
 checkOrigin(request);const access=await transferAccess(),{ctx}=access;let body:any;
 try{body=await request.json();}catch{throw new WorkspaceError(400,'確認資料格式不正確');}
 if(!uuid(body?.id))throw new WorkspaceError(400,'申請編號不正確');
 const row=checked(await ctx.auth.from('store_transfer_requests').select('from_store_id,to_store_id,status').eq('id',body.id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的調店申請');
 if(!access.canConfirm(row))throw new WorkspaceError(403,'只有原店或新店督導（或系統管理員代確認）可以確認此調店申請');
 if(typeof body?.version!=='string'||!/^[a-f0-9]{32}$/.test(body.version))throw new WorkspaceError(400,'請先核對本次調店影響');
 const dateError=getMovementDateError(body.effective_date);if(dateError)throw new WorkspaceError(400,dateError);
 const result=await ctx.admin.rpc('workspace_transfer_confirm',{p_actor:ctx.user.id,p_id:body.id,p_date:body.effective_date,p_version:body.version});
 if(result.error){const messages:Record<string,string>={WORKSPACE_STALE:'核對後資料已變更，請重新核對調店影響',WORKSPACE_CONFLICT:'此申請已被處理，請重新整理',WORKSPACE_STORE_CHANGED:'門市已停用或變更，請重新核對',WORKSPACE_DUPLICATE:'同日已有調店紀錄',WORKSPACE_EMPLOYEE_CHANGED:'員工主檔與申請不符，請核對姓名及原任職門市',WORKSPACE_MONTH_DUPLICATE:'同一門市月份有重複員工資料，請先核對',WORKSPACE_DATE_REQUIRED:'請先填寫生效日期並核對調店影響'};
  if(result.error.message.includes('WORKSPACE_FORBIDDEN'))throw new WorkspaceError(403,'只有原店或新店督導（或系統管理員代確認）可以確認此調店申請');
  for(const [key,message] of Object.entries(messages))if(result.error.message.includes(key))throw new WorkspaceError(409,message);
  throw new WorkspaceError(503,'調店確認未完成，請稍後重試');
 }
 return respond(result.data);
}catch(e){return failed(e);}}
