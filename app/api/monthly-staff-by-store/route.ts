import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/monthly-staff-by-store
 * 依門市取得每月人員狀態（由系統抓取最近一個月的人員資料，用於預填本店人員）
 * Query params:
 *   store_id (required)
 *   year_month (optional, YYYY-MM, 預設為最近一個月)
 *   search (optional, 員編或姓名搜尋)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const storeId = searchParams.get('store_id');
    const yearMonth = searchParams.get('year_month');
    const search = searchParams.get('search') || '';

    if (!storeId) {
      return NextResponse.json({ success: false, error: '缺少 store_id' }, { status: 400 });
    }

    // 若有指定年月，直接查該月
    if (yearMonth) {
      const { data, error } = await supabase
        .from('monthly_staff_status')
        .select('id, employee_code, employee_name, position, year_month, status')
        .eq('store_id', storeId)
        .eq('year_month', yearMonth)
        .not('status', 'eq', 'resigned')
        .order('position')
        .order('employee_code');

      if (error) {
        if (error.code === '42P01') return NextResponse.json({ success: true, data: [], year_month: yearMonth });
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      let result = data || [];
      if (search) {
        const s = search.toLowerCase();
        result = result.filter(e =>
          (e.employee_code || '').toLowerCase().includes(s) ||
          (e.employee_name || '').toLowerCase().includes(s)
        );
      }

      return NextResponse.json({ success: true, data: result, year_month: yearMonth });
    }

    // 否則找最近有紀錄的月份
    const { data: latestRecord, error: latestError } = await supabase
      .from('monthly_staff_status')
      .select('year_month')
      .eq('store_id', storeId)
      .order('year_month', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      if (latestError.code === '42P01') return NextResponse.json({ success: true, data: [], year_month: null });
      return NextResponse.json({ success: false, error: latestError.message }, { status: 500 });
    }

    if (!latestRecord) {
      return NextResponse.json({ success: true, data: [], year_month: null });
    }

    const latestYearMonth = latestRecord.year_month;

    const { data, error } = await supabase
      .from('monthly_staff_status')
      .select('id, employee_code, employee_name, position, year_month, status')
      .eq('store_id', storeId)
      .eq('year_month', latestYearMonth)
      .not('status', 'eq', 'resigned')
      .order('position')
      .order('employee_code');

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    let result = data || [];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(e =>
        (e.employee_code || '').toLowerCase().includes(s) ||
        (e.employee_name || '').toLowerCase().includes(s)
      );
    }

    return NextResponse.json({ success: true, data: result, year_month: latestYearMonth });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
