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

    if (!storeId) {
      // 需要 view_all 權限
      const canViewAll = await hasAnyPermission(user.id, [
        'cross_dept.stockout.view_all',
        'cross_dept.stockout.respond',
      ]);
      if (!canViewAll) {
        return NextResponse.json({ success: false, error: '沒有查看所有門市回報的權限' }, { status: 403 });
      }

      const { data, error } = await supabase
        .from('stockout_reports')
        .select(`
          *,
          store:stores(id, store_code, store_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return NextResponse.json({ success: true, data: data ?? [] });
    }

    // 取特定門市的回報（需 submit 或 view_all 其一）
    const canAccess = await hasAnyPermission(user.id, [
      'cross_dept.stockout.submit',
      'cross_dept.stockout.view_all',
      'cross_dept.stockout.respond',
    ]);
    if (!canAccess) {
      return NextResponse.json({ success: false, error: '沒有權限' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('stockout_reports')
      .select(`
        *,
        store:stores(id, store_code, store_name)
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: data ?? [] });
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

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const hasActiveResponse = !!existingResp && (!existingResp.eta_date || existingResp.eta_date >= today);
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

    let query = supabase.from('stockout_reports').delete().eq('id', id);
    if (!canManage) {
      // 一般提交者只能刪自己的
      query = query.eq('reported_by', user.id);
    }

    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
