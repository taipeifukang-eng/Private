import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

/**
 * GET /api/pharmacist-annual-master/sync?year=2026
 * 同步指定年度的藥師主檔（未關帳時）並回傳資料
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canView = await hasPermission(user.id, 'pharmacist.management.view');
  if (!canView) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: '無效的年度' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // 1. 檢查是否已關帳
  const { data: lockData } = await adminSupabase
    .from('pharmacist_annual_master_locks')
    .select('year, locked_at, locked_by')
    .eq('year', year)
    .single();

  const isLocked = !!lockData;

  // 2. 如果未關帳，判斷是否有新增人事異動再決定是否重跑同步
  if (!isLocked) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const todayStr = new Date().toISOString().slice(0, 10);
    const effectiveEnd = todayStr < yearEnd ? todayStr : yearEnd;

    // 查詢上次同步時間
    const { data: syncLog } = await adminSupabase
      .from('pharmacist_annual_master_sync_log')
      .select('last_synced_at')
      .eq('year', year)
      .single();

    const lastSyncedAt: string | null = syncLog?.last_synced_at ?? null;
    let needsSync = true;

    if (lastSyncedAt) {
      // 有同步記錄：只在 last_synced_at 後有新增人事異動時才重跑
      const { count } = await adminSupabase
        .from('employee_movement_history')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', lastSyncedAt)
        .in('movement_type', ['resignation', 'leave_without_pay', 'leave_of_absence', 'return_to_work', 'onboarding'])
        .gte('movement_date', yearStart)
        .lte('movement_date', effectiveEnd);

      needsSync = (count ?? 0) > 0;
    }

    if (needsSync) {
      await syncAnnualMaster(adminSupabase, year);
      // 更新（或初次寫入）同步時間
      await adminSupabase
        .from('pharmacist_annual_master_sync_log')
        .upsert({ year, last_synced_at: new Date().toISOString() }, { onConflict: 'year' });
    }
  }

  // 3. 查詢年度主檔資料
  const { data: masterData, error } = await adminSupabase
    .from('pharmacist_annual_master')
    .select(`
      id,
      year,
      employee_code,
      employee_name,
      status,
      status_date,
      join_date,
      resignation_date,
      current_store_id,
      current_position,
      source,
      notes,
      created_at,
      updated_at,
      stores:current_store_id(store_code, store_name)
    `)
    .eq('year', year)
    .order('status')
    .order('employee_code');

  if (error) {
    // 表不存在的情況
    if (error.code === '42P01' || error.code === 'PGRST204') {
      return NextResponse.json({ 
        error: '請先執行 migration_pharmacist_annual_master.sql 建立表結構',
        missing_table: true 
      }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 4. 查詢 pharmacist_profiles 補充資料
  const employeeCodes = (masterData || []).map((r: any) => r.employee_code).filter(Boolean);
  
  const { data: profilesData } = employeeCodes.length > 0
    ? await adminSupabase
        .from('pharmacist_profiles')
        .select('employee_code, school, education_level, is_responsible_pharmacist, license_renewal_date')
        .in('employee_code', employeeCodes)
    : { data: [] };

  const profileByCode = new Map<string, any>();
  (profilesData || []).forEach((p: any) => {
    if (p.employee_code) {
      profileByCode.set(p.employee_code.toUpperCase(), p);
    }
  });

  // 5. 查詢常年會費狀態
  const now = new Date();
  const currentFeeYear = now.getFullYear();
  
  const { data: annualFeeData } = employeeCodes.length > 0
    ? await adminSupabase
        .from('pharmacist_annual_fees')
        .select('employee_code, association_city, fee_year, fee_period_end')
        .in('employee_code', employeeCodes)
        .order('created_at', { ascending: false })
    : { data: [] };

  const feeByCode = new Map<string, any[]>();
  (annualFeeData || []).forEach((f: any) => {
    const code = (f.employee_code || '').toUpperCase();
    if (!code) return;
    const list = feeByCode.get(code) || [];
    list.push(f);
    feeByCode.set(code, list);
  });

  // 6. 計算常年會費藍底狀態
  const annualFeeBlueByCode = new Map<string, boolean>();
  employeeCodes.forEach((code: string) => {
    const records = feeByCode.get(code.toUpperCase()) || [];
    if (records.length === 0) {
      annualFeeBlueByCode.set(code.toUpperCase(), false);
      return;
    }

    const latest = records[0];
    const city = latest?.association_city || '';

    if (city === '基隆市') {
      const latestEnd = records.find((r: any) => r.fee_period_end)?.fee_period_end || null;
      if (!latestEnd) {
        annualFeeBlueByCode.set(code.toUpperCase(), false);
        return;
      }
      const endTs = new Date(`${latestEnd.slice(0, 10)}T23:59:59`).getTime();
      annualFeeBlueByCode.set(code.toUpperCase(), now.getTime() <= endTs);
      return;
    }

    const hasCurrentYearRecord = records.some((r: any) => r.fee_year === currentFeeYear);
    annualFeeBlueByCode.set(code.toUpperCase(), hasCurrentYearRecord);
  });

  // 7. 組合回傳資料
  const rows = (masterData || []).map((r: any) => {
    const code = (r.employee_code || '').toUpperCase();
    const profile = profileByCode.get(code) || {};
    const storeInfo = r.stores || {};

    return {
      employee_code: r.employee_code,
      employee_name: r.employee_name || '',
      status: r.status,
      status_date: r.status_date,
      join_date: r.join_date,
      resignation_date: r.resignation_date,
      current_position: r.current_position || '-',
      store_code: storeInfo.store_code || '',
      store_name: storeInfo.store_name || '',
      source: r.source,
      notes: r.notes,
      // 從 pharmacist_profiles 補充
      school: profile.school || '',
      education_level: profile.education_level || '',
      is_responsible_pharmacist: profile.is_responsible_pharmacist ?? false,
      license_renewal_date: profile.license_renewal_date || null,
      // 常年會費狀態
      annual_fee_is_blue: annualFeeBlueByCode.get(code) ?? false,
      // 轉換狀態為 is_active（相容舊介面）
      is_active: r.status === 'active',
      start_date: r.join_date,
    };
  });

  return NextResponse.json({
    year,
    isLocked,
    lockInfo: lockData || null,
    data: rows,
    syncedAt: isLocked ? null : new Date().toISOString(),
  });
}

/**
 * 同步年度主檔：
 * 1. 新入職的藥師 => INSERT
 * 2. 已存在的人有狀態異動 => 只 UPDATE 狀態欄位（不動姓名、到職日）
 * 3. 檢查年度開始前已離職的人 => 更新狀態為離職
 */
async function syncAnnualMaster(adminSupabase: any, year: number) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const today = new Date().toISOString().slice(0, 10);
  const effectiveEnd = today < yearEnd ? today : yearEnd;

  // 1. 取得該年度所有人事異動
  const { data: movements } = await adminSupabase
    .from('employee_movement_history')
    .select('employee_code, employee_name, store_id, movement_type, movement_date, onboarding_is_pharmacist')
    .gte('movement_date', yearStart)
    .lte('movement_date', effectiveEnd)
    .order('movement_date', { ascending: true });

  // 2. 取得年度開始前的最近離職/復職記錄（處理跨年離職）
  const { data: priorMovements } = await adminSupabase
    .from('employee_movement_history')
    .select('employee_code, movement_type, movement_date')
    .lt('movement_date', yearStart)
    .in('movement_type', ['resignation', 'return_to_work', 'onboarding'])
    .order('movement_date', { ascending: false });

  // 整理年度前的最新狀態（按員編）
  const priorStatusByCode = new Map<string, { type: string; date: string }>();
  (priorMovements || []).forEach((m: any) => {
    const code = (m.employee_code || '').toUpperCase();
    if (!code) return;
    // 只保留第一筆（最新的）
    if (!priorStatusByCode.has(code)) {
      priorStatusByCode.set(code, { type: m.movement_type, date: m.movement_date });
    }
  });

  // 3. 整理本年度異動資料
  const movementsByCode = new Map<string, any[]>();
  const newPharmacistCodes = new Set<string>(); // 新入職的藥師

  (movements || []).forEach((m: any) => {
    const code = (m.employee_code || '').toUpperCase();
    if (!code) return;

    const list = movementsByCode.get(code) || [];
    list.push(m);
    movementsByCode.set(code, list);

    // 入職且為藥師 => 可能是新藥師
    if (m.movement_type === 'onboarding' && m.onboarding_is_pharmacist) {
      newPharmacistCodes.add(code);
    }
  });

  // 3. 取得現有年度主檔資料
  const { data: existingMaster } = await adminSupabase
    .from('pharmacist_annual_master')
    .select('employee_code, status, status_date, resignation_date')
    .eq('year', year);

  const existingCodes = new Set<string>();
  (existingMaster || []).forEach((r: any) => {
    if (r.employee_code) {
      existingCodes.add(r.employee_code.toUpperCase());
    }
  });

  // 4. 處理新入職的藥師（INSERT）
  const insertPayload: any[] = [];
  for (const code of Array.from(newPharmacistCodes)) {
    if (existingCodes.has(code)) continue; // 已存在，跳過

    const codeMovements = movementsByCode.get(code) || [];
    const onboarding = codeMovements.find(
      (m: any) => m.movement_type === 'onboarding' && m.onboarding_is_pharmacist
    );
    if (!onboarding) continue;

    insertPayload.push({
      year,
      employee_code: code,
      employee_name: onboarding.employee_name || null,
      status: 'active',
      join_date: onboarding.movement_date || null,
      current_store_id: onboarding.store_id || null,
      current_position: '藥師',
      source: 'onboarding',
      notes: `新增於 ${today}`,
    });
  }

  if (insertPayload.length > 0) {
    await adminSupabase
      .from('pharmacist_annual_master')
      .insert(insertPayload);
  }

  // 5. 處理現有人員的狀態異動（只 UPDATE 狀態欄位）
  for (const code of Array.from(existingCodes)) {
    const codeMovements = movementsByCode.get(code);
    if (!codeMovements || codeMovements.length === 0) continue; // 沒有異動，跳過

    // 找狀態相關的異動
    let latestResignation: any = null;
    let latestSuspension: any = null;
    let latestReturn: any = null;

    for (const m of codeMovements) {
      if (m.movement_type === 'resignation') {
        if (!latestResignation || m.movement_date > latestResignation.movement_date) {
          latestResignation = m;
        }
      } else if (m.movement_type === 'leave_without_pay') {
        if (!latestSuspension || m.movement_date > latestSuspension.movement_date) {
          latestSuspension = m;
        }
      } else if (m.movement_type === 'return_to_work') {
        if (!latestReturn || m.movement_date > latestReturn.movement_date) {
          latestReturn = m;
        }
      }
    }

    // 沒有狀態異動，跳過
    if (!latestResignation && !latestSuspension && !latestReturn) continue;

    // 決定新狀態
    const resignDate = latestResignation?.movement_date || '';
    const suspendDate = latestSuspension?.movement_date || '';
    const returnDate = latestReturn?.movement_date || '';

    let newStatus = 'active';
    let statusDate: string | null = null;
    let resignationDate: string | null = null;

    if (returnDate && returnDate >= resignDate && returnDate >= suspendDate) {
      newStatus = 'active';
      statusDate = returnDate;
    } else if (suspendDate && suspendDate >= resignDate) {
      newStatus = 'suspended';
      statusDate = suspendDate;
    } else if (resignDate) {
      newStatus = 'resigned';
      statusDate = resignDate;
      resignationDate = resignDate;
    }

    // 只更新狀態欄位
    await adminSupabase
      .from('pharmacist_annual_master')
      .update({
        status: newStatus,
        status_date: statusDate,
        resignation_date: resignationDate,
      })
      .eq('year', year)
      .eq('employee_code', code);
  }

  // 6. 處理年度開始前就已離職的人（沒有本年度異動的情況）
  for (const code of Array.from(existingCodes)) {
    // 如果本年度有異動，已經在上面處理過了
    if (movementsByCode.has(code)) continue;

    // 檢查年度前的最新狀態
    const priorStatus = priorStatusByCode.get(code);
    if (!priorStatus) continue;

    // 如果年度前最新狀態是離職，更新為離職
    if (priorStatus.type === 'resignation') {
      await adminSupabase
        .from('pharmacist_annual_master')
        .update({
          status: 'resigned',
          status_date: priorStatus.date,
          resignation_date: priorStatus.date,
        })
        .eq('year', year)
        .eq('employee_code', code);
    }
  }
}
