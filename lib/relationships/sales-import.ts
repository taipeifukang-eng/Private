import * as XLSX from 'xlsx';

/**
 * 關係會員銷售明細匯入的共用純函式。
 * 舊 route（app/api/relationship-sales/import）與 workspace 匯入 handler 共用同一份欄位驗證與日期規則，
 * 內容自原 route 原封搬出（行為不變）；去重只在 workspace handler 與資料庫函式內進行。
 */
export type SalesRow = Record<string, unknown>;
export const REQUIRED_HEADERS = ['門市代號', '銷售日期', '會員編號', '品號', '品名', '數量', '金額'];

export function textValue(value: unknown) {
  return String(value ?? '').trim();
}

export function numberValue(value: unknown) {
  if (typeof value === 'number') return value;
  const normalized = textValue(value).replace(/,/g, '');
  return normalized === '' ? Number.NaN : Number(normalized);
}

/** 銷售日期：Excel 序號，或文字 YYYY/MM/DD HH:MM（必須是存在的日期與時間）。回傳台北時間 ISO 字串，不合法回傳 null。 */
export function saleDateValue(value: unknown): string | null {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}T${String(parsed.H).padStart(2, '0')}:${String(parsed.M).padStart(2, '0')}:00+08:00`;
  }

  const match = textValue(value).match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const candidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
  if (Number.isNaN(candidate.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== hour || parts.minute !== minute) return null;
  return `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
}

/** 讀工作表第一頁成列物件；失敗回傳 null（舊 route 回「Excel 檔案無法解析」）。 */
export function readSalesRows(buffer: Buffer): SalesRow[] | null {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<SalesRow>(sheet, { defval: '' });
  } catch {
    return null;
  }
}

/** 檔案層驗證（沒有資料、缺欄位、欄位順序）。沒問題回傳 null，否則回傳舊版訊息。 */
export function validateSalesSheet(rows: SalesRow[]): string | null {
  if (!rows.length) return 'Excel 中沒有資料';
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !(header in rows[0]));
  if (missingHeaders.length) return `缺少欄位：${missingHeaders.join('、')}`;
  const actualHeaders = Object.keys(rows[0]).slice(0, REQUIRED_HEADERS.length);
  const hasCorrectOrder = REQUIRED_HEADERS.every((header, index) => actualHeaders[index] === header);
  if (!hasCorrectOrder) return `欄位順序錯誤，前七欄必須依序為：${REQUIRED_HEADERS.join('、')}`;
  return null;
}

export type ParsedSalesRow = {
  storeCode: string; saleDatetime: string | null; memberNumber: string;
  productCode: string; productName: string; quantity: number; amount: number;
};

/** 逐列驗證；errors 為舊版逐列錯誤文字（第 N 列從 2 起算）。 */
export function parseSalesRows(rows: SalesRow[]): { validRows: ParsedSalesRow[]; errors: string[] } {
  const errors: string[] = [];
  const validRows = rows.map((row, index) => {
    const storeCode = textValue(row['門市代號']);
    const saleDatetime = saleDateValue(row['銷售日期']);
    const memberNumber = textValue(row['會員編號']);
    const productCode = textValue(row['品號']);
    const productName = textValue(row['品名']);
    const quantity = numberValue(row['數量']);
    const amount = numberValue(row['金額']);
    if (!storeCode || !saleDatetime || !memberNumber || !productCode || !productName || !Number.isFinite(quantity) || !Number.isFinite(amount)) {
      errors.push(`第 ${index + 2} 列資料不完整，銷售日期須為 YYYY/MM/DD HH:MM，數量與金額須為數字`);
    }
    return { storeCode, saleDatetime, memberNumber, productCode, productName, quantity, amount };
  });
  return { validRows, errors };
}

/**
 * 去重鍵：門市代號、銷售時間、會員編號、品號、數量、金額（完全相同才算重複）。
 * 銷售時間一律換成台北時間「YYYY-MM-DDTHH:mm」字串，數量與金額固定到小數 2 位（與資料庫 numeric(_,2) 相同）。
 */
export function salesDedupeKey(row: { storeCode?: string | null; saleDatetime?: string | Date | null; memberNumber: string; productCode: string; quantity: number | string; amount: number | string }): string {
  let when = '';
  if (row.saleDatetime) {
    const d = row.saleDatetime instanceof Date ? row.saleDatetime : new Date(row.saleDatetime);
    if (!Number.isNaN(d.getTime())) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(d).map((p) => [p.type, p.value]));
      when = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    }
  }
  return JSON.stringify([row.storeCode ?? '', when, row.memberNumber, row.productCode, Number(row.quantity).toFixed(2), Number(row.amount).toFixed(2)]);
}

/**
 * 去重規劃（與資料庫函式 workspace_import_relationship_sales 同一規則，供單元測試對照）：
 * 只略過「資料庫已存在」的相同明細；同一檔內本身相同的列不會因此被略過。
 * 資料庫已有 c 筆、檔案有 k 筆相同明細時，略過前 min(k, c) 筆，其餘照常新增。
 */
export function planSalesDedupe<T extends Parameters<typeof salesDedupeKey>[0]>(rows: T[], existingCounts: Map<string, number>): { fresh: T[]; skipped: T[] } {
  const left = new Map(existingCounts);
  const fresh: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    const key = salesDedupeKey(row);
    const remaining = left.get(key) || 0;
    if (remaining > 0) {
      left.set(key, remaining - 1);
      skipped.push(row);
    } else fresh.push(row);
  }
  return { fresh, skipped };
}
