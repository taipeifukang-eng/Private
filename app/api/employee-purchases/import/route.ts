import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const REQUIRED_HEADERS = [
  '門市代號',
  '銷售日期',
  '銷售序號',
  '會員編號',
  '會員名稱',
  '品號',
  '品名',
  '數量',
  '總金額',
];

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeName(value: unknown) {
  return normalizeText(value).replace(/\s+/g, '').toUpperCase();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '');
}

function normalizeStoreCode(value: unknown) {
  const raw = normalizeCode(value);
  if (/^\d+(\.0+)?$/.test(raw)) {
    return String(Number(raw)).padStart(4, '0');
  }
  return raw;
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = normalizeText(value).replace(/[./]/g, '-');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function getYearMonthFromSaleDate(value: unknown) {
  const saleDate = parseDate(value);
  return saleDate ? saleDate.slice(0, 7) : null;
}

function getCell(row: Record<string, unknown>, header: string) {
  return row[header] ?? null;
}

function isTotalRow(row: Record<string, unknown>) {
  const markerFields = ['門市代號', '銷售日期', '銷售序號', '發票編號', '會員編號', '會員名稱', '品號', '品名'];
  const markerText = markerFields
    .map((field) => normalizeText(row[field]))
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (['合計', '總計', '小計', 'TOTAL', 'SUM'].some((marker) => markerText.includes(marker))) {
    return true;
  }

  const hasAmountValue = ['總金額', '毛利', '總成本', '數量'].some((field) => normalizeText(row[field]) !== '');
  const hasRequiredDetail =
    normalizeText(row['門市代號']) !== '' ||
    normalizeText(row['銷售日期']) !== '' ||
    normalizeText(row['會員編號']) !== '' ||
    normalizeText(row['會員名稱']) !== '' ||
    normalizeText(row['品號']) !== '' ||
    normalizeText(row['品名']) !== '';

  return hasAmountValue && !hasRequiredDetail;
}

function buildRowsFromWorksheet(sheet: XLSX.WorkSheet) {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  if (rawRows.length < 3) {
    throw new Error('Excel 資料不足，第一列應為 GridBand1，第二列應為欄位列');
  }

  const headerRow = rawRows[1].map((cell) => normalizeText(cell));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerRow.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Excel 缺少必要欄位：${missingHeaders.join('、')}`);
  }

  return rawRows.slice(2)
    .map((values, index) => {
      const row: Record<string, unknown> = {};
      headerRow.forEach((header, headerIndex) => {
        if (header) row[header] = values[headerIndex] ?? null;
      });
      return { rowNumber: index + 3, row };
    })
    .filter(({ row }) => Object.values(row).some((value) => value !== null && value !== ''))
    .filter(({ row }) => !isTotalRow(row));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canImport = await hasPermission(user.id, 'employee_purchase.import');
    if (!canImport) {
      return NextResponse.json({ success: false, error: '無員工購物匯入權限' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ success: false, error: '請選擇 Excel 檔案' }, { status: 400 });
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      return NextResponse.json({ success: false, error: '僅支援 .xlsx 或 .xls 檔案' }, { status: 400 });
    }

    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const parsedRows = buildRowsFromWorksheet(sheet);
    const saleMonthCounts = new Map<string, number>();
    parsedRows.forEach(({ row }) => {
      const saleMonth = getYearMonthFromSaleDate(getCell(row, '銷售日期'));
      if (saleMonth) saleMonthCounts.set(saleMonth, (saleMonthCounts.get(saleMonth) || 0) + 1);
    });

    const saleMonths = Array.from(saleMonthCounts.keys()).sort();
    if (saleMonths.length === 0) {
      return NextResponse.json({ success: false, error: '無法從銷售日期判定匯入月份，請確認銷售日期格式為 YYYY/MM/DD HH:MM' }, { status: 400 });
    }
    if (saleMonths.length > 1) {
      return NextResponse.json({
        success: false,
        error: `Excel 銷售日期包含多個月份：${saleMonths.join('、')}，請拆成單一月份後再匯入`,
      }, { status: 400 });
    }

    const yearMonth = saleMonths[0];

    const admin = createAdminClient();
    const { data: stores, error: storesError } = await admin
      .from('stores')
      .select('id, store_code');
    if (storesError) throw storesError;

    const storeMap = new Map<string, string>();
    (stores || []).forEach((store: any) => {
      storeMap.set(normalizeStoreCode(store.store_code), store.id);
      storeMap.set(normalizeCode(store.store_code), store.id);
    });

    const { data: staffRows, error: staffError } = await admin
      .from('monthly_staff_status')
      .select('id, store_id, employee_code, employee_name, position')
      .eq('year_month', yearMonth);
    if (staffError) throw staffError;

    const staffByCode = new Map<string, any>();
    const staffByName = new Map<string, any[]>();
    (staffRows || []).forEach((staff: any) => {
      const code = normalizeCode(staff.employee_code);
      const name = normalizeName(staff.employee_name);
      if (code) staffByCode.set(code, staff);
      if (name) {
        const list = staffByName.get(name) || [];
        list.push(staff);
        staffByName.set(name, list);
      }
    });

    const errors: string[] = [];
    const records = parsedRows.map(({ row, rowNumber }) => {
      const storeCode = normalizeStoreCode(getCell(row, '門市代號'));
      const memberCode = normalizeCode(getCell(row, '會員編號'));
      const memberName = normalizeText(getCell(row, '會員名稱'));
      const saleDate = parseDate(getCell(row, '銷售日期'));
      const storeId = storeMap.get(storeCode) || null;

      if (!storeId) errors.push(`第 ${rowNumber} 列：找不到門市代號「${normalizeText(getCell(row, '門市代號'))}」`);
      if (!saleDate) errors.push(`第 ${rowNumber} 列：銷售日期格式無法解析`);

      let matchedStaff = memberCode ? staffByCode.get(memberCode) : null;
      let matchStatus: 'employee_code' | 'employee_name' | 'ambiguous' | 'unmatched' = matchedStaff ? 'employee_code' : 'unmatched';

      if (!matchedStaff && memberName) {
        const nameMatches = staffByName.get(normalizeName(memberName)) || [];
        if (nameMatches.length === 1) {
          matchedStaff = nameMatches[0];
          matchStatus = 'employee_name';
        } else if (nameMatches.length > 1) {
          matchStatus = 'ambiguous';
        }
      }

      return {
        batch_id: null as string | null,
        year_month: yearMonth,
        store_id: storeId,
        store_code: storeCode || null,
        sale_date: saleDate,
        sale_sequence: normalizeText(getCell(row, '銷售序號')) || null,
        invoice_number: normalizeText(getCell(row, '發票編號')) || null,
        invoice_status: normalizeText(getCell(row, '發票狀態')) || null,
        member_code: memberCode || null,
        member_name: memberName || null,
        member_mobile: normalizeText(getCell(row, '會員手機')) || null,
        member_phone: normalizeText(getCell(row, '會員電話')) || null,
        product_code: normalizeText(getCell(row, '品號')) || null,
        product_name: normalizeText(getCell(row, '品名')) || null,
        unit: normalizeText(getCell(row, '單位')) || null,
        quantity: parseNumber(getCell(row, '數量')),
        gross_profit: parseNumber(getCell(row, '毛利')),
        unit_price: parseNumber(getCell(row, '單價')),
        unit_cost: parseNumber(getCell(row, '單位成本')),
        cash_discount: parseNumber(getCell(row, '現金折讓')),
        total_amount: parseNumber(getCell(row, '總金額')),
        document_note: normalizeText(getCell(row, '單據備註')) || null,
        shift_name: normalizeText(getCell(row, '班別')) || null,
        machine: normalizeText(getCell(row, '機台')) || null,
        cashier: normalizeText(getCell(row, '收銀')) || null,
        total_cost: parseNumber(getCell(row, '總成本')),
        price_discount_amount: parseNumber(getCell(row, '變價折讓金額')),
        employee_code: matchedStaff?.employee_code || null,
        employee_name: matchedStaff?.employee_name || null,
        employee_position: matchedStaff?.position || null,
        matched_staff_status_id: matchedStaff?.id || null,
        match_status: matchStatus,
        raw_row: row,
      };
    });

    const validRecords = records.filter((record) => record.store_id && record.sale_date);
    if (validRecords.length === 0) {
      return NextResponse.json({ success: false, error: `沒有可匯入資料。${errors.slice(0, 5).join('；')}`, errors }, { status: 400 });
    }

    const matchedCount = validRecords.filter((record) => record.match_status === 'employee_code' || record.match_status === 'employee_name').length;
    const totalAmount = validRecords.reduce((sum, record) => sum + Number(record.total_amount || 0), 0);

    const { data: batch, error: batchError } = await admin
      .from('employee_purchase_import_batches')
      .insert({
        year_month: yearMonth,
        file_name: file.name,
        imported_by: user.id,
        row_count: validRecords.length,
        matched_count: matchedCount,
        unmatched_count: validRecords.length - matchedCount,
        total_amount: totalAmount,
        notes: errors.length ? errors.slice(0, 20).join('；') : null,
      })
      .select('id')
      .single();
    if (batchError) throw batchError;

    const { error: deleteError } = await admin
      .from('employee_purchase_sales')
      .delete()
      .eq('year_month', yearMonth);
    if (deleteError) throw deleteError;

    const insertRows = validRecords.map((record) => ({ ...record, batch_id: batch.id }));
    for (const group of chunk(insertRows, 500)) {
      const { error: insertError } = await admin.from('employee_purchase_sales').insert(group);
      if (insertError) throw insertError;
    }

    return NextResponse.json({
      success: true,
      imported: validRecords.length,
      skipped: parsedRows.length - validRecords.length,
      matched: matchedCount,
      unmatched: validRecords.length - matchedCount,
      total_amount: totalAmount,
      year_month: yearMonth,
      errors,
    });
  } catch (error: any) {
    console.error('Error importing employee purchases:', error);
    return NextResponse.json({ success: false, error: error.message || '匯入員工購物資料失敗' }, { status: 500 });
  }
}
