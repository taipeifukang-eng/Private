// 處方箋「本月範本」：版面和使用者的 Google Sheet 一樣（每店三列：一般／連續／加總，一組「N月」的張數／金額）。
// 使用者只要從 Google Sheet 複製當月張數、金額，貼到 D3 起，存檔上傳即可。純函式，不連資料庫。
import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const PRESCRIPTION_TEMPLATE_SHEET = '處方箋月報';

export type TemplateStore = { id: string; store_code: string; store_name: string };
export type TemplateReport = {
  regular_prescription_count: number | null;
  regular_prescription_point_value: number | null;
  chronic_prescription_count: number | null;
  chronic_prescription_point_value: number | null;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function buildPrescriptionTemplateWorkbook(
  yearMonth: string,
  stores: TemplateStore[],
  reports: Map<string, TemplateReport>,
): XLSX.WorkBook {
  const month = Number(yearMonth.slice(5, 7));
  const sheet: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const put = (addr: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return;
    sheet[addr] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: value };
  };

  // 標題兩列
  put('A1', '門市代號');
  put('B1', '店別');
  put('C1', '項目');
  put('D1', `${month}月`);
  put('D2', '張數');
  put('E2', '金額');
  merges.push(
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
    { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
    { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
  );

  // 每店三列
  let excelRow = 3;
  for (const store of stores) {
    const report = reports.get(store.id);
    const r1 = excelRow;
    const r2 = excelRow + 1;
    const r3 = excelRow + 2;
    put(`A${r1}`, store.store_code);
    put(`B${r1}`, store.store_name);
    put(`C${r1}`, '一般');
    put(`C${r2}`, '連續');
    put(`C${r3}`, '加總');
    const regularCount = report?.regular_prescription_count ?? null;
    const regularPoints = report?.regular_prescription_point_value ?? null;
    const chronicCount = report?.chronic_prescription_count ?? null;
    const chronicPoints = report?.chronic_prescription_point_value ?? null;
    put(`D${r1}`, regularCount);
    put(`E${r1}`, regularPoints);
    put(`D${r2}`, chronicCount);
    put(`E${r2}`, chronicPoints);
    // 加總列用公式（使用者貼上數字會覆蓋它，沒關係）；同時寫入快取值，讀檔時不必重算
    sheet[`D${r3}`] = { t: 'n', f: `D${r1}+D${r2}`, v: (regularCount ?? 0) + (chronicCount ?? 0) };
    sheet[`E${r3}`] = { t: 'n', f: `E${r1}+E${r2}`, v: round4((regularPoints ?? 0) + (chronicPoints ?? 0)) };
    merges.push(
      { s: { r: r1 - 1, c: 0 }, e: { r: r3 - 1, c: 0 } },
      { s: { r: r1 - 1, c: 1 }, e: { r: r3 - 1, c: 1 } },
    );
    excelRow += 3;
  }

  sheet['!ref'] = `A1:E${Math.max(excelRow - 1, 2)}`;
  sheet['!merges'] = merges;
  sheet['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 18 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, PRESCRIPTION_TEMPLATE_SHEET);
  return workbook;
}

/**
 * 轉成 xlsx 檔案內容，並補上「凍結窗格」（A、B 欄與兩列標題）。
 * xlsx 社群版不能寫凍結窗格，所以在輸出後直接改工作表 XML；改失敗就回傳沒有凍結的原檔，不影響使用。
 */
export function writePrescriptionTemplate(workbook: XLSX.WorkBook): Uint8Array {
  const raw = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  try {
    const files = unzipSync(raw);
    const path = 'xl/worksheets/sheet1.xml';
    if (!files[path]) return raw;
    const xml = strFromU8(files[path]);
    const pane = '<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="D3" sqref="D3"/></sheetView></sheetViews>';
    let patched: string;
    if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) patched = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, pane);
    else if (/<dimension[^>]*\/>/.test(xml)) patched = xml.replace(/(<dimension[^>]*\/>)/, `$1${pane}`);
    else return raw;
    files[path] = strToU8(patched);
    return zipSync(files);
  } catch {
    return raw;
  }
}
