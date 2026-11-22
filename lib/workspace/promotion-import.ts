import * as XLSX from 'xlsx';
import { getMovementDateError } from '../employee-movement-date';
import { POSITION_OPTIONS, NEWBIE_LEVEL_OPTIONS, ADMIN_LEVEL_OPTIONS } from '../../types/workflow';

export const MAX_PROMOTION_ROWS = 500;
export const MAX_PROMOTION_FILE_BYTES = 5 * 1024 * 1024;
export type PromotionDraft = { employee_code: string; employee_name: string; position: string; newbie_level: string; effective_date: string; notes: string };
export type PromotionIssue = { row: number; field: string; message: string };
const fields = ['employee_code', 'employee_name', 'position', 'newbie_level', 'effective_date', 'notes'] as const;
const headers: Record<string, typeof fields[number]> = {
  '員編':'employee_code', '姓名':'employee_name', '職位':'position', '新人階段':'newbie_level',
  '新人等級':'newbie_level', '行政階級':'newbie_level', '階段／階級':'newbie_level', newbie_level:'newbie_level', '生效日':'effective_date', '備註':'notes',
};
export function normalizePromotionDate(value: unknown, date1904 = false): string {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    const date = XLSX.SSF.parse_date_code(value, { date1904 });
    return date ? `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : String(value);
  }
  const text = typeof value === 'string' ? value.trim() : '';
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` : text;
}
export function validatePromotionRows(input: unknown, firstRow = 1) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_PROMOTION_ROWS) throw new Error(`請提供 1 至 ${MAX_PROMOTION_ROWS} 筆升遷資料`);
  const errors: PromotionIssue[] = [], seen = new Set<string>();
  const rows: PromotionDraft[] = input.map((raw, index) => {
    const row = firstRow + index;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    const item = Object.fromEntries(fields.map(field => [field, typeof raw[field] === 'string' ? raw[field].trim() : ''])) as PromotionDraft;
    item.employee_code = item.employee_code.toUpperCase();
    // JSON forms must supply a date string; Excel serial conversion belongs to the parser only.
    item.effective_date = normalizePromotionDate(item.effective_date);
    const add = (field: string, message: string) => errors.push({ row, field, message });
    if (!item.employee_code || item.employee_code.length > 20) add('employee_code','員編必填且不得超過 20 字');
    if (!item.employee_name || item.employee_name.length > 100) add('employee_name','姓名必填且不得超過 100 字');
    if (!(POSITION_OPTIONS as readonly string[]).includes(item.position) && item.position !== '代理店長') add('position','請選擇有效職位');
    const options = item.position === '新人' ? NEWBIE_LEVEL_OPTIONS : item.position === '行政' ? ADMIN_LEVEL_OPTIONS : [];
    if (options.length && !options.some(option => option.value === item.newbie_level)) add('newbie_level',`請選擇有效的${item.position === '新人' ? '新人階段' : '行政階級'}`);
    if (!options.length) item.newbie_level = '';
    const dateError = getMovementDateError(item.effective_date);
    if (dateError) add('effective_date',dateError);
    if (item.notes.length > 5000) add('notes','備註不得超過 5000 字');
    if (/(新人等級|行政階級)[:：]/.test(item.notes)) add('notes','階段／階級請填在專用欄位，避免與備註衝突');
    const key = JSON.stringify([item.employee_code,item.effective_date,item.position,item.newbie_level]);
    if (seen.has(key)) add('employee_code','相同員工、日期、職位與階段重複，請移除重複列');
    seen.add(key);
    return item;
  });
  return {rows,errors,valid:errors.length === 0};
}

export function parsePromotionWorkbook(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_PROMOTION_FILE_BYTES) throw new Error('Excel 檔案須為 5 MB 以下的非空檔案');
  const book = XLSX.read(buffer, { type:'buffer', cellDates:false, cellFormula:true, sheetRows:MAX_PROMOTION_ROWS + 2 });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet?.['!ref']) throw new Error('Excel 第一個工作表沒有資料');
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (range.e.r - range.s.r > MAX_PROMOTION_ROWS) throw new Error(`Excel 最多 ${MAX_PROMOTION_ROWS} 筆資料`);
  if (range.e.c - range.s.c > 30) throw new Error('Excel 欄位過多，請使用升遷匯入範本');
  const columns = new Map<number, typeof fields[number]>(), found = new Set<string>();
  for (let col = range.s.c; col <= range.e.c; col++) {
    const label = String(sheet[XLSX.utils.encode_cell({r:range.s.r,c:col})]?.v || '').trim();
    const field = headers[label];
    if (!field) continue;
    if (found.has(field)) throw new Error(`Excel 重複欄位：${label}`);
    columns.set(col, field); found.add(field);
  }
  for (const field of ['employee_code','employee_name','position','effective_date']) if (!found.has(field)) throw new Error('Excel 缺少必要欄位：員編、姓名、職位、生效日');
  const input: Record<string,string>[] = [], sourceRows: number[] = [], formulaErrors: PromotionIssue[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: Record<string,string> = {}; let nonempty = false;
    for (const [col,field] of Array.from(columns)) {
      const cell = sheet[XLSX.utils.encode_cell({r,c:col})];
      if (!cell) continue;
      if (cell.f) formulaErrors.push({row:r+1,field,message:'匯入欄位不可使用公式，請貼上實際值'});
      if (cell.t === 'e') formulaErrors.push({row:r+1,field,message:'儲存格有 Excel 錯誤，請先修正'});
      if (cell.v != null && String(cell.v).trim() !== '' || cell.f) nonempty = true;
      row[field] = field === 'effective_date' ? normalizePromotionDate(cell.v, !!book.Workbook?.WBProps?.date1904) : String(XLSX.utils.format_cell(cell) || '').trim();
    }
    if (nonempty) { input.push(row); sourceRows.push(r+1); }
  }
  const result = validatePromotionRows(input);
  const errors = [...result.errors.map(error => ({...error,row:sourceRows[error.row-1]})),...formulaErrors];
  return {rows:result.rows,sourceRows,errors,valid:errors.length === 0};
}

export function promotionTemplate() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['員編','姓名','職位','階段／階級','生效日','備註']]);
  sheet['!cols'] = [16,18,18,20,16,40].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(book,sheet,'升遷資料');
  const help = XLSX.utils.aoa_to_sheet([
    ['填寫說明'],['資料填於第一個工作表，一列一筆，最多 500 筆。'],
    ['員編請設為文字，保留前導零；姓名須與門市員工主檔一致。'],
    ['生效日使用西元 YYYY-MM-DD 或 YYYY/MM/DD，亦接受 Excel 日期儲存格；不自動轉換民國年。'],
    ['新人階段：未過階新人、一階新人、二階新人。'],['行政階級：未過階行政、過階行政。'],
    ['代理店長為暫代職務，月狀態保留正式職位並標示代理店長。'],['匯入只載入待確認資料，不會直接儲存。'],
  ]);
  help['!cols'] = [{wch:105}]; XLSX.utils.book_append_sheet(book,help,'填寫說明');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
