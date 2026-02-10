import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

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

    const supabase = createClient();

    // 權限檢查
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    // 使用 RBAC 權限檢查
    const permission = await requirePermission(user.id, 'monthly.export.download');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: permission.message },
        { status: 403 }
      );
    }

    // 獲取所有門市
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('id, store_code, store_name')
      .eq('is_active', true)
      .order('store_code');

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      return NextResponse.json(
        { success: false, error: '獲取門市失敗' },
        { status: 500 }
      );
    }

    // 對每個門市統計該月份的人員狀態
    const storesWithStatus = await Promise.all(
      (stores || []).map(async (store) => {
        // 獲取該門市該月份的統計摘要
        const { data: summary } = await supabase
          .from('monthly_store_summary')
          .select('*')
          .eq('store_id', store.id)
          .eq('year_month', yearMonth)
          .single();

        // 獲取該門市該月份的員工資料
        const { data: staffRecords, count } = await supabase
          .from('monthly_staff_status')
          .select('status', { count: 'exact' })
          .eq('store_id', store.id)
          .eq('year_month', yearMonth);

        const totalEmployees = count || 0;
        const submittedCount = (staffRecords || []).filter(r => r.status === 'submitted').length;
        const confirmedCount = (staffRecords || []).filter(r => r.status === 'confirmed').length;

        // 確定門市狀態
        let storeStatus: 'pending' | 'submitted' | 'confirmed' = 'pending';
        if (summary?.status === 'confirmed') {
          storeStatus = 'confirmed';
        } else if (summary?.status === 'submitted') {
          storeStatus = 'submitted';
        } else if (confirmedCount > 0) {
          storeStatus = 'confirmed';
        } else if (submittedCount > 0) {
          storeStatus = 'submitted';
        }

        return {
          id: store.id,
          store_code: store.store_code,
          store_name: store.store_name,
          total_employees: totalEmployees,
          submitted_count: submittedCount,
          confirmed_count: confirmedCount,
          store_status: storeStatus
        };
      })
    );

    return NextResponse.json({
      success: true,
      stores: storesWithStatus
    });

  } catch (error) {
    console.error('Error in stores API:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
