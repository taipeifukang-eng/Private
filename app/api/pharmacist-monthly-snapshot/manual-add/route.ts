import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

function validYearMonth(v: string): boolean {
  return /^\d{4}-\d{2}$/.test(v);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [canEdit, canViewAll] = await Promise.all([
    hasPermission(user.id, 'pharmacist.management.edit'),
    hasPermission(user.id, 'monthly.status.view_all'),
  ]);

  if (!canEdit && !canViewAll) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '無效的 JSON' }, { status: 400 });
  }

  const yearMonth = String(body.year_month || '').trim();
  const storeId = String(body.store_id || '').trim();
  const employeeCode = String(body.employee_code || '').trim().toUpperCase();
  const employeeName = String(body.employee_name || '').trim();
  const position = String(body.position || '').trim() || '藥師';

  if (!validYearMonth(yearMonth)) {
    return NextResponse.json({ error: 'year_month 格式需為 YYYY-MM' }, { status: 400 });
  }
  if (!storeId) {
    return NextResponse.json({ error: 'store_id 為必填' }, { status: 400 });
  }
  if (!employeeCode) {
    return NextResponse.json({ error: 'employee_code 為必填' }, { status: 400 });
  }
  if (!employeeName) {
    return NextResponse.json({ error: 'employee_name 為必填' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('pharmacist_monthly_snapshot')
    .upsert({
      year_month: yearMonth,
      store_id: storeId,
      employee_code: employeeCode,
      employee_name: employeeName,
      position,
      is_active: true,
      source: 'manual',
      notes: `manual add by ${user.id}`,
    }, { onConflict: 'year_month,store_id,employee_code' })
    .select('id, year_month, store_id, employee_code, employee_name, position, source')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message || '新增失敗' }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
