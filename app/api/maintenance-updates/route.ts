import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

const STORAGE_BUCKET = 'maintenance-photos';

function normalizeMaintenanceError(err: any) {
  const msg = String(err?.message || '');
  if (
    msg.includes("Could not find the table 'public.maintenance_") ||
    msg.includes('schema cache')
  ) {
    return '維修模組資料表尚未建置到目前環境，請先在該環境執行 migration_general_affairs_maintenance.sql';
  }
  return msg || '維修模組操作失敗';
}

// ──────────────────────────────────────────
// GET /api/maintenance-updates?request_id=xxx
//   取得維修進度更新紀錄
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('request_id');

    if (!requestId) {
      return NextResponse.json({ success: false, error: '缺少 request_id' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('maintenance_updates')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const updateIds = (data ?? []).map((u: any) => u.id);
    let photoMap = new Map<string, any[]>();

    if (updateIds.length > 0) {
      const { data: photoRows, error: photoErr } = await supabase
        .from('maintenance_update_photos')
        .select('*')
        .in('update_id', updateIds)
        .order('created_at', { ascending: false });
      if (photoErr) throw photoErr;

      const paths = (photoRows ?? []).map((p: any) => p.storage_path).filter(Boolean);
      let signedMap = new Map<string, string>();
      if (paths.length > 0) {
        const { data: signedData, error: signedErr } = await adminClient.storage
          .from(STORAGE_BUCKET)
          .createSignedUrls(paths, 60 * 60 * 24 * 7);
        if (signedErr) throw signedErr;

        (signedData ?? []).forEach((item, idx) => {
          const p = paths[idx];
          if (p && item?.signedUrl) signedMap.set(p, item.signedUrl);
        });
      }

      for (const row of (photoRows ?? [])) {
        const next = photoMap.get(row.update_id) ?? [];
        next.push({ ...row, signed_url: signedMap.get(row.storage_path) ?? null });
        photoMap.set(row.update_id, next);
      }
    }

    const withPhotos = (data ?? []).map((u: any) => ({
      ...u,
      photos: photoMap.get(u.id) ?? [],
    }));

    return NextResponse.json({ success: true, data: withPhotos });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// POST /api/maintenance-updates
//   新增維修進度更新（總務組操作）
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canUpdate = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.update',
      'cross_dept.maintenance.view_all',
    ]);
    if (!canUpdate) {
      return NextResponse.json({ success: false, error: '沒有更新進度的權限' }, { status: 403 });
    }

    const body = await request.json();
    const { request_id, status, notes } = body;

    if (!request_id || !status || !notes) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    // 驗證 status 有效
    const validStatuses = ['pending', 'in_progress', 'completed', 'closed'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ success: false, error: '無效的狀態' }, { status: 400 });
    }

    // 取得更新者姓名
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const updaterName = profile?.full_name || user.email || 'Unknown';

    // 新增更新紀錄
    const { data: updateRecord, error: dbError } = await supabase
      .from('maintenance_updates')
      .insert({
        request_id,
        status,
        notes,
        updated_by: user.id,
        updated_by_name: updaterName,
      })
      .select()
      .single();

    if (dbError) throw dbError;

    // 同時更新 maintenance_requests 的 status
    const { error: updateError } = await supabase
      .from('maintenance_requests')
      .update({ status })
      .eq('id', request_id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, data: updateRecord }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}
