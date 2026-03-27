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
    const codesParam = searchParams.get('product_codes');

    let query = supabase
      .from('stockout_product_responses')
      .select(`
        *,
        responder:profiles!stockout_product_responses_responded_by_fkey(full_name)
      `)
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
    const { product_code, product_name, response_content } = body;
    if (!product_code || !product_name || !response_content?.trim()) {
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
          responded_by: user.id,
          responded_at: new Date().toISOString(),
        },
        { onConflict: 'product_code' }
      )
      .select()
      .single();

    if (error) throw error;
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
