import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

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
// GET /api/maintenance-requests
//   查詢維修回報
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 30)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const storeId = searchParams.get('store_id');
    const status = searchParams.get('status');
    const q = searchParams.get('q')?.trim() ?? '';

    const canViewAll = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.view_all',
    ]);
    const canSubmit = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.submit',
    ]);

    // 無店舖條件表示查看全域，需要 view_all
    if (!storeId && !canViewAll) {
      return NextResponse.json({ success: false, error: '沒有查看所有維修回報的權限' }, { status: 403 });
    }

    // 指定店舖需要有 submit 或 view_all
    if (storeId && !canSubmit && !canViewAll) {
      return NextResponse.json({ success: false, error: '沒有權限' }, { status: 403 });
    }

    let query = supabase
      .from('maintenance_requests')
      .select(`
        *,
        store:stores(id, store_code, store_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (q) {
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data ?? [],
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// POST /api/maintenance-requests
//   提交維修回報
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canSubmit = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.submit',
      'cross_dept.maintenance.view_all',
    ]);
    if (!canSubmit) {
      return NextResponse.json({ success: false, error: '沒有提交維修回報的權限' }, { status: 403 });
    }

    const body = await request.json();
    const { store_id, title, description, priority } = body;

    if (!store_id || !title) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    // 取得回報者姓名
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const reporterName = profile?.full_name || user.email || 'Unknown';

    const { data, error } = await supabase
      .from('maintenance_requests')
      .insert({
        store_id,
        title,
        description: description || null,
        reported_by: user.id,
        reporter_name: reporterName,
        priority: priority || 'normal',
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// DELETE /api/maintenance-requests?id=xxx
//   刪除維修回報（本人可刪自己的；總務可刪任意）
// ──────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });

    const { data: req, error: reqErr } = await supabase
      .from('maintenance_requests')
      .select('id, reported_by')
      .eq('id', id)
      .single();
    if (reqErr) throw reqErr;
    if (!req) return NextResponse.json({ success: false, error: '維修回報不存在' }, { status: 404 });

    const canManage = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.view_all',
      'cross_dept.maintenance.update',
    ]);
    const canDeleteOwn = req.reported_by === user.id;

    if (!canManage && !canDeleteOwn) {
      return NextResponse.json({ success: false, error: '沒有刪除權限' }, { status: 403 });
    }

    const { data: photoRows } = await supabase
      .from('maintenance_photos')
      .select('storage_path')
      .eq('request_id', id);

    const { error: delErr } = await supabase
      .from('maintenance_requests')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    const paths = (photoRows ?? []).map((p: any) => p.storage_path).filter(Boolean);
    if (paths.length > 0) {
      const { error: storageErr } = await adminClient.storage
        .from('maintenance-photos')
        .remove(paths);
      // 不中斷刪除流程，只記錄錯誤
      if (storageErr) {
        console.error('清理維修照片檔案失敗:', storageErr.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}
