import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/performance-data?year=2026&store_id=xxx
 * 查詢某年某門市的業績資料（12個月）
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const storeId = searchParams.get('store_id');
    // 若沒有傳 store_id，代表查詢有權限的所有門市
    const month = searchParams.get('month'); // optional

    let query = supabase
      .from('store_performance')
      .select(`
        id, store_id, year, month, business_days,
        monthly_gross_profit_target, monthly_revenue_target,
        monthly_customer_count_target, last_month_rx_target,
        monthly_gross_profit_actual, monthly_revenue_actual,
        monthly_customer_count_actual, last_month_rx_actual,
        stores!inner(store_code, store_name)
      `)
      .order('month', { ascending: true });

    if (year) query = query.eq('year', parseInt(year));
    if (storeId) query = query.eq('store_id', storeId);
    if (month) query = query.eq('month', parseInt(month));

    const { data, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, records: data || [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/performance-data
 * 新增或更新單筆業績資料 (upsert)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const body = await request.json();
    const {
      store_id, year, month, business_days,
      monthly_gross_profit_target, monthly_revenue_target,
      monthly_customer_count_target, last_month_rx_target,
      monthly_gross_profit_actual, monthly_revenue_actual,
      monthly_customer_count_actual, last_month_rx_actual,
    } = body;

    if (!store_id || !year || !month || !business_days) {
      return NextResponse.json({ success: false, error: '缺少必要欄位 (store_id, year, month, business_days)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('store_performance')
      .upsert({
        store_id, year, month, business_days,
        monthly_gross_profit_target,
        monthly_revenue_target,
        monthly_customer_count_target,
        last_month_rx_target,
        monthly_gross_profit_actual,
        monthly_revenue_actual,
        monthly_customer_count_actual,
        last_month_rx_actual,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id,year,month' })
      .select()
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, record: data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
