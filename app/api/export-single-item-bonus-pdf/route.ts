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

    // === 步驟 1：本店填寫的 support_staff_bonus ===
    const { data: localBonusData } = await supabase
      .from('support_staff_bonus')
      .select('employee_code, employee_name, bonus_amount')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .gt('bonus_amount', 0)
      .order('employee_code');

    // === 步驟 2：查詢本店員工名單 ===
    // 來源 1：store_employees（在職員工）
    // 來源 2：monthly_staff_status 該月本店有紀錄的員工（含手動新增）
    // 兩者聯集 → 判斷是否為「本店員工」
    const [{ data: storeEmps }, { data: monthlyStaff }] = await Promise.all([
      supabase
        .from('store_employees')
        .select('employee_code')
        .eq('store_id', store_id)
        .eq('is_active', true)
        .not('employee_code', 'is', null),
      supabase
        .from('monthly_staff_status')
        .select('employee_code')
        .eq('store_id', store_id)
        .eq('year_month', year_month)
        .not('employee_code', 'is', null)
    ]);

    const homeCodeSet = new Set([
      ...(storeEmps || []).map(e => e.employee_code).filter(Boolean),
      ...(monthlyStaff || []).map(e => e.employee_code).filter(Boolean)
    ]);

    // 本店填寫的名單：本店員工無備註，外來支援標注「支援同仁」
    const localEntries = (localBonusData || []).map(s => ({
      employee_code: s.employee_code,
      employee_name: s.employee_name,
      bonus: s.bonus_amount || 0,
      source_note: homeCodeSet.has(s.employee_code || '') ? null : '支援同仁' as string | null
    }));

    // === 步驟 3：查詢本店員工在「其他門市」填寫的 support_staff_bonus ===
    // 例：FK0557 屬中興店，新欣店也填了 FK0557 $1000 → 在中興店 PDF 也顯示，標注來源
    const crossEntries: { employee_code: string; employee_name: string; bonus: number; source_note: string | null }[] = [];

    if (homeCodeSet.size > 0) {
      const homeCodes = Array.from(homeCodeSet);
      const { data: crossData } = await supabase
        .from('support_staff_bonus')
        .select('employee_code, employee_name, bonus_amount, store_id, stores(store_code, store_name)')
        .eq('year_month', year_month)
        .in('employee_code', homeCodes)
        .neq('store_id', store_id)
        .gt('bonus_amount', 0);

      for (const s of (crossData || [])) {
        const storeInfo = s.stores as any;
        const source_note = storeInfo
          ? `來源：${storeInfo.store_code} ${storeInfo.store_name}`
          : '來源：其他門市';
        crossEntries.push({
          employee_code: s.employee_code,
          employee_name: s.employee_name,
          bonus: s.bonus_amount || 0,
          source_note
        });
      }
    }

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
