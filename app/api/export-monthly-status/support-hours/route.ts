import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const yearMonth = searchParams.get('year_month');

    if (!yearMonth) {
      return NextResponse.json(
        { success: false, error: '缺少年月參數' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 權限檢查
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    // 權限：admin 或營業部的 manager
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessManager = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    const isAdmin = ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '');
    
    if (!profile || (!isAdmin && !isBusinessManager)) {
      return NextResponse.json(
        { success: false, error: '權限不足' },
        { status: 403 }
      );
    }

    // 獲取所有門市及其支援時數
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select(`
        id,
        store_code,
        store_name
      `)
      .eq('is_active', true)
      .order('store_code');

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      return NextResponse.json(
        { success: false, error: '獲取門市失敗' },
        { status: 500 }
      );
    }

    // 獲取每個門市的支援時數資料
    const supportHoursData = await Promise.all(
      (stores || []).map(async (store) => {
        const { data: summary } = await supabase
          .from('monthly_store_summary')
          .select('support_to_other_stores_hours, support_from_other_stores_hours')
          .eq('store_id', store.id)
          .eq('year_month', yearMonth)
          .maybeSingle();

        return {
          門市代號: store.store_code,
          門市名稱: store.store_name,
          支援分店時數: summary?.support_to_other_stores_hours || 0,
          分店支援時數: summary?.support_from_other_stores_hours || 0
        };
      })
    );

    // 建立工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(supportHoursData);

    // 設定欄位寬度
    ws['!cols'] = [
      { wch: 12 }, // 門市代號
      { wch: 20 }, // 門市名稱
      { wch: 15 }, // 支援分店時數
      { wch: 15 }  // 分店支援時數
    ];

    XLSX.utils.book_append_sheet(wb, ws, '門市支援時數');

    // 生成 buffer
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 設定檔案名稱
    const fileName = `門市支援時數_${yearMonth}.xlsx`;

    // 返回 Excel 檔案
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });

  } catch (error) {
    console.error('Export support hours error:', error);
    return NextResponse.json(
      { success: false, error: '匯出失敗' },
      { status: 500 }
    );
  }
}
