import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

/**
 * 匯出育才獎金 Excel
 * 欄位：門市代號 | 月份 | 員編 | 姓名 | 育才獎金金額 | 育才對象
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

    // 查詢所有員工的育才獎金資料
    const { data: staffData, error } = await supabase
      .from('monthly_staff_status')
      .select(`
        id,
        store_id,
        employee_code,
        employee_name,
        talent_cultivation_bonus,
        talent_cultivation_target,
        stores!inner (
          store_code,
          store_name
        )
      `)
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .not('talent_cultivation_bonus', 'is', null)
      .order('store_id')
      .order('employee_code');

    if (error) {
      console.error('Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 準備 Excel 資料
    const excelData = staffData.map((record: any) => ({
      '門市代號': record.stores.store_code || '',
      '月份': year_month,
      '員編': record.employee_code || '',
      '姓名': record.employee_name || '',
      '育才獎金金額': record.talent_cultivation_bonus || 0,
      '育才對象': record.talent_cultivation_target || ''
    }));

    // 建立工作簿
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '育才獎金');

    // 生成 Excel buffer
    const excelBuffer = XLSX.write(workbook, { 
      type: 'array', 
      bookType: 'xlsx' 
    });

    // 設定檔名
    const filename = `育才獎金_${year_month}.xlsx`;
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
