import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

/**
 * POST /api/performance-data/import
 * 從 Excel 批次匯入業績資料
 *
 * Form data:
 *   file: .xlsx 檔案
 *   store_id: 門市 UUID
 *   year: 年份 (e.g. 2026)
 *
 * Excel 欄位 (第一列為標題):
 *   月份 | 營業天數 | 月毛利目標 | 月營業額目標 | 月來客數目標 | 上個月處方箋目標
 *   | 月毛利實際 | 月營業額實際 | 月來客數實際 | 上個月處方箋實際
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const storeId = formData.get('store_id') as string;
    const year = formData.get('year') as string;

    if (!file || !storeId || !year) {
      return NextResponse.json(
        { success: false, error: '缺少必要參數 (file, store_id, year)' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year);
    if (isNaN(yearNum)) {
      return NextResponse.json({ success: false, error: '年份格式錯誤' }, { status: 400 });
    }

    // 讀取 Excel
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Excel 無資料' }, { status: 400 });
    }

    // 欄位映射
    const COL = {
      month: ['月份'],
      business_days: ['營業天數'],
      gp_target: ['月毛利目標', '毛利目標'],
      rev_target: ['月營業額目標', '營業額目標'],
      cc_target: ['月來客數目標', '來客數目標'],
      rx_target: ['上個月處方箋目標', '處方箋目標'],
      gp_actual: ['月毛利實際', '毛利實際'],
      rev_actual: ['月營業額實際', '營業額實際'],
      cc_actual: ['月來客數實際', '來客數實際'],
      rx_actual: ['上個月處方箋實際', '處方箋實際'],
    };

    function getVal(row: Record<string, any>, keys: string[]): number | null {
      for (const k of keys) {
        if (k in row && row[k] !== null && row[k] !== '') {
          const v = parseFloat(String(row[k]).replace(/,/g, ''));
          return isNaN(v) ? null : v;
        }
      }
      return null;
    }

    const records = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const monthRaw = getVal(row, COL.month);
      const business_days = getVal(row, COL.business_days);

      if (!monthRaw || !business_days) {
        errors.push(`第 ${i + 2} 列: 月份或營業天數為空，跳過`);
        continue;
      }

      const month = Math.round(monthRaw);
      if (month < 1 || month > 12) {
        errors.push(`第 ${i + 2} 列: 月份 ${month} 超出範圍 (1-12)，跳過`);
        continue;
      }

      records.push({
        store_id: storeId,
        year: yearNum,
        month,
        business_days: Math.round(business_days),
        monthly_gross_profit_target: getVal(row, COL.gp_target),
        monthly_revenue_target: getVal(row, COL.rev_target),
        monthly_customer_count_target: getVal(row, COL.cc_target),
        last_month_rx_target: getVal(row, COL.rx_target),
        monthly_gross_profit_actual: getVal(row, COL.gp_actual),
        monthly_revenue_actual: getVal(row, COL.rev_actual),
        monthly_customer_count_actual: getVal(row, COL.cc_actual),
        last_month_rx_actual: getVal(row, COL.rx_actual),
        created_by: user.id,
        updated_at: new Date().toISOString(),
      });
    }

    if (records.length === 0) {
      return NextResponse.json({ success: false, error: '沒有可匯入的有效資料', errors }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('store_performance')
      .upsert(records, { onConflict: 'store_id,year,month' })
      .select();

    if (error) {
      return NextResponse.json({ success: false, error: error.message, errors }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imported: data?.length ?? 0,
      skipped: rows.length - records.length,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
