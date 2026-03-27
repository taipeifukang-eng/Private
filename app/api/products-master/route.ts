import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

// GET /api/products-master?q=搜尋關鍵字  （前10筆）
// GET /api/products-master?all=1          （全部，管理用）
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() ?? '';
    const all = searchParams.get('all') === '1';

    // 無關鍵字：直接回傳全部（管理頁用）
    if (!q && all) {
      const { data, error } = await supabase
        .from('products_master')
        .select('product_code, product_name, unit')
        .eq('is_active', true)
        .order('product_code');
      if (error) throw error;
      return NextResponse.json({ success: true, data: data ?? [] });
    }

    if (!q) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 搜尋：1) 編號開頭符合  2) 編號/名稱包含  — 分兩批查詢後合併，開頭符合優先
    const [prefixRes, containsRes] = await Promise.all([
      supabase
        .from('products_master')
        .select('product_code, product_name, unit')
        .eq('is_active', true)
        .ilike('product_code', `${q}%`)
        .order('product_code')
        .limit(20),
      supabase
        .from('products_master')
        .select('product_code, product_name, unit')
        .eq('is_active', true)
        .or(`product_code.ilike.%${q}%,product_name.ilike.%${q}%`)
        .order('product_code')
        .limit(20),
    ]);

    if (prefixRes.error) throw prefixRes.error;
    if (containsRes.error) throw containsRes.error;

    // 合併：開頭符合優先，去重，最多 20 筆
    const seen = new Set<string>();
    const merged: typeof prefixRes.data = [];
    for (const row of [...(prefixRes.data ?? []), ...(containsRes.data ?? [])]) {
      if (!seen.has(row.product_code)) {
        seen.add(row.product_code);
        merged.push(row);
        if (!all && merged.length >= 20) break;
      }
    }

    return NextResponse.json({ success: true, data: merged });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/products-master  （multipart/form-data, file=xlsx）
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    // 權限檢查
    const { data: permRow } = await supabase.rpc('check_user_permission', {
      p_user_id: user.id,
      p_permission_code: 'store.products_master.manage',
    }).maybeSingle();
    // 若無 RPC，改用直接查詢
    const { data: rolePerms } = await supabase
      .from('user_roles')
      .select('role:roles!inner(role_permissions!inner(is_allowed, permission:permissions!inner(code)))')
      .eq('user_id', user.id)
      .eq('is_active', true);
    const isAllowed = (rolePerms ?? []).some((ur: any) =>
      ur.role?.role_permissions?.some((rp: any) =>
        rp.is_allowed && rp.permission?.code === 'store.products_master.manage'
      )
    );
    if (!isAllowed) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: '缺少檔案' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Excel 無資料' }, { status: 400 });
    }

    // 欄位對應（容忍不同大小寫/空格）
    const normalize = (row: any, keys: string[]): string => {
      for (const k of keys) {
        const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return String(val).trim();
        }
      }
      return '';
    };

    const records = rows.map(row => ({
      product_code: normalize(row, ['商品編號', 'product_code', 'ProductCode', '編號']),
      product_name: normalize(row, ['商品名稱', 'product_name', 'ProductName', '品名', '名稱']),
      unit:         normalize(row, ['單位', 'unit', 'Unit']) || '',
      is_active: true,
    })).filter(r => r.product_code && r.product_name);

    if (records.length === 0) {
      return NextResponse.json({ error: '找不到有效資料，請確認欄位名稱（商品編號、商品名稱、單位）' }, { status: 400 });
    }

    // Upsert（依 product_code 更新）
    const { error: upsertError } = await supabase
      .from('products_master')
      .upsert(records, { onConflict: 'product_code' });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true, count: records.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/products-master?product_code=XXX  （停用單筆）
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const code = new URL(request.url).searchParams.get('product_code');
    if (!code) return NextResponse.json({ error: '缺少 product_code' }, { status: 400 });

    const { error } = await supabase
      .from('products_master')
      .update({ is_active: false })
      .eq('product_code', code);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
