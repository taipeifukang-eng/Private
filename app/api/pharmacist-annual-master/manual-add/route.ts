import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

function isValidYear(value: number): boolean {
  return Number.isInteger(value) && value >= 2020 && value <= 2100;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildManualEmployeeCode(year: number): string {
  const timePart = Date.now().toString().slice(-8);
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `MANUAL${String(year).slice(-2)}${timePart}${randomPart}`.slice(0, 20);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '無效的 JSON' }, { status: 400 });
  }

  const year = typeof body.year === 'number' ? body.year : parseInt(String(body.year || ''), 10);
  const employeeCodeInput = String(body.employee_code || '').trim().toUpperCase();
  const employeeName = String(body.employee_name || '').trim();
  const joinDateRaw = String(body.join_date || '').trim();
  const currentPosition = String(body.current_position || '').trim() || '藥師';
  const notesRaw = String(body.notes || '').trim();
  const employeeCode = employeeCodeInput || buildManualEmployeeCode(year);

  if (!isValidYear(year)) {
    return NextResponse.json({ error: '無效的年度' }, { status: 400 });
  }
  if (!employeeName) {
    return NextResponse.json({ error: '姓名為必填' }, { status: 400 });
  }
  if (!joinDateRaw || !isValidDate(joinDateRaw)) {
    return NextResponse.json({ error: '到職日格式需為 YYYY-MM-DD' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data: lockData } = await adminSupabase
    .from('pharmacist_annual_master_locks')
    .select('year')
    .eq('year', year)
    .single();

  if (lockData) {
    return NextResponse.json({ error: `${year} 年度已關帳，無法手動新增` }, { status: 400 });
  }

  const { data: existingRow } = await adminSupabase
    .from('pharmacist_annual_master')
    .select('id')
    .eq('year', year)
    .eq('employee_code', employeeCode)
    .maybeSingle();

  if (existingRow) {
    return NextResponse.json({ error: `${employeeCode} 已存在於 ${year} 年度主檔` }, { status: 409 });
  }

  const createdNote = notesRaw || `手動新增於 ${new Date().toISOString().slice(0, 10)}${employeeCodeInput ? '' : '（員編自動產生）'}`;
  const { data, error } = await adminSupabase
    .from('pharmacist_annual_master')
    .insert({
      year,
      employee_code: employeeCode,
      employee_name: employeeName,
      status: 'active',
      status_date: joinDateRaw,
      join_date: joinDateRaw,
      current_position: currentPosition,
      source: 'manual',
      notes: createdNote,
    })
    .select(`
      id,
      year,
      employee_code,
      employee_name,
      status,
      status_date,
      join_date,
      resignation_date,
      current_position,
      source,
      notes
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message || '新增失敗' }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}