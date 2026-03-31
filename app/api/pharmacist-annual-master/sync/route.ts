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

  // 2. 如果未關帳，執行同步
  if (!isLocked) {
    await syncAnnualMaster(adminSupabase, year);
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
 * 同步年度主檔：從人事異動更新狀態（只更新有異動的人，不覆蓋已有資料）
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

  if (!movements || movements.length === 0) {
    return;
  }

  // 2. 收集有異動且需要處理的藥師員編
  const pharmacistCodesToProcess = new Set<string>();
  const movementsByCode = new Map<string, any[]>();

  (movements || []).forEach((m: any) => {
    const code = (m.employee_code || '').toUpperCase();
    if (!code) return;

    const list = movementsByCode.get(code) || [];
    list.push(m);
    movementsByCode.set(code, list);

    // 入職且為藥師 => 需要處理（可能是新增）
    if (m.movement_type === 'onboarding' && m.onboarding_is_pharmacist) {
      pharmacistCodesToProcess.add(code);
    }
  });

  // 3. 取得現有年度主檔資料（需要完整資料來保留欄位）
  const { data: existingMaster } = await adminSupabase
    .from('pharmacist_annual_master')
    .select('*')
    .eq('year', year);

  const existingByCode = new Map<string, any>();
  (existingMaster || []).forEach((r: any) => {
    if (r.employee_code) {
      existingByCode.set(r.employee_code.toUpperCase(), r);
      // 現有主檔中的人，如果有異動也需要處理
      if (movementsByCode.has(r.employee_code.toUpperCase())) {
        pharmacistCodesToProcess.add(r.employee_code.toUpperCase());
      }
    }
  });

  if (pharmacistCodesToProcess.size === 0) {
    return;
  }

  // 4. 只處理有異動的藥師
  const upsertPayload: any[] = [];
  const pharmacistCodesArray = Array.from(pharmacistCodesToProcess);

  for (const code of pharmacistCodesArray) {
    const codeMovements = movementsByCode.get(code) || [];
    const existing = existingByCode.get(code);
    
    // 按日期排序取得最新狀態
    const sorted = [...codeMovements].sort((a, b) => 
      (a.movement_date || '').localeCompare(b.movement_date || '')
    );

    // 找最新的各類異動
    let latestOnboarding: any = null;
    let latestResignation: any = null;
    let latestSuspension: any = null;
    let latestReturn: any = null;

    for (const m of sorted) {
      if (m.movement_type === 'onboarding' && m.onboarding_is_pharmacist) {
        latestOnboarding = m;
      } else if (m.movement_type === 'resignation') {
        latestResignation = m;
      } else if (m.movement_type === 'leave_without_pay') {
        latestSuspension = m;
      } else if (m.movement_type === 'return_to_work') {
        latestReturn = m;
      }
    }

    // 決定狀態
    let status = existing?.status || 'active';
    let statusDate: string | null = existing?.status_date || null;
    let resignationDate: string | null = existing?.resignation_date || null;

    const resignDate = latestResignation?.movement_date || '';
    const suspendDate = latestSuspension?.movement_date || '';
    const returnDate = latestReturn?.movement_date || '';

    // 只有實際有異動時才更新狀態
    if (returnDate || suspendDate || resignDate) {
      if (returnDate && returnDate >= resignDate && returnDate >= suspendDate) {
        status = 'active';
        statusDate = returnDate;
      } else if (suspendDate && suspendDate >= resignDate) {
        status = 'suspended';
        statusDate = suspendDate;
      } else if (resignDate) {
        status = 'resigned';
        statusDate = resignDate;
        resignationDate = resignDate;
      }
    }

    // 取得姓名和門市（優先使用異動資料，其次使用現有資料）
    const latestMovement = sorted[sorted.length - 1];
    const employeeName = latestOnboarding?.employee_name || latestMovement?.employee_name || existing?.employee_name || null;
    const storeId = latestMovement?.store_id || latestOnboarding?.store_id || existing?.current_store_id || null;
    const joinDate = latestOnboarding?.movement_date || existing?.join_date || null;

    upsertPayload.push({
      year,
      employee_code: code,
      // 不用 null 覆蓋已有資料
      employee_name: employeeName || existing?.employee_name || null,
      status,
      status_date: statusDate || existing?.status_date || null,
      join_date: joinDate || existing?.join_date || null,
      resignation_date: resignationDate,
      current_store_id: storeId || existing?.current_store_id || null,
      current_position: existing?.current_position || '藥師',
      source: latestOnboarding ? 'onboarding' : (existing?.source || 'movement'),
      notes: existing ? `同步更新於 ${today}` : `新增於 ${today}`,
    });
  }

  // 5. 批次 upsert（只更新有異動的人）
  if (upsertPayload.length > 0) {
    await adminSupabase
      .from('pharmacist_annual_master')
      .upsert(upsertPayload, { 
        onConflict: 'year,employee_code',
        ignoreDuplicates: false 
      });
  }
}
