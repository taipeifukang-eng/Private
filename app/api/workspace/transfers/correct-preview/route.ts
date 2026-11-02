import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
import {transferCorrectionPlan} from '@/lib/workspace/transfer-correction-plan';
import {getMovementDateError} from '@/lib/employee-movement-date';
export const dynamic='force-dynamic';
async function all(query:()=>any){const rows:any[]=[];for(let n=0;;n+=500){const batch=checked(await query().range(n,n+499)) as any[];rows.push(...batch);if(batch.length<500)return rows;}}
export async function POST(request:Request){try{
 checkOrigin(request);const access=await transferAccess(),{ctx}=access;let body:any;try{body=await request.json();}catch{throw new WorkspaceError(400,'核對資料格式不正確');}
 if(!uuid(body?.id))throw new WorkspaceError(400,'申請編號不正確');const error=getMovementDateError(body?.effective_date);if(error)throw new WorkspaceError(400,error);
 const row=checked(await ctx.auth.from('store_transfer_requests').select('*').eq('id',body.id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的調店申請');if(!access.canReject(row))throw new WorkspaceError(403,'沒有更正此申請的權限');
 if(row.status!=='confirmed'||!row.effective_date||!row.movement_history_id)throw new WorkspaceError(409,'目前不是可更正的已確認調店');
 if(row.effective_date===body.effective_date)throw new WorkspaceError(400,'新日期與原日期相同');
 const version=checked(await ctx.admin.rpc('workspace_transfer_snapshot',{p_id:row.id}));
 const current=checked(await ctx.auth.from('store_transfer_requests').select('*').eq('id',row.id).maybeSingle());if(JSON.stringify(row)!==JSON.stringify(current))throw new WorkspaceError(409,'申請已變更，請重新核對');
 const dates=[row.effective_date.slice(0,7),body.effective_date.slice(0,7)].sort();
 const [rows,initialized,stores]=await Promise.all([
  all(()=>ctx.admin.from('monthly_staff_status').select('*').eq('employee_code',row.employee_code).in('store_id',[row.from_store_id,row.to_store_id]).gte('year_month',dates[0]).lte('year_month',dates[1]).order('id')),
  all(()=>ctx.admin.from('monthly_staff_status').select('store_id,year_month').in('store_id',[row.from_store_id,row.to_store_id]).gte('year_month',dates[0]).lte('year_month',dates[1]).eq('status','draft').order('id')),
  ctx.admin.from('stores').select('id,store_name').in('id',[row.from_store_id,row.to_store_id]).then(checked),
 ]);
 let plan;try{plan=transferCorrectionPlan({oldDate:row.effective_date,newDate:body.effective_date,fromStore:row.from_store_id,toStore:row.to_store_id,fromName:stores?.find(s=>s.id===row.from_store_id)?.store_name||'調出門市',toName:stores?.find(s=>s.id===row.to_store_id)?.store_name||'調入門市',rows,initialized});}catch(e){throw new WorkspaceError(400,(e as Error).message);}
 if(version!==checked(await ctx.admin.rpc('workspace_transfer_snapshot',{p_id:row.id})))throw new WorkspaceError(409,'核對期間資料變更，請重新核對');
 return respond({...plan,id:row.id,version,validationOnly:true,canSubmit:false});
}catch(e){return failed(e);}}
