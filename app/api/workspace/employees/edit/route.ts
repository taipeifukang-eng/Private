import { checked, checkOrigin, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { canReadStorePersonnel } from '@/lib/workspace/store-personnel';
import { employeeDirectory } from '@/lib/workspace/employee-directory';
import { normalizeBirthday } from '@/lib/workspace/employee-birthdays';
import { POSITION_OPTIONS } from '@/types/workflow';
export const dynamic='force-dynamic';
async function authorized(){const ctx=await context();requireCapability(ctx,['employee.manage']);requireCapability(ctx,['employee.employee.edit']);if(!await canReadStorePersonnel(ctx))throw new WorkspaceError(403,'目前職務沒有全域員工管理權限');return ctx;}
function code(value:any){if(typeof value!=='string'||! /^[A-Z0-9_-]{1,30}$/.test(value))throw new WorkspaceError(400,'員編不正確');return value;}
export async function GET(request:Request){try{
 const ctx=await authorized(), employeeCode=code(new URL(request.url).searchParams.get('employee'));
 const snapshot=checked(await ctx.admin.rpc('workspace_employee_edit_state',{p_code:employeeCode}));
 const employee=employeeDirectory(snapshot.masters,snapshot.statuses,snapshot.movements)[0];
 if(!employee)throw new WorkspaceError(404,'找不到員工');
 return respond({employee,expected:snapshot,positions:POSITION_OPTIONS,monthlyCount:snapshot.statuses.length,masterCount:snapshot.masters.length});
}catch(e){return failed(e);}}
export async function PUT(request:Request){try{
 checkOrigin(request);const ctx=await authorized(),b=await request.json(),d=b?.data;
 const employeeCode=code(d?.employee_code);
 if(!uuid(b.requestId)||!b.expected||typeof d.employee_name!=='string'||!d.employee_name.trim()||d.employee_name.trim().length>100)throw new WorkspaceError(400,'請填寫姓名');
 const position=d.current_position || '';
 // Preserve a historical position option if it was already present, without accepting arbitrary new values.
 const original=employeeDirectory(b.expected.masters || [],b.expected.statuses || [],b.expected.movements || [])[0];
 if(typeof position!=='string'||(position&&!POSITION_OPTIONS.includes(position)&&position!==original?.current_position))throw new WorkspaceError(400,'職位不正確');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=(v:any,limit:string)=>{if(v===''||v==null)return null;if(typeof v!=='string')throw new WorkspaceError(400,'日期格式不正確');const result=normalizeBirthday(v,limit);if(!result)throw new WorkspaceError(400,'請填寫有效日期，生日不可晚於今天');return result;};
 const birthday=date(d.birthday,today),start_date=date(d.start_date,'9999-12-31');
 if(birthday&&start_date&&birthday>start_date)throw new WorkspaceError(400,'生日不可晚於到職日');
 const r=await ctx.admin.rpc('workspace_employee_edit',{p_actor:ctx.user.id,p_request:b.requestId,p_expected:b.expected,p_data:{employee_code:employeeCode,employee_name:d.employee_name.trim(),current_position:position,birthday,start_date}});
 if(r.error)throw new WorkspaceError(r.error.message.includes('WORKSPACE_CHANGED')?409:503,r.error.message.includes('WORKSPACE_CHANGED')?'員工資料已變更，草稿已保留。請關閉後重新開啟核對。':'儲存未完成，請稍後重試；資料未部分寫入。');
 return respond(r.data);
}catch(e){return failed(e);}}
