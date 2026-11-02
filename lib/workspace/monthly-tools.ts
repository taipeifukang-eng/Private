import { checked, type Context, WorkspaceError } from './server';

export const monthlyTools = {
  support: { table: 'support_staff_bonus', permission: 'monthly.allowance.edit_support_bonus', fields: ['bonus_amount'] },
  transport: { table: 'monthly_staff_status', permission: 'monthly.allowance.edit_support_bonus', fields: ['monthly_transport_expense', 'transport_expense_notes'] },
  talent: { table: 'talent_cultivation_bonus', permission: 'monthly.allowance.edit_support_bonus', fields: ['cultivation_bonus', 'cultivation_target'] },
  spring: { table: 'spring_festival_bonus', permission: 'monthly.allowance.edit_support_bonus', fields: ['attendance_date', 'category', 'bonus_amount'] },
  meal: { table: 'meal_allowance_records', permission: 'monthly.allowance.edit_support_bonus', fields: ['record_date', 'work_hours', 'meal_period', 'employee_type'] },
} as const;
export type MonthlyTool = keyof typeof monthlyTools;
export function toolFor(kind: string) {
  if (!Object.hasOwn(monthlyTools, kind)) throw new WorkspaceError(400, '不支援的獎金項目');
  return monthlyTools[kind as MonthlyTool];
}
export function permit(ctx: Context, code: string) {
  if (!ctx.has(code)) throw new WorkspaceError(403, '沒有此項操作權限');
}
export async function editableMonth(ctx: Context, store: string, month: string) {
  const summary = checked(await ctx.admin.from('monthly_store_summary').select('store_status').eq('store_id', store).eq('year_month', month).maybeSingle());
  const locked = checked(await ctx.admin.from('monthly_staff_status').select('id').eq('store_id', store).eq('year_month', month).in('status', ['submitted', 'confirmed']).limit(1));
  if (['submitted', 'confirmed'].includes(summary?.store_status || '') || locked?.length)
    throw new WorkspaceError(409, '此月份已送審或確認，請先退回草稿再修改');
}
export function validateAllowance(kind: string, rows: any[], month: string) {
  const tool = toolFor(kind);
  if (!Array.isArray(rows) || rows.length > 1500) throw new WorkspaceError(400, '資料筆數不正確');
  const keys = new Set<string>();
  return rows.map((r, i) => {
    const fail = (message: string): never => { throw new WorkspaceError(400, `第 ${i + 1} 列：${message}`); };
    if (!r || typeof r !== 'object') fail('資料格式不正確');
    const out: Record<string, any> = {};
    for (const key of ['employee_code', 'employee_name', ...tool.fields]) {
      const value = r[key];
      if (['bonus_amount', 'monthly_transport_expense', 'cultivation_bonus'].includes(key)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000) fail('金額須為 0 至 10,000,000');
        if (['talent', 'spring'].includes(kind) && !Number.isInteger(value)) fail('金額須為整數');
      } else if (typeof value !== 'string' || value.length > (key === 'employee_code' ? 50 : 2000) || (!value.trim() && key !== 'transport_expense_notes')) fail('請填完整員工及明細');
      out[key] = typeof value === 'string' ? value.trim() : value;
    }
    out.employee_code = out.employee_code.toUpperCase();
    if (kind === 'transport' && out.monthly_transport_expense > 0 && !out.transport_expense_notes) fail('交通費須填寫原因');
    if (kind === 'spring') {
      if (!['藥師', '主管', '專員'].includes(out.category)) fail('出勤分類不正確');
      const date = out.attendance_date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(month + '-') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) fail('日期須在目前月份');
    }
    if (kind === 'meal') {
      if (!['藥師', '非藥師'].includes(out.employee_type) || !['中餐', '晚餐', '晚晚餐'].includes(out.meal_period)) fail('誤餐時段或身分不正確');
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(out.work_hours)) fail('上班區間格式為 HH:MM-HH:MM');
      if (!/^\d{2}\/\d{2}$/.test(out.record_date)) fail('日期格式為 MM/DD');
      const date = month.slice(0,4) + '-' + out.record_date.replace('/', '-');
      if (!date.startsWith(month + '-') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) fail('誤餐日期須在目前月份');
    }
    const key = [out.employee_code, kind === 'spring' ? out.attendance_date : kind === 'meal' ? out.record_date + out.meal_period : ''].join(':');
    if (keys.has(key)) fail('員工或出勤項目重複');
    keys.add(key);
    return out;
  });
}
