import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/monthly-staff-by-store/search
 * 在所有 monthly_staff_status 中搜尋員工（用於支援人員指派的下拉搜尋）
 * Query params:
 *   q (required, 員編或姓名關鍵字，至少1字)
 *   year_month (optional, YYYY-MM)
 *   store_id (optional, 限定門市)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const q = searchParams.get('q') || '';
    const yearMonth = searchParams.get('year_month');
    const storeId = searchParams.get('store_id');

    if (!q || q.length < 1) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 先查 store_employees（最準確的員編對應）
    let empQuery = supabase
      .from('store_employees')
      .select('employee_code, employee_name:employee_code, position, store_id')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .limit(20);

    // store_employees 中沒有 employee_name 設計，改用 monthly_staff_status 搜尋
    let query = supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position, store_id, year_month')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .not('status', 'eq', 'resigned')
      .order('year_month', { ascending: false });

    if (yearMonth) {
      query = query.eq('year_month', yearMonth);
    }
    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    query = query.limit(50);

    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ success: true, data: [] });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // 依員編去重，取最新一筆
    const seen = new Map<string, any>();
    for (const row of (data || [])) {
      if (!row.employee_code) continue;
      const code = row.employee_code.toUpperCase();
      if (!seen.has(code)) {
        seen.set(code, row);
      }
    }

    const result = Array.from(seen.values()).slice(0, 20);

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
