import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess,type TransferSide} from '@/lib/workspace/transfers';
import {getMovementDateError} from '@/lib/employee-movement-date';
export const dynamic='force-dynamic';
/**
 * M2 D.2：調店要原店與新店督導都確認才生效。
 * 只完成自己負責的那一側時不需要日期與核對版本，回 status=pending（等另一側）；
 * 這一次確認會讓兩側都齊全時，才需要生效日期與核對版本，並實際寫入異動、主檔與月人員。
 */
export async function POST(request:Request){try{
 checkOrigin(request);const access=await transferAccess(),{ctx}=access;let body:any;
 try{body=await request.json();}catch{throw new WorkspaceError(400,'確認資料格式不正確');}
 if(!uuid(body?.id))throw new WorkspaceError(400,'申請編號不正確');
 const row=checked(await ctx.auth.from('store_transfer_requests').select('from_store_id,to_store_id,status').eq('id',body.id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的調店申請');
 const done=(checked(await ctx.admin.from('store_transfer_confirmations').select('side').eq('request_id',body.id))||[]).map((c:any)=>c.side as TransferSide);
 const mine=access.sides(row,done);
 if(!access.confirm)throw new WorkspaceError(403,'只有原店或新店督導（或系統管理員代確認）可以確認此調店申請');
 const completes=done.length+mine.length>=2;
 if(completes){
  if(typeof body?.version!=='string'||!/^[a-f0-9]{32}$/.test(body.version))throw new WorkspaceError(400,'請先核對本次調店影響');
  const dateError=getMovementDateError(body.effective_date);if(dateError)throw new WorkspaceError(400,dateError);
 }
 const result=await ctx.admin.rpc('workspace_transfer_confirm',{p_actor:ctx.user.id,p_id:body.id,p_date:completes?body.effective_date:null,p_version:completes?body.version:null});
 if(result.error){const messages:Record<string,string>={WORKSPACE_STALE:'核對後資料已變更，請重新核對調店影響',WORKSPACE_CONFLICT:'此申請已被處理，請重新整理',WORKSPACE_STORE_CHANGED:'門市已停用或變更，請重新核對',WORKSPACE_DUPLICATE:'同日已有調店紀錄',WORKSPACE_EMPLOYEE_CHANGED:'員工主檔與申請不符，請核對姓名及原任職門市',WORKSPACE_MONTH_DUPLICATE:'同一門市月份有重複員工資料，請先核對',WORKSPACE_SIDE_DONE:'您負責的這一側已由其他人確認，請重新整理',WORKSPACE_DATE_REQUIRED:'請先填寫生效日期並核對調店影響'};
  if(result.error.message.includes('WORKSPACE_FORBIDDEN'))throw new WorkspaceError(403,'只有原店或新店督導（或系統管理員代確認）可以確認此調店申請');
  for(const [key,message] of Object.entries(messages))if(result.error.message.includes(key))throw new WorkspaceError(409,message);
  throw new WorkspaceError(503,'調店確認未完成，請稍後重試');
 }
 return respond(result.data);
}catch(e){return failed(e);}}
