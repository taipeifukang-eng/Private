import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
import {getMovementDateError} from '@/lib/employee-movement-date';
export const dynamic='force-dynamic';
async function authorized(id:string){if(!uuid(id))throw new WorkspaceError(400,'申請編號不正確');const access=await transferAccess(),row=checked(await access.ctx.auth.from('store_transfer_requests').select('*').eq('id',id).maybeSingle());if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的申請');if(!access.canReject(row))throw new WorkspaceError(403,'沒有更正此調店的權限');return {access,row};}
export async function GET(request:Request){try{
 const id=new URL(request.url).searchParams.get('id')||'',first=await authorized(id),ctx=first.access.ctx;
 const version=checked(await ctx.admin.rpc('workspace_transfer_snapshot',{p_id:id})),{row}=await authorized(id);
 if(row.status!=='confirmed'||!row.effective_date||!row.movement_history_id)throw new WorkspaceError(409,'此申請不是可更正的已確認調店');
 const months=checked(await ctx.admin.from('monthly_staff_status').select('id,store_id,year_month,status,work_days').eq('employee_code',row.employee_code).in('store_id',[row.from_store_id,row.to_store_id]).eq('year_month',row.effective_date.slice(0,7)).order('id'))||[];
 if(version!==checked(await ctx.admin.rpc('workspace_transfer_snapshot',{p_id:id})))throw new WorkspaceError(409,'資料已變更，請重新載入');
 return respond({row,months,version});
}catch(e){return failed(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);let b:any;try{b=await request.json();}catch{throw new WorkspaceError(400,'更正資料格式不正確');}
 const {access}=await authorized(b?.id),dateError=getMovementDateError(b?.effective_date);
 if(dateError)throw new WorkspaceError(400,dateError);
 if(!uuid(b?.requestId)||typeof b?.version!=='string'||!/^[a-f0-9]{32}$/.test(b.version)||typeof b?.reason!=='string'||!b.reason.trim()||b.reason.length>2000)throw new WorkspaceError(400,'請重新核對資料並填寫2000字內的更正原因');
 const result=await access.ctx.admin.rpc('workspace_transfer_correct',{p_actor:access.ctx.user.id,p_id:b.id,p_date:b.effective_date,p_reason:b.reason.trim(),p_version:b.version,p_request:b.requestId});
 if(result.error){const messages:Record<string,string>={WORKSPACE_STALE:'資料已變更，請重新載入後核對',WORKSPACE_CONFLICT:'此調店目前無法更正',WORKSPACE_SAME_DATE:'新日期與原日期相同',WORKSPACE_CROSS_MONTH_PENDING:'跨月份更正的人工核對與提交流程建置中，目前僅開放同月份更正',WORKSPACE_HISTORY_CHANGED:'申請與異動紀錄不一致，請先核對',WORKSPACE_LATER_MOVEMENT:'已有其他後續異動，請先核對員工歷程',WORKSPACE_EMPLOYEE_CHANGED:'目前員工主檔不符此調店，請先核對',WORKSPACE_MONTH_LOCKED:'受影響月份不是草稿，請先處理月份狀態',WORKSPACE_MONTH_DUPLICATE:'月份有重複員工資料，請先核對',WORKSPACE_MONTH_CHANGED:'月份狀態已被調整，請先核對',WORKSPACE_REQUEST_REUSED:'此更正識別已用於不同內容，請重新核對',WORKSPACE_INVALID:'日期須在2000至2100年，並填寫更正原因'};
  if(result.error.message.includes('WORKSPACE_FORBIDDEN'))throw new WorkspaceError(403,'目前沒有更正此申請的權限');
  for(const [key,message] of Object.entries(messages))if(result.error.message.includes(key))throw new WorkspaceError(409,message);
  throw new WorkspaceError(503,'更正未完成，請稍後重試');
 }return respond(result.data);
}catch(e){return failed(e);}}
