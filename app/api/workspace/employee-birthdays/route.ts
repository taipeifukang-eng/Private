import {checked,checkOrigin,context,failed,requireCapability,respond,uuid,WorkspaceError,type Context} from '@/lib/workspace/server';
import {canReadStorePersonnel} from '@/lib/workspace/store-personnel';
import {employeeDirectory} from '@/lib/workspace/employee-directory';
import {MAX_BIRTHDAY_BYTES,MAX_BIRTHDAY_ROWS,parseBirthdayCsv,matchBirthdayEmployees,restoreBirthdayNames,normalizeBirthday} from '@/lib/workspace/employee-birthdays';
export const dynamic='force-dynamic';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function authorized(request:Request){checkOrigin(request);const ctx=await context();requireCapability(ctx,['employee.manage']);requireCapability(ctx,['employee.employee.edit']);if(!await canReadStorePersonnel(ctx))throw new WorkspaceError(403,'目前職務沒有全域員工管理權限');return ctx;}
async function visibleMasters(ctx:Context){const rows:any[]=[];for(let start=0;;start+=500){const batch=checked(await ctx.auth.from('store_employees').select('id,employee_code').order('id').range(start,start+499))||[];rows.push(...batch);if(batch.length<500)return rows;}}

export async function POST(request:Request){try{
 const ctx=await authorized(request);
 let form:FormData;try{form=await request.formData();}catch{throw new WorkspaceError(400,'請上傳 UTF-8 CSV 檔案');}
 const file=form.get('file');if(!file||typeof file==='string'||!file.name.toLowerCase().endsWith('.csv'))throw new WorkspaceError(400,'請選擇 CSV 檔案');
 if(file.size>MAX_BIRTHDAY_BYTES)throw new WorkspaceError(400,'CSV 檔案不可超過 5 MB');
 let parsed:ReturnType<typeof parseBirthdayCsv>;try{parsed=parseBirthdayCsv(await file.text(),today());}catch(e){throw new WorkspaceError(400,(e as Error).message);}
 const visible=await visibleMasters(ctx);const visibleIds=new Set(visible.map(r=>r.id));
 const snapshot=checked(await ctx.admin.rpc('workspace_birthday_snapshot',{p_codes:Array.from(new Set(parsed.rows.map(r=>r.employee_code)))}));
 const masters:any[]=snapshot.rows;
 if(masters.some(r=>!visibleIds.has(r.id)))throw new WorkspaceError(403,'部分員工主檔不在可查看範圍，無法整批更新生日');
 const employees=employeeDirectory(masters,[],[]);
 parsed.rows=restoreBirthdayNames(parsed.rows,employees);
 const birthdays=new Map<string,Set<string|null>>();
 for(const m of masters){const code=String(m.employee_code).trim().toUpperCase();if(!birthdays.has(code))birthdays.set(code,new Set());birthdays.get(code)!.add(m.birthday||null);}
 const errors=[...parsed.errors,...matchBirthdayEmployees(parsed.rows,employees)].sort((a,b)=>a.row-b.row);
 return respond({rows:parsed.rows.map(row=>({...row,previousBirthdays:Array.from(birthdays.get(row.employee_code)||[])})),errors,skipped:parsed.skipped,expected:snapshot.version,valid:parsed.rows.length>0&&errors.length===0});
}catch(e){return failed(e);}}

export async function PUT(request:Request){try{
 const ctx=await authorized(request);let body:any;try{body=await request.json();}catch{throw new WorkspaceError(400,'生日更新內容格式不正確');}
 if(!body||!uuid(body.requestId)||typeof body.expected!=='string'||!/^[a-f0-9]{32}$/.test(body.expected)||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>MAX_BIRTHDAY_ROWS)throw new WorkspaceError(400,'請先預覽並確認生日資料');
 const seen=new Set<string>();const rows=body.rows.map((r:any)=>{if(!r||typeof r.employee_code!=='string'||typeof r.employee_name!=='string'||typeof r.birthday!=='string')throw new WorkspaceError(400,'生日資料欄位不完整');const code=r.employee_code.trim().toUpperCase(),name=r.employee_name.trim(),date=normalizeBirthday(r.birthday,today());if(!/^[A-Z0-9_-]{1,30}$/.test(code)||!name||name.length>200||!date||seen.has(code))throw new WorkspaceError(400,'生日資料包含錯誤日期、員編、姓名或重複列');seen.add(code);return {employee_code:code,employee_name:name,birthday:date};}).sort((a:any,b:any)=>a.employee_code.localeCompare(b.employee_code));
 const visible=await visibleMasters(ctx);
 const result=await ctx.admin.rpc('workspace_birthday_save',{p_actor:ctx.user.id,p_request:body.requestId,p_rows:rows,p_expected:body.expected,p_visible_ids:visible.filter(r=>seen.has(String(r.employee_code).trim().toUpperCase())).map(r=>r.id)});
 if(result.error){const messages:[string,number,string][]=[['WORKSPACE_CONFLICT',409,'員工資料已更新，請重新預覽後再確認'],['WORKSPACE_REQUEST_REUSED',409,'本次儲存識別已用於其他內容，請重新預覽'],['WORKSPACE_SCOPE',403,'部分員工主檔不在可查看範圍'],['WORKSPACE_EMPLOYEE',400,'查無部分員工，整批生日均未更新'],['WORKSPACE_NAME',400,'員工姓名不符，請重新預覽'],['WORKSPACE_DATE',400,'生日日期不正確'],['WORKSPACE_INVALID',400,'生日更新內容格式不正確']];for(const [key,status,message] of messages)if(result.error.message.includes(key))throw new WorkspaceError(status,message);throw new WorkspaceError(503,'生日更新未完成，整批資料未部分套用，請稍後重試');}
 return respond(result.data);
}catch(e){return failed(e);}}
