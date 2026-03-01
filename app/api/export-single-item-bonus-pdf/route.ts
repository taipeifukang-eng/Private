import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 匯出門市單品獎金資料（包含一般員工和支援人員）
 * 返回 JSON 資料供客戶端生成 PDF
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查權限（店長以上）
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, job_title')
      .eq('id', user.id)
      .single();

    const isStoreManager = ['店長', '代理店長', '督導', '督導(代理店長)'].includes(profile?.job_title || '');
    const hasPermission = ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '') || isStoreManager;

    if (!hasPermission) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { year_month, store_id } = body;

    if (!year_month || !store_id) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 查詢門市資訊
    const { data: store } = await supabase
      .from('stores')
      .select('store_code, store_name')
      .eq('id', store_id)
      .single();

    if (!store) {
      return NextResponse.json({ error: '找不到門市' }, { status: 404 });
    }

    // 1. 查詢該門市該月份有單品獎金的一般員工
    const { data: staffData } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, last_month_single_item_bonus')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('last_month_single_item_bonus', 'is', null)
      .gt('last_month_single_item_bonus', 0)
      .order('employee_code');

    // 2. 查詢支援人員單品獎金（含來源門市資訊）
    const { data: supportData } = await supabase
      .from('support_staff_bonus')
      .select('employee_code, employee_name, bonus_amount, store_id, stores(store_code, store_name)')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .gt('bonus_amount', 0)
      .order('employee_code');

    // 合併數據，保留各自獨立一筆；support_staff_bonus 的資料附上來源門市備註
    const staffEntries = (staffData || []).map(s => ({
      employee_code: s.employee_code,
      employee_name: s.employee_name,
      bonus: s.last_month_single_item_bonus || 0,
      source_note: null as string | null
    }));

    // 找出在 monthly_staff_status 已出現的員工編號，support 重複者標記來源
    const staffCodes = new Set(staffEntries.map(s => s.employee_code));

    const supportEntries = (supportData || []).map(s => {
      const storeInfo = (s.stores as any);
      const sourceLabel = storeInfo
        ? `${storeInfo.store_code} ${storeInfo.store_name} 單品獎金表`
        : '單品獎金表';
      return {
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        bonus: s.bonus_amount || 0,
        // 若同一員工在 monthly_staff_status 也已出現，則標記來源；否則不需標記
        source_note: staffCodes.has(s.employee_code) ? sourceLabel : null as string | null
      };
    });

    const allStaff = [...staffEntries, ...supportEntries].filter(s => s.bonus > 0);

    // 按員工編號排序
    allStaff.sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));

    // 返回 JSON 資料（包含門市資訊）
    return NextResponse.json({
      store_code: store.store_code,
      store_name: store.store_name,
      staff: allStaff
    });

  } catch (error) {
    console.error('Error exporting bonus data:', error);
    return NextResponse.json(
      { error: '匯出失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}
