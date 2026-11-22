import {formatPromotionPosition,getMovementNotesForDisplay} from '@/lib/monthly-staff/promotion-level';
import {checked,checkOrigin,context,failed,requireCapability,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {POSITION_OPTIONS} from '@/types/workflow';
import {normalizeBirthday} from '@/lib/workspace/employee-birthdays';
import {canReadStorePersonnel} from '@/lib/workspace/store-personnel';
import {employeeDirectory} from '@/lib/workspace/employee-directory';
import {checkEmployeeId} from '@/lib/workspace/employee-id-rule';
export const dynamic='force-dynamic';
async function all(query:()=>any){const result:any[]=[];for(let start=0;;start+=500){const rows=checked(await query().range(start,start+499)) as any[];result.push(...rows);if(rows.length<500)return result;}}
export async function GET(request:Request){try{
 const ctx=await context();requireCapability(ctx,['employee.manage']);
 if(!await canReadStorePersonnel(ctx))throw new WorkspaceError(403,'目前職務沒有全域員工管理權限');
 const code=new URL(request.url).searchParams.get('history');
 if(code!==null){
  const normalized=code.trim().toUpperCase();if(!/^[A-Z0-9_-]{1,30}$/.test(normalized))throw new WorkspaceError(400,'員工代碼格式不正確');
  const history=await all(()=>ctx.auth.from('employee_movement_history').select('id,employee_code,employee_name,movement_type,movement_date,old_value,new_value,notes,store:stores(store_code,store_name)').eq('employee_code',normalized).order('movement_date',{ascending:false}).order('created_at',{ascending:false}).order('id'));
  const label=(v:string)=>({active:'在職',resigned:'離職',full_month:'整月在職',new_hire:'新進',leave_of_absence:'留職停薪',leave_without_pay:'留職停薪',transferred_in:'調入',transferred_out:'調出',promoted:'升職',support_rotation:'支援卡班',dual_store_manager:'擔任雙店長',leave_return:'留停復職'}[v]||v||'—');
  return respond({history:history.map(h=>({...h,old_label:label(h.old_value),new_label:formatPromotionPosition(label(h.new_value),h.notes),display_notes:getMovementNotesForDisplay(h.notes)}))});
 }
 const [masters,statuses,movements]=await Promise.all([
  all(()=>ctx.auth.from('store_employees').select('employee_code,employee_name,start_date,birthday,current_position,newbie_level,is_active,employment_status,last_movement_date').order('id')),
  all(()=>ctx.auth.from('monthly_staff_status').select('employee_code,employee_name,position,year_month,monthly_status,start_date').order('year_month',{ascending:false}).order('id')),
  all(()=>ctx.auth.from('employee_movement_history').select('employee_code,employee_name,movement_type,new_value,movement_date').order('movement_date',{ascending:false}).order('created_at',{ascending:false}).order('id')),
 ]);
 const employees=employeeDirectory(masters,statuses,movements);
 return respond({employees,total:employees.length,active:employees.filter(e=>e.is_active).length,positions:POSITION_OPTIONS,capabilities:{create:ctx.has('employee.employee.create'),edit:ctx.has('employee.employee.edit')}});
}catch(e){return failed(e);}}

export async function POST(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,['employee.manage']);requireCapability(ctx,['employee.employee.create']);
 if(!await canReadStorePersonnel(ctx))throw new WorkspaceError(403,'目前職務沒有全域員工管理權限');
 let body:any;try{body=await request.json();}catch{throw new WorkspaceError(400,'員工資料格式不正確');}
 const d=body?.data;
 if(!uuid(body?.requestId)||!d||typeof d.employee_code!=='string'||typeof d.employee_name!=='string')throw new WorkspaceError(400,'請填寫員編與姓名');
 const idCheck=checkEmployeeId(d.employee_code),code=idCheck.code,name=d.employee_name.trim(),position=d.current_position??'';
 if(!idCheck.ok)throw new WorkspaceError(400,idCheck.message);
 if(!name||name.length>100||typeof position!=='string'||(position&&!POSITION_OPTIONS.includes(position)))throw new WorkspaceError(400,'員編、姓名或職位格式不正確');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=(value:any,limit:string)=>{if(value==null||value==='')return null;if(typeof value!=='string')throw new WorkspaceError(400,'日期格式不正確');const normalized=normalizeBirthday(value,limit);if(!normalized)throw new WorkspaceError(400,'請填寫有效的西元日期，生日不可晚於今天');return normalized;};
 const birthday=date(d.birthday,today),start=date(d.start_date,'9999-12-31');
 if(birthday&&start&&birthday>start)throw new WorkspaceError(400,'生日不可晚於到職日');
 const result=await ctx.admin.rpc('workspace_employee_create',{p_actor:ctx.user.id,p_request:body.requestId,p_data:{employee_code:code,employee_name:name,current_position:position,start_date:start,birthday}});
 if(result.error){if(result.error.message.includes('WORKSPACE_DUPLICATE'))throw new WorkspaceError(409,'此員編已存在於主檔、月人員狀態或異動紀錄，請先查看既有員工');if(result.error.message.includes('WORKSPACE_REQUEST_REUSED'))throw new WorkspaceError(409,'新增識別已用於其他內容，請重新確認');if(result.error.message.includes('WORKSPACE_DATE'))throw new WorkspaceError(400,'生日或到職日不正確');throw new WorkspaceError(503,'員工新增未完成，請稍後重試');}
 return respond(result.data);
}catch(e){return failed(e);}}
