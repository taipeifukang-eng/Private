import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
export const dynamic='force-dynamic';
async function access(){const a=await transferAccess();if(!a.create)throw new WorkspaceError(403,'沒有新增調店申請權限');return a.ctx;}
async function all(query:()=>any){const rows:any[]=[];for(let n=0;;n+=500){const page=checked(await query().range(n,n+499)) as any[];rows.push(...page);if(page.length<500)return rows;}}
export async function GET(request:Request){try{
 const ctx=await access();
 // H.5：登記調店時偵測該員目前是否為代理店長（原店），畫面據此詢問「新任職的門市是否也擔任代理店長」。
 const query=new URL(request.url).searchParams,actingCode=query.get('acting_code');
 if(actingCode!==null){
  const code=actingCode.trim().toUpperCase(),fromStore=(query.get('from_store_id')||'').toLowerCase();
  if(!/^[A-Z0-9_-]{1,20}$/.test(code)||(fromStore&&!uuid(fromStore)))throw new WorkspaceError(400,'員編或門市不正確');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const acting=checked(await ctx.admin.rpc('workspace_acting_active',{p_code:code,p_store:fromStore||null,p_until:today}))===true;
  return respond({acting});
 }
 const [stores,employees]=await Promise.all([
 all(()=>ctx.auth.from('stores').select('id,store_code,store_name').eq('is_active',true).order('store_code').order('id')),
 all(()=>ctx.auth.from('store_employees').select('id,employee_code,employee_name,store_id').order('employee_code').order('id')),
 ]);return respond({stores,employees});
}catch(e){return failed(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const ctx=await access();let body:any;try{body=await request.json();}catch{throw new WorkspaceError(400,'申請資料格式不正確');}
 const fields=['employee_code','employee_name','from_store_id','to_store_id','notes'];
 if(!uuid(body?.requestId)||!body?.data||fields.some(k=>typeof body.data[k]!=='string'))throw new WorkspaceError(400,'請填寫完整申請資料');
 const d=Object.fromEntries(fields.map(k=>[k,body.data[k].trim()]));d.employee_code=d.employee_code.toUpperCase();d.from_store_id=d.from_store_id.toLowerCase();d.to_store_id=d.to_store_id.toLowerCase();
 if(!/^[A-Z0-9_-]{1,20}$/.test(d.employee_code)||!d.employee_name||d.employee_name.length>100||d.notes.length>5000||!uuid(d.from_store_id)||!uuid(d.to_store_id)||d.from_store_id===d.to_store_id)throw new WorkspaceError(400,'請核對員編、姓名及不同的調出／調入門市；備註限5000字');
 if(body.data.continue_acting!==undefined&&typeof body.data.continue_acting!=='boolean')throw new WorkspaceError(400,'請核對「新店是否續任代理店長」');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // H.5：只有該員目前確實是原店的代理店長，「新店續任代理」的答案才有意義，否則一律記為否。
 const continueActing=body.data.continue_acting===true&&checked(await ctx.admin.rpc('workspace_acting_active',{p_code:d.employee_code,p_store:d.from_store_id,p_until:today}))===true;
 const id=body.requestId.toLowerCase();
 const existing=async()=>checked(await ctx.auth.from('store_transfer_requests').select('*').eq('id',id).maybeSingle());
 const replay=(row:any)=>{if(row.created_by!==ctx.user.id||fields.some(k=>(row[k]||'')!==d[k])||!!row.continue_acting!==continueActing)throw new WorkspaceError(409,'此請求編號已使用，請重新核對申請');return respond({id:row.id,status:row.status,alreadyCreated:true});};
 const prior=await existing();if(prior)return replay(prior);
 const stores=checked(await ctx.auth.from('stores').select('id').in('id',[d.from_store_id,d.to_store_id]).eq('is_active',true))||[];
 if(stores.length!==2)throw new WorkspaceError(400,'調出或調入門市已停用或無法查看，請重新選擇');
 const result=await ctx.auth.from('store_transfer_requests').insert({...d,notes:d.notes||null,continue_acting:continueActing,id,created_by:ctx.user.id,status:'pending'}).select('id,status').single();
 if(result.error?.code==='23505'){const row=await existing();if(row)return replay(row);throw new WorkspaceError(409,'此請求編號已使用，請重新核對申請');}
 return respond(checked(result));
}catch(e){return failed(e);}}
