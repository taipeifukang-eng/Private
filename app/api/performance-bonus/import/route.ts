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

function getNumOptional(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      const n = parseFloat(String(v).replace(/,/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return undefined;
}

function isNonZeroNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && value !== 0;
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

function normalizeStoreCode(code: string): string {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getStoreCodeBase(code: string): string {
  const normalized = normalizeStoreCode(code);
  const m = normalized.match(/^\d+/);
  return m ? m[0] : normalized;
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

const BONUS_VALUE_FIELDS = [
  'group_bonus',
  'hr_subsidy_bonus',
  'single_item_bonus',
  'inventory_diff_penalty',
  'talent_bonus',
  'transport_fee',
  'inventory_bonus',
  'rx_incentive_bonus',
  'quarterly_makeup_bonus',
  'meal_allowance',
  'spring_festival_bonus',
  'pharmacist_guarantee',
  'owner_rx_makeup',
  'sales_competition_bonus',
  'owner_signing_bonus',
] as const;

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
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] [POST /api/performance-bonus/import] Started`);
  
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

    console.log(`[${Date.now() - startTime}ms] Auth verified`);

    const formData = await request.formData();
    const file       = formData.get('file') as File | null;
    const fallbackYear    = (formData.get('year')     as string) || String(new Date().getFullYear());
    const fallbackStoreId = (formData.get('store_id') as string) || '';

    if (!file) return NextResponse.json({ success: false, error: '缺少檔案' }, { status: 400 });

    console.log(`[${Date.now() - startTime}ms] File received: ${file.name}, size: ${file.size} bytes`);

    // 讀取 Excel
    console.log(`[${Date.now() - startTime}ms] Reading Excel file...`);
    const buffer   = await file.arrayBuffer();
    console.log(`[${Date.now() - startTime}ms] Buffer created, parsing workbook...`);
    
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    console.log(`[${Date.now() - startTime}ms] Workbook parsed, sheet names: ${workbook.SheetNames.join(', ')}`);
    
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    console.log(`[${Date.now() - startTime}ms] Converting sheet to JSON...`);
    
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    console.log(`[${Date.now() - startTime}ms] Sheet converted, ${rows.length} rows found`);
    
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Excel 無資料' }, { status: 400 });

    // 診斷：輸出實際的 Excel 欄位名
    const firstRow = rows[0];
    const actualKeys = Object.keys(firstRow);
    console.log(`[${Date.now() - startTime}ms] [Excel Column Keys] ${actualKeys.join(', ')}`);

    const admin = createAdminClient();

    // 載入所有門市代號對照
    console.log(`[${Date.now() - startTime}ms] Loading store mappings...`);
    const { data: storeList } = await admin
      .from('stores')
      .select('id, store_code')
      .eq('is_active', true);
    const storeCodeMap: Record<string, string> = {};
    const storeCodeBaseMap: Record<string, { id: string; code: string }[]> = {};
    (storeList || []).forEach(s => {
      const normalized = normalizeStoreCode(s.store_code);
      const base = getStoreCodeBase(normalized);
      storeCodeMap[normalized] = s.id;
      if (!storeCodeBaseMap[base]) storeCodeBaseMap[base] = [];
      storeCodeBaseMap[base].push({ id: s.id, code: normalized });
    });

    // 固定排序，確保前綴比對在多候選時有一致結果
    Object.keys(storeCodeBaseMap).forEach(base => {
      storeCodeBaseMap[base].sort((a, b) => a.code.localeCompare(b.code, 'en'));
    });
    console.log(`[${Date.now() - startTime}ms] Store mappings loaded: ${storeList?.length || 0} stores`);

    const upserts: Record<string, any>[] = [];
    const errors: string[] = [];
    const conflicts: string[] = [];

    console.log(`[${Date.now() - startTime}ms] Processing rows...`);
    let processedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const rowLabel = `第 ${i + 2} 列`;

      // ── 員編 ──
      const employeeCode = getStr(row, COL.employee_code);
      if (!employeeCode) { errors.push(`${rowLabel}：缺少員編`); continue; }
      
      // 🔍 DEBUG: 追踪 FK0278
      const isTrackedEmployee = employeeCode.toUpperCase() === 'FK0278';
      if (isTrackedEmployee) {
        console.log(`[${Date.now() - startTime}ms] [FK0278 DEBUG] 正在处理 FK0278，行号=${i + 2}，行数据=${JSON.stringify(row)}`);
      }

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
        if (isTrackedEmployee) {
          console.warn(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ❌ 年月份解析失败: rawMonth="${getStr(row, COL.month)}", rawYear="${getStr(row, COL.year) || fallbackYear}"`);
        }
        continue; 
      }
      
      if (isTrackedEmployee) {
        console.log(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ✓ 年月份=${yearMonth}`);
      }

      // ── 門市 ──
      const rawCode = getStr(row, COL.store_code);
      let storeId = fallbackStoreId;
      if (rawCode) {
        const normalizedRawCode = normalizeStoreCode(rawCode);

        // 1) 先精準匹配（例：0015B -> 0015B）
        let found = storeCodeMap[normalizedRawCode];

        // 2) 再做前綴/基礎碼匹配（例：0015 -> 0015B/0015C/0015D）
        if (!found) {
          const base = getStoreCodeBase(normalizedRawCode);
          const candidates = storeCodeBaseMap[base] || [];
          if (candidates.length > 0) {
            found = candidates[0].id;
            if (candidates.length > 1) {
              console.warn(
                `[Store code prefix match] ${rawCode} matched multiple stores: ${candidates.map(c => c.code).join(', ')}; using ${candidates[0].code}`
              );
            }
          }
        }

        if (!found) { 
          errors.push(`${rowLabel}：找不到門市代號 "${rawCode}"（${employeeCode}）`); 
          if (isTrackedEmployee) {
            console.warn(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ❌ 找不到门市: rawCode="${rawCode}"`);
          }
          continue; 
        }
        storeId = found;
        
        if (isTrackedEmployee) {
          console.log(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ✓ 门市=${rawCode} -> storeId=${storeId}`);
        }
      }
      if (!storeId) { 
        errors.push(`${rowLabel}：缺少門市（${employeeCode}）`); 
        if (isTrackedEmployee) {
          console.warn(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ❌ 缺少门市信息`);
        }
        continue; 
      }

      const upsertRecord = {
        store_id:               storeId,
        year_month:             yearMonth,
        employee_code:          employeeCode,
        employee_name:          getStr(row, COL.employee_name) || undefined,
        group_bonus:            getNumOptional(row, COL.group_bonus),
        hr_subsidy_bonus:       getNumOptional(row, COL.hr_subsidy_bonus),
        single_item_bonus:      getNumOptional(row, COL.single_item_bonus),
        inventory_diff_penalty: getNumOptional(row, COL.inventory_diff_penalty),
        talent_bonus:           getNumOptional(row, COL.talent_bonus),
        transport_fee:          getNumOptional(row, COL.transport_fee),
        inventory_bonus:        getNumOptional(row, COL.inventory_bonus),
        rx_incentive_bonus:     getNumOptional(row, COL.rx_incentive_bonus),
        quarterly_makeup_bonus: getNumOptional(row, COL.quarterly_makeup_bonus),
        meal_allowance:         getNumOptional(row, COL.meal_allowance),
        spring_festival_bonus:  getNumOptional(row, COL.spring_festival_bonus),
        pharmacist_guarantee:   getNumOptional(row, COL.pharmacist_guarantee),
        owner_rx_makeup:        getNumOptional(row, COL.owner_rx_makeup),
        sales_competition_bonus:getNumOptional(row, COL.sales_competition_bonus),
        owner_signing_bonus:    getNumOptional(row, COL.owner_signing_bonus),
        __rowLabel:             rowLabel,
        __rawStoreCode:         rawCode,
      };
      
      // 🔍 DEBUG: 输出FK0278的最终upsert记录
      if (isTrackedEmployee) {
        console.log(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ✓ 最终upsert记录:`, upsertRecord);
      }
      
      upserts.push(upsertRecord);

      processedCount++;
      if (processedCount % 50 === 0) {
        console.log(`[${Date.now() - startTime}ms] Processed ${processedCount} rows...`);
      }
    }

    console.log(`[${Date.now() - startTime}ms] Row processing complete: ${upserts.length} valid records, ${errors.length} errors`);
    
    // 🔍 DEBUG: 检查FK0278是否在upserts中
    const fk0278InUpserts = upserts.find(r => r.employee_code?.toUpperCase() === 'FK0278');
    if (fk0278InUpserts) {
      console.log(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ✓ FK0278 在 upserts 中:`, fk0278InUpserts);
    } else {
      console.warn(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ❌ FK0278 不在 upserts 中!`);
    }

    if (upserts.length === 0) {
      return NextResponse.json({ success: false, error: `沒有可匯入的資料。${errors.length > 0 ? '錯誤：' + errors.join('；') : ''}` });
    }

    console.log(`[${Date.now() - startTime}ms] Preparing deduplicated upsert payload...`);

    // 去重：相同 store_id + year_month + employee_code 視為同一筆
    // 不同門市的相同員工保持獨立記錄（key 包含 store_id）。
    // 同一 key 出現多列時：
    //   - 0 視為 Excel 佔位值，不覆蓋既有非 0 值
    //   - 非 0 可以覆蓋 undefined / 0
    //   - 同一欄位若出現兩個非 0 值，視為來源資料衝突，整批匯入失敗
    const dedupMap = new Map<string, Record<string, any>>();
    for (const r of upserts) {
      const key = `${r.store_id}|${r.year_month}|${r.employee_code}`;
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, { ...r });
      } else {
        for (const field of BONUS_VALUE_FIELDS) {
          const incomingVal = r[field];
          if (incomingVal === undefined) continue;

          const existingVal = existing[field];

          if (isNonZeroNumber(existingVal) && isNonZeroNumber(incomingVal)) {
            conflicts.push(
              `${r.__rowLabel}：員編 ${r.employee_code}、年月 ${r.year_month}、門市 ${r.__rawStoreCode || r.store_id} 的「${field}」重複出現非 0 值（${existingVal} vs ${incomingVal})`
            );
            continue;
          }

          if (isNonZeroNumber(existingVal) && incomingVal === 0) {
            continue;
          }

          if ((existingVal === undefined || existingVal === 0) && incomingVal !== undefined) {
            existing[field] = incomingVal;
          }
        }
        if (r.employee_name) existing.employee_name = r.employee_name;
      }
    }
    const dedupedUpserts = Array.from(dedupMap.values());

    if (conflicts.length > 0) {
      return NextResponse.json({
        success: false,
        error: '匯入資料存在同月、同門市、同員編、同獎金欄位的重複非 0 值衝突',
        conflicts,
      }, { status: 400 });
    }

    console.log(
      `[${Date.now() - startTime}ms] Upserting ${dedupedUpserts.length} records (raw: ${upserts.length}, deduped: ${dedupedUpserts.length})...`
    );

    // 讀取既有資料，做「欄位合併更新」：新檔案未提供的欄位保留舊值
    const uniqueStoreIds = Array.from(new Set(dedupedUpserts.map(r => r.store_id)));
    const uniqueYearMonths = Array.from(new Set(dedupedUpserts.map(r => r.year_month)));
    const uniqueEmployeeCodes = Array.from(new Set(dedupedUpserts.map(r => r.employee_code)));

    const { data: existingRows, error: existingError } = await admin
      .from('monthly_bonus_records')
      .select(`
        store_id,
        year_month,
        employee_code,
        employee_name,
        group_bonus,
        hr_subsidy_bonus,
        single_item_bonus,
        inventory_diff_penalty,
        talent_bonus,
        transport_fee,
        inventory_bonus,
        rx_incentive_bonus,
        quarterly_makeup_bonus,
        meal_allowance,
        spring_festival_bonus,
        pharmacist_guarantee,
        owner_rx_makeup,
        sales_competition_bonus,
        owner_signing_bonus
      `)
      .in('store_id', uniqueStoreIds)
      .in('year_month', uniqueYearMonths)
      .in('employee_code', uniqueEmployeeCodes);

    if (existingError) {
      console.error(`[${Date.now() - startTime}ms] [Load existing error] ${existingError.message}`);
      return NextResponse.json({ success: false, error: '讀取既有資料失敗：' + existingError.message }, { status: 500 });
    }

    const existingMap = new Map<string, Record<string, any>>();
    (existingRows || []).forEach(r => {
      const key = `${r.store_id}|${r.year_month}|${r.employee_code}`;
      existingMap.set(key, r as Record<string, any>);
    });

    const mergedUpserts = dedupedUpserts.map(r => {
      const key = `${r.store_id}|${r.year_month}|${r.employee_code}`;
      const old = existingMap.get(key);
      const merged: Record<string, any> = {
        store_id: r.store_id,
        year_month: r.year_month,
        employee_code: r.employee_code,
        employee_name: r.employee_name ?? old?.employee_name ?? null,
      };

      BONUS_VALUE_FIELDS.forEach(field => {
        const incoming = r[field];
        if (incoming === undefined) {
          merged[field] = old?.[field] ?? 0;
        } else {
          merged[field] = incoming;
        }
      });

      return merged;
    });
    
    // 🔍 DEBUG: 检查FK0278在merged中是否存在
    const fk0278InMerged = mergedUpserts.find(r => r.employee_code?.toUpperCase() === 'FK0278');
    if (fk0278InMerged) {
      console.log(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ✓ FK0278 在 mergedUpserts 中:`, fk0278InMerged);
    } else {
      console.warn(`[${Date.now() - startTime}ms] [FK0278 DEBUG] ❌ FK0278 在 mergedUpserts 中消失了!`);
    }

    const { error: upsertError } = await admin
      .from('monthly_bonus_records')
      .upsert(mergedUpserts, { onConflict: 'store_id,year_month,employee_code' });

    if (upsertError) {
      console.error(`[${Date.now() - startTime}ms] [Upsert error] ${upsertError.message}`);
      return NextResponse.json({ success: false, error: '資料庫操作失敗：' + upsertError.message }, { status: 500 });
    }

    const successCount = mergedUpserts.length;
    console.log(`[${Date.now() - startTime}ms] Upsert success: ${successCount} records`);

    console.log(`[${Date.now() - startTime}ms] Total processing time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

    console.log(`[${Date.now() - startTime}ms] Upsert complete`);
    
    return NextResponse.json({
      success: true,
      imported: successCount,
      skipped: upserts.length - successCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: any) {
    console.error('[performance-bonus/import] Fatal error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
