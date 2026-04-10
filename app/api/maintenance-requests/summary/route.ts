import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

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
export async function GET(_request: NextRequest) {
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

    const { data, error } = await supabase
      .from('maintenance_requests')
      .select('store_id, status, store:stores(id, store_code, store_name)');

    if (error) throw error;

    const map = new Map<string, {
      store_id: string;
      store_code: string;
      store_name: string;
      pending: number;
      in_progress: number;
      completed: number;
      closed: number;
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
          pending: 0,
          in_progress: 0,
          completed: 0,
          closed: 0,
          total: 0,
        });
      }

      const bucket = map.get(key)!;
      bucket.total += 1;
      if (row.status === 'pending') bucket.pending += 1;
      else if (row.status === 'in_progress') bucket.in_progress += 1;
      else if (row.status === 'completed') bucket.completed += 1;
      else if (row.status === 'closed') bucket.closed += 1;
    }

    const summary = Array.from(map.values())
      .sort((a, b) => (b.pending - a.pending) || (b.in_progress - a.in_progress) || a.store_code.localeCompare(b.store_code));

    return NextResponse.json({ success: true, data: summary });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}
