import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const permission = await requirePermission(user.id, 'employee.employee.edit');
    if (!permission.allowed) {
      return NextResponse.json({ success: false, error: permission.message }, { status: 403 });
    }

    const body = await request.json();
    const { updates } = body as { updates: { employee_code: string; birthday: string }[] };

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ success: false, error: '沒有資料可更新' }, { status: 400 });
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const item of updates) {
      if (!item.employee_code || !item.birthday) continue;

      // 驗證日期格式 YYYY-MM-DD
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(item.birthday)) {
        errors.push(`${item.employee_code}: 日期格式錯誤 (${item.birthday})`);
        errorCount++;
        continue;
      }

      const { error } = await supabase
        .from('store_employees')
        .update({ birthday: item.birthday })
        .eq('employee_code', item.employee_code.toUpperCase());

      if (error) {
        errors.push(`${item.employee_code}: ${error.message}`);
        errorCount++;
      } else {
        successCount++;
      }
    }

    return NextResponse.json({
      success: true,
      successCount,
      errorCount,
      errors
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
