import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';
import { hasPermission } from '@/lib/permissions/check';

function getStr(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function getNum(row: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      const n = parseFloat(String(v).replace(/,/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

// 智能解析月份（支援 "1", "01", "1月", "一月" 等格式）
function parseMonth(monthStr: string): number | null {
  if (!monthStr) return null;
  const trimmed = monthStr.trim();
  
  // 移除 "月" 字
  let cleaned = trimmed.replace(/月/g, '');
  
  // 支援中文數字
  const chineseToNum: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12
  };
  
  if (chineseToNum[cleaned]) {
    return chineseToNum[cleaned];
  }
  
  // 嘗試解析為數字
  const num = parseInt(cleaned);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return num;
  }
  
  return null;
}

// Excel 欄位名稱對照（支援中英文）
const COL = {
  store_code:             ['門市代號', '分店代號', 'store_code'],
  year_month:             ['年月', '年月份', 'year_month'],
  month:                  ['月份', 'month'],
  year:                   ['年份', 'year'],
  employee_code:          ['員編', '員工代號', 'employee_code'],
  employee_name:          ['姓名', '員工姓名', 'employee_name'],
  group_bonus:            ['團體獎金'],
  hr_subsidy_bonus:       ['人力補貼團體獎金', '人力補貼'],
  single_item_bonus:      ['單品獎金'],
  inventory_diff_penalty: ['盤點盤差承擔金額', '盤差承擔'],
  talent_bonus:           ['育才獎金'],
  transport_fee:          ['交通費'],
  inventory_bonus:        ['盤點獎金'],
  rx_incentive_bonus:     ['處方激勵獎金', '處方激勵'],
  quarterly_makeup_bonus: ['季回補獎金', '季回補'],
  meal_allowance:         ['誤餐費'],
  spring_festival_bonus:  ['春節出勤獎金', '春節獎金'],
  pharmacist_guarantee:   ['藥師保證金'],
  owner_rx_makeup:        ['負責人處方回補獎金', '負責人處方回補'],
  sales_competition_bonus:['銷售競賽獎金', '競賽獎金'],
  owner_signing_bonus:    ['負責人簽約金'],
};

/**
 * POST /api/performance-bonus/import
 * Excel 匯入每月獎金資料
 *
 * Form data:
 *   file     : .xlsx 檔案
 *   year     : 後備年份 (e.g. '2026')
 *   store_id : 後備門市 UUID
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    // RBAC: 匯入每月獎金（admin 保底放行）
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      const canImport = await hasPermission(user.id, 'performance.bonus.import');
      if (!canImport) {
        return NextResponse.json({ error: '無匯入權限' }, { status: 403 });
      }
    }

    const formData = await request.formData();
    const file       = formData.get('file') as File | null;
    const fallbackYear    = (formData.get('year')     as string) || String(new Date().getFullYear());
    const fallbackStoreId = (formData.get('store_id') as string) || '';

    if (!file) return NextResponse.json({ success: false, error: '缺少檔案' }, { status: 400 });

    // 讀取 Excel
    const buffer   = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Excel 無資料' }, { status: 400 });

    // 診斷：輸出實際的 Excel 欄位名
    const firstRow = rows[0];
    const actualKeys = Object.keys(firstRow);
    console.log('[Excel Diagnosis] Actual column keys:', actualKeys);
    console.log('[Excel Diagnosis] First row data:', firstRow);

    const admin = createAdminClient();

    // 載入所有門市代號對照
    const { data: storeList } = await admin
      .from('stores')
      .select('id, store_code')
      .eq('is_active', true);
    const storeCodeMap: Record<string, string> = {};
    (storeList || []).forEach(s => { storeCodeMap[s.store_code.trim()] = s.id; });

    const upserts: Record<string, any>[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const rowLabel = `第 ${i + 2} 列`;

      // ── 員編 ──
      const employeeCode = getStr(row, COL.employee_code);
      if (!employeeCode) { errors.push(`${rowLabel}：缺少員編`); continue; }

      // ── 年月份 ──
      let yearMonth = '';
      const rawYearMonth = getStr(row, COL.year_month);
      if (rawYearMonth && /^\d{4}-\d{2}$/.test(rawYearMonth)) {
        yearMonth = rawYearMonth;
      } else {
        // 嘗試從月份欄位取值
        const rawMonth = getStr(row, COL.month);
        
        // 檢查月份欄位是否已經是 YYYY-MM 格式
        if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
          yearMonth = rawMonth;
        } else {
          // 如果月份欄位不是完整日期，則嘗試結合年份
          const rawYear = getStr(row, COL.year) || fallbackYear;
          const monthNum = parseMonth(rawMonth);
          if (monthNum) {
            yearMonth = `${rawYear}-${String(monthNum).padStart(2, '0')}`;
          }
        }
      }
      if (!yearMonth) { 
        errors.push(`${rowLabel}：無法解析年月。月份值="${getStr(row, COL.month)}"，年份值="${getStr(row, COL.year) || fallbackYear}"（${employeeCode}）`); 
        continue; 
      }

      // ── 門市 ──
      const rawCode = getStr(row, COL.store_code);
      let storeId = fallbackStoreId;
      if (rawCode) {
        const found = storeCodeMap[rawCode];
        if (!found) { errors.push(`${rowLabel}：找不到門市代號 "${rawCode}"（${employeeCode}）`); continue; }
        storeId = found;
      }
      if (!storeId) { errors.push(`${rowLabel}：缺少門市（${employeeCode}）`); continue; }

      upserts.push({
        store_id:               storeId,
        year_month:             yearMonth,
        employee_code:          employeeCode,
        employee_name:          getStr(row, COL.employee_name) || null,
        group_bonus:            getNum(row, COL.group_bonus),
        hr_subsidy_bonus:       getNum(row, COL.hr_subsidy_bonus),
        single_item_bonus:      getNum(row, COL.single_item_bonus),
        inventory_diff_penalty: getNum(row, COL.inventory_diff_penalty),
        talent_bonus:           getNum(row, COL.talent_bonus),
        transport_fee:          getNum(row, COL.transport_fee),
        inventory_bonus:        getNum(row, COL.inventory_bonus),
        rx_incentive_bonus:     getNum(row, COL.rx_incentive_bonus),
        quarterly_makeup_bonus: getNum(row, COL.quarterly_makeup_bonus),
        meal_allowance:         getNum(row, COL.meal_allowance),
        spring_festival_bonus:  getNum(row, COL.spring_festival_bonus),
        pharmacist_guarantee:   getNum(row, COL.pharmacist_guarantee),
        owner_rx_makeup:        getNum(row, COL.owner_rx_makeup),
        sales_competition_bonus:getNum(row, COL.sales_competition_bonus),
        owner_signing_bonus:    getNum(row, COL.owner_signing_bonus),
      });
    }

    if (upserts.length === 0) {
      return NextResponse.json({ success: false, error: `沒有可匯入的資料。${errors.length > 0 ? '錯誤：' + errors.join('；') : ''}` });
    }

    // Upsert（以 store_id, year_month, employee_code 為 key）
    const { error: upsertError } = await admin
      .from('monthly_bonus_records')
      .upsert(upserts, { onConflict: 'store_id,year_month,employee_code' });

    if (upsertError) return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      imported: upserts.length,
      skipped: rows.length - upserts.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: any) {
    console.error('[performance-bonus/import]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
