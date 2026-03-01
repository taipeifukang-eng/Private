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

    // 1. 查詢該門市該月份有單品獎金的員工（僅從 monthly_staff_status）
    //    support_staff_bonus 是透過「上個月單品獎金」modal 填寫的獨立表，
    //    store_id = 本店 的 support_staff_bonus 資料不納入本店 PDF 匯出
    const { data: staffData } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, last_month_single_item_bonus')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('last_month_single_item_bonus', 'is', null)
      .gt('last_month_single_item_bonus', 0)
      .order('employee_code');

    if (!staffData || staffData.length === 0) {
      return NextResponse.json({
        store_code: store.store_code,
        store_name: store.store_name,
        staff: []
      });
    }

    // 2. 查詢每位員工的所屬門市（profiles 或 employees），
    //    若非本店員工則在備註中標示其所屬門市來源
    const employeeCodes = staffData.map(s => s.employee_code).filter(Boolean);

    const { data: empProfiles } = await supabase
      .from('profiles')
      .select('employee_code, store_id, stores(store_code, store_name)')
      .in('employee_code', employeeCodes);

    // 建立員工編號 → 所屬門市資訊的 Map
    const empStoreMap = new Map<string, { store_code: string; store_name: string }>();
    for (const p of (empProfiles || [])) {
      if (p.employee_code && p.stores) {
        const s = p.stores as any;
        empStoreMap.set(p.employee_code, {
          store_code: s.store_code || '',
          store_name: s.store_name || ''
        });
      }
    }

    // 組合最終資料，非本店員工附上所屬門市備註
    const allStaff = (staffData).map(s => {
      const homeStore = empStoreMap.get(s.employee_code || '');
      let source_note: string | null = null;
      if (homeStore && homeStore.store_code && homeStore.store_code !== store.store_code) {
        source_note = `所屬門市：${homeStore.store_code} ${homeStore.store_name}`;
      }
      return {
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        bonus: s.last_month_single_item_bonus || 0,
        source_note
      };
    }).filter(s => s.bonus > 0);

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
