import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

// ──────────────────────────────────────────
// GET /api/stockout-reports
//   ?store_id=xxx  → 只取該門市（店長自己）
//   （無 store_id） → 取全部（需 view_all 權限）
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('store_id');
    const storeIds = (searchParams.get('store_ids') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 30)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const q = searchParams.get('q')?.trim() ?? '';
    const status = searchParams.get('status');
    const month = searchParams.get('month'); // YYYY-MM
    const dateRange = searchParams.get('date_range'); // recent_30

    const canViewAll = await hasAnyPermission(user.id, [
      'cross_dept.stockout.view_all',
      'cross_dept.stockout.respond',
    ]);
    const canAccessStoreScope = await hasAnyPermission(user.id, [
      'cross_dept.stockout.submit',
      'cross_dept.stockout.view_all',
      'cross_dept.stockout.respond',
    ]);

    // 無門市條件等同查看全域，需要 view_all/respond
    if (!storeId && storeIds.length === 0 && !canViewAll) {
      return NextResponse.json({ success: false, error: '沒有查看所有門市回報的權限' }, { status: 403 });
    }

    // 指定門市或多門市則需要至少有 submit/view_all/respond
    if ((storeId || storeIds.length > 0) && !canAccessStoreScope) {
      return NextResponse.json({ success: false, error: '沒有權限' }, { status: 403 });
    }

    let query = supabase
      .from('stockout_reports')
      .select(`
        *,
        store:stores(id, store_code, store_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (storeId) {
      query = query.eq('store_id', storeId);
    } else if (storeIds.length > 0) {
      query = query.in('store_id', storeIds);
    }

    if (q) {
      query = query.or(`product_code.ilike.%${q}%,product_name.ilike.%${q}%`);
    }

    if (status === 'pending' || status === 'responded') {
      query = query.eq('status', status);
    }

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = `${month}-01`;
      const [y, m] = month.split('-').map(Number);
      const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      query = query.gte('created_at', `${start}T00:00:00+08:00`).lt('created_at', `${nextMonth}T00:00:00+08:00`);
    }

    if (dateRange === 'recent_30') {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      query = query.gte('created_at', since.toISOString());
    }

    const { data, error, count } = await query.range(from, to);

    if (error) throw error;

    // 月份彙總（供前端歷史月份折疊使用）
    let bucketQuery = supabase
      .from('stockout_reports')
      .select('created_at')
      .order('created_at', { ascending: false });

    if (storeId) {
      bucketQuery = bucketQuery.eq('store_id', storeId);
    } else if (storeIds.length > 0) {
      bucketQuery = bucketQuery.in('store_id', storeIds);
    }

    if (q) {
      bucketQuery = bucketQuery.or(`product_code.ilike.%${q}%,product_name.ilike.%${q}%`);
    }
    if (status === 'pending' || status === 'responded') {
      bucketQuery = bucketQuery.eq('status', status);
    }

    const { data: bucketRows, error: bucketErr } = await bucketQuery;
    if (bucketErr) throw bucketErr;

    const bucketMap = new Map<string, number>();
    for (const row of (bucketRows ?? [])) {
      const monthKey = String(row.created_at).slice(0, 7);
      bucketMap.set(monthKey, (bucketMap.get(monthKey) ?? 0) + 1);
    }
    const monthBuckets = Array.from(bucketMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([monthKey, c]) => ({ month: monthKey, count: c }));

    return NextResponse.json({
      success: true,
      data: data ?? [],
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
      monthBuckets,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// POST /api/stockout-reports
// Body: { store_id, product_code, product_name, required_qty }
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canSubmit = await hasAnyPermission(user.id, [
      'cross_dept.stockout.submit',
      'cross_dept.stockout.view_all',
      'cross_dept.stockout.respond',
    ]);
    if (!canSubmit) {
      return NextResponse.json({ success: false, error: '沒有提交缺貨回報的權限' }, { status: 403 });
    }

    const body = await request.json();
    const { store_id, product_code, product_name, required_qty } = body;
    if (!store_id || !product_code || !product_name || !required_qty) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    // 檢查此商品編號是否已有「仍有效」的商品部回覆
    const { data: existingResp } = await supabase
      .from('stockout_product_responses')
      .select('id, eta_date')
      .eq('product_code', product_code.trim())
      .maybeSingle();

    const graceStartDate = new Date();
    graceStartDate.setDate(graceStartDate.getDate() - 15);
    const responseGraceLowerBound = graceStartDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    // ETA 在回報日前15天內仍視為有效回覆，避免短時間內重複回覆同結論
    const hasActiveResponse = !!existingResp && (
      !existingResp.eta_date || existingResp.eta_date >= responseGraceLowerBound
    );
    const status = hasActiveResponse ? 'responded' : 'pending';

    const { data, error } = await supabase
      .from('stockout_reports')
      .insert({
        store_id,
        product_code: product_code.trim(),
        product_name: product_name.trim(),
        required_qty: Number(required_qty),
        reported_by: user.id,
        status,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// DELETE /api/stockout-reports?id=xxx
// ──────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });

    // 只有 view_all/respond 可刪除任意，submit 只能刪自己回報的
    const canManage = await hasAnyPermission(user.id, [
      'cross_dept.stockout.view_all',
      'cross_dept.stockout.respond',
    ]);

    // 先取出將刪除的紀錄，後續可判斷是否要同步清除商品部回覆
    let targetQuery = supabase
      .from('stockout_reports')
      .select('id, product_code')
      .eq('id', id)
      .limit(1);
    if (!canManage) {
      targetQuery = targetQuery.eq('reported_by', user.id);
    }

    const { data: targetRows, error: targetError } = await targetQuery;
    if (targetError) throw targetError;
    const target = (targetRows && targetRows[0]) || null;
    if (!target) {
      return NextResponse.json({ success: false, error: '找不到可刪除的缺貨回報' }, { status: 404 });
    }

    let query = supabase.from('stockout_reports').delete().eq('id', id);
    if (!canManage) {
      // 一般提交者只能刪自己的
      query = query.eq('reported_by', user.id);
    }

    const { error } = await query;
    if (error) throw error;

    // 若此商品已無任何缺貨回報，清除當前回覆快取，避免 UI 顯示殘留提醒
    const { count: remainingCount, error: countError } = await supabase
      .from('stockout_reports')
      .select('id', { count: 'exact', head: true })
      .eq('product_code', target.product_code);
    if (countError) throw countError;

    let clearedResponse = false;
    if ((remainingCount || 0) === 0) {
      const { error: clearError } = await supabase
        .from('stockout_product_responses')
        .delete()
        .eq('product_code', target.product_code);
      if (clearError) throw clearError;
      clearedResponse = true;
    }

    return NextResponse.json({ success: true, clearedResponse });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
