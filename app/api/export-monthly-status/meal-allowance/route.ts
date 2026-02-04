import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  console.log('🚀 開始處理誤餐費匯出');
  
  try {
    const supabase = createClient();

    // 檢查用戶身份
    console.log('👤 檢查用戶身份');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('❌ 用戶驗證失敗:', authError);
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    console.log('✅ 用戶已驗證:', user.id);

    // 檢查權限
    console.log('🔐 檢查權限');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('❌ 查詢用戶資料失敗:', profileError);
      return NextResponse.json({ error: `找不到用戶資料: ${profileError.message}` }, { status: 403 });
    }

    if (!profile) {
      return NextResponse.json({ error: '找不到用戶資料' }, { status: 403 });
    }
    console.log('👤 用戶資料:', profile);

    // 只有管理員、營業部主管或營業部助理可以匯出
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
    const canExport = profile.role === 'admin' || 
                     profile.role === 'supervisor' ||
                     profile.role === 'area_manager' ||
                     (profile.department?.startsWith('營業') && profile.role === 'manager' && !needsAssignment);

    if (!canExport) {
      console.error('❌ 權限不足:', { role: profile.role, department: profile.department, job_title: profile.job_title });
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }
    console.log('✅ 權限檢查通過');

    // 獲取請求參數
    let body;
    try {
      body = await request.json();
    } catch (jsonError) {
      console.error('❌ 解析 JSON 失敗:', jsonError);
      return NextResponse.json({ error: '無效的請求內容' }, { status: 400 });
    }
    
    const { year_month, store_ids } = body;
    console.log('📅 參數:', { year_month, store_ids_count: store_ids?.length });

    if (!year_month || !store_ids || store_ids.length === 0) {
      return NextResponse.json(
        { error: '缺少必要參數' },
        { status: 400 }
      );
    }

    // 使用 admin client 繞過 RLS 來查詢資料
    console.log('🔧 創建 admin client');
    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (clientError) {
      console.error('❌ 創建 admin client 失敗:', clientError);
      return NextResponse.json({ error: '伺服器設定錯誤' }, { status: 500 });
    }

    // 獲取門市資料（用於取得門市代號）
    console.log('🏪 查詢門市資料');
    const { data: stores, error: storesError } = await adminClient
      .from('stores')
      .select('id, store_code, store_name')
      .in('id', store_ids);

    if (storesError) {
      console.error('❌ 查詢門市失敗:', storesError);
      return NextResponse.json(
        { error: `獲取門市資料失敗: ${storesError.message}` },
        { status: 500 }
      );
    }
    console.log('✅ 門市資料:', stores?.length, '筆');

    // 建立門市ID到門市代號的映射
    const storeMap = new Map(
      stores?.map(s => [s.id, { code: s.store_code, name: s.store_name }]) || []
    );

    // 獲取誤餐費記錄（使用 admin client）
    console.log('📋 查詢誤餐費記錄');
    const { data: records, error: recordsError } = await adminClient
      .from('meal_allowance_records')
      .select('*')
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .order('store_id')
      .order('record_date')
      .order('employee_code');

    if (recordsError) {
      console.error('❌ 查詢誤餐費記錄失敗:', recordsError);
      return NextResponse.json(
        { error: `獲取誤餐費記錄失敗: ${recordsError.message}` },
        { status: 500 }
      );
    }
    console.log('✅ 誤餐費記錄:', records?.length, '筆');

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

    console.log('✅ Excel 生成成功，大小:', excelBuffer.length);

    // 返回檔案
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="誤餐費_${year_month}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error('❌ 誤餐費匯出發生錯誤:', error);
    console.error('錯誤堆疊:', error?.stack);
    return NextResponse.json(
      { error: `匯出失敗: ${error?.message || '未知錯誤'}` },
      { status: 500 }
    );
  }
}
