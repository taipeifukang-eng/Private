import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
    if (!canEdit) {
      return NextResponse.json({ success: false, error: '權限不足，僅可檢視' }, { status: 403 });
    }

    const body = await request.json();
    const id = (body.id || '').toString();
    const yearMonth = (body.year_month || '').toString();
    const position = (body.position || '').toString().trim();

    if (!id || !yearMonth || !position) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    const { error } = await supabase
      .from('monthly_staff_status')
      .update({
        position,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('year_month', yearMonth)
      .eq('is_pharmacist', true);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '更新失敗' }, { status: 500 });
  }
}
