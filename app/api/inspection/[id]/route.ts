import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/check';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查使用者是否有刪除巡店記錄的權限
    const permission = await requirePermission(user.id, 'inspection.delete');
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.message || '權限不足' }, { status: 403 });
    }

    // 使用 Admin Client 執行刪除（繞過 RLS）
    const adminClient = createAdminClient();

    // 先刪除關聯的 inspection_results
    const { error: resultsDeleteError } = await adminClient
      .from('inspection_results')
      .delete()
      .eq('inspection_id', params.id);

    if (resultsDeleteError) {
      console.error('刪除 inspection_results 失敗:', resultsDeleteError);
      return NextResponse.json(
        { error: `刪除檢查明細失敗: ${resultsDeleteError.message}` },
        { status: 500 }
      );
    }

    // 再刪除 inspection_masters
    const { error: masterDeleteError } = await adminClient
      .from('inspection_masters')
      .delete()
      .eq('id', params.id);

    if (masterDeleteError) {
      console.error('刪除 inspection_masters 失敗:', masterDeleteError);
      return NextResponse.json(
        { error: `刪除巡店記錄失敗: ${masterDeleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: '巡店記錄已刪除' });
  } catch (error: any) {
    console.error('刪除巡店記錄時發生錯誤:', error);
    return NextResponse.json(
      { error: error.message || '刪除失敗' },
      { status: 500 }
    );
  }
}
