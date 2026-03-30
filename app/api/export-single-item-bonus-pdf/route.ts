import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildHistoricalStoreCodeMap } from '@/lib/store/historical';

interface PdfReportRow {
  employee_code: string;
  employee_name: string;
  source_notes: string[];
  single_item_bonus: number;
  single_item_bonus_details: string[];
  meal_allowance_amount: number;
  meal_allowance_details: string[];
  transport_expense: number;
  transport_notes: string[];
  talent_cultivation_bonus: number;
  talent_cultivation_targets: string[];
  spring_festival_bonus: number;
  spring_festival_details: string[];
}

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

    // 取得該門市在目標月份當時的歷史代碼
    const mainCodeMap = await buildHistoricalStoreCodeMap(supabase, [store_id], year_month);
    const historicalMainCode = mainCodeMap[store_id] || store.store_code;

    const reportMap = new Map<string, PdfReportRow>();

    const getRow = (employeeCode: string | null, employeeName: string | null) => {
      const safeEmployeeCode = employeeCode || '';
      const safeEmployeeName = employeeName || '';
      const key = `${safeEmployeeCode}::${safeEmployeeName}`;

      if (!reportMap.has(key)) {
        reportMap.set(key, {
          employee_code: safeEmployeeCode,
          employee_name: safeEmployeeName,
          source_notes: [],
          single_item_bonus: 0,
          single_item_bonus_details: [],
          meal_allowance_amount: 0,
          meal_allowance_details: [],
          transport_expense: 0,
          transport_notes: [],
          talent_cultivation_bonus: 0,
          talent_cultivation_targets: [],
          spring_festival_bonus: 0,
          spring_festival_details: []
        });
      }

      return reportMap.get(key)!;
    };

    const pushUnique = (target: string[], value: string | null | undefined) => {
      if (!value) {
        return;
      }
      if (!target.includes(value)) {
        target.push(value);
      }
    };

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
    for (const item of (localBonusData || [])) {
      const row = getRow(item.employee_code, item.employee_name);
      row.single_item_bonus += item.bonus_amount || 0;
      pushUnique(row.single_item_bonus_details, `本店：NT$${(item.bonus_amount || 0).toLocaleString()}`);
      if (!homeCodeSet.has(item.employee_code || '')) {
        pushUnique(row.source_notes, '支援同仁');
      }
    }

    // === 步驟 3：查詢本店員工在「其他門市」填寫的 support_staff_bonus ===
    // 例：FK0557 屬中興店，新欣店也填了 FK0557 $1000 → 在中興店 PDF 也顯示，標注來源
    if (homeCodeSet.size > 0) {
      const homeCodes = Array.from(homeCodeSet);
      const { data: crossData } = await supabase
        .from('support_staff_bonus')
        .select('employee_code, employee_name, bonus_amount, store_id, stores(store_code, store_name)')
        .eq('year_month', year_month)
        .in('employee_code', homeCodes)
        .neq('store_id', store_id)
        .gt('bonus_amount', 0);

      // 建立來源門市的歷史代碼映射
      const crossStoreIds = Array.from(new Set((crossData || []).map((s: any) => s.store_id).filter(Boolean)));
      const crossCodeMap = crossStoreIds.length
        ? await buildHistoricalStoreCodeMap(supabase, crossStoreIds, year_month)
        : {};

      for (const item of (crossData || [])) {
        const storeInfo = item.stores as any;
        const historicalCode = crossCodeMap[item.store_id] || storeInfo?.store_code || '';
        const sourceNote = storeInfo
          ? `來源：${historicalCode} ${storeInfo.store_name}`
          : '來源：其他門市';
        const row = getRow(item.employee_code, item.employee_name);
        row.single_item_bonus += item.bonus_amount || 0;
        pushUnique(
          row.single_item_bonus_details,
          storeInfo
            ? `${historicalCode} ${storeInfo.store_name}：NT$${(item.bonus_amount || 0).toLocaleString()}`
            : `其他門市：NT$${(item.bonus_amount || 0).toLocaleString()}`
        );
        pushUnique(row.source_notes, sourceNote);
      }
    }

    // === 步驟 4：交通費用 ===
    const { data: transportData } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, monthly_transport_expense, transport_expense_notes')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('monthly_transport_expense', 'is', null)
      .gt('monthly_transport_expense', 0)
      .order('employee_code');

    for (const item of (transportData || [])) {
      const row = getRow(item.employee_code, item.employee_name);
      row.transport_expense += item.monthly_transport_expense || 0;
      pushUnique(row.transport_notes, item.transport_expense_notes);
    }

    // === 步驟 5：育才津貼 ===
    const { data: talentData } = await supabase
      .from('talent_cultivation_bonus')
      .select('employee_code, employee_name, cultivation_bonus, cultivation_target')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .gt('cultivation_bonus', 0)
      .order('employee_code');

    for (const item of (talentData || [])) {
      const row = getRow(item.employee_code, item.employee_name);
      row.talent_cultivation_bonus += item.cultivation_bonus || 0;
      pushUnique(row.talent_cultivation_targets, item.cultivation_target);
    }

    // === 步驟 6：春節出勤獎金 ===
    const { data: springFestivalData } = await supabase
      .from('spring_festival_bonus')
      .select('employee_code, employee_name, attendance_date, category, bonus_amount')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .gt('bonus_amount', 0)
      .order('attendance_date')
      .order('employee_code');

    for (const item of (springFestivalData || [])) {
      const row = getRow(item.employee_code, item.employee_name);
      row.spring_festival_bonus += item.bonus_amount || 0;
      const attendanceDate = item.attendance_date
        ? new Date(item.attendance_date).toLocaleDateString('zh-TW')
        : '';
      pushUnique(row.spring_festival_details, `${attendanceDate} ${item.category}`.trim());
    }

    // === 步驟 7：誤餐費 ===
    const { data: mealAllowanceData } = await supabase
      .from('meal_allowance_records')
      .select('employee_code, employee_name, record_date, meal_period, work_hours, employee_type')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .order('record_date')
      .order('employee_code');

    for (const item of (mealAllowanceData || [])) {
      const row = getRow(item.employee_code, item.employee_name);
      const amount = item.employee_type === '藥師' ? 200 : 100;
      row.meal_allowance_amount += amount;
      const detail = [item.record_date, item.meal_period, item.work_hours, `${item.employee_type}:${amount}元`]
        .filter(Boolean)
        .join(' ');
      pushUnique(row.meal_allowance_details, detail);
    }

    const allStaff = Array.from(reportMap.values())
      .filter(item =>
        item.single_item_bonus > 0 ||
        item.meal_allowance_amount > 0 ||
        item.transport_expense > 0 ||
        item.talent_cultivation_bonus > 0 ||
        item.spring_festival_bonus > 0
      )
      .sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));

    const visibleColumns = {
      single_item_bonus: allStaff.some(item => item.single_item_bonus > 0),
      meal_allowance: allStaff.some(item => item.meal_allowance_amount > 0),
      transport_expense: allStaff.some(item => item.transport_expense > 0),
      talent_cultivation_bonus: allStaff.some(item => item.talent_cultivation_bonus > 0),
      spring_festival_bonus: allStaff.some(item => item.spring_festival_bonus > 0)
    };

    if (allStaff.length === 0) {
      return NextResponse.json({ error: '該月沒有可匯出的獎金或津貼資料' }, { status: 404 });
    }

    // 返回 JSON 資料（包含門市資訊）
    return NextResponse.json({
      store_code: historicalMainCode,
      store_name: store.store_name,
      staff: allStaff,
      visible_columns: visibleColumns
    });

  } catch (error) {
    console.error('Error exporting bonus data:', error);
    return NextResponse.json(
      { error: '匯出失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}
