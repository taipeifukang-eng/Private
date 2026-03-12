import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const admin = createAdminClient();
    const { searchParams } = request.nextUrl;
    const q = (searchParams.get('q') || '').trim();

    if (!q) return NextResponse.json({ success: true, data: [], not_found: false });

    // ── 來源 1：monthly_staff_status ──
    const { data: monthlyData } = await admin
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position, store_id, year_month')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .not('status', 'eq', 'resigned')
      .order('year_month', { ascending: false })
      .limit(50);

    const seen = new Map<string, any>();
    for (const row of (monthlyData || [])) {
      if (!row.employee_code) continue;
      const key = row.employee_code.toUpperCase();
      if (!seen.has(key)) seen.set(key, row);
    }

    if (seen.size > 0) {
      const results = Array.from(seen.values());
      const sids = Array.from(new Set(results.map((r) => r.store_id).filter(Boolean))) as string[];
      let storeNames: Record<string, string> = {};
      if (sids.length > 0) {
        const { data: storesData } = await admin.from('stores').select('id, store_name').in('id', sids);
        for (const s of storesData || []) storeNames[s.id] = s.store_name;
      }
      return NextResponse.json({
        success: true, not_found: false,
        data: results.map((r) => ({
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          position: r.position || '',
          store_id: r.store_id,
          from_store_name: storeNames[r.store_id] || '',
          source: 'monthly_status',
        })),
      });
    }

    // ── 來源 2：employee_movement_history（人員異動紀錄）──
    const { data: movData } = await admin
      .from('employee_movement_history')
      .select('employee_code, employee_name, position, movement_date, to_store_id, store_id')
      .or(`employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .order('movement_date', { ascending: false })
      .limit(50);

    const movSeen = new Map<string, any>();
    for (const row of (movData || [])) {
      if (!row.employee_code) continue;
      const key = row.employee_code.toUpperCase();
      if (!movSeen.has(key)) movSeen.set(key, row);
    }

    if (movSeen.size === 0) {
      return NextResponse.json({ success: true, data: [], not_found: true });
    }

    // 補齊門市名稱
    const movResults = Array.from(movSeen.values());
    const movSids = Array.from(new Set(movResults.map((r) => r.to_store_id || r.store_id).filter(Boolean))) as string[];
    let movStoreNames: Record<string, string> = {};
    if (movSids.length > 0) {
      const { data: storesData } = await admin.from('stores').select('id, store_name').in('id', movSids);
      for (const s of storesData || []) movStoreNames[s.id] = s.store_name;
    }

    return NextResponse.json({
      success: true, not_found: false,
      data: movResults.map((r) => {
        const sid = r.to_store_id || r.store_id || '';
        return {
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          position: r.position || '',
          store_id: sid,
          from_store_name: movStoreNames[sid] || '',
          source: 'movement_history',
        };
      }),
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
