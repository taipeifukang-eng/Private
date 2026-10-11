import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function getCell(row: Record<string, unknown>, aliases: string[]) {
  const header = Object.keys(row).find(key => aliases.includes(key.trim().toLowerCase()));
  return header ? row[header] : undefined;
}

function getText(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parseYearMonth(value: unknown, fallback: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = XLSX.SSF.parse_date_code(value);
    if (date?.y && date?.m) return `${date.y}-${String(date.m).padStart(2, '0')}`;
  }
  const raw = getText(value);
  if (!raw) return fallback;
  const normalized = raw
    .replace(/年/g, '-')
    .replace(/月/g, '')
    .replace(/[/.]/g, '-')
    .replace(/\s+/g, '');
  const match = normalized.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
}

function parseNumber(value: unknown, allowDecimal: boolean): number | null | undefined {
  const raw = getText(value).replace(/,/g, '');
  if (!raw) return null;
  const pattern = allowDecimal ? /^\d+(\.\d{1,4})?$/ : /^\d+$/;
  if (!pattern.test(raw)) return undefined;
  const number = Number(raw);
  if (!Number.isFinite(number) || number > (allowDecimal ? 99999999.9999 : 2147483647)) return undefined;
  return number;
}

function normalizeStoreCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function resolveStore(code: string, stores: Array<{ id: string; store_code: string; store_name: string }>) {
  const normalized = normalizeStoreCode(code);
  const exact = stores.find(store => normalizeStoreCode(store.store_code) === normalized);
  if (exact) return { store: exact };

  const codePrefix = normalized.match(/^(\d{3,4}[A-Z]?)/)?.[1];
  if (!codePrefix) return { error: `找不到或無權限的門市代號「${code}」` };

  const candidates = new Map<string, typeof stores[number]>();
  for (const store of stores) {
    const storeCode = normalizeStoreCode(store.store_code);
    const storeDigits = storeCode.match(/^\d+/)?.[0] || '';
    const prefixDigits = codePrefix.match(/^\d+/)?.[0] || '';
    const normalizedDigits = prefixDigits.length === 3 ? prefixDigits.padStart(4, '0') : prefixDigits;
    const storeBase = storeCode.replace(/[A-Z]+$/, '');
    const sameBase = storeBase === normalizedDigits || storeBase === prefixDigits;
    const sameExactPrefix = storeCode === codePrefix;
    if (sameBase || sameExactPrefix || storeDigits === normalizedDigits && storeCode === normalizedDigits) {
      candidates.set(store.id, store);
    }
  }

  if (candidates.size === 1) return { store: Array.from(candidates.values())[0] };
  if (candidates.size > 1) {
    return { error: `門市代號「${code}」對應多間門市，請使用完整門市代號：${Array.from(candidates.values()).map(store => store.store_code).join('、')}` };
  }
  return { error: `找不到或無權限的門市代號「${code}」` };
}

export async function POST(request: NextRequest) {
  try {
    const context = await getPrescriptionReportContext();
    if ('response' in context) return context.response;

    const canEdit = await hasPermission(context.user.id, 'performance.edit');
    if (!canEdit) return NextResponse.json({ error: '沒有匯入處方箋資料的權限' }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get('file');
    const selectedMonth = String(formData.get('year_month') || '');
    if (!(file instanceof File)) return NextResponse.json({ error: '請選擇 Excel 檔案' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: '檔案不可超過 10 MB' }, { status: 400 });
    if (!YEAR_MONTH_PATTERN.test(selectedMonth)) {
      return NextResponse.json({ error: '請先選擇正確的匯入年月' }, { status: 400 });
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return NextResponse.json({ error: 'Excel 檔案沒有工作表' }, { status: 400 });

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: true });
    if (rows.length === 0) return NextResponse.json({ error: 'Excel 工作表沒有資料' }, { status: 400 });

    const seenStores = new Set<string>();
    const errors: string[] = [];
    const payload: Record<string, unknown>[] = [];
    const updatedAt = new Date().toISOString();

    rows.forEach((row, index) => {
      if (Object.values(row).every(value => getText(value) === '')) return;
      const rowLabel = `第 ${index + 2} 列`;
      const rowMonth = parseYearMonth(getCell(row, ['年月', '年月份', 'year_month']), selectedMonth);
      if (!YEAR_MONTH_PATTERN.test(rowMonth)) {
        errors.push(`${rowLabel}：年月格式需為 YYYY-MM`);
        return;
      }
      if (rowMonth !== selectedMonth) {
        errors.push(`${rowLabel}：資料年月 ${rowMonth} 與目前選擇的 ${selectedMonth} 不同`);
        return;
      }

      const rawStoreCode = getText(getCell(row, ['門市代號', '分店代號', 'store_code']));
      if (!rawStoreCode) {
        errors.push(`${rowLabel}：缺少門市代號`);
        return;
      }
      const resolved = resolveStore(rawStoreCode, context.stores);
      if (!resolved.store) {
        errors.push(`${rowLabel}：${resolved.error}`);
        return;
      }
      if (seenStores.has(resolved.store.id)) {
        errors.push(`${rowLabel}：門市 ${resolved.store.store_code} 在檔案中重複`);
        return;
      }
      seenStores.add(resolved.store.id);

      const regularCount = parseNumber(getCell(row, ['一般箋張數', '一般處方箋張數', 'regular_prescription_count']), false);
      const regularPoints = parseNumber(getCell(row, ['一般箋點值', '一般處方箋點值', 'regular_prescription_point_value']), true);
      const chronicCount = parseNumber(getCell(row, ['慢箋張數', '慢性處方箋張數', 'chronic_prescription_count']), false);
      const chronicPoints = parseNumber(getCell(row, ['慢箋點值', '慢性處方箋點值', 'chronic_prescription_point_value']), true);
      if ([regularCount, regularPoints, chronicCount, chronicPoints].includes(undefined)) {
        errors.push(`${rowLabel}：${resolved.store.store_code} 的張數需為非負整數，點值最多四位小數`);
        return;
      }

      payload.push({
        year_month: selectedMonth,
        store_id: resolved.store.id,
        regular_prescription_count: regularCount,
        regular_prescription_point_value: regularPoints,
        chronic_prescription_count: chronicCount,
        chronic_prescription_point_value: chronicPoints,
        prescription_data_updated_at: updatedAt,
        prescription_data_updated_by: context.user.id,
        updated_at: updatedAt,
      });
    });

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Excel 有 ${errors.length} 筆資料需修正，未匯入任何資料`,
        errors: errors.slice(0, 50),
        error_count: errors.length,
      }, { status: 400 });
    }
    if (payload.length === 0) return NextResponse.json({ error: 'Excel 沒有可匯入的門市資料' }, { status: 400 });

    const { error } = await context.admin
      .from('monthly_prescription_reports')
      .upsert(payload, { onConflict: 'year_month,store_id' });
    if (error) {
      console.error('[Prescription report] Excel import failed:', error);
      return NextResponse.json({ error: '處方箋 Excel 寫入失敗，資料未匯入' }, { status: 500 });
    }

    return NextResponse.json({ success: true, imported: payload.length, year_month: selectedMonth });
  } catch (error: any) {
    console.error('[Prescription report] Excel import error:', error);
    return NextResponse.json({ error: error.message || '處方箋 Excel 匯入失敗' }, { status: 500 });
  }
}
