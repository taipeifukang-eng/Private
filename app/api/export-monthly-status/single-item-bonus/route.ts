import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

/**
 * 匯出單品獎金 Excel
 * 欄位：門市代號 | 月份 | 員編 | 姓名 | 單品獎金總額
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const body = await request.json();
    const { year_month, store_ids } = body;

    if (!year_month || !store_ids || !Array.isArray(store_ids)) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 查詢所有員工的單品獎金資料（從 monthly_staff_status）
    const { data: staffData, error } = await supabase
      .from('monthly_staff_status')
      .select(`
        id,
        store_id,
        employee_code,
        employee_name,
        last_month_single_item_bonus,
        stores!inner (
          store_code,
          store_name
        )
      `)
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .not('last_month_single_item_bonus', 'is', null)
      .order('store_id')
      .order('employee_code');

    if (error) {
      console.error('Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 查詢支援人員獎金資料（從 support_staff_bonus，包含門市關聯）
    const { data: supportBonusData, error: supportError } = await supabase
      .from('support_staff_bonus')
      .select(`
        *,
        stores!inner (
          store_code,
          store_name
        )
      `)
      .eq('year_month', year_month)
      .in('store_id', store_ids);

    if (supportError) {
      console.error('Support bonus query error:', supportError);
      // 不中斷，繼續處理 monthly_staff_status 的資料
    }

    // 準備 Excel 資料 - 來自 monthly_staff_status
    const excelData = staffData.map((record: any) => ({
      '門市代號': record.stores.store_code || '',
      '月份': year_month,
      '員編': record.employee_code || '',
      '姓名': record.employee_name || '',
      '單品獎金總額': record.last_month_single_item_bonus || 0
    }));

    // 加入支援人員獎金資料（帶門市代號）
    if (supportBonusData && supportBonusData.length > 0) {
      const supportExcelData = supportBonusData.map((record: any) => ({
        '門市代號': record.stores?.store_code || '',
        '月份': year_month,
        '員編': record.employee_code || '',
        '姓名': record.employee_name || '',
        '單品獎金總額': record.bonus_amount || 0
      }));
      excelData.push(...supportExcelData);
    }

    // 建立工作簿
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '單品獎金');

    // 生成 Excel buffer
    const excelBuffer = XLSX.write(workbook, { 
      type: 'array', 
      bookType: 'xlsx' 
    });

    // 設定檔名
    const filename = `單品獎金_${year_month}.xlsx`;
    const encodedFilename = encodeURIComponent(filename);

    // 回傳 Excel 檔案
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`
      }
    });

  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json({ 
      error: error.message || '匯出失敗' 
    }, { status: 500 });
  }
}
