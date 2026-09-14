import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

type PurchaseRow = {
  id: string;
  year_month: string;
  store_code: string | null;
  sale_date: string | null;
  sale_sequence: string | null;
  member_code: string | null;
  member_name: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: number;
  total_amount: number;
  gross_profit: number;
  employee_code: string | null;
  employee_name: string | null;
  employee_position: string | null;
  match_status: string;
  stores?: { store_name?: string | null } | { store_name?: string | null }[] | null;
};

function getStoreName(row: PurchaseRow) {
  const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
  return store?.store_name || '';
}

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function requireAccess(userId: string) {
  return hasAnyPermission(userId, ['employee_purchase.view', 'employee_purchase.import']);
}

async function fetchAllPurchases(yearMonth: string, position: string) {
  const admin = createAdminClient();
  const pageSize = 1000;
  let from = 0;
  const rows: PurchaseRow[] = [];

  while (true) {
    let query = admin
      .from('employee_purchase_sales')
      .select(`
        id,
        year_month,
        store_code,
        sale_date,
        sale_sequence,
        member_code,
        member_name,
        product_code,
        product_name,
        quantity,
        total_amount,
        gross_profit,
        employee_code,
        employee_name,
        employee_position,
        match_status,
        stores:store_id (store_name)
      `)
      .eq('year_month', yearMonth)
      .order('sale_date', { ascending: false })
      .order('sale_sequence', { ascending: false })
      .range(from, from + pageSize - 1);

    if (position) {
      query = query.eq('employee_position', position);
    }

    const { data, error } = await query;
    if (error) throw error;

    rows.push(...((data || []) as PurchaseRow[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const allowed = await requireAccess(user.id);
    if (!allowed) {
      return NextResponse.json({ success: false, error: '無員工購物管理權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('year_month') || '';
    const position = (searchParams.get('position') || '').trim();

    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, error: '月份格式錯誤' }, { status: 400 });
    }

    const admin = createAdminClient();
    const rows = await fetchAllPurchases(yearMonth, position);

    const { data: allPositionRows, error: positionError } = await admin
      .from('employee_purchase_sales')
      .select('employee_position')
      .eq('year_month', yearMonth);
    if (positionError) throw positionError;

    const positions = Array.from(
      new Set((allPositionRows || [])
        .map((row: any) => String(row.employee_position || '').trim())
        .filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    const summaryMap = new Map<string, {
      position: string;
      sales_count: number;
      employee_count: Set<string>;
      total_quantity: number;
      total_amount: number;
      gross_profit: number;
    }>();

    rows.forEach((row) => {
      const key = row.employee_position || '未比對職稱';
      const summary = summaryMap.get(key) || {
        position: key,
        sales_count: 0,
        employee_count: new Set<string>(),
        total_quantity: 0,
        total_amount: 0,
        gross_profit: 0,
      };
      summary.sales_count += 1;
      if (row.employee_code || row.employee_name) {
        summary.employee_count.add(row.employee_code || row.employee_name || '');
      }
      summary.total_quantity += toNumber(row.quantity);
      summary.total_amount += toNumber(row.total_amount);
      summary.gross_profit += toNumber(row.gross_profit);
      summaryMap.set(key, summary);
    });

    const summaryByPosition = Array.from(summaryMap.values())
      .map((summary) => ({
        position: summary.position,
        sales_count: summary.sales_count,
        employee_count: summary.employee_count.size,
        total_quantity: summary.total_quantity,
        total_amount: summary.total_amount,
        gross_profit: summary.gross_profit,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);

    const { data: latestBatch } = await admin
      .from('employee_purchase_import_batches')
      .select('id, year_month, file_name, imported_at, row_count, matched_count, unmatched_count, total_amount')
      .eq('year_month', yearMonth)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const detailRows = rows.slice(0, 500).map((row) => ({
      id: row.id,
      year_month: row.year_month,
      store_code: row.store_code || '',
      store_name: getStoreName(row),
      sale_date: row.sale_date,
      sale_sequence: row.sale_sequence || '',
      member_code: row.member_code || '',
      member_name: row.member_name || '',
      product_code: row.product_code || '',
      product_name: row.product_name || '',
      quantity: toNumber(row.quantity),
      total_amount: toNumber(row.total_amount),
      gross_profit: toNumber(row.gross_profit),
      employee_code: row.employee_code || '',
      employee_name: row.employee_name || '',
      employee_position: row.employee_position || '',
      match_status: row.match_status,
    }));

    return NextResponse.json({
      success: true,
      positions,
      summary_by_position: summaryByPosition,
      rows: detailRows,
      total_count: rows.length,
      total_amount: rows.reduce((sum, row) => sum + toNumber(row.total_amount), 0),
      matched_count: rows.filter((row) => row.match_status === 'employee_code' || row.match_status === 'employee_name').length,
      unmatched_count: rows.filter((row) => row.match_status !== 'employee_code' && row.match_status !== 'employee_name').length,
      latest_batch: latestBatch || null,
    });
  } catch (error: any) {
    console.error('Error loading employee purchases:', error);
    return NextResponse.json({ success: false, error: error.message || '載入員工購物資料失敗' }, { status: 500 });
  }
}
