import {checked,type Context} from './server';
export {movementTypes} from './movement-fields';
// C.2（M2 規格）：批次升遷權限者可看歷史頁；舊版管理員仍可查看。
export async function canReadMovementHistory(ctx:Context) {
 const profile=checked(await ctx.auth.from('profiles').select('role').eq('id',ctx.user.id).maybeSingle());
 return profile?.role==='admin'||canEditMovement(ctx)||ctx.has('employee.promotion.batch');
}
// 修改：異動管理、員工管理、批次升遷任一；刪除：刪除異動權限（與舊版 /api/employee-movements/[id] 相同）。
export const MOVEMENT_EDIT_CODES=['employee.movement.manage','employee.manage','employee.promotion.batch'] as const;
export const MOVEMENT_DELETE_CODES=['employee.promotion.delete'] as const;
export function canEditMovement(ctx:Pick<Context,'has'>){return ctx.has(...MOVEMENT_EDIT_CODES);}
export function canDeleteMovement(ctx:Pick<Context,'has'>){return ctx.has(...MOVEMENT_DELETE_CODES);}
