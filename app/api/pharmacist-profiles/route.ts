import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

// GET /api/pharmacist-profiles?employee_codes=FK0001,FK0002,...
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canView = await hasPermission(user.id, 'pharmacist.management.view');
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const codesParam = req.nextUrl.searchParams.get('employee_codes');
  if (!codesParam) return NextResponse.json({ data: [] });

  const codes = codesParam.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return NextResponse.json({ data: [] });

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('pharmacist_profiles')
    .select('employee_code, school, is_responsible_pharmacist, license_renewal_date, notes, updated_at')
    .in('employee_code', codes);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

// PATCH /api/pharmacist-profiles  Body: { employee_code, school?, is_responsible_pharmacist?, license_renewal_date?, notes? }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { employee_code, school, is_responsible_pharmacist, license_renewal_date, notes } = body || {};
  if (!employee_code || typeof employee_code !== 'string') {
    return NextResponse.json({ error: 'employee_code is required' }, { status: 400 });
  }

  const code = employee_code.trim().toUpperCase();
  const updates: Record<string, unknown> = {};
  if (school !== undefined) updates.school = school;
  if (is_responsible_pharmacist !== undefined) updates.is_responsible_pharmacist = Boolean(is_responsible_pharmacist);
  if (license_renewal_date !== undefined) updates.license_renewal_date = license_renewal_date || null;
  if (notes !== undefined) updates.notes = notes;

  const adminSupabase = createAdminClient();
  const { error } = await adminSupabase
    .from('pharmacist_profiles')
    .upsert({ employee_code: code, ...updates }, { onConflict: 'employee_code' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
