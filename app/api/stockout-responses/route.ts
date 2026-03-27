import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

// ──────────────────────────────────────────
// GET /api/stockout-responses
//   ?product_codes=A001,A002,...  → 批次查詢（任何有權限者）
//   （無參數）                    → 取全部（需 view_all 或 respond）
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canAccess = await hasAnyPermission(user.id, [
      'cross_dept.stockout.submit',
      'cross_dept.stockout.view_all',
      'cross_dept.stockout.respond',
    ]);
    if (!canAccess) return NextResponse.json({ success: false, error: '沒有權限' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const history = searchParams.get('history') === '1';
    const codesParam = searchParams.get('product_codes');

    if (history) {
      const productCode = searchParams.get('product_code')?.trim();
      if (!productCode) {
        return NextResponse.json({ success: false, error: '缺少 product_code' }, { status: 400 });
      }

      const page = Math.max(1, Number(searchParams.get('page') ?? 1));
      const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize') ?? 10)));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from('stockout_product_response_history')
        .select('id, product_code, product_name, response_content, responded_by, responded_at, eta_date', { count: 'exact' })
        .eq('product_code', productCode)
        .order('responded_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        data: data ?? [],
        pagination: {
          page,
          pageSize,
          total: count ?? 0,
          totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
        },
      });
    }

    let query = supabase
      .from('stockout_product_responses')
      .select('*')
      .order('responded_at', { ascending: false });

    if (codesParam) {
      const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean);
      query = query.in('product_code', codes);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// POST /api/stockout-responses  (新增 or 更新，以 product_code UPSERT)
// Body: { product_code, product_name, response_content }
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canRespond = await hasAnyPermission(user.id, [
      'cross_dept.stockout.respond',
      'cross_dept.stockout.view_all',
    ]);
    if (!canRespond) {
      return NextResponse.json({ success: false, error: '沒有回覆缺貨商品的權限' }, { status: 403 });
    }

    const body = await request.json();
    const { product_code, product_name, response_content, eta_date } = body;
    if (!product_code || !product_name || !response_content?.trim() || !eta_date) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    // UPSERT：以 product_code 為唯一鍵
    const { data, error } = await supabase
      .from('stockout_product_responses')
      .upsert(
        {
          product_code: product_code.trim(),
          product_name: product_name.trim(),
          response_content: response_content.trim(),
          eta_date,
          responded_by: user.id,
          responded_at: new Date().toISOString(),
        },
        { onConflict: 'product_code' }
      )
      .select()
      .single();

    if (error) throw error;

    const { error: historyError } = await supabase
      .from('stockout_product_response_history')
      .insert({
        response_id: data.id,
        product_code: data.product_code,
        product_name: data.product_name,
        response_content: data.response_content,
        eta_date: data.eta_date,
        responded_by: data.responded_by,
        responded_at: data.responded_at,
      });

    if (historyError) throw historyError;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// DELETE /api/stockout-responses?product_code=xxx
// ──────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canRespond = await hasAnyPermission(user.id, [
      'cross_dept.stockout.respond',
      'cross_dept.stockout.view_all',
    ]);
    if (!canRespond) return NextResponse.json({ success: false, error: '沒有刪除權限' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const productCode = searchParams.get('product_code');
    if (!productCode) return NextResponse.json({ success: false, error: '缺少 product_code' }, { status: 400 });

    const { error } = await supabase
      .from('stockout_product_responses')
      .delete()
      .eq('product_code', productCode);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
