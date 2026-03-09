import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/monthly-staff-by-store/search
 * 搜尋員工（用於本店人員手動新增的下拉搜尋）
 * 搜尋邏輯分兩個來源：
 *   1. monthly_staff_status（預設搜尋所有門市；傳 store_id 可限定門市）
 *   2. employee_movement_history（入職/調店異動），當 monthly_staff_status 無結果時作為 fallback
 * 若兩者都找不到則回傳 not_found: true，前端顯示「請洽營業部新增人員異動」
 *
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
      return NextResponse.json({ success: true, data: [], not_found: false });
    }

    // ── 來源 1：monthly_staff_status（所有門市，不強制過濾 store_id） ──
    let query = supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position, store_id, year_month')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .not('status', 'eq', 'resigned')
      .order('year_month', { ascending: false });

    if (yearMonth) query = query.eq('year_month', yearMonth);
    if (storeId)   query = query.eq('store_id', storeId);
    query = query.limit(80);

    const { data: monthlyData, error: monthlyError } = await query;
    if (monthlyError && monthlyError.code !== '42P01') {
      return NextResponse.json({ success: false, error: monthlyError.message }, { status: 500 });
    }

    // 依員編去重，取最新月份
    const seen = new Map<string, any>();
    for (const row of (monthlyData || [])) {
      if (!row.employee_code) continue;
      const code = row.employee_code.toUpperCase();
      if (!seen.has(code)) seen.set(code, { ...row, source: 'monthly_status' });
    }
    const monthlyResults = Array.from(seen.values()).slice(0, 20);

    if (monthlyResults.length > 0) {
      // 補齊門市名稱（用於顯示來源門市）
      const sids = Array.from(new Set(monthlyResults.map((r: any) => r.store_id).filter(Boolean))) as string[];
      let storeNames: Record<string, string> = {};
      if (sids.length > 0) {
        const { data: storesData } = await supabase
          .from('stores')
          .select('id, store_name')
          .in('id', sids);
        for (const s of storesData || []) storeNames[s.id] = s.store_name;
      }
      return NextResponse.json({
        success: true,
        not_found: false,
        data: monthlyResults.map((r: any) => ({
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          position: r.position || '',
          store_id: r.store_id,
          from_store_name: storeNames[r.store_id] || '',
          source: 'monthly_status',
        })),
      });
    }

    // ── 來源 2：employee_movement_history（入職/調店），作為 fallback ──
    const { data: movData, error: movError } = await supabase
      .from('employee_movement_history')
      .select('employee_code, employee_name, position, movement_type, movement_date, to_store_id, store_id')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .in('movement_type', ['onboarding', 'store_transfer', 'return_to_work'])
      .order('movement_date', { ascending: false })
      .limit(30);

    if (movError && movError.code !== '42P01') {
      return NextResponse.json({ success: true, data: [], not_found: true });
    }

    const movSeen = new Map<string, any>();
    for (const row of (movData || [])) {
      if (!row.employee_code) continue;
      const code = row.employee_code.toUpperCase();
      if (!movSeen.has(code)) movSeen.set(code, row);
    }

    if (movSeen.size === 0) {
      // 兩個來源都找不到 → not_found: true
      return NextResponse.json({ success: true, data: [], not_found: true });
    }

    return NextResponse.json({
      success: true,
      not_found: false,
      data: Array.from(movSeen.values()).slice(0, 20).map((r: any) => ({
        employee_code: r.employee_code,
        employee_name: r.employee_name,
        position: r.position || '',
        store_id: r.to_store_id || r.store_id || '',
        from_store_name: '',
        source: 'movement_history',
      })),
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
