import { checked, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { canReadStorePersonnel } from '@/lib/workspace/store-personnel';
import { formatPromotionPosition, getMovementNotesForDisplay } from '@/lib/monthly-staff/promotion-level';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCapability(ctx, ['store.store.view', 'store.store.view_inactive', 'store.store.create', 'store.store.edit', 'store.store.clone', 'store.manage']);
    if (!await canReadStorePersonnel(ctx)) throw new WorkspaceError(403, '沒有門市員工歷程的查看權限');
    const query = new URL(request.url).searchParams, id = query.get('store'), employeeId = query.get('employee');
    if (!uuid(id) || (employeeId && !uuid(employeeId))) throw new WorkspaceError(400, '門市或員工 ID 不正確');
    const store = checked(await ctx.auth.from('stores').select('id,store_code,store_name,is_active').eq('id', id).maybeSingle());
    if (!store || (!store.is_active && !ctx.has('store.store.view_inactive', 'store.store.edit', 'store.store.clone', 'store.manage'))) throw new WorkspaceError(404, '找不到可查看的門市');
    if (employeeId) {
      const employee = checked(await ctx.auth.from('store_employees').select('id,employee_code,employee_name,position,current_position,start_date,last_promotion_date').eq('store_id', id).eq('id', employeeId).maybeSingle());
      if (!employee) throw new WorkspaceError(404, '找不到此門市的員工');
      const history: any[] = [];
      for (let from = 0; employee.employee_code; from += 500) {
        const rows = checked(await ctx.auth.from('employee_movement_history').select('id,movement_date,movement_type,old_value,new_value,notes').eq('store_id', id).eq('employee_code', employee.employee_code).order('movement_date', { ascending: false }).order('id').range(from, from + 499)) || [];
        history.push(...rows); if (rows.length < 500) break;
      }
      const status = (value: string) => ({active:'在職',resigned:'離職',leave_without_pay:'留職停薪'}[value] || value || '—');
      return respond({store,employee,history:history.map(row => ({...row,old_label:status(row.old_value),new_label:formatPromotionPosition(status(row.new_value),row.notes),display_notes:getMovementNotesForDisplay(row.notes)}))});
    }
    const employees: any[] = [];
    for (let from = 0;; from += 500) {
      const rows = checked(await ctx.auth.from('store_employees').select('id,employee_code,employee_name,position,current_position,start_date,last_promotion_date').eq('store_id', id).order('employee_code').order('id').range(from, from + 499)) || [];
      employees.push(...rows); if (rows.length < 500) break;
    }
    return respond({store,employees});
  } catch (error) { return failed(error); }
}
