// 讀 Excel 檔成純函式需要的形狀（伺服端與測試用）。解析方式與舊版相同：XLSX.read(buffer)、診所檔取第一個工作表。
import * as XLSX from 'xlsx';

export function readClaimRows(bytes: ArrayBuffer | Buffer) {
  const workbook = XLSX.read(Buffer.from(bytes as ArrayBuffer), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
  return { sheetName: workbook.SheetNames[0] || '', rows };
}

export function readPriceWorkbook(bytes: ArrayBuffer | Buffer) {
  const workbook = XLSX.read(Buffer.from(bytes as ArrayBuffer), { type: 'buffer' });
  return {
    SheetNames: workbook.SheetNames,
    rowsOf: (sheetName: string) => XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null }) as Record<string, any>[],
  };
}
