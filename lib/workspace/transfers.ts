import {checked,context,WorkspaceError,type Context} from './server';
/** 確認紀錄的 side：from＝原店督導、to＝新店督導、both＝同一位督導同時負責兩店、admin＝系統管理員代確認。 */
export type TransferConfirmSide='from'|'to'|'both'|'admin';
/**
 * 調店確認人（M2 H.1／H.7）：原店或新店任一位督導（主責或代理）確認即成立。
 * 督導 = store_managers.role_type='supervisor' 的門市指派；店長不能確認；系統管理員可代為確認（留下代確認紀錄）。
 */
export async function transferAccess(existing?:Context){
 const ctx=existing||await context();const profile=checked(await ctx.auth.from('profiles').select('role').eq('id',ctx.user.id).maybeSingle());const admin=profile?.role==='admin',create=admin||ctx.has('employee.store_transfer.create'),confirm=admin||ctx.has('employee.store_transfer.confirm');
 if(!create&&!confirm)throw new WorkspaceError(403,'沒有調店申請的查看權限');
 const managed=new Set<string>(),supervised=new Set<string>();if(!admin){for(let from=0;;from+=500){const rows=checked(await ctx.auth.from('store_managers').select('store_id,role_type').eq('user_id',ctx.user.id).order('store_id').range(from,from+499))||[];for(const r of rows){managed.add(r.store_id);if(r.role_type==='supervisor')supervised.add(r.store_id);}if(rows.length<500)break;}}
 type Req={from_store_id:string;to_store_id:string};
 /** 目前使用者可否確認這筆調店：原店或新店任一位督導，或系統管理員代確認。 */
 const canConfirm=(r:Req)=>confirm&&(admin||supervised.has(r.from_store_id)||supervised.has(r.to_store_id));
 /** 確認時會記錄成哪一方：督導優先於管理員；管理員本人不是督導才算代確認。 */
 const sideOf=(r:Req):TransferConfirmSide|null=>{
  if(!canConfirm(r))return null;const f=supervised.has(r.from_store_id),t=supervised.has(r.to_store_id);
  return f&&t?'both':f?'from':t?'to':'admin';
 };
 return {ctx,admin,create,confirm,supervised,sideOf,canRead:(r:Req)=>admin||create||managed.has(r.from_store_id)||managed.has(r.to_store_id),canReject:(r:Req)=>confirm&&(admin||managed.has(r.from_store_id)||managed.has(r.to_store_id)),canConfirm};
}
