// DPOS 月價格檔解析：純函式。逐字沿用舊版 app/api/clinic-selfpay/prices/import/route.ts。
// 規則：工作表名 YYYY-MM 按工作表分月（沒有任何月份工作表時用第一個工作表加畫面選的年月）；欄位別名全部沿用；
// 同門市同月同健保碼保留檔案中最後一筆；關帳月份略過（由呼叫端帶入已關帳月份）。
import { parseNumber } from './common';

export type PriceRecord = {
  store_id: string;
  year_month: string;
  health_insurance_code: string;
  product_code: string;
  product_name: string | null;
  selfpay_drug_name: string | null;
  member_price: number;
  cost_price: number;
  source_file_name: string;
  created_by: string;
};

export function getCell(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

export function parseYearMonthSheetName(sheetName: string) {
  const trimmed = String(sheetName || '').trim();
  return /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function buildRecords(rows: Record<string, any>[], storeId: string, yearMonth: string, fileName: string, userId: string): PriceRecord[] {
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
    .filter(Boolean) as PriceRecord[];
}

export function deduplicatePriceRecords(records: PriceRecord[]) {
  const byConflictKey = new Map<string, PriceRecord>();

  for (const record of records) {
    const key = [record.store_id, record.year_month, record.health_insurance_code].join('|');
    // 同一份匯入檔若重複同門市、同月份、同健保碼，採用檔案中最後一筆。
    byConflictKey.set(key, record);
  }

  return {
    records: Array.from(byConflictKey.values()),
    duplicateCount: records.length - byConflictKey.size,
  };
}

/** 決定要讀哪些工作表：有 YYYY-MM 工作表就按月份分；否則只讀第一個工作表，月份用畫面選的。 */
export function selectTargetSheets(sheetNames: string[], selectedYearMonth: string) {
  const monthlySheets = sheetNames
    .map((sheetName) => ({ sheetName, yearMonth: parseYearMonthSheetName(sheetName) }))
    .filter((item): item is { sheetName: string; yearMonth: string } => Boolean(item.yearMonth));
  return monthlySheets.length > 0 ? monthlySheets : [{ sheetName: sheetNames[0], yearMonth: selectedYearMonth }];
}

/**
 * 整份活頁簿的解析（純函式；sheetRows 由呼叫端用 sheet_to_json(sheet,{defval:null}) 取得）。
 * closedMonths 內的月份略過。回傳去重後的紀錄與統計。
 */
export function parsePriceWorkbook(
  workbook: { SheetNames: string[]; rowsOf: (sheetName: string) => Record<string, any>[] },
  opts: { storeId: string; yearMonth: string; fileName: string; userId: string; closedMonths?: Set<string> },
) {
  const targetSheets = selectTargetSheets(workbook.SheetNames, opts.yearMonth);
  const targetMonths = Array.from(new Set(targetSheets.map((item) => item.yearMonth)));
  const closed = opts.closedMonths || new Set<string>();
  const skippedClosedMonths = targetMonths.filter((m) => closed.has(m));
  const records = targetSheets.flatMap(({ sheetName, yearMonth: targetMonth }) => {
    if (closed.has(targetMonth)) return [];
    const rows = workbook.rowsOf(sheetName);
    if (!rows.length) return [];
    return buildRecords(rows, opts.storeId, targetMonth, opts.fileName, opts.userId);
  });
  const deduped = deduplicatePriceRecords(records);
  return { targetMonths, skippedClosedMonths, records, deduped };
}
