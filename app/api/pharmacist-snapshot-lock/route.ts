import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

// GET /api/pharmacist-snapshot-lock?year_months=2026-01,2026-02,...
// 回傳哪些月份已關帳
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canView = await hasPermission(user.id, 'pharmacist.management.view');
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('pharmacist_snapshot_locks')
    .select('year_month, locked_at, locked_by')
    .order('year_month', { ascending: true });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return NextResponse.json({ data: [], missing_table: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

// POST /api/pharmacist-snapshot-lock  body: { year_month: '2026-02' }
// 關帳
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const yearMonth = String(body?.year_month || '');
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: '無效的月份格式' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // 取得 locked_by 名稱（用 profiles.full_name）
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();
  const lockedBy = profile?.full_name || user.email || user.id;

  const { error } = await adminSupabase
    .from('pharmacist_snapshot_locks')
    .upsert({ year_month: yearMonth, locked_by: lockedBy }, { onConflict: 'year_month' });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return NextResponse.json({ error: '請先執行 migration_add_pharmacist_snapshot_lock.sql' }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/pharmacist-snapshot-lock  body: { year_month: '2026-02' }
// 解除關帳（不允許中間月份解除）
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const yearMonth = String(body?.year_month || '');
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: '無效的月份格式' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // 檢查是否有比此月份更晚的已關帳月份
  const { data: laterLocks, error: checkError } = await adminSupabase
    .from('pharmacist_snapshot_locks')
    .select('year_month')
    .gt('year_month', yearMonth)
    .limit(1);

  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }

  if (laterLocks && laterLocks.length > 0) {
    const laterMonth = laterLocks[0].year_month;
    return NextResponse.json(
      { error: `無法解除 ${yearMonth} 關帳：${laterMonth} 已關帳，請先解除較晚月份的關帳` },
      { status: 409 }
    );
  }

  const { error } = await adminSupabase
    .from('pharmacist_snapshot_locks')
    .delete()
    .eq('year_month', yearMonth);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
