import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

function normalizeMaintenanceError(err: any) {
  const msg = String(err?.message || '');
  if (
    msg.includes("Could not find the table 'public.maintenance_") ||
    msg.includes('schema cache')
  ) {
    return '維修模組資料表尚未建置到目前環境，請先在該環境執行相關 migration';
  }
  return msg || '維修模組操作失敗';
}

// GET /api/maintenance-requests/summary
// 回傳各門市在不同狀態的回報筆數，供總務快速掌握
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canViewAll = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.view_all',
      'cross_dept.maintenance.update',
    ]);

    if (!canViewAll) {
      return NextResponse.json({ success: false, error: '沒有查看總覽權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('year_month');

    let query = supabase
      .from('maintenance_requests')
      .select('store_id, status, store:stores(id, store_code, store_name)');

    if (yearMonth && /^\d{4}-\d{2}$/.test(yearMonth)) {
      const [yr, mo] = yearMonth.split('-').map(Number);
      const nextMo = mo === 12 ? 1 : mo + 1;
      const nextYr = mo === 12 ? yr + 1 : yr;
      const startStr = `${yearMonth}-01T00:00:00+08:00`;
      const endStr = `${String(nextYr).padStart(4, '0')}-${String(nextMo).padStart(2, '0')}-01T00:00:00+08:00`;
      query = query.gte('reported_at', startStr).lt('reported_at', endStr);
    }

    const { data, error } = await query;

    if (error) throw error;

    const map = new Map<string, {
      store_id: string;
      store_code: string;
      store_name: string;
      unaccepted: number;
      accepted: number;
      processing: number;
      completed: number;
      pending: number;
      in_progress: number;
      total: number;
    }>();

    for (const row of (data ?? []) as any[]) {
      const store = row.store || {};
      const key = String(row.store_id || 'unknown');
      if (!map.has(key)) {
        map.set(key, {
          store_id: key,
          store_code: String(store.store_code || '-'),
          store_name: String(store.store_name || '未知門市'),
          unaccepted: 0,
          accepted: 0,
          processing: 0,
          completed: 0,
          pending: 0,
          in_progress: 0,
          total: 0,
        });
      }

      const bucket = map.get(key)!;
      bucket.total += 1;
      const status = row.status === 'pending'
        ? 'UNACCEPTED'
        : row.status === 'in_progress'
          ? 'PROCESSING'
          : row.status === 'completed' || row.status === 'closed'
            ? 'COMPLETED'
            : row.status;
      if (status === 'UNACCEPTED') {
        bucket.unaccepted += 1;
        bucket.pending += 1;
      } else if (status === 'ACCEPTED') {
        bucket.accepted += 1;
      } else if (status === 'PROCESSING') {
        bucket.processing += 1;
        bucket.in_progress += 1;
      } else if (status === 'COMPLETED') {
        bucket.completed += 1;
      }
    }

    const summary = Array.from(map.values())
      .sort((a, b) => (b.unaccepted - a.unaccepted) || (b.processing - a.processing) || a.store_code.localeCompare(b.store_code));

    return NextResponse.json({ success: true, data: summary });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}
