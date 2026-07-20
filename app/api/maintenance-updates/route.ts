import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import {
  inferMaintenanceActionFromPayload,
  transitionMaintenanceTicket,
} from '@/lib/maintenance/status-service';
import { normalizeProgressStage } from '@/lib/maintenance/status';

const STORAGE_BUCKET = 'maintenance-photos';

export const dynamic = 'force-dynamic';

function normalizeMaintenanceError(err: any) {
  const msg = String(err?.message || '');
  if (
    msg.includes('maintenance_categories') ||
    msg.includes('category_id')
  ) {
    return '維修分類欄位尚未建置到目前環境，請先執行 migration_add_maintenance_categories.sql';
  }
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

    const canManage = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.update',
      'cross_dept.maintenance.view_all',
    ]);

    let query = supabase
      .from('maintenance_updates')
      .select('*, category:maintenance_categories(id, name, sort_order, is_active)')
      .eq('request_id', requestId)
      .order('progress_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (!canManage) {
      query = query.eq('visibility', 'PUBLIC');
    }

    const { data, error } = await query;

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

    const body = await request.json();
    const { request_id, notes, progress_date, category_id } = body;

    if (!request_id || !notes || !progress_date) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    // 驗證 progress_date（YYYY-MM-DD）
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(progress_date))) {
      return NextResponse.json({ success: false, error: '紀錄日期格式錯誤' }, { status: 400 });
    }

    const hasCategoryPayload = Object.prototype.hasOwnProperty.call(body, 'category_id');
    let normalizedCategoryId =
      typeof category_id === 'string' && category_id.trim() ? category_id.trim() : null;

    if (normalizedCategoryId) {
      const { data: category, error: categoryError } = await supabase
        .from('maintenance_categories')
        .select('id')
        .eq('id', normalizedCategoryId)
        .eq('is_active', true)
        .single();

      if (categoryError || !category) {
        return NextResponse.json({ success: false, error: '維修分類不存在或已停用' }, { status: 400 });
      }
    }

    if (!hasCategoryPayload) {
      const { data: requestRow, error: requestError } = await supabase
        .from('maintenance_requests')
        .select('category_id')
        .eq('id', request_id)
        .single();

      if (requestError) throw requestError;
      normalizedCategoryId = requestRow?.category_id ?? null;
    }

    const progressStage = normalizeProgressStage(body?.progress_stage);
    const updateRecord = await transitionMaintenanceTicket(supabase, {
      requestId: request_id,
      userId: user.id,
      action: inferMaintenanceActionFromPayload(body),
      notes,
      progressDate: progress_date,
      progressStage,
      visibility: body?.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
      categoryId: hasCategoryPayload ? normalizedCategoryId : undefined,
      assigneeId: typeof body?.assignee_id === 'string' ? body.assignee_id : undefined,
      assigneeName: typeof body?.assignee_name === 'string' ? body.assignee_name : undefined,
      handlingMethod: typeof body?.handling_method === 'string' ? body.handling_method : undefined,
      vendorId: typeof body?.vendor_id === 'string' ? body.vendor_id : undefined,
      forceCloseReason: typeof body?.force_close_reason === 'string' ? body.force_close_reason : undefined,
    });

    return NextResponse.json({ success: true, data: updateRecord }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}
