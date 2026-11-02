import {checked,type Context} from './server';
export {movementTypes} from './movement-fields';
export async function canReadMovementHistory(ctx:Context) {
 const profile=checked(await ctx.auth.from('profiles').select('role').eq('id',ctx.user.id).maybeSingle());
 // Legacy admin access; non-admins need batch + create. Confirm-only supervisors see transfers only.
 return profile?.role==='admin'||(ctx.has('employee.promotion.batch')&&ctx.has('employee.store_transfer.create'));
}
