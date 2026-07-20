import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

function normalizeMaintenanceError(err: any) {
  const msg = String(err?.message || '');
  if (
    msg.includes("Could not find the table 'public.maintenance_categories'") ||
    msg.includes("Could not find the 'category_id' column") ||
    msg.includes('schema cache')
  ) {
    return '維修分類資料表尚未建置到目前環境，請先執行 migration_add_maintenance_categories.sql';
  }
  return msg || '維修分類操作失敗';
}

async function requireMaintenanceAccess(userId: string) {
  return hasAnyPermission(userId, [
    'cross_dept.maintenance.submit',
    'cross_dept.maintenance.view_all',
    'cross_dept.maintenance.update',
    'cross_dept.maintenance.category.edit',
  ]);
}

async function requireCategoryEdit(userId: string) {
  return hasAnyPermission(userId, ['cross_dept.maintenance.category.edit']);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canAccess = await requireMaintenanceAccess(user.id);
    if (!canAccess) {
      return NextResponse.json({ success: false, error: '沒有維修分類查看權限' }, { status: 403 });
    }

    const canEdit = await requireCategoryEdit(user.id);
    const includeInactive = new URL(request.url).searchParams.get('include_inactive') === '1';

    let query = adminClient
      .from('maintenance_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!includeInactive || !canEdit) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canEdit = await requireCategoryEdit(user.id);
    if (!canEdit) {
      return NextResponse.json({ success: false, error: '沒有編輯維修分類的權限' }, { status: 403 });
    }

    const body = await request.json();
    const name = String(body?.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ success: false, error: '請輸入分類名稱' }, { status: 400 });
    }

    const { data: maxRow } = await adminClient
      .from('maintenance_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSortOrder = Number(maxRow?.sort_order ?? 0) + 10;

    const { data, error } = await adminClient
      .from('maintenance_categories')
      .insert({
        name,
        sort_order: nextSortOrder,
        is_active: true,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canEdit = await requireCategoryEdit(user.id);
    if (!canEdit) {
      return NextResponse.json({ success: false, error: '沒有編輯維修分類的權限' }, { status: 403 });
    }

    const body = await request.json();
    const id = String(body?.id ?? '').trim();
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少分類 id' }, { status: 400 });
    }

    const payload: Record<string, any> = { updated_by: user.id };
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ success: false, error: '請輸入分類名稱' }, { status: 400 });
      payload.name = name;
    }
    if (typeof body.is_active === 'boolean') payload.is_active = body.is_active;
    if (Number.isFinite(Number(body.sort_order))) payload.sort_order = Number(body.sort_order);

    const { data, error } = await adminClient
      .from('maintenance_categories')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canEdit = await requireCategoryEdit(user.id);
    if (!canEdit) {
      return NextResponse.json({ success: false, error: '沒有編輯維修分類的權限' }, { status: 403 });
    }

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: '缺少分類 id' }, { status: 400 });

    const { data, error } = await adminClient
      .from('maintenance_categories')
      .update({ is_active: false, updated_by: user.id })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}
