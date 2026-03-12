import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

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

    // 使用 admin client 繞過 RLS，確保能搜尋到所有員工
    const adminSupabase = createAdminClient();

    const { searchParams } = request.nextUrl;
    const q = searchParams.get('q') || '';
    const yearMonth = searchParams.get('year_month');
    const storeId = searchParams.get('store_id');

    if (!q || q.length < 1) {
      return NextResponse.json({ success: true, data: [], not_found: false });
    }

    // ── 來源 1：monthly_staff_status（所有門市，不強制過濾 store_id） ──
    let query = adminSupabase
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
        const { data: storesData } = await adminSupabase
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
    const { data: movData, error: movError } = await adminSupabase
      .from('employee_movement_history')
      .select('employee_code, employee_name, position, movement_type, movement_date, to_store_id, store_id')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
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
      // ── 來源 3：store_employees（最終 fallback，含所有在職/新進人員）──
      const { data: empData } = await adminSupabase
        .from('store_employees')
        .select('employee_code, employee_name, current_position, store_id')
        .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
        .limit(20);

      if (!empData || empData.length === 0) {
        return NextResponse.json({ success: true, data: [], not_found: true });
      }

      // 嘗試從 movement_history 找最新門市（不限 movement_type，只取最新一筆有 store_id 的）
      const empCodes = empData.map((e: any) => e.employee_code);
      const { data: latestMov } = await adminSupabase
        .from('employee_movement_history')
        .select('employee_code, store_id, to_store_id')
        .in('employee_code', empCodes)
        .not('store_id', 'is', null)
        .order('movement_date', { ascending: false })
        .limit(50);

      const latestStoreMap: Record<string, string> = {};
      for (const row of (latestMov || [])) {
        const code = (row.employee_code || '').toUpperCase();
        if (!latestStoreMap[code]) latestStoreMap[code] = row.to_store_id || row.store_id || '';
      }

      return NextResponse.json({
        success: true,
        not_found: false,
        data: empData.map((e: any) => ({
          employee_code: e.employee_code,
          employee_name: e.employee_name,
          position: e.current_position || '',
          store_id: latestStoreMap[e.employee_code?.toUpperCase()] || e.store_id || '',
          from_store_name: '',
          source: 'movement_history',
        })),
      });
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
