import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import { MAINTENANCE_PROGRESS_STAGE_OPTIONS } from '@/lib/maintenance/status';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canAccess = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.submit',
      'cross_dept.maintenance.view_all',
      'cross_dept.maintenance.update',
      'cross_dept.maintenance.category.edit',
    ]);
    if (!canAccess) {
      return NextResponse.json({ success: false, error: '沒有維修進度查看權限' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('maintenance_progress_stages')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('maintenance_progress_stages') || msg.includes('schema cache')) {
        return NextResponse.json({ success: true, data: MAINTENANCE_PROGRESS_STAGE_OPTIONS });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '維修進度查詢失敗' }, { status: 500 });
  }
}

async function requireStageEdit(userId: string) {
  const allowed = await hasAnyPermission(userId, ['cross_dept.maintenance.category.edit']);
  if (!allowed) throw new Error('沒有維修進度階段管理權限');
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    await requireStageEdit(user.id);
    const body = await request.json();
    const code = String(body?.code || '').trim().toUpperCase();
    const name = String(body?.name || '').trim();
    if (!/^[A-Z0-9_]+$/.test(code) || !name) {
      return NextResponse.json({ success: false, error: '請輸入有效代碼與名稱' }, { status: 400 });
    }

    const { data, error } = await adminClient
      .from('maintenance_progress_stages')
      .insert({
        code,
        name,
        sort_order: Number(body?.sort_order || 999),
        is_active: body?.is_active !== false,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '維修進度階段新增失敗' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    await requireStageEdit(user.id);
    const body = await request.json();
    const code = String(body?.code || '').trim().toUpperCase();
    if (!code) return NextResponse.json({ success: false, error: '缺少進度階段代碼' }, { status: 400 });

    const payload: Record<string, any> = { updated_by: user.id };
    if (typeof body.name === 'string') payload.name = body.name.trim();
    if (Number.isFinite(Number(body.sort_order))) payload.sort_order = Number(body.sort_order);
    if (typeof body.is_active === 'boolean') payload.is_active = body.is_active;

    const { data, error } = await adminClient
      .from('maintenance_progress_stages')
      .update(payload)
      .eq('code', code)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '維修進度階段更新失敗' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    await requireStageEdit(user.id);
    const code = new URL(request.url).searchParams.get('code');
    if (!code) return NextResponse.json({ success: false, error: '缺少進度階段代碼' }, { status: 400 });

    const { data, error } = await adminClient
      .from('maintenance_progress_stages')
      .update({ is_active: false, updated_by: user.id })
      .eq('code', code.trim().toUpperCase())
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '維修進度階段停用失敗' }, { status: 500 });
  }
}
