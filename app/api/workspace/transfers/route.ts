import {checked,checkOrigin,failed,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {transferAccess} from '@/lib/workspace/transfers';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const access=await transferAccess(),{ctx}=access;const status=new URL(request.url).searchParams.get('status')||'pending';if(!['all','pending','confirmed','rejected'].includes(status))throw new WorkspaceError(400,'調店申請狀態不正確');
 const rows:any[]=[];for(let from=0;;from+=500){let query=ctx.auth.from('store_transfer_requests').select('*,from_store:from_store_id(store_code,store_name),to_store:to_store_id(store_code,store_name)').order('created_at',{ascending:false}).order('id');if(status!=='all')query=query.eq('status',status);const page=checked(await query.range(from,from+499))||[];rows.push(...page.filter(access.canRead));if(page.length<500)break;}
 // A supervisor may read a request involving their store while the other store's
 // general catalog is outside RLS. Resolve only names on already-authorized requests.
 const storeIds=Array.from(new Set<string>(rows.flatMap(r=>[r.from_store_id,r.to_store_id]))),storeNames=new Map<string,any>();
 for(let i=0;i<storeIds.length;i+=100){const stores=checked(await ctx.admin.from('stores').select('id,store_code,store_name').in('id',storeIds.slice(i,i+100)))||[];for(const s of stores)storeNames.set(s.id,s);}
 for(const row of rows){row.from_store=storeNames.get(row.from_store_id)||row.from_store;row.to_store=storeNames.get(row.to_store_id)||row.to_store;}
 const ids=Array.from(new Set<string>(rows.flatMap(r=>[r.created_by,r.confirmed_by,r.corrected_by]).filter(Boolean))),names=new Map<string,string>();
 for(let i=0;i<ids.length;i+=100){const profiles=checked(await ctx.auth.from('profiles').select('id,full_name').in('id',ids.slice(i,i+100)))||[];for(const p of profiles)names.set(p.id,p.full_name||'未提供姓名');}
 return respond({rows:rows.map(r=>({...r,creator_name:names.get(r.created_by)||null,confirmer_name:names.get(r.confirmed_by)||null,corrector_name:names.get(r.corrected_by)||null,canReject:r.status==='pending'&&access.canReject(r),canCorrect:r.status==='confirmed'&&!!r.effective_date&&!!r.movement_history_id&&access.canReject(r)})),status,canCreate:access.create});
}catch(e){return failed(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const access=await transferAccess(),{ctx}=access;
 let body:any;try{body=await request.json();}catch{throw new WorkspaceError(400,'操作資料格式不正確');}if(body?.operation!=='reject'||!uuid(body?.id))throw new WorkspaceError(400,'拒絕申請資料不正確');
 const row=checked(await ctx.auth.from('store_transfer_requests').select('id,status,from_store_id,to_store_id,confirmed_by').eq('id',body.id).maybeSingle());
 if(!row||!access.canRead(row))throw new WorkspaceError(404,'找不到可查看的調店申請');if(!access.canReject(row))throw new WorkspaceError(403,'您沒有拒絕此門市調店申請的權限');
 if(row.status==='rejected'&&row.confirmed_by===ctx.user.id)return respond({id:row.id,status:'rejected',alreadyRejected:true});
 if(row.status!=='pending')throw new WorkspaceError(409,'此申請已被處理，請重新整理確認');
 const result=checked(await ctx.auth.from('store_transfer_requests').update({status:'rejected',confirmed_by:ctx.user.id,confirmed_at:new Date().toISOString()}).eq('id',row.id).eq('status','pending').eq('from_store_id',row.from_store_id).eq('to_store_id',row.to_store_id).select('id,status').maybeSingle());
 if(!result)throw new WorkspaceError(409,'申請已變更或目前無法更新，請重新整理確認');
 return respond(result);
}catch(e){return failed(e);}}
