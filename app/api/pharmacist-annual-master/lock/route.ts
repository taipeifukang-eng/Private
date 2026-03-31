import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

/**
 * GET /api/pharmacist-annual-master/lock
 * 查詢所有已關帳的年度
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canView = await hasPermission(user.id, 'pharmacist.management.view');
  if (!canView) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('pharmacist_annual_master_locks')
    .select('year, locked_at, locked_by')
    .order('year', { ascending: false });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST204') {
      return NextResponse.json({ data: [], missing_table: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

/**
 * POST /api/pharmacist-annual-master/lock
 * 關帳指定年度
 * body: { year: 2026 }
 */
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

  const body = await req.json().catch(() => ({}));
  const year = typeof body?.year === 'number' ? body.year : parseInt(body?.year, 10);

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: '無效的年度' }, { status: 400 });
  }

  // 不允許關帳當前年度（需等年度結束）
  const currentYear = new Date().getFullYear();
  if (year > currentYear) {
    return NextResponse.json({ error: '不能關帳未來的年度' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // 取得操作者名稱
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();
  const lockedBy = profile?.full_name || user.email || user.id;

  // 檢查是否有該年度的主檔資料
  const { count } = await adminSupabase
    .from('pharmacist_annual_master')
    .select('id', { count: 'exact', head: true })
    .eq('year', year);

  if (!count || count === 0) {
    return NextResponse.json({ 
      error: `${year} 年度尚無藥師主檔資料，請先初始化` 
    }, { status: 400 });
  }

  // 執行關帳
  const { error } = await adminSupabase
    .from('pharmacist_annual_master_locks')
    .upsert({ year, locked_by: lockedBy }, { onConflict: 'year' });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST204') {
      return NextResponse.json({ 
        error: '請先執行 migration_pharmacist_annual_master.sql' 
      }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ 
    ok: true, 
    message: `${year} 年度藥師主檔已關帳`,
    year,
    locked_by: lockedBy,
  });
}

/**
 * DELETE /api/pharmacist-annual-master/lock
 * 解除關帳指定年度
 * body: { year: 2026 }
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const year = typeof body?.year === 'number' ? body.year : parseInt(body?.year, 10);

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: '無效的年度' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // 檢查是否已關帳
  const { data: lockData } = await adminSupabase
    .from('pharmacist_annual_master_locks')
    .select('year')
    .eq('year', year)
    .single();

  if (!lockData) {
    return NextResponse.json({ error: `${year} 年度尚未關帳` }, { status: 400 });
  }

  // 解除關帳
  const { error } = await adminSupabase
    .from('pharmacist_annual_master_locks')
    .delete()
    .eq('year', year);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ 
    ok: true, 
    message: `${year} 年度藥師主檔已解除關帳`,
    year,
  });
}
