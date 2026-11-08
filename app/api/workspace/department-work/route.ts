import { checked, checkOrigin, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES } from '@/lib/admin/organization-management';
import { DEPARTMENT_PAGE_PERMISSION_CODES } from '@/lib/workspace/organization-rules';
export const dynamic='force-dynamic';
const manage=[...ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES];
export async function GET(request:Request){try{
 const ctx=await context();requireCapability(ctx,[...DEPARTMENT_PAGE_PERMISSION_CODES]); // M5 Q9：照舊版部門管理頁的進入條件（只有組織檢視或成員／主管檢視權限進不來）
 const query=new URL(request.url).searchParams;
 if(query.get('people')==='true'){
  requireCapability(ctx,manage);const people:any[]=[];
  for(let start=0;;start+=500){const rows=checked(await ctx.admin.from('profiles').select('id,full_name,email,employee_code,job_title,department').order('id').range(start,start+499))||[];people.push(...rows);if(rows.length<500)break;}
  return respond({people});
 }
 const catalog=checked(await ctx.admin.rpc('workspace_organization_catalog'));
 const departments=catalog.units.filter((u:any)=>u.type==='department');
 const organizationCapabilities={create:ctx.has('organization.department.create'),edit:ctx.has('organization.department.edit'),members:ctx.has('organization.member.manage'),managers:ctx.has('organization.manager.manage')};
 const id=query.get('department');
 if(!id)return respond({departments,canManage:ctx.has(...manage),organizationCapabilities});
 if(!uuid(id))throw new WorkspaceError(400,'部門識別格式不正確');
 const department=departments.find((u:any)=>u.id===id);
 if(!department)throw new WorkspaceError(404,'找不到此部門');
 const work=checked(await ctx.admin.rpc('workspace_department_catalog',{p_department:id}));
 return respond({...work,members:department.members,managers:department.managers,organizationCapabilities,canManage:ctx.has(...manage)&&work.department?.status==='active'});
}catch(e){return failed(e);}}
const invalid=()=>new WorkspaceError(400,'工作職掌資料格式不正確，請檢查分類、名稱及指派人員');
const text=(value:any,max:number,required=false)=>{if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))throw invalid();return value.trim();};
export async function POST(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,manage);
 let body:any;try{body=await request.json();}catch{throw invalid();}
 if(!body||!uuid(body.requestId)||typeof body.expected!=='string'||!/^[a-f0-9]{32}$/.test(body.expected)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw invalid();
 const d=body.data;
 if(!uuid(d.organization_unit_id)||(d.id!=null&&!uuid(d.id))||(d.category_id!=null&&!uuid(d.category_id))||!['fixed','recurring','project'].includes(d.work_type)||!['normal','important','critical'].includes(d.importance)||!['active','inactive'].includes(d.status)||!Array.isArray(d.assignments)||d.assignments.length>1000)throw invalid();
 const data:any={id:d.id??null,organization_unit_id:d.organization_unit_id,category_id:d.category_id??null,category_name:text(d.category_name??'',200),title:text(d.title,300,true),work_type:d.work_type,importance:d.importance,status:d.status};
 if(!data.category_id&&!data.category_name)throw new WorkspaceError(400,'請選擇或新增工作分類');
 for(const key of ['purpose','execution_context','completion_standard','notes','related_resources','handover_focus','required_systems','important_contacts','handover_notes'])data[key]=text(d[key]??'',10000);
 data.assignments=d.assignments.map((a:any)=>{if(!a||!uuid(a.user_id)||!['PRIMARY','COLLABORATOR','BACKUP'].includes(a.assignment_type))throw invalid();return {user_id:a.user_id,assignment_type:a.assignment_type};}).sort((a:any,b:any)=>(a.user_id+':'+a.assignment_type).localeCompare(b.user_id+':'+b.assignment_type));
 if(new Set(data.assignments.map((a:any)=>a.user_id+':'+a.assignment_type)).size!==data.assignments.length)throw invalid();
 const result=await ctx.admin.rpc('workspace_department_save',{p_actor:ctx.user.id,p_request:body.requestId,p_data:data,p_expected:body.expected});
 if(result.error){
  const errors:[string,number,string][]=[['WORKSPACE_CONFLICT',409,'此部門的工作職掌已更新，請保留草稿並重新載入核對'],['WORKSPACE_REQUEST_REUSED',409,'儲存識別已用於其他內容，請重新確認後儲存'],['WORKSPACE_DEPARTMENT',400,'只能在啟用中的部門維護工作職掌'],['WORKSPACE_NOT_FOUND',404,'此部門找不到該工作職掌'],['WORKSPACE_CATEGORY',400,'分類不存在、已停用或屬於其他部門'],['WORKSPACE_PERSON',400,'所選指派人員已不存在或角色不正確'],['WORKSPACE_INVALID',400,'工作職掌格式不正確']];
  for(const [key,status,message] of errors)if(result.error.message.includes(key))throw new WorkspaceError(status,message);
  throw new WorkspaceError(503,'工作職掌未儲存，分類與人員指派均未部分套用，請稍後重試');
 }
 return respond(result.data);
}catch(e){return failed(e);}}
