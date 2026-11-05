import {checked,context,WorkspaceError,type Context} from './server';
export type TransferSide='from'|'to';
/**
 * 調店確認人（M2 D.2）：原店督導與新店督導都確認才生效。
 * 督導 = store_managers.role_type='supervisor' 的門市指派；系統管理員可代為確認（留下代確認紀錄）。
 */
export async function transferAccess(existing?:Context){
 const ctx=existing||await context();const profile=checked(await ctx.auth.from('profiles').select('role').eq('id',ctx.user.id).maybeSingle());const admin=profile?.role==='admin',create=admin||ctx.has('employee.store_transfer.create'),confirm=admin||ctx.has('employee.store_transfer.confirm');
 if(!create&&!confirm)throw new WorkspaceError(403,'沒有調店申請的查看權限');
 const managed=new Set<string>(),supervised=new Set<string>();if(!admin){for(let from=0;;from+=500){const rows=checked(await ctx.auth.from('store_managers').select('store_id,role_type').eq('user_id',ctx.user.id).order('store_id').range(from,from+499))||[];for(const r of rows){managed.add(r.store_id);if(r.role_type==='supervisor')supervised.add(r.store_id);}if(rows.length<500)break;}}
 type Req={from_store_id:string;to_store_id:string};
 /** 目前使用者可代表確認的調店側（尚未被確認者）。 */
 const sides=(r:Req,done:TransferSide[]=[]):TransferSide[]=>{
  if(!confirm)return [];const out:TransferSide[]=[];
  if(!done.includes('from')&&(admin||supervised.has(r.from_store_id)))out.push('from');
  if(!done.includes('to')&&(admin||supervised.has(r.to_store_id)))out.push('to');
  return out;
 };
 return {ctx,admin,create,confirm,supervised,sides,canRead:(r:Req)=>admin||create||managed.has(r.from_store_id)||managed.has(r.to_store_id),canReject:(r:Req)=>confirm&&(admin||managed.has(r.from_store_id)||managed.has(r.to_store_id)),canConfirm:(r:Req,done:TransferSide[]=[])=>sides(r,done).length>0};
}
