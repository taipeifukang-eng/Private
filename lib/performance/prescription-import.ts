// 處方箋匯入的純函式（不連資料庫、不讀環境變數）：
//   - Google Sheet 下載的 xlsx：每店三列（一般／連續／加總）、每月一組「張數／金額」
//   - 舊的「一門市一列」範本
//   - 簡稱正規化與自動比對、加總核對
import * as XLSX from 'xlsx';

export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type Cell = unknown;
export type Grid = Cell[][];

export type StoreLite = { id: string; store_code: string; store_name: string };

export type Money = { count: number | null; points: number | null };

export type SheetRow = {
  /** 表上原本的店別文字 */
  rawAlias: string;
  /** 正規化後的簡稱（對照表的 key） */
  alias: string;
  /** 一般箋所在的 Excel 列號（1 起算，方便使用者對照） */
  rowNo: number;
  regular: Money;
  chronic: Money;
  total: Money | null;
  /** 加總核對不符的說明；空陣列代表相符或沒有加總列可核對 */
  mismatches: string[];
  /** 該店有哪些列沒有填到數字或格式錯誤 */
  errors: string[];
};

export type ParseSheetResult =
  | { ok: true; sheetName: string; monthLabel: string; foundMonths: string[]; rows: SheetRow[]; ignoredLabels: string[] }
  | { ok: false; error: string; foundMonths?: string[] };

// ---------------------------------------------------------------- 基本工具

function text(value: Cell): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[ 　]/g, ' ').trim();
}

/** 簡稱正規化：全形轉半形、去掉所有空白。 */
export function normalizeAlias(value: string): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
}

function normalizeName(value: string): string {
  return normalizeAlias(value).toLowerCase();
}

const CHINESE_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

/** 認得「十月」「10月」「十月份」「2026年10月」「10 月」…；回傳月份 1~12，認不得回 0。 */
export function parseMonthLabel(value: Cell): number {
  const raw = normalizeAlias(text(value)).replace(/^\d{2,4}年/, '').replace(/份$/, '');
  if (!raw) return 0;
  const digit = raw.match(/^0?(\d{1,2})月$/);
  if (digit) {
    const m = Number(digit[1]);
    return m >= 1 && m <= 12 ? m : 0;
  }
  const chinese = raw.match(/^(十一|十二|十|一|二|三|四|五|六|七|八|九)月$/);
  if (chinese) return CHINESE_DIGITS[chinese[1]] || 0;
  return 0;
}

/** 讀數字：去千分位逗號與空白；空白或「-」回 null；格式錯誤回 undefined；負數視為錯誤。 */
export function parseAmount(value: Cell, allowDecimal: boolean): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return undefined;
    if (!allowDecimal && !Number.isInteger(value)) return undefined;
    return Math.round(value * 10000) / 10000;
  }
  const raw = text(value).replace(/,/g, '').replace(/^NT\$?/i, '').replace(/\s+/g, '');
  if (raw === '' || raw === '-' || raw === '—' || raw === '－') return null;
  const pattern = allowDecimal ? /^\d+(\.\d{1,4})?$/ : /^\d+$/;
  if (!pattern.test(raw)) return undefined;
  const number = Number(raw);
  if (!Number.isFinite(number) || number > (allowDecimal ? 99999999.9999 : 2147483647)) return undefined;
  return number;
}

export function workbookToGrid(sheet: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null, raw: true, blankrows: true });
}

// ---------------------------------------------------------------- 格式判斷

export function findStoreHeader(grid: Grid, maxRows = 30): { row: number; col: number } | null {
  for (let r = 0; r < Math.min(grid.length, maxRows); r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (normalizeAlias(text(row[c])) === '店別') return { row: r, col: c };
    }
  }
  return null;
}

function isLegacyHeaderGrid(grid: Grid): boolean {
  const first = (grid[0] || []).map(cell => text(cell).toLowerCase());
  return first.includes('門市代號') || first.includes('分店代號') || first.includes('store_code');
}

export type DetectResult =
  | { format: 'gsheet'; sheetName: string }
  | { format: 'legacy' };

/** 自動判斷格式：第一張表有「門市代號」標題 → 舊範本；否則找含「店別」的工作表 → Google Sheet；都沒有就走舊範本（由它回報缺欄位）。 */
export function detectFormat(workbook: XLSX.WorkBook): DetectResult {
  const firstName = workbook.SheetNames[0];
  const firstSheet = firstName ? workbook.Sheets[firstName] : undefined;
  if (firstSheet && isLegacyHeaderGrid(workbook2grid(firstSheet))) return { format: 'legacy' };
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet && findStoreHeader(workbook2grid(sheet))) return { format: 'gsheet', sheetName: name };
  }
  return { format: 'legacy' };
}

function workbook2grid(sheet: XLSX.WorkSheet) {
  return workbookToGrid(sheet);
}

// ---------------------------------------------------------------- Google Sheet 解析

const TOTAL_LABELS = ['加總', '合計', '總計', '總和', '小計'];
const IGNORED_STORE_LABELS = ['合計', '總計', '總和', '加總', '小計', '全部', '全區', '總店數'];

type RowKind = 'regular' | 'chronic' | 'total' | '';

function rowKindOf(label: string): RowKind {
  const v = normalizeAlias(label);
  if (!v) return '';
  if (TOTAL_LABELS.some(t => v === t || v.startsWith(t))) return 'total';
  if (v === '一般' || v === '一般箋' || v.startsWith('一般')) return 'regular';
  if (v === '連續' || v === '連續箋' || v.startsWith('連續') || v === '慢箋' || v.startsWith('慢')) return 'chronic';
  return '';
}

type Group = { monthCol: number; start: number; end: number; month: number; label: string };

function mergeIndex(sheet: XLSX.WorkSheet | undefined) {
  return (sheet?.['!merges'] || []) as XLSX.Range[];
}

/**
 * 在含「店別」的工作表中，只解析指定月份那一組的「張數／金額」欄。
 * year_month 的年份只用來決定月份，年份以匯入頁所選為準。
 */
export function parseGoogleSheet(workbook: XLSX.WorkBook, yearMonth: string, preferredSheet?: string): ParseSheetResult {
  if (!YEAR_MONTH_PATTERN.test(yearMonth)) return { ok: false, error: '匯入年月格式需為 YYYY-MM' };
  const targetMonth = Number(yearMonth.slice(5, 7));

  const names = preferredSheet ? [preferredSheet] : workbook.SheetNames;
  const foundMonthsAll: string[] = [];
  let storeHeaderSeen = false;

  for (const sheetName of names) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = workbookToGrid(sheet);
    const storeHeader = findStoreHeader(grid);
    if (!storeHeader) continue;
    storeHeaderSeen = true;

    // 找月份標題列：前 30 列內，含最多「月份」儲存格的那一列
    let monthRow = -1;
    let monthCells: { col: number; month: number; label: string }[] = [];
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const cells: { col: number; month: number; label: string }[] = [];
      (grid[r] || []).forEach((cell, c) => {
        const month = parseMonthLabel(cell);
        if (month) cells.push({ col: c, month, label: text(cell) });
      });
      if (cells.length > monthCells.length) { monthCells = cells; monthRow = r; }
    }
    if (monthRow < 0) continue;
    foundMonthsAll.push(...monthCells.map(cell => cell.label));

    const merges = mergeIndex(sheet);
    const groups: Group[] = monthCells.map((cell, i) => {
      const merge = merges.find(m => m.s.r <= monthRow && m.e.r >= monthRow && m.s.c <= cell.col && m.e.c >= cell.col);
      const start = merge ? merge.s.c : cell.col;
      const nextCol = monthCells[i + 1]?.col ?? Infinity;
      const end = Math.max(merge ? merge.e.c : cell.col, Number.isFinite(nextCol) ? nextCol - 1 : (grid[monthRow] || []).length - 1);
      return { monthCol: cell.col, start, end, month: cell.month, label: cell.label };
    });
    const group = groups.find(g => g.month === targetMonth);
    if (!group) continue;

    // 子標題列（張數／金額）：月份列下面 1~2 列
    let subRow = -1;
    let countCol = -1;
    let amountCol = -1;
    for (let r = monthRow; r <= Math.min(monthRow + 2, grid.length - 1) && subRow < 0; r++) {
      const row = grid[r] || [];
      let cCol = -1;
      let aCol = -1;
      for (let c = group.start; c <= Math.min(group.end, row.length - 1); c++) {
        const v = normalizeAlias(text(row[c]));
        if (cCol < 0 && (v === '張數' || v === '處方張數')) cCol = c;
        else if (cCol >= 0 && aCol < 0 && (v === '金額' || v === '點值' || v === '處方金額')) aCol = c;
      }
      if (cCol >= 0 && aCol >= 0) { subRow = r; countCol = cCol; amountCol = aCol; }
    }
    if (subRow < 0) {
      return { ok: false, error: `找到「${group.label}」，但它底下找不到「張數」「金額」欄位，請確認標題列`, foundMonths: foundMonthsAll };
    }

    const dataStart = Math.max(subRow, storeHeader.row) + 1;
    const rows = collectStoreRows(grid, {
      storeCol: storeHeader.col, countCol, amountCol, dataStart,
      merges,
    });
    return { ok: true, sheetName, monthLabel: group.label, foundMonths: monthCells.map(c => c.label), rows: rows.rows, ignoredLabels: rows.ignored };
  }

  if (!storeHeaderSeen) return { ok: false, error: '找不到含「店別」欄位的工作表' };
  const unique = Array.from(new Set(foundMonthsAll));
  const wanted = `${targetMonth}月（或${toChineseMonth(targetMonth)}月）`;
  return {
    ok: false,
    error: unique.length > 0
      ? `找不到「${wanted}」的欄位。檔案內的月份有：${unique.join('、')}`
      : `找不到「${wanted}」的欄位，檔案內沒有任何月份標題`,
    foundMonths: unique,
  };
}

function toChineseMonth(m: number) {
  return ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][m] || String(m);
}

function collectStoreRows(
  grid: Grid,
  opts: { storeCol: number; countCol: number; amountCol: number; dataStart: number; merges: XLSX.Range[] },
) {
  const { storeCol, countCol, amountCol, dataStart } = opts;
  const labelCandidates = (row: Cell[]): RowKind => {
    // 該組標籤欄＝「張數」左邊那欄
    if (countCol - 1 !== storeCol && countCol - 1 >= 0) {
      const kind = rowKindOf(text(row[countCol - 1]));
      if (kind) return kind;
    }
    // 退而求其次：整列任何一格文字是標籤（排除店別欄）
    for (let c = 0; c < row.length; c++) {
      if (c === storeCol || typeof row[c] !== 'string') continue;
      const kind = rowKindOf(text(row[c]));
      if (kind) return kind;
    }
    return '';
  };

  type Acc = { rawAlias: string; rowNo: number; regular?: Money; chronic?: Money; total?: Money; errors: string[] };
  const order: Acc[] = [];
  let current: Acc | null = null;
  const ignored: string[] = [];
  let ignoringBlock = false;

  for (let r = dataStart; r < grid.length; r++) {
    const row = grid[r] || [];
    // 合併儲存格只有第一列有值：有值才換店，空白就沿用上一個店別（往下補）
    const storeText = text(row[storeCol]);
    if (storeText) {
      if (IGNORED_STORE_LABELS.includes(normalizeAlias(storeText))) {
        ignoringBlock = true;
        ignored.push(storeText);
        current = null;
        continue;
      }
      ignoringBlock = false;
      if (!current || normalizeAlias(current.rawAlias) !== normalizeAlias(storeText)) {
        current = { rawAlias: storeText, rowNo: r + 1, errors: [] };
        order.push(current);
      }
    }
    if (ignoringBlock || !current) continue;

    const kind = labelCandidates(row);
    if (!kind) continue;
    const count = parseAmount(row[countCol], false);
    const points = parseAmount(row[amountCol], true);
    const label = kind === 'regular' ? '一般' : kind === 'chronic' ? '連續' : '加總';
    if (count === undefined) current.errors.push(`第 ${r + 1} 列（${label}）的張數格式不正確：「${text(row[countCol])}」`);
    if (points === undefined) current.errors.push(`第 ${r + 1} 列（${label}）的金額格式不正確：「${text(row[amountCol])}」`);
    const money: Money = { count: count ?? null, points: points ?? null };
    if (kind === 'regular') { if (!current.regular) { current.regular = money; current.rowNo = r + 1; } else current.errors.push(`第 ${r + 1} 列：「${current.rawAlias}」的一般列重複出現`); }
    else if (kind === 'chronic') { if (!current.chronic) current.chronic = money; else current.errors.push(`第 ${r + 1} 列：「${current.rawAlias}」的連續列重複出現`); }
    else if (!current.total) current.total = money;
  }

  const rows: SheetRow[] = order
    .filter(acc => acc.regular || acc.chronic)
    .map(acc => {
      const regular = acc.regular || { count: null, points: null };
      const chronic = acc.chronic || { count: null, points: null };
      return {
        rawAlias: acc.rawAlias,
        alias: normalizeAlias(acc.rawAlias),
        rowNo: acc.rowNo,
        regular,
        chronic,
        total: acc.total || null,
        mismatches: acc.errors.length ? [] : checkTotals(regular, chronic, acc.total || null),
        errors: acc.errors,
      };
    });
  return { rows, ignored };
}

/** 加總核對：一般＋連續 要等於加總（張數、金額各自比；沒有加總列或加總欄空白就不比）。 */
export function checkTotals(regular: Money, chronic: Money, total: Money | null): string[] {
  if (!total) return [];
  const out: string[] = [];
  if (total.count !== null) {
    const sum = (regular.count ?? 0) + (chronic.count ?? 0);
    if (sum !== total.count) out.push(`張數：一般＋連續＝${sum}，加總列是 ${total.count}`);
  }
  if (total.points !== null) {
    const sum = Math.round(((regular.points ?? 0) + (chronic.points ?? 0)) * 10000) / 10000;
    if (Math.abs(sum - total.points) > 0.005) out.push(`金額：一般＋連續＝${sum}，加總列是 ${total.points}`);
  }
  return out;
}

// ---------------------------------------------------------------- 簡稱對照

export type AliasMap = Map<string, string>; // 正規化簡稱 -> store_id

export type AliasMatch =
  | { status: 'mapped'; store: StoreLite }
  | { status: 'auto'; store: StoreLite }
  | { status: 'ambiguous'; candidates: StoreLite[] }
  | { status: 'unknown'; candidates: [] };

/**
 * 對照表優先；其次「簡稱唯一包含於某門市名稱」才算自動對上；
 * 沒有候選或多個候選都要使用者自己選。對照表指向的門市不在可選清單（已停用或沒權限）時，視同沒有對照。
 */
export function matchAlias(alias: string, aliasMap: AliasMap, stores: StoreLite[]): AliasMatch {
  const key = normalizeAlias(alias);
  const mappedId = aliasMap.get(key);
  if (mappedId) {
    const store = stores.find(s => s.id === mappedId);
    if (store) return { status: 'mapped', store };
  }
  const needle = normalizeName(key);
  if (!needle) return { status: 'unknown', candidates: [] };
  const candidates = stores.filter(s => normalizeName(s.store_name).includes(needle));
  if (candidates.length === 1) return { status: 'auto', store: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  return { status: 'unknown', candidates: [] };
}

// ---------------------------------------------------------------- 預覽結果（Google Sheet 與舊格式共用）

export type PreviewRow = {
  key: string;
  /** 表上的簡稱，或舊格式的門市代號 */
  label: string;
  rowNo: number;
  status: 'mapped' | 'auto' | 'ambiguous' | 'unknown' | 'matched' | 'error';
  store: StoreLite | null;
  candidates: StoreLite[];
  regular: Money;
  chronic: Money;
  mismatches: string[];
  errors: string[];
};

export type ImportPlan = {
  format: 'gsheet' | 'legacy';
  yearMonth: string;
  sheetName?: string;
  monthLabel?: string;
  rows: PreviewRow[];
  ignoredLabels: string[];
};

export function buildGsheetPreview(
  parsed: Extract<ParseSheetResult, { ok: true }>,
  yearMonth: string,
  aliasMap: AliasMap,
  stores: StoreLite[],
  selections: Record<string, string> = {},
): ImportPlan {
  const seen = new Map<string, string>();
  const rows: PreviewRow[] = parsed.rows.map(row => {
    const match = matchAlias(row.alias, aliasMap, stores);
    let status: PreviewRow['status'] = match.status;
    let store: StoreLite | null = 'store' in match ? match.store : null;
    const candidates = 'candidates' in match ? match.candidates : [];
    const errors = [...row.errors];
    if (!store && selections[row.alias]) {
      const chosen = stores.find(s => s.id === selections[row.alias]);
      if (chosen) { store = chosen; status = 'matched'; }
      else errors.push(`你選的門市「${selections[row.alias]}」不在可匯入的門市清單內`);
    }
    if (store) {
      const dup = seen.get(store.id);
      if (dup) errors.push(`「${row.rawAlias}」與「${dup}」對到同一家門市（${store.store_name}），請修正其中一個`);
      else seen.set(store.id, row.rawAlias);
    }
    return {
      key: row.alias, label: row.rawAlias, rowNo: row.rowNo, status: errors.length ? 'error' : status,
      store, candidates, regular: row.regular, chronic: row.chronic, mismatches: row.mismatches, errors,
    };
  });
  // 同一簡稱在檔案中出現兩次
  const aliasCount = new Map<string, number>();
  parsed.rows.forEach(r => aliasCount.set(r.alias, (aliasCount.get(r.alias) || 0) + 1));
  rows.forEach(r => {
    if ((aliasCount.get(r.key) || 0) > 1 && !r.errors.some(e => e.includes('重複'))) {
      r.errors.push(`店別「${r.label}」在檔案中出現多次`);
      r.status = 'error';
    }
  });
  return { format: 'gsheet', yearMonth, sheetName: parsed.sheetName, monthLabel: parsed.monthLabel, rows, ignoredLabels: parsed.ignoredLabels };
}

/** 可以寫入嗎？所有列都已對上門市、沒有錯誤。 */
export function planIsImportable(plan: ImportPlan): boolean {
  return plan.rows.length > 0 && plan.rows.every(r => r.store && r.status !== 'error' && r.errors.length === 0);
}

// ---------------------------------------------------------------- 舊格式（一門市一列）

function getCell(row: Record<string, unknown>, aliases: string[]) {
  const header = Object.keys(row).find(key => aliases.includes(key.trim().toLowerCase()));
  return header ? row[header] : undefined;
}

function parseYearMonthCell(value: unknown, fallback: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = XLSX.SSF.parse_date_code(value);
    if (date?.y && date?.m) return `${date.y}-${String(date.m).padStart(2, '0')}`;
  }
  const raw = text(value);
  if (!raw) return fallback;
  const normalized = raw.replace(/年/g, '-').replace(/月/g, '').replace(/[/.]/g, '-').replace(/\s+/g, '');
  const match = normalized.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
}

function normalizeStoreCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function resolveStoreByCode(code: string, stores: StoreLite[]): { store?: StoreLite; error?: string } {
  const normalized = normalizeStoreCode(code);
  const exact = stores.find(store => normalizeStoreCode(store.store_code) === normalized);
  if (exact) return { store: exact };
  const codePrefix = normalized.match(/^(\d{3,4}[A-Z]?)/)?.[1];
  if (!codePrefix) return { error: `找不到或無權限的門市代號「${code}」` };
  const candidates = new Map<string, StoreLite>();
  for (const store of stores) {
    const storeCode = normalizeStoreCode(store.store_code);
    const storeDigits = storeCode.match(/^\d+/)?.[0] || '';
    const prefixDigits = codePrefix.match(/^\d+/)?.[0] || '';
    const normalizedDigits = prefixDigits.length === 3 ? prefixDigits.padStart(4, '0') : prefixDigits;
    const storeBase = storeCode.replace(/[A-Z]+$/, '');
    const sameBase = storeBase === normalizedDigits || storeBase === prefixDigits;
    const sameExactPrefix = storeCode === codePrefix;
    if (sameBase || sameExactPrefix || (storeDigits === normalizedDigits && storeCode === normalizedDigits)) candidates.set(store.id, store);
  }
  if (candidates.size === 1) return { store: Array.from(candidates.values())[0] };
  if (candidates.size > 1) {
    return { error: `門市代號「${code}」對應多間門市，請使用完整門市代號：${Array.from(candidates.values()).map(s => s.store_code).join('、')}` };
  }
  return { error: `找不到或無權限的門市代號「${code}」` };
}

export function parseLegacySheet(workbook: XLSX.WorkBook, yearMonth: string, stores: StoreLite[]): { ok: true; plan: ImportPlan } | { ok: false; error: string } {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return { ok: false, error: 'Excel 檔案沒有工作表' };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: true });
  if (rows.length === 0) return { ok: false, error: 'Excel 工作表沒有資料' };

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  rows.forEach((row, index) => {
    if (Object.values(row).every(value => text(value) === '')) return;
    const rowNo = index + 2;
    const errors: string[] = [];
    const rowMonth = parseYearMonthCell(getCell(row, ['年月', '年月份', 'year_month']), yearMonth);
    if (!YEAR_MONTH_PATTERN.test(rowMonth)) errors.push('年月格式需為 YYYY-MM');
    else if (rowMonth !== yearMonth) errors.push(`資料年月 ${rowMonth} 與目前選擇的 ${yearMonth} 不同`);

    const rawCode = text(getCell(row, ['門市代號', '分店代號', 'store_code']));
    let store: StoreLite | null = null;
    if (!rawCode) errors.push('缺少門市代號');
    else {
      const resolved = resolveStoreByCode(rawCode, stores);
      if (resolved.store) {
        store = resolved.store;
        if (seen.has(store.id)) errors.push(`門市 ${store.store_code} 在檔案中重複`);
        seen.add(store.id);
      } else errors.push(resolved.error || '找不到門市');
    }

    const regularCount = parseAmount(getCell(row, ['一般箋張數', '一般處方箋張數', 'regular_prescription_count']), false);
    const regularPoints = parseAmount(getCell(row, ['一般箋點值', '一般處方箋點值', 'regular_prescription_point_value']), true);
    const chronicCount = parseAmount(getCell(row, ['慢箋張數', '慢性處方箋張數', 'chronic_prescription_count']), false);
    const chronicPoints = parseAmount(getCell(row, ['慢箋點值', '慢性處方箋點值', 'chronic_prescription_point_value']), true);
    if ([regularCount, regularPoints, chronicCount, chronicPoints].includes(undefined)) {
      errors.push('張數需為非負整數，點值最多四位小數');
    }
    out.push({
      key: store ? store.id : `row-${rowNo}`,
      label: rawCode || '（空白）',
      rowNo,
      status: errors.length ? 'error' : 'matched',
      store,
      candidates: [],
      regular: { count: regularCount ?? null, points: regularPoints ?? null },
      chronic: { count: chronicCount ?? null, points: chronicPoints ?? null },
      mismatches: [],
      errors,
    });
  });
  return { ok: true, plan: { format: 'legacy', yearMonth, rows: out, ignoredLabels: [] } };
}

// ---------------------------------------------------------------- 一次完成：判斷格式 → 解析 → 對照

export function buildImportPlan(
  workbook: XLSX.WorkBook,
  yearMonth: string,
  stores: StoreLite[],
  aliasMap: AliasMap,
  selections: Record<string, string> = {},
): { ok: true; plan: ImportPlan } | { ok: false; error: string } {
  const detected = detectFormat(workbook);
  if (detected.format === 'legacy') return parseLegacySheet(workbook, yearMonth, stores);
  const parsed = parseGoogleSheet(workbook, yearMonth, detected.sheetName);
  if (!parsed.ok) {
    // 該工作表找不到月份時，再試其他含「店別」的工作表
    const retry = parseGoogleSheet(workbook, yearMonth);
    if (!retry.ok) return { ok: false, error: retry.error };
    return { ok: true, plan: buildGsheetPreview(retry, yearMonth, aliasMap, stores, selections) };
  }
  return { ok: true, plan: buildGsheetPreview(parsed, yearMonth, aliasMap, stores, selections) };
}
