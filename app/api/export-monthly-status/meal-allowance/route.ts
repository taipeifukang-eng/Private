import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // 檢查用戶身份
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: '找不到用戶資料' }, { status: 403 });
    }

    // 只有管理員、營業部主管或營業部助理可以匯出
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
    const canExport = profile.role === 'admin' || 
                     profile.role === 'supervisor' ||
                     profile.role === 'area_manager' ||
                     (profile.department?.startsWith('營業') && profile.role === 'manager' && !needsAssignment);

    if (!canExport) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    // 獲取請求參數
    const body = await request.json();
    const { year_month, store_ids } = body;

    if (!year_month || !store_ids || store_ids.length === 0) {
      return NextResponse.json(
        { error: '缺少必要參數' },
        { status: 400 }
      );
    }

    // 使用 admin client 繞過 RLS 來查詢資料
    const adminClient = createAdminClient();

    // 獲取門市資料（用於取得門市代號）
    const { data: stores, error: storesError } = await adminClient
      .from('stores')
      .select('id, store_code, store_name')
      .in('id', store_ids);

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      return NextResponse.json(
        { error: '獲取門市資料失敗' },
        { status: 500 }
      );
    }

    // 建立門市ID到門市代號的映射
    const storeMap = new Map(
      stores?.map(s => [s.id, { code: s.store_code, name: s.store_name }]) || []
    );

    // 獲取誤餐費記錄（使用 admin client）
    const { data: records, error: recordsError } = await adminClient
      .from('meal_allowance_records')
      .select('*')
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .order('store_id')
      .order('record_date')
      .order('employee_code');

    if (recordsError) {
      console.error('Error fetching meal allowance records:', recordsError);
      return NextResponse.json(
        { error: '獲取誤餐費記錄失敗' },
        { status: 500 }
      );
    }

    // 準備 Excel 資料
    const excelData = (records || []).map(record => {
      const store = storeMap.get(record.store_id);
      return {
        '門市代號': store?.code || '',
        '月份': year_month,
        '日期': record.record_date,
        '員編': record.employee_code || '',
        '姓名': record.employee_name || '',
        '上班區間': record.work_hours || '',
        '誤餐時段': record.meal_period || '',
        '身分': record.employee_type || ''
      };
    });

    // 如果沒有資料
    if (excelData.length === 0) {
      excelData.push({
        '門市代號': '',
        '月份': year_month,
        '日期': '',
        '員編': '',
        '姓名': '',
        '上班區間': '',
        '誤餐時段': '',
        '身分': ''
      });
    }

    // 創建工作簿
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // 設定欄寬
    const columnWidths = [
      { wch: 12 }, // 門市代號
      { wch: 10 }, // 月份
      { wch: 10 }, // 日期
      { wch: 12 }, // 員編
      { wch: 15 }, // 姓名
      { wch: 18 }, // 上班區間
      { wch: 12 }, // 誤餐時段
      { wch: 10 }, // 身分
    ];
    worksheet['!cols'] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '誤餐費');

    // 生成 Excel 文件
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    // 返回檔案
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="誤餐費_${year_month}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Error in meal allowance export:', error);
    return NextResponse.json(
      { error: '匯出失敗' },
      { status: 500 }
    );
  }
}
