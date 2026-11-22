import {movementErrors as messages} from '@/lib/workspace/movement-errors';
import {checkOrigin,context,failed,requireCapability,respond,uuid,WorkspaceError} from '@/lib/workspace/server';
import {validateMovementFields} from '@/lib/workspace/movement-fields';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,['employee.promotion.batch']);
 const b=await request.json();
 if(!uuid(b?.requestId)||typeof b?.version!=='string'||!/^[a-f0-9]{32}$/.test(b.version))throw new WorkspaceError(400,'請先查核這批異動');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let fields:ReturnType<typeof validateMovementFields>;try{fields=validateMovementFields(b.rows,today);}catch(e){throw new WorkspaceError(400,(e as Error).message);}
 if(!fields.valid)throw new WorkspaceError(400,fields.errors.map(e=>`第 ${e.row} 列：${e.message}`).join('；'));
 const ids=Array.from(new Set(fields.rows.flatMap(r=>[r.store_id,r.from_store_id,r.to_store_id]).filter(id=>id&&!id.startsWith('org:'))));
 for(let i=0;i<ids.length;i+=100){const chunk=ids.slice(i,i+100),r=await ctx.auth.from('stores').select('id').in('id',chunk);if(r.error||r.data?.length!==chunk.length)throw new WorkspaceError(403,'門市查看範圍已變更，請重新查核');}
 const r=await ctx.admin.rpc('workspace_movement_save',{p_actor:ctx.user.id,p_request:b.requestId,p_rows:fields.rows,p_expected:b.version});
 if(r.error){
  const key=Object.keys(messages).find(k=>r.error!.message===k),row=/row=(\d+)/.exec(r.error.details||'')?.[1];
  if(key)throw new WorkspaceError(409,`${row?`第 ${row} 列：`:''}${messages[key]}整批未儲存，草稿已保留。`);
  throw new WorkspaceError(503,'尚無法確認儲存結果，請保留目前內容並重試；同批重試不會重複登記。');
 }
 return respond(r.data);
}catch(e){return failed(e);}}
