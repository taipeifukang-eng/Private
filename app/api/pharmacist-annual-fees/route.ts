import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const TAIWAN_CITIES = [
  '台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣',
  '苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣',
  '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣',
] as const;

function mapDbError(error: unknown): string {
  const err = error as { code?: string; message?: string };
  if (err.code === 'PGRST205' || err.code === '42P01') {
    return 'pharmacist_annual_fees 資料表不存在，請先執行 supabase/migration_pharmacist_annual_fees.sql';
  }
  if (err.code === '42703') {
    return 'pharmacist_annual_fees 欄位不完整，請重新執行 migration';
  }
  return err.message || '資料庫錯誤';
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// GET /api/pharmacist-annual-fees?employee_code=FK0001
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canView = await hasPermission(user.id, 'pharmacist.management.view');
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const employeeCode = req.nextUrl.searchParams.get('employee_code');
  if (!employeeCode) return NextResponse.json({ data: [] });

  const code = employeeCode.trim().toUpperCase();

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('pharmacist_annual_fees')
    .select('*')
    .eq('employee_code', code)
    .order('fee_year', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: mapDbError(error) }, { status: 500 });

  const rows = data || [];
  const creatorValues = Array.from(new Set(rows.map((r) => String(r.created_by || '').trim()).filter(Boolean)));
  const creatorIds = creatorValues.filter((v) => isUuidLike(v));
  const creatorEmails = creatorValues.filter((v) => v.includes('@')).map((v) => v.toLowerCase());

  const creatorNameById = new Map<string, string>();
  const creatorNameByEmail = new Map<string, string>();

  if (creatorIds.length > 0) {
    const { data: idProfiles } = await adminSupabase
      .from('profiles')
      .select('id, full_name')
      .in('id', creatorIds);

    (idProfiles || []).forEach((p: { id: string; full_name: string | null }) => {
      if (p.id && p.full_name) creatorNameById.set(p.id, p.full_name);
    });
  }

  if (creatorEmails.length > 0) {
    const { data: emailProfiles } = await adminSupabase
      .from('profiles')
      .select('email, full_name')
      .in('email', creatorEmails);

    (emailProfiles || []).forEach((p: { email: string | null; full_name: string | null }) => {
      if (p.email && p.full_name) creatorNameByEmail.set(p.email.toLowerCase(), p.full_name);
    });
  }

  const dataWithCreatorName = rows.map((r) => {
    const rawCreator = String(r.created_by || '').trim();
    const creatorName = isUuidLike(rawCreator)
      ? creatorNameById.get(rawCreator) || null
      : creatorNameByEmail.get(rawCreator.toLowerCase()) || null;

    return {
      ...r,
      created_by_name: creatorName,
    };
  });

  return NextResponse.json({ data: dataWithCreatorName });
}

// POST /api/pharmacist-annual-fees
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '無效的 JSON' }, { status: 400 });
  }

  const { employee_code, association_city, fee_year, fee_period_start, fee_period_end, payment_proof_path, notes } = body;

  if (!employee_code || typeof employee_code !== 'string') {
    return NextResponse.json({ error: 'employee_code 為必填' }, { status: 400 });
  }
  if (!association_city || typeof association_city !== 'string' || !association_city.trim()) {
    return NextResponse.json({ error: '縣市公會為必填' }, { status: 400 });
  }
  if (!TAIWAN_CITIES.includes(association_city.trim() as typeof TAIWAN_CITIES[number])) {
    return NextResponse.json({ error: '縣市公會不在允許清單內' }, { status: 400 });
  }
  if (!fee_year || typeof fee_year !== 'number' || fee_year < 2000 || fee_year > 2100) {
    return NextResponse.json({ error: '申請年度不正確（需為西元年）' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('pharmacist_annual_fees')
    .insert({
      employee_code: employee_code.trim().toUpperCase(),
      association_city: association_city.trim(),
      fee_year,
      fee_period_start: fee_period_start || null,
      fee_period_end: fee_period_end || null,
      payment_proof_path: payment_proof_path || null,
      notes: notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: mapDbError(error) }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/pharmacist-annual-fees  Body: { id, notes?, payment_proof_path? }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '無效的 JSON' }, { status: 400 });
  }

  const { id, notes, payment_proof_path } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id 為必填' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (notes !== undefined) updates.notes = notes || null;
  if (payment_proof_path !== undefined) updates.payment_proof_path = payment_proof_path || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '無可更新欄位' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { error } = await adminSupabase
    .from('pharmacist_annual_fees')
    .update(updates)
    .eq('id', id);

  if (error) return NextResponse.json({ error: mapDbError(error) }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/pharmacist-annual-fees?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 為必填' }, { status: 400 });

  const adminSupabase = createAdminClient();

  // 先取得記錄以便刪除 storage 檔案
  const { data: record } = await adminSupabase
    .from('pharmacist_annual_fees')
    .select('payment_proof_path')
    .eq('id', id)
    .single();

  // 刪除資料庫記錄
  const { error } = await adminSupabase
    .from('pharmacist_annual_fees')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: mapDbError(error) }, { status: 500 });

  // 若有對應的 storage 檔案，一併刪除
  if (record?.payment_proof_path) {
    await adminSupabase.storage
      .from('pharmacist-fee-proofs')
      .remove([record.payment_proof_path]);
  }

  return NextResponse.json({ success: true });
}
