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

    // 1. 本店填寫的員工單品獎金（透過「上個月單品獎金」modal 填入的 support_staff_bonus）
    //    這些是本店自己員工的獎金，直接顯示、不需備註
    const { data: localBonusData } = await supabase
      .from('support_staff_bonus')
      .select('employee_code, employee_name, bonus_amount')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .gt('bonus_amount', 0)
      .order('employee_code');

    // 2. 從 monthly_staff_status 查出本店月份有單品獎金的員工，
    //    並查詢其所屬門市，篩選出「所屬門市 ≠ 本店」的員工（別間店到本店支援的）
    const { data: staffData } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, last_month_single_item_bonus')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('last_month_single_item_bonus', 'is', null)
      .gt('last_month_single_item_bonus', 0)
      .order('employee_code');

    // 查詢這些員工的所屬門市
    const allCodes = (staffData || []).map(s => s.employee_code).filter(Boolean);
    let empStoreMap = new Map<string, { store_code: string; store_name: string }>();

    if (allCodes.length > 0) {
      const { data: empProfiles } = await supabase
        .from('profiles')
        .select('employee_code, stores(store_code, store_name)')
        .in('employee_code', allCodes);

      for (const p of (empProfiles || [])) {
        if (p.employee_code && p.stores) {
          const s = p.stores as any;
          empStoreMap.set(p.employee_code, {
            store_code: s.store_code || '',
            store_name: s.store_name || ''
          });
        }
      }
    }

    // 本店員工（support_staff_bonus），無備註
    const localEntries = (localBonusData || []).map(s => ({
      employee_code: s.employee_code,
      employee_name: s.employee_name,
      bonus: s.bonus_amount || 0,
      source_note: null as string | null
    }));

    // 本店記錄中，所屬門市 ≠ 本店的員工（別間店來支援），附上所屬門市備註
    const crossEntries = (staffData || [])
      .filter(s => {
        const homeStore = empStoreMap.get(s.employee_code || '');
        // 若查不到所屬門市資訊，也一併顯示（不過濾掉）
        if (!homeStore || !homeStore.store_code) return true;
        return homeStore.store_code !== store.store_code;
      })
      .map(s => {
        const homeStore = empStoreMap.get(s.employee_code || '');
        const source_note = homeStore && homeStore.store_code
          ? `所屬門市：${homeStore.store_code} ${homeStore.store_name}`
          : null;
        return {
          employee_code: s.employee_code,
          employee_name: s.employee_name,
          bonus: s.last_month_single_item_bonus || 0,
          source_note
        };
      });

    // 合併：本店員工在前，別間店支援員工在後，各自按員工編號排序
    localEntries.sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));
    crossEntries.sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));

    const allStaff = [...localEntries, ...crossEntries].filter(s => s.bonus > 0);

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
