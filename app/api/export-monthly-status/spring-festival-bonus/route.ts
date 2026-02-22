import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

/**
 * 匯出春節出勤獎金 Excel
 * 欄位：門市代號、月份、員編、姓名、身分、上班日期
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 使用 RBAC 權限檢查
    const permission = await requirePermission(user.id, 'monthly.export.download');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: permission.message },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { year_month, store_ids } = body;

    if (!year_month || !store_ids || !Array.isArray(store_ids)) {
      return NextResponse.json({ success: false, error: '缺少年月或門市參數' }, { status: 400 });
    }

    // 查詢春節出勤獎金資料，JOIN stores 取得門市代號
    const { data: bonusData, error } = await supabase
      .from('spring_festival_bonus')
      .select(`
        id,
        year_month,
        employee_code,
        employee_name,
        category,
        attendance_date,
        bonus_amount,
        store:stores(store_code, store_name)
      `)
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .order('store_id', { ascending: true })
      .order('attendance_date', { ascending: true })
      .order('employee_code', { ascending: true });

    if (error) {
      console.error('Error fetching spring festival bonus data:', error);
      return NextResponse.json({ success: false, error: '查詢資料失敗' }, { status: 500 });
    }

    if (!bonusData || bonusData.length === 0) {
      return NextResponse.json({ success: false, error: '該月份沒有春節出勤獎金資料' }, { status: 404 });
    }

    // 按門市代號 → 上班日期 → 員編排序
    bonusData.sort((a: any, b: any) => {
      const codeA = a.store?.store_code || '';
      const codeB = b.store?.store_code || '';
      if (codeA !== codeB) return codeA.localeCompare(codeB);
      const dateA = a.attendance_date || '';
      const dateB = b.attendance_date || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.employee_code || '').localeCompare(b.employee_code || '');
    });

    // 準備 Excel 資料
    const excelData = bonusData.map((row: any) => ({
      '門市代號': row.store?.store_code || '',
      '月份': row.year_month,
      '員編': row.employee_code || '',
      '姓名': row.employee_name || '',
      '身分': row.category || '',
      '上班日期': row.attendance_date || '',
    }));

    // 創建工作表
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // 設定欄寬
    worksheet['!cols'] = [
      { wch: 15 }, // 門市代號
      { wch: 12 }, // 月份
      { wch: 12 }, // 員編
      { wch: 15 }, // 姓名
      { wch: 10 }, // 身分
      { wch: 15 }, // 上班日期
    ];

    // 創建工作簿
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SpringFestivalBonus');

    // 生成 Excel 檔案
    const excelBuffer = XLSX.write(workbook, { 
      type: 'array', 
      bookType: 'xlsx',
      bookSST: false
    });

    // 返回檔案
    const filename = encodeURIComponent(`春節出勤獎金_${year_month}.xlsx`);
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`
      }
    });

  } catch (error: any) {
    console.error('Error in spring festival bonus export:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '匯出失敗' 
    }, { status: 500 });
  }
}
