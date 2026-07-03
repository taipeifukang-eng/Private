import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

function normalizeStoreCode(raw: string): string {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getRaw(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== '') {
      return row[k];
    }
  }
  return null;
}

function getVal(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== '') {
      const v = parseFloat(String(row[k]).replace(/,/g, ''));
      return isNaN(v) ? null : v;
    }
  }
  return null;
}

function getStr(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== '') return String(row[k]).trim();
  }
  return null;
}

function parseYearMonthCell(value: unknown): { year: number; month: number } | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m) {
      return { year: parsed.y, month: parsed.m };
    }
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth() + 1 };
  }

  const normalized = String(value)
    .trim()
    .replace(/年/g, '-')
    .replace(/月/g, '')
    .replace(/[/.]/g, '-');

  const match = normalized.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;

  return { year, month };
}

/**
 * POST /api/performance-data/import
 * 從 Excel 批次匯入業績資料
 *
 * Form data:
 *   file: .xlsx 檔案
 *   store_id: 門市 UUID（當 Excel 列未含門市代號時作為後備）
 *   year: 年份 (e.g. 2026)（當 Excel 列未含年份時作為後備）
 *
 * Excel 欄位 (第一列為標題):
 *   門市代號 | 年月份 | 月營業額目標 | 月營業額實際 | 系統月營業額 | 自費月藥營業額
 *   | 月毛利額目標 | 月實際毛利額 | 活動當日毛利 | 月真實毛利額 | 系統月毛利額 | 月長照毛利額
 *   | 處方加購回補月毛利額 | 小偷賠償回補月毛利 | Kamedis業績扣月毛利額
 *   | 月來客數目標 | 月實際來客數 | 上個月慢箋總張數目標 | 上個月慢箋總張數實際
 *
 *   ※ 門市代號、年月份、年份/月份皆可混用；營業天數建議提供。
 *      若該年月已有資料可沿用原營業天數，若無舊資料且未提供則該列略過。
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const fallbackStoreId = (formData.get('store_id') as string) || '';
    const fallbackYear   = (formData.get('year')     as string) || '';

    if (!file) {
      return NextResponse.json({ success: false, error: '缺少檔案' }, { status: 400 });
    }

    // 讀取 Excel
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Excel 無資料' }, { status: 400 });
    }

    // 預載所有門市代號 → UUID 對照表
    const { data: storeList } = await supabase
      .from('stores')
      .select('id, store_code');
    const storeCodeMap: Record<string, string> = {};
    const pureNumericStoreMap: Record<string, string[]> = {};
    const prefixStoreMap: Record<string, string[]> = {};
    const pushStoreCandidate = (map: Record<string, string[]>, key: string, storeId: string) => {
      if (!key) return;
      if (!map[key]) map[key] = [];
      if (!map[key].includes(storeId)) map[key].push(storeId);
    };
    (storeList || []).forEach(s => {
      const normalized = normalizeStoreCode(s.store_code);
      storeCodeMap[normalized] = s.id;

      if (/^\d+$/.test(normalized)) {
        const key = String(Number(normalized));
        if (!pureNumericStoreMap[key]) pureNumericStoreMap[key] = [];
        pureNumericStoreMap[key].push(s.id);
      }

      const numericPrefix = normalized.match(/^(\d+)/)?.[1];
      if (numericPrefix && numericPrefix !== normalized) {
        pushStoreCandidate(prefixStoreMap, numericPrefix, s.id);
        pushStoreCandidate(prefixStoreMap, String(Number(numericPrefix)), s.id);
      }
    });

    // 欄位映射
    const COL = {
      store_code:   ['門市代號', '分店代號', 'store_code'],
      year_month:   ['年月份', '年月', 'year_month'],
      year:         ['年份', 'year'],
      month:        ['月份', 'month'],
      business_days:['營業天數', '月營業天數'],
      gp_target:    ['月毛利額目標', '月毛利目標', '毛利目標'],
      rev_target:   ['月營業額目標', '營業額目標'],
      cc_target:    ['月來客數目標', '來客數目標'],
      rx_target:    ['上個月慢箋總張數目標', '上個月處方箋目標', '慢箋總張數目標', '處方箋目標'],
      gp_actual:    ['月實際毛利額', '月毛利實際', '毛利實際'],
      activity_day_gp: ['活動當日毛利', '當日活動毛利', '活動日毛利', '活動毛利'],
      rev_actual:   ['月營業額實際', '營業額實際'],
      cc_actual:    ['月實際來客數', '月來客數實際', '來客數實際'],
      rx_actual:    ['上個月慢箋總張數實際', '上個月處方箋實際', '慢箋總張數實際', '處方箋實際'],
      system_rev:   ['系統月營業額'],
      self_pay_rev: ['自費月藥營業額'],
      true_gp:      ['月真實毛利額'],
      system_gp:    ['系統月毛利額'],
      ltc_gp:       ['月長照毛利額'],
      rx_addon_gp:  ['處方加購回補月毛利額', '月處方加購回補月毛利額'],
      theft_gp:     ['小偷賠償回補月毛利'],
      kamedis_gp:   ['Kamedis業績扣月毛利額'],
    };

    const draftRecords = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // 決定門市
      const rowStoreCode = getStr(row, COL.store_code);
      let storeId = fallbackStoreId;
      if (rowStoreCode) {
        const normalizedRowStoreCode = normalizeStoreCode(rowStoreCode);
        let found = storeCodeMap[normalizedRowStoreCode];

        // Excel 常把 0003 讀成 3，數字門市代號時以純數字比對回填。
        if (!found && /^\d+(\.0+)?$/.test(normalizedRowStoreCode)) {
          const numericKey = String(Number(normalizedRowStoreCode));
          const candidates = pureNumericStoreMap[numericKey] || [];
          if (candidates.length === 1) {
            found = candidates[0];
          } else if (candidates.length > 1) {
            errors.push(`第 ${i + 2} 列: 門市代號「${rowStoreCode}」比對到多個門市，請改為完整代號（含前導零）`);
            continue;
          }
        }

        if (!found && /^\d+(\.0+)?$/.test(normalizedRowStoreCode)) {
          const numericKey = String(Number(normalizedRowStoreCode));
          const candidates = [
            ...(prefixStoreMap[normalizedRowStoreCode] || []),
            ...(prefixStoreMap[numericKey] || []),
          ].filter((id, index, arr) => arr.indexOf(id) === index);
          if (candidates.length === 1) {
            found = candidates[0];
          } else if (candidates.length > 1) {
            errors.push(`第 ${i + 2} 列: 門市代號「${rowStoreCode}」比對到多個含後綴門市，請改為完整代號（例如含 A/B）`);
            continue;
          }
        }

        if (!found) {
          errors.push(`第 ${i + 2} 列: 找不到門市代號「${rowStoreCode}」，跳過`);
          continue;
        }
        storeId = found;
      }
      if (!storeId) {
        errors.push(`第 ${i + 2} 列: 未指定門市，跳過（請在 Excel 加入「門市代號」欄或選擇門市）`);
        continue;
      }

      // 決定年份
      const rowYearMonth = parseYearMonthCell(getRaw(row, COL.year_month));
      const rowYearRaw = getVal(row, COL.year);
      const yearNum = rowYearMonth?.year ?? (rowYearRaw ? Math.round(rowYearRaw) : parseInt(fallbackYear));
      const monthRaw = getVal(row, COL.month);
      const month = rowYearMonth?.month ?? (monthRaw ? Math.round(monthRaw) : NaN);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        errors.push(`第 ${i + 2} 列: 年份無效，跳過（請在 Excel 加入「年月份」或「年份」欄，或選擇年份）`);
        continue;
      }
      if (isNaN(month) || month < 1 || month > 12) {
        errors.push(`第 ${i + 2} 列: 月份無效，跳過（請在 Excel 加入「年月份」或「月份」欄）`);
        continue;
      }

      draftRecords.push({
        store_id: storeId,
        year: yearNum,
        month,
        business_days: getVal(row, COL.business_days),
        monthly_gross_profit_target:    getVal(row, COL.gp_target),
        monthly_revenue_target:         getVal(row, COL.rev_target),
        monthly_customer_count_target:  getVal(row, COL.cc_target),
        last_month_rx_target:           getVal(row, COL.rx_target),
        monthly_gross_profit_actual:    getVal(row, COL.gp_actual),
        activity_day_gross_profit:      getVal(row, COL.activity_day_gp),
        monthly_revenue_actual:         getVal(row, COL.rev_actual),
        monthly_customer_count_actual:  getVal(row, COL.cc_actual),
        last_month_rx_actual:           getVal(row, COL.rx_actual),
        system_monthly_revenue:         getVal(row, COL.system_rev),
        self_pay_monthly_revenue:       getVal(row, COL.self_pay_rev),
        monthly_true_gross_profit:      getVal(row, COL.true_gp),
        system_monthly_gross_profit:    getVal(row, COL.system_gp),
        monthly_long_term_care_gross_profit: getVal(row, COL.ltc_gp),
        monthly_rx_addon_makeup_gross_profit: getVal(row, COL.rx_addon_gp),
        monthly_theft_compensation_makeup_gross_profit: getVal(row, COL.theft_gp),
        monthly_kamedis_deduction_gross_profit: getVal(row, COL.kamedis_gp),
        created_by: user.id,
        updated_at: new Date().toISOString(),
      });
    }

    if (draftRecords.length === 0) {
      return NextResponse.json({ success: false, error: '沒有可匯入的有效資料', errors }, { status: 400 });
    }

    const storeIds = Array.from(new Set(draftRecords.map(r => r.store_id)));
    const years = Array.from(new Set(draftRecords.map(r => r.year)));
    const months = Array.from(new Set(draftRecords.map(r => r.month)));

    const { data: existingRows, error: existingError } = await supabase
      .from('store_performance')
      .select('store_id, year, month, business_days')
      .in('store_id', storeIds)
      .in('year', years)
      .in('month', months);

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message, errors }, { status: 500 });
    }

    const existingMap = new Map<string, any>();
    (existingRows || []).forEach((row: any) => {
      existingMap.set(`${row.store_id}-${row.year}-${row.month}`, row);
    });

    const records: Record<string, any>[] = [];
    draftRecords.forEach(record => {
      const existing = existingMap.get(`${record.store_id}-${record.year}-${record.month}`);
      const resolvedBusinessDays = record.business_days
        ? Math.round(record.business_days)
        : existing?.business_days;

      if (!resolvedBusinessDays) {
        errors.push(`第 ${record.month} 月（${record.year}）: 缺少營業天數且無既有資料可沿用，跳過`);
        return;
      }

      records.push({
        ...record,
        business_days: resolvedBusinessDays,
      });
    });

    if (records.length === 0) {
      const brief = errors.slice(0, 5).join('；');
      const tail = errors.length > 5 ? `；...另有 ${errors.length - 5} 筆` : '';
      return NextResponse.json({ success: false, error: `沒有可匯入的有效資料：${brief}${tail}`, errors }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('store_performance')
      .upsert(records, { onConflict: 'store_id,year,month' })
      .select();

    if (error) {
      return NextResponse.json({ success: false, error: error.message, errors }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imported: data?.length ?? 0,
      skipped: rows.length - records.length,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
