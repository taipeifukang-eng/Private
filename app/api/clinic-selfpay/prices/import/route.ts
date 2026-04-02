import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getCurrentUserId, parseNumber } from '../../_lib';

export const runtime = 'nodejs';

function getCell(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function isMissingSelfpayColumnError(message: string) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('selfpay_drug_name') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

function isMissingClosureTableError(message: string) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('clinic_selfpay_price_month_closures') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

function parseYearMonthSheetName(sheetName: string) {
  const trimmed = String(sheetName || '').trim();
  return /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function buildRecords(rows: Record<string, any>[], storeId: string, yearMonth: string, fileName: string, userId: string) {
  return rows
    .map((row) => {
      const healthCodeRaw = getCell(row, [
        '健保碼',
        '健保代號',
        '健保代碼',
        'HIS代碼',
        'health_insurance_code',
      ]);
      const selfpayDrugName = getCell(row, ['自費藥名稱', '診所自費藥名稱', '藥品名稱', 'selfpay_drug_name']);
      const productCode = getCell(row, ['品號', '商品編號', '料號', 'DPOS品號', 'product_code']);
      const productName = getCell(row, ['品名', '商品名稱', 'DPOS品名', 'product_name']);
      const memberPrice = parseNumber(getCell(row, ['會員價', '會員售價', 'member_price']));
      const costPrice = parseNumber(getCell(row, ['成本', '成本價', '進價', 'cost_price']));

      if (!healthCodeRaw || !productCode) return null;

      const healthCode = healthCodeRaw.toUpperCase();

      return {
        store_id: storeId,
        year_month: yearMonth,
        health_insurance_code: healthCode,
        product_code: productCode,
        product_name: productName || selfpayDrugName || null,
        selfpay_drug_name: selfpayDrugName || null,
        member_price: memberPrice,
        cost_price: costPrice,
        source_file_name: fileName,
        created_by: userId,
      };
    })
    .filter(Boolean) as any[];
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const form = await request.formData();
    const storeId = String(form.get('store_id') || '');
    const yearMonth = String(form.get('year_month') || '');
    const file = form.get('file') as File | null;

    if (!storeId || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, error: '請提供正確的門市與年月' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ success: false, error: '缺少匯入檔案' }, { status: 400 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === storeId)) {
      return NextResponse.json({ success: false, error: '無此門市操作權限' }, { status: 403 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
    const admin = createAdminClient();
    const monthlySheets = workbook.SheetNames
      .map((sheetName) => ({ sheetName, yearMonth: parseYearMonthSheetName(sheetName) }))
      .filter((item): item is { sheetName: string; yearMonth: string } => Boolean(item.yearMonth));

    const targetSheets = monthlySheets.length > 0
      ? monthlySheets
      : [{ sheetName: workbook.SheetNames[0], yearMonth }];

    const targetMonths = Array.from(new Set(targetSheets.map((item) => item.yearMonth)));

    let closedMonthSet = new Set<string>();
    const { data: closureRows, error: closureError } = await admin
      .from('clinic_selfpay_price_month_closures')
      .select('year_month')
      .eq('store_id', storeId)
      .in('year_month', targetMonths);

    if (closureError && !isMissingClosureTableError(closureError.message)) {
      return NextResponse.json({ success: false, error: closureError.message }, { status: 500 });
    }
    if (!closureError) {
      closedMonthSet = new Set((closureRows || []).map((row: any) => String(row.year_month || '')));
    }

    const skippedClosedMonths = targetMonths.filter((targetMonth) => closedMonthSet.has(targetMonth));

    const records = targetSheets.flatMap(({ sheetName, yearMonth: targetMonth }) => {
      if (closedMonthSet.has(targetMonth)) return [];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, any>[];
      if (!rows.length) return [];
      return buildRecords(rows, storeId, targetMonth, file.name, userId);
    });

    if (!records.length) {
      return NextResponse.json(
        {
          success: false,
          error: skippedClosedMonths.length > 0
            ? `以下年月已關帳，未匯入任何資料：${skippedClosedMonths.join('、')}`
            : '找不到有效資料，請確認欄位格式：健保碼、自費藥名稱、品號、品名、會員價、成本（至少需有健保碼與品號）',
        },
        { status: 400 }
      );
    }

    const { error } = await admin
      .from('clinic_selfpay_price_entries')
      .upsert(records, { onConflict: 'store_id,year_month,health_insurance_code' });

    if (error && isMissingSelfpayColumnError(error.message)) {
      const legacyRecords = records.map(({ selfpay_drug_name, ...rest }) => rest);
      const { error: legacyError } = await admin
        .from('clinic_selfpay_price_entries')
        .upsert(legacyRecords, { onConflict: 'store_id,year_month,health_insurance_code' });
      if (legacyError) {
        return NextResponse.json({ success: false, error: legacyError.message }, { status: 500 });
      }
    } else if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imported: records.length,
      importedMonths: Array.from(new Set(records.map((row: any) => row.year_month))).sort(),
      skippedClosedMonths,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
