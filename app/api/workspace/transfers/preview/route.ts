import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
import {getMovementDateError} from '@/lib/employee-movement-date';
import {transferMonthPlan} from '@/lib/workspace/transfer-months';
export const dynamic='force-dynamic';
async function all(query:()=>any){const rows:any[]=[];for(let n=0;;n+=500){const page=checked(await query().range(n,n+499)) as any[];rows.push(...page);if(page.length<500)return rows;}}
export async function POST(request:Request){try{
 checkOrigin(request);const access=await transferAccess(),{ctx}=access;let body:any;
 try{body=await request.json();}catch{throw new WorkspaceError(400,'核對資料格式不正確');}
 if(!uuid(body?.id))throw new WorkspaceError(400,'申請編號不正確');const dateError=getMovementDateError(body.effective_date);if(dateError)throw new WorkspaceError(400,dateError);
 const row=checked(await ctx.auth.from('store_transfer_requests').select('*').eq('id',body.id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的調店申請');
 if(!access.canReject(row))throw new WorkspaceError(403,'沒有確認此調店申請的權限');
 if(row.status!=='pending')throw new WorkspaceError(409,'此申請已被處理，請重新整理確認');
 // Scoped authorization above allows both ends of this particular request to be checked.
 // Do not return other employees' monthly records or expose a general service-role catalog.
 const version=checked(await ctx.admin.rpc('workspace_transfer_snapshot',{p_id:row.id}));
 const current=checked(await ctx.auth.from('store_transfer_requests').select('*').eq('id',row.id).maybeSingle());
 if(JSON.stringify(current)!==JSON.stringify(row))throw new WorkspaceError(409,'申請已變更，請重新核對');
 const month=body.effective_date.slice(0,7);
 const [stores,rows,drafts,duplicates,employees,later]=await Promise.all([
  ctx.admin.from('stores').select('id,store_name,is_active').in('id',[row.from_store_id,row.to_store_id]).then(checked),
  all(()=>ctx.admin.from('monthly_staff_status').select('id,store_id,year_month,status,monthly_status,work_days').eq('employee_code',row.employee_code).in('store_id',[row.from_store_id,row.to_store_id]).gte('year_month',month).order('id')),
  all(()=>ctx.admin.from('monthly_staff_status').select('year_month').eq('store_id',row.to_store_id).eq('status','draft').gte('year_month',month).order('id')),
  ctx.admin.from('employee_movement_history').select('id').eq('employee_code',row.employee_code).eq('movement_type','store_transfer').eq('movement_date',body.effective_date).limit(1).then(checked),
  all(()=>ctx.admin.from('store_employees').select('id,store_id,employee_name,is_active,last_movement_date').eq('employee_code',row.employee_code).order('id')),
  ctx.admin.from('employee_movement_history').select('id').eq('employee_code',row.employee_code).gt('movement_date',body.effective_date).limit(1).then(checked),
 ]);
 const from=stores?.find(s=>s.id===row.from_store_id),to=stores?.find(s=>s.id===row.to_store_id);
 const plan=transferMonthPlan({effectiveDate:body.effective_date,fromStore:row.from_store_id,toStore:row.to_store_id,fromName:from?.store_name||row.from_store_id,toName:to?.store_name||row.to_store_id,rows,destinationDraftMonths:drafts.map(r=>r.year_month)});
 if(!from?.is_active||!to?.is_active)plan.conflicts.push('調出或調入門市已停用或不存在');
 if(duplicates?.length)plan.conflicts.push('員工在此日期已有調店異動紀錄');
 const active=employees.filter(e=>e.is_active);
 if(active.length!==1||active[0]?.store_id!==row.from_store_id||active[0]?.employee_name!==row.employee_name||employees.filter(e=>e.store_id===row.to_store_id).length>1)plan.conflicts.push('員工主檔與申請不符，請核對姓名及原任職門市');
 if(later?.length||employees.some(e=>e.last_movement_date>body.effective_date))plan.conflicts.push('此員工已有較晚的異動，請先核對完整歷程');
 if(version!==checked(await ctx.admin.rpc('workspace_transfer_snapshot',{p_id:row.id})))throw new WorkspaceError(409,'資料在核對期間變更，請重新核對');
 return respond({version,id:row.id,employee_code:row.employee_code,employee_name:row.employee_name,effective_date:body.effective_date,...plan,validationOnly:false,canSubmit:plan.conflicts.length===0});
}catch(e){return failed(e);}}
