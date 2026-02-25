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

    // 將各種日期格式統一轉為 YYYY-MM-DD
    const normalizeDate = (raw: string): string | null => {
      const s = raw.trim();
      // 已是 YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      // YYYY/M/D 或 YYYY/MM/DD（含斜線、月日不補零）
      const slashMatch = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (slashMatch) {
        const [, y, m, d] = slashMatch;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      // YYYY-M-D（橫線但不補零）
      const dashMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (dashMatch) {
        const [, y, m, d] = dashMatch;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      return null;
    };

    for (const item of updates) {
      if (!item.employee_code || !item.birthday) continue;

      const normalized = normalizeDate(item.birthday);
      if (!normalized) {
        errors.push(`${item.employee_code}: 日期格式無法辨識 (${item.birthday})，請使用 YYYY/M/D 或 YYYY-MM-DD`);
        errorCount++;
        continue;
      }

      const { error } = await supabase
        .from('store_employees')
        .update({ birthday: normalized })
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
