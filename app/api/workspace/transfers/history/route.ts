import {checked,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const params=new URL(request.url).searchParams,id=params.get('id')||'',raw=params.get('page')||'1';
 if(!uuid(id)||!/^\d{1,5}$/.test(raw)||Number(raw)<1)throw new WorkspaceError(400,'申請編號或頁碼不正確');
 const page=Number(raw),pageSize=20,access=await transferAccess(),{ctx}=access;
 const row=checked(await ctx.auth.from('store_transfer_requests').select('id,from_store_id,to_store_id,effective_date,corrected_at,corrected_by,correction_reason').eq('id',id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的申請');
 const result=await ctx.admin.from('workspace_transfer_corrections').select('request_id,old_date,new_date,reason,actor_id,created_at',{count:'exact'}).eq('transfer_id',id).order('created_at',{ascending:false}).order('request_id').range((page-1)*pageSize,page*pageSize-1);
 const rows=checked(result)||[];
 const latest=checked(await ctx.admin.from('workspace_transfer_corrections').select('new_date,created_at,actor_id,reason').eq('transfer_id',id).order('created_at',{ascending:false}).order('request_id').limit(1).maybeSingle());
 const legacy=row.corrected_at&&(!latest||Date.parse(latest.created_at)!==Date.parse(row.corrected_at)||latest.new_date!==row.effective_date||latest.actor_id!==row.corrected_by||latest.reason!==row.correction_reason)?{new_date:row.effective_date,created_at:row.corrected_at,actor_id:row.corrected_by,reason:row.correction_reason}:null;
 const actors=Array.from(new Set<string>([...rows.map(r=>r.actor_id),legacy?.actor_id].filter(Boolean) as string[])),names=new Map<string,string>();
 if(actors.length){const people=checked(await ctx.admin.from('profiles').select('id,full_name').in('id',actors))||[];for(const person of people)names.set(person.id,person.full_name||'未提供姓名');}
 return respond({rows:rows.map(r=>({...r,actor_name:names.get(r.actor_id)||'未提供更正人'})),legacy:legacy?{...legacy,actor_name:names.get(legacy.actor_id)||'未提供更正人'}:null,total:result.count||0,page,pageSize});
}catch(e){return failed(e);}}
