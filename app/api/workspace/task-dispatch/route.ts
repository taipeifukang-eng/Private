import {createHash} from 'crypto';
import {context,checked,failed,respond,uuid,WorkspaceError,checkOrigin} from '@/lib/workspace/server';
import {managedTemplate} from '@/lib/workspace/task-management';
import {taskRows} from '@/lib/workspace/task-archive';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{const ctx=await context(),id=new URL(request.url).searchParams.get('id');if(!uuid(id))throw new WorkspaceError(400,'範本編號無效');const {template}=await managedTemplate(ctx,id);
    const assignment=checked(await ctx.admin.from('assignments').select('id,workspace_version,planned_start_date,planned_end_date,status,department').eq('template_id',id).eq('archived',false).order('created_at',{ascending:false}).order('id').limit(1).maybeSingle());
    const collaborators=assignment?await taskRows(()=>ctx.admin.from('assignment_collaborators').select('user_id,section_id').eq('assignment_id',assignment.id).order('id')):[];
    const people=await taskRows(()=>ctx.admin.from('profiles').select('id,full_name,email,department,job_title').order('full_name').order('id'));
    return respond({template,assignment,collaborators,people,actor:ctx.user.id});
  }catch(e){return failed(e);}
}
export async function POST(request:Request){
  try{checkOrigin(request);const ctx=await context(),b=await request.json();if(!uuid(b.id)||!uuid(b.writeId)||!['copy','assign'].includes(b.operation)||!Number.isSafeInteger(b.version)||(b.assignment!==null&&(!b.assignment||!uuid(b.assignment.id)||!Number.isSafeInteger(b.assignment.version))))throw new WorkspaceError(400,'操作資料格式不符');await managedTemplate(ctx,b.id);
    let form:any;
    if(b.operation==='copy'){if(typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>300)throw new WorkspaceError(400,'請填寫 300 字以內的副本標題');form={title:b.title.trim()};}
    else{if(!Array.isArray(b.users)||b.users.length>2000||b.users.some((u:any)=>!uuid(u)))throw new WorkspaceError(400,'人員清單格式不符');const date=(v:any)=>{if(v===null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new WorkspaceError(400,'日期格式不符');return v;};form={users:Array.from(new Set<string>(b.users)).sort(),start:date(b.start),end:date(b.end)};if(form.start&&form.end&&form.start>form.end)throw new WorkspaceError(400,'開始日不可晚於結束日');}
    const hash=createHash('sha256').update(JSON.stringify({id:b.id,version:b.version,assignment:b.assignment,operation:b.operation,form})).digest('hex');
    const r=await ctx.admin.rpc('workspace_dispatch_task',{p_template:b.id,p_version:b.version,p_assignment:b.assignment?.id || null,p_assignment_version:b.assignment?.version || 0,p_actor:ctx.user.id,p_write:b.writeId,p_hash:hash,p_operation:b.operation,p_form:form});
    if(r.error){if(/CONFLICT/.test(r.error.message))throw new WorkspaceError(409,'範本或指派已變更，草稿保留，請另開最新版本核對');if(/INVALID_MEMBER/.test(r.error.message))throw new WorkspaceError(400,'所選人員已不存在，請重新選擇');throw new WorkspaceError(503,'操作失敗，請保留視窗重試');}return respond(r.data);
  }catch(e){return failed(e);}
}
