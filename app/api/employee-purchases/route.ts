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

type PositionSummaryRow = {
  position: string;
  sales_count: number;
  employee_count: number;
  total_quantity: number;
  total_amount: number;
  gross_profit: number;
};

type MonthStatsRow = {
  total_count: number;
  total_amount: number;
  matched_count: number;
  unmatched_count: number;
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

function normalizeSummaryRows(rows: any[]): PositionSummaryRow[] {
  return (rows || []).map((row: any) => ({
    position: row.position || '未比對職稱',
    sales_count: toNumber(row.sales_count),
    employee_count: toNumber(row.employee_count),
    total_quantity: toNumber(row.total_quantity),
    total_amount: toNumber(row.total_amount),
    gross_profit: toNumber(row.gross_profit),
  }));
}

function normalizeStats(row: any): MonthStatsRow {
  return {
    total_count: toNumber(row?.total_count),
    total_amount: toNumber(row?.total_amount),
    matched_count: toNumber(row?.matched_count),
    unmatched_count: toNumber(row?.unmatched_count),
  };
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
    const { data: summaryData, error: summaryError } = await supabase
      .rpc('employee_purchase_position_summary', { p_year_month: yearMonth });
    if (summaryError) throw summaryError;

    const summaryByPosition = normalizeSummaryRows(summaryData || []);
    const positions = summaryByPosition
      .map((row) => row.position)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    const { data: statsData, error: statsError } = await supabase
      .rpc('employee_purchase_month_stats', {
        p_year_month: yearMonth,
        p_position: position || null,
      });
    if (statsError) throw statsError;
    const stats = normalizeStats(Array.isArray(statsData) ? statsData[0] : statsData);

    let detailQuery = admin
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
      .limit(500);

    if (position && position !== '未比對職稱') {
      detailQuery = detailQuery.eq('employee_position', position);
    } else if (position === '未比對職稱') {
      detailQuery = detailQuery.or('employee_position.is.null,employee_position.eq.');
    }

    const { data: detailData, error: detailError } = await detailQuery;
    if (detailError) throw detailError;
    const rows = (detailData || []) as PurchaseRow[];

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
      total_count: stats.total_count,
      total_amount: stats.total_amount,
      matched_count: stats.matched_count,
      unmatched_count: stats.unmatched_count,
      latest_batch: latestBatch || null,
    });
  } catch (error: any) {
    console.error('Error loading employee purchases:', error);
    return NextResponse.json({ success: false, error: error.message || '載入員工購物資料失敗' }, { status: 500 });
  }
}
