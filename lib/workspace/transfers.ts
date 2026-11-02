import {checked,context,WorkspaceError,type Context} from './server';
export async function transferAccess(existing?:Context){
 const ctx=existing||await context();const profile=checked(await ctx.auth.from('profiles').select('role').eq('id',ctx.user.id).maybeSingle());const admin=profile?.role==='admin',create=admin||ctx.has('employee.store_transfer.create'),confirm=admin||ctx.has('employee.store_transfer.confirm');
 if(!create&&!confirm)throw new WorkspaceError(403,'沒有調店申請的查看權限');
 const managed=new Set<string>();if(!admin){for(let from=0;;from+=500){const rows=checked(await ctx.auth.from('store_managers').select('store_id').eq('user_id',ctx.user.id).order('store_id').range(from,from+499))||[];for(const r of rows)managed.add(r.store_id);if(rows.length<500)break;}}
 return {ctx,admin,create,confirm,canRead:(r:{from_store_id:string;to_store_id:string})=>admin||create||managed.has(r.from_store_id)||managed.has(r.to_store_id),canReject:(r:{from_store_id:string;to_store_id:string})=>confirm&&(admin||managed.has(r.from_store_id)||managed.has(r.to_store_id))};
}
