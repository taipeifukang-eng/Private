import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

/**
 * 匯出交通費用 Excel
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ success: false, error: '找不到用戶資料' }, { status: 403 });
    }

    // 只有管理員、營業部主管或營業部助理可以匯出
    const canExport = profile.role === 'admin' || 
                     (profile.department === '營業部' && profile.role === 'manager') ||
                     (profile.department === '營業部' && profile.job_title === '助理' && profile.role === 'manager');

    if (!canExport) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { year_month, store_ids } = body;

    if (!year_month || !store_ids || !Array.isArray(store_ids)) {
      return NextResponse.json({ success: false, error: '缺少年月或門市參數' }, { status: 400 });
    }

    // 查詢有填寫交通費用的員工資料
    const { data: staffData, error } = await supabase
      .from('monthly_staff_status')
      .select(`
        id,
        year_month,
        employee_code,
        employee_name,
        monthly_transport_expense,
        transport_expense_notes,
        store:stores(store_code, store_name)
      `)
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .not('monthly_transport_expense', 'is', null)
      .gt('monthly_transport_expense', 0)
      .order('store_id', { ascending: true })
      .order('employee_code', { ascending: true });

    if (error) {
      console.error('Error fetching transport data:', error);
      return NextResponse.json({ success: false, error: '查詢資料失敗' }, { status: 500 });
    }

    if (!staffData || staffData.length === 0) {
      return NextResponse.json({ success: false, error: '該月份沒有交通費用資料' }, { status: 404 });
    }

    // 準備 Excel 資料
    const excelData = staffData.map((staff: any) => ({
      '門市代號': staff.store?.store_code || '',
      '月份': staff.year_month,
      '員編': staff.employee_code || '',
      '姓名': staff.employee_name || '',
      '交通費': staff.monthly_transport_expense || 0,
      '備註原因': staff.transport_expense_notes || ''
    }));

    // 創建工作表
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // 設定欄寬
    worksheet['!cols'] = [
      { wch: 15 }, // 門市代號
      { wch: 12 }, // 月份
      { wch: 12 }, // 員編
      { wch: 15 }, // 姓名
      { wch: 12 }, // 交通費
      { wch: 40 }  // 備註原因
    ];

    // 創建工作簿
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'TransportExpense');

    // 生成 Excel 檔案 - 使用 array buffer 而不是 buffer
    const excelBuffer = XLSX.write(workbook, { 
      type: 'array', 
      bookType: 'xlsx',
      bookSST: false
    });

    // 返回檔案
    const filename = encodeURIComponent(`交通費用_${year_month}.xlsx`);
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`
      }
    });

  } catch (error: any) {
    console.error('Error in transport export:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '匯出失敗' 
    }, { status: 500 });
  }
}
