import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

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

async function getManagedStoreIds(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('store_managers')
    .select('store_id')
    .eq('user_id', userId);

  if (error) throw error;
  return Array.from(new Set((data || []).map((row: any) => row.store_id).filter(Boolean)));
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
    const categoryId = searchParams.get('category_id');
    const q = searchParams.get('q')?.trim() ?? '';
    const yearMonth = searchParams.get('year_month'); // format: YYYY-MM

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

    // 指定店舖需要有 submit 或 view_all；submit 僅限自己管理的門市
    if (storeId && !canSubmit && !canViewAll) {
      return NextResponse.json({ success: false, error: '沒有權限' }, { status: 403 });
    }
    if (storeId && canSubmit && !canViewAll) {
      const managedStoreIds = await getManagedStoreIds(supabase, user.id);
      if (!managedStoreIds.includes(storeId)) {
        return NextResponse.json({ success: false, error: '沒有此門市維修回報查看權限' }, { status: 403 });
      }
    }

    let query = supabase
      .from('maintenance_requests')
      .select(`
        *,
        store:stores(id, store_code, store_name),
        category:maintenance_categories(id, name, sort_order, is_active)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (categoryId === '__none__') {
      query = query.is('category_id', null);
    } else if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (q) {
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    }

    if (yearMonth && /^\d{4}-\d{2}$/.test(yearMonth)) {
      const [yr, mo] = yearMonth.split('-').map(Number);
      const nextMo = mo === 12 ? 1 : mo + 1;
      const nextYr = mo === 12 ? yr + 1 : yr;
      const startStr = `${yearMonth}-01T00:00:00+08:00`;
      const endStr = `${String(nextYr).padStart(4, '0')}-${String(nextMo).padStart(2, '0')}-01T00:00:00+08:00`;
      query = query.gte('reported_at', startStr).lt('reported_at', endStr);
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

    const [canSubmit, canViewAll] = await Promise.all([
      hasAnyPermission(user.id, ['cross_dept.maintenance.submit']),
      hasAnyPermission(user.id, ['cross_dept.maintenance.view_all']),
    ]);
    if (!canSubmit && !canViewAll) {
      return NextResponse.json({ success: false, error: '沒有提交維修回報的權限' }, { status: 403 });
    }

    const body = await request.json();
    const { store_id, title, description } = body;
    const resourceType = String(body?.resource_type || '').trim() || null;
    const issueType = String(body?.issue_type || '').trim() || null;
    const contactName = String(body?.contact_name || '').trim() || null;
    const contactPhone = String(body?.contact_phone || '').trim() || null;

    if (!store_id || !title) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }
    if (!canViewAll) {
      const managedStoreIds = await getManagedStoreIds(supabase, user.id);
      if (!managedStoreIds.includes(store_id)) {
        return NextResponse.json({ success: false, error: '沒有此門市維修回報提交權限' }, { status: 403 });
      }
    }

    // 取得回報者姓名
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const reporterName = profile?.full_name || user.email || 'Unknown';

    const insertPayload: Record<string, any> = {
      store_id,
      title,
      description: description || null,
      reported_by: user.id,
      reporter_name: reporterName,
      priority: 'normal',
      status: 'pending',
      resource_type: resourceType,
      issue_type: issueType,
      contact_name: contactName,
      contact_phone: contactPhone,
    };

    const { data, error } = await supabase
      .from('maintenance_requests')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      const message = String(error.message || '');
      const missingNewColumns =
        message.includes('resource_type') ||
        message.includes('issue_type') ||
        message.includes('contact_name') ||
        message.includes('contact_phone') ||
        message.includes('schema cache');

      if (!missingNewColumns) throw error;

      const fallbackPayload = {
        store_id,
        title,
        description: description || null,
        reported_by: user.id,
        reporter_name: reporterName,
        priority: 'normal',
        status: 'pending',
      };
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('maintenance_requests')
        .insert(fallbackPayload)
        .select()
        .single();
      if (fallbackError) throw fallbackError;

      return NextResponse.json({ success: true, data: fallbackData, warning: 'maintenance_requests 新欄位尚未套用 migration，已用舊格式建立回報' }, { status: 201 });
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// PATCH /api/maintenance-requests
//   更新維修回報欄位（目前用於總務直接調整分類）
// ──────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canManage = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.update',
      'cross_dept.maintenance.view_all',
    ]);
    if (!canManage) {
      return NextResponse.json({ success: false, error: '沒有更新維修回報的權限' }, { status: 403 });
    }

    const body = await request.json();
    const id = String(body?.id ?? '').trim();
    const normalizedCategoryId =
      typeof body?.category_id === 'string' && body.category_id.trim()
        ? body.category_id.trim()
        : null;

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    }

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

    const { data, error } = await supabase
      .from('maintenance_requests')
      .update({ category_id: normalizedCategoryId })
      .eq('id', id)
      .select(`
        *,
        store:stores(id, store_code, store_name),
        category:maintenance_categories(id, name, sort_order, is_active)
      `)
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
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
