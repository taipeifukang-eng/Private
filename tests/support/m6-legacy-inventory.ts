/**
 * 舊版離線盤點工具（app/inventory/page.tsx 的三個模組）的「參照實作」。
 * 舊版邏輯寫在 React 元件裡，無法直接 import；這裡逐段照抄計算與欄位辨識的部分（去掉 alert、console、狀態），
 * 供 M6-W25 的新舊對跑測試使用。來源行號（2026-11-21 版本）：
 *   formatProductCode 333、readExcelFile 343、readFKS0701ExcelFile 783、validateColumns 849、handleBaseDataUpload 884、
 *   handleModule1Upload 990、generateModule1Result 1052、handleModule2Upload 1102、generateModule2Result 1277、
 *   generateModule3Result 1473。
 * 舊版有任何改動時，這份參照要一起更新；不得為了讓測試通過而改參照。
 */
import * as XLSX from 'xlsx';

type Any = any;
export type LegacyOutcome<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): LegacyOutcome<T> => ({ ok: true, value });
const fail = (message: string): LegacyOutcome<never> => ({ ok: false, message });

export const formatProductCode = (code: Any): string => {
  if (!code) return '';
  const str = String(code).trim();
  if (/^\d+$/.test(str)) return str.padStart(8, '0');
  return str;
};

/** XLSX.read(buffer) 後取第一個工作表。 */
export function firstSheet(buffer: Buffer | Uint8Array): XLSX.WorkSheet {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.Sheets[wb.SheetNames[0]];
}

export const readExcelFile = (ws: XLSX.WorkSheet): Any[] => XLSX.utils.sheet_to_json(ws);

function validateColumns(data: Any[], required: string[], fileType: string): string | null {
  if (data.length === 0) return '檔案沒有資料！';
  const actual = Object.keys(data[0]);
  const missing = required.filter((c) => !actual.includes(c));
  if (missing.length) return `${fileType}缺少必要欄位！缺少：${missing.join('、')}`;
  return null;
}

export type LegacyProduct = { 品號: string; 品名: string; UN: string; 條碼: string; 庫存: number; 主要儲位: string };

/** handleBaseDataUpload：手動讀第二列為標題。 */
export function legacyParseBase(ws: XLSX.WorkSheet): LegacyOutcome<LegacyProduct[]> {
  try {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const headers: string[] = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 1, c: col })];
      headers.push(cell ? (cell.v || '').toString().trim() : '');
    }
    const json: Any[] = [];
    for (let row = 2; row <= range.e.r; row++) {
      const rowData: Any = {};
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        const header = headers[col];
        if (header) rowData[header] = cell ? cell.v : null;
      }
      if (Object.values(rowData).some((v) => v !== null && v !== '')) json.push(rowData);
    }
    const locKey = json.length > 0 ? Object.keys(json[0]).find((k) => k.includes('主要') && (k.includes('儲位') || k.includes('庫位'))) : null;
    if (!locKey) return fail('找不到「主要儲位」或「主要庫位」欄位');
    const stockKey = json.length > 0 ? Object.keys(json[0]).find((k) => k.includes('庫存') || k.includes('重存')) : null;
    if (!stockKey) return fail('找不到「庫存」或「重存」欄位！');
    const err = validateColumns(json, ['品號', '品名', '條碼'], '1F當日商品資料');
    if (err) return fail(err);
    const unKey = json.length > 0 ? Object.keys(json[0]).find((k) => k === 'UN' || k === 'un' || k.includes('單位')) : null;
    return ok(
      json.map((row: Any) => ({
        品號: formatProductCode(row['品號']),
        品名: String(row['品名'] || ''),
        UN: unKey ? String(row[unKey] || '') : '',
        條碼: String(row['條碼'] || ''),
        庫存: Number(row[stockKey] || 0),
        主要儲位: String(row[locKey] || ''),
      })),
    );
  } catch {
    return fail('匯入失敗，請檢查檔案格式');
  }
}

/** readFKS0701ExcelFile + 上傳後的格式化。 */
export function legacyParseFks(ws: XLSX.WorkSheet): LegacyOutcome<Any[]> {
  try {
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as Any[][];
    if (raw.length < 2) return fail('檔案資料不足');
    const headers = raw[0];
    const idx = (k: string) => headers.findIndex((h: Any) => String(h).includes(k));
    const i品號 = idx('品號'), i品名 = idx('品名'), i條碼 = idx('條碼'), i數量 = idx('盤點數量'), i儲位 = idx('盤點儲位');
    if (i品號 === -1 || i數量 === -1) return fail(`找不到必要欄位！標題行內容：${headers.join(' | ')}`);
    const result = raw.slice(1).map((row: Any[]) => ({
      品號: row[i品號],
      品名: i品名 >= 0 ? row[i品名] : '',
      條碼: i條碼 >= 0 ? row[i條碼] : '',
      盤點數量: i數量 >= 0 ? row[i數量] : 0,
      盤點儲位: i儲位 >= 0 ? row[i儲位] : '',
    }));
    return ok(
      result
        .filter((r: Any) => r.品號)
        .map((r: Any) => ({
          品號: formatProductCode(r.品號),
          品名: String(r.品名 || ''),
          條碼: String(r.條碼 || ''),
          盤點數量: Number(r.盤點數量 || 0),
          盤點儲位: String(r.盤點儲位 || ''),
        })),
    );
  } catch (e) {
    return fail(String(e));
  }
}

/** handleModule1Upload('external')：重複品號會被拒絕。 */
export function legacyParseExternal(ws: XLSX.WorkSheet): LegacyOutcome<{ 品號: string; 品名: string; 條碼: string; 盤點數量: number }[]> {
  const data = readExcelFile(ws);
  const err = validateColumns(data, ['品號', '品名', '條碼', '盤點數量'], '外盤公司盤點檔');
  if (err) return fail(err);
  const parsed = data.map((row: Any) => ({
    品號: formatProductCode(row['品號']),
    品名: String(row['品名'] || ''),
    條碼: String(row['條碼'] || ''),
    盤點數量: Number(row['盤點數量'] || 0),
  }));
  const seen = new Set<string>();
  const dup: string[] = [];
  parsed.forEach((item) => {
    if (item.品號 && seen.has(item.品號)) {
      if (!dup.includes(item.品號)) dup.push(item.品號);
    } else seen.add(item.品號);
  });
  if (dup.length) return fail(`匯入失敗：外盤公司原始檔中發現重複品號！重複的品號有：${dup.join(', ')}`);
  return ok(parsed);
}

/** handleModule2Upload('pre') 與多檔單檔處理。 */
export function legacyParsePre(ws: XLSX.WorkSheet): LegacyOutcome<{ 品號: string; 盤點數量: number; 盤點儲位: string }[]> {
  const data = readExcelFile(ws);
  const err = validateColumns(data, ['品號', '盤點數量', '盤點儲位'], '預盤資料');
  if (err) return fail(err);
  return ok(data.map((row: Any) => ({ 品號: formatProductCode(row['品號']), 盤點數量: Number(row['盤點數量'] || 0), 盤點儲位: String(row['盤點儲位'] || '') })));
}

/** handleModule2Upload('external')：外盤公司盤點 Stock 明細，同品號同儲位加總。 */
export function legacyParseModified(ws: XLSX.WorkSheet) {
  const data = readExcelFile(ws);
  const err = validateColumns(data, ['貨號', '數量', '貨架', '棚板', '序號'], '外盤公司盤點檔');
  if (err) return fail(err);
  const raw = data.map((row: Any) => {
    const 貨架 = String(row['貨架'] || '').trim();
    const 棚板 = String(row['棚板'] || '').trim();
    return { 品號: formatProductCode(row['貨號']), 品名: String(row['品名'] || ''), 條碼: String(row['條碼'] || ''), 盤點數量: Number(row['數量'] || 0), 盤點儲位: `外${貨架}-${棚板}` };
  });
  const merge = new Map<string, (typeof raw)[0]>();
  raw.forEach((item) => {
    const key = `${item.品號}__${item.盤點儲位}`;
    const existing = merge.get(key);
    if (existing) existing.盤點數量 += item.盤點數量;
    else merge.set(key, { ...item });
  });
  return ok(Array.from(merge.values()));
}

/** generateModule1Result */
export function legacyModule1(base: LegacyProduct[], external: Any[], fks: Any[]): { 品號: string }[] {
  const baseMap = new Map<string, number>();
  base.forEach((i) => baseMap.set(i.品號, i.庫存));
  const countMap = new Map<string, number>();
  external.forEach((i) => countMap.set(i.品號, (countMap.get(i.品號) || 0) + i.盤點數量));
  fks.forEach((i) => countMap.set(i.品號, (countMap.get(i.品號) || 0) + i.盤點數量));
  const need: { 品號: string }[] = [];
  external.forEach((i) => {
    if ((countMap.get(i.品號) || 0) !== (baseMap.get(i.品號) || 0)) need.push({ 品號: i.品號 });
  });
  return need;
}

/** generateModule2Result（只留計算；檔案由呼叫端決定要不要輸出） */
export function legacyModule2(base: LegacyProduct[], pre: Any[], fks: Any[], modified: Any[]) {
  const baseMap = new Map<string, LegacyProduct>();
  base.forEach((i) => baseMap.set(i.品號, i));
  const records: Any[] = [];
  [...pre, ...fks, ...modified].forEach((i) => records.push({ 品號: i.品號, 盤點儲位: i.盤點儲位, 該儲位盤點數量: i.盤點數量 }));
  const total = new Map<string, number>();
  records.forEach((r) => total.set(r.品號, (total.get(r.品號) || 0) + r.該儲位盤點數量));
  const full = records.map((r) => {
    const b = baseMap.get(r.品號);
    const 加總 = total.get(r.品號) || 0;
    const 庫存量 = b?.庫存 || 0;
    return { 盤點儲位: r.盤點儲位, 該儲位盤點數量: r.該儲位盤點數量, 品號: r.品號, 品名: b?.品名 || '', UN: b?.UN || '', 條碼: b?.條碼 || '', 庫存量, 各式盤點數量加總: 加總, 盤差量: 加總 - 庫存量 };
  });
  const diff = full.filter((r) => r.盤差量 !== 0);
  const seen = new Set<string>();
  const zero: Any[] = [];
  full.forEach((r) => {
    if (r.盤差量 === 0 && !seen.has(r.品號)) {
      seen.add(r.品號);
      zero.push({ 品號: r.品號, 庫存量: r.庫存量, 實際量: r.各式盤點數量加總 });
    }
  });
  diff.sort((a, b) => a.盤點儲位.localeCompare(b.盤點儲位, 'zh-TW'));
  const inv = new Set<string>();
  records.forEach((r) => inv.add(r.品號));
  const missing = base
    .filter((i) => i.庫存 !== 0 && !inv.has(i.品號))
    .map((i) => ({ 品號: i.品號, 品名: i.品名, UN: i.UN || '', 條碼: i.條碼, 庫存量: i.庫存, 主要儲位: i.主要儲位, 盤點數量: 0 }));
  return { diff, zero, missing };
}

/** generateModule3Result：不驗證、只累加。 */
export function legacyModule3(noDiff: Any[], internal: Any[], uninventoried: Any[]) {
  const map = new Map<string, { 庫存量: number; 實際量: number }>();
  noDiff.forEach((row) => {
    const code = String(row.品號 || '');
    if (code && !map.has(code)) map.set(code, { 庫存量: Number(row.庫存量 || 0), 實際量: Number(row.實際量 || 0) });
  });
  internal.forEach((row) => {
    const code = formatProductCode(row['品號']);
    if (!map.has(code)) map.set(code, { 庫存量: Number(row['庫存量'] || 0), 實際量: 0 });
    map.get(code)!.實際量 += Number(row['該儲位盤點數量'] || 0);
  });
  uninventoried.forEach((row) => {
    const code = formatProductCode(row['品號']);
    if (!map.has(code)) map.set(code, { 庫存量: Number(row['庫存量'] || 0), 實際量: 0 });
    map.get(code)!.實際量 += Number(row['盤點數量'] || 0);
  });
  return Array.from(map.entries()).map(([品號, d]) => ({ 品號, 庫存量: d.庫存量, 實際量: d.實際量, 盤差量: d.實際量 - d.庫存量 }));
}
