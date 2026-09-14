import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

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

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function requireAccess(userId: string) {
  return hasAnyPermission(userId, ['employee_purchase.view', 'employee_purchase.import']);
}

function normalizeSummaryRows(rows: any[]): PositionSummaryRow[] {
  return (rows || []).map((row: any) => ({
    position: row.position_name || row.position || '未比對職稱',
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

    const { data: employeeSummaryData, error: employeeSummaryError } = await supabase
      .rpc('employee_purchase_employee_summary', {
        p_year_month: yearMonth,
        p_position: position || null,
      });
    if (employeeSummaryError) throw employeeSummaryError;

    const { data: latestBatch } = await admin
      .from('employee_purchase_import_batches')
      .select('id, year_month, file_name, imported_at, row_count, matched_count, unmatched_count, total_amount')
      .eq('year_month', yearMonth)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const employeeRows = (employeeSummaryData || []).map((row: any, index: number) => ({
      id: `${row.recognized_store_code || 'store'}-${row.employee_code || row.employee_name || 'employee'}-${index}`,
      recognized_store_code: row.recognized_store_code || '',
      recognized_store_name: row.recognized_store_name || '',
      employee_code: row.employee_code || '',
      employee_name: row.employee_name || '',
      employee_position: row.employee_position || '',
      purchase_count: toNumber(row.purchase_count),
      total_amount: toNumber(row.total_amount),
    }));

    return NextResponse.json({
      success: true,
      positions,
      summary_by_position: summaryByPosition,
      rows: employeeRows,
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
