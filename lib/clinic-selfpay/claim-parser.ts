// 診所檔（健保系統匯出）解析：純函式，輸入為「工作表列陣列」（sheet_to_json header:1、defval:''）。
// 逐字沿用舊版 app/api/clinic-selfpay/batches/import/route.ts，包括數量欄優先順序（M、L、K、J、N）與 6 個固定排除的健保代碼。
import { parseNumber, parseRocDateToIso } from './common';

export type ParsedClaimItem = {
  lineNo: number;
  healthInsuranceCode: string;
  drugName: string;
  qty: number;
};

export type ParseDebugStats = {
  scannedRows: number;
  acceptedRows: number;
  skippedClinicLine: number;
  skippedEmpty: number;
  skippedHeaderOrCount: number;
  skippedNoInsuranceCode: number;
  skippedNoQty: number;
  skippedExcludedCode: number;
  skippedInvalidCode: number;
};

export type ParsedClaim = {
  clinicCode: string | null;
  clinicName: string | null;
  sourceB2Text: string;
  sourceB4Text: string;
  periodStart: string | null;
  periodEnd: string | null;
  items: ParsedClaimItem[];
  debugStats: ParseDebugStats;
};

export const EXCLUDED_HEALTH_INSURANCE_CODES = new Set([
  'A100000100',
  'B200000100',
  'A400000100',
  'B100000100',
  'B000000100',
  'A900000100',
]);

export function parseClinicInfo(text: string): { code: string; name: string } | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/診所別[:：]\s*([^\s]+)\s+(.+)/);
  if (!m) return null;
  return { code: m[1].trim(), name: m[2].trim() };
}

export function parsePeriod(text: string): { start: string | null; end: string | null } {
  const m = text.match(/(\d{7})\s*[~～-]\s*(\d{7})/);
  if (!m) return { start: null, end: null };
  return {
    start: parseRocDateToIso(m[1]),
    end: parseRocDateToIso(m[2]),
  };
}

export function parseClinicCodeFromRange(text: string): string | null {
  const m = text.match(/診所區間[:：]\s*([0-9A-Za-z]+)/);
  return m ? m[1].trim() : null;
}

export function parseClaimQty(row: any[]) {
  const qtyCols = [12, 11, 10, 9, 13]; // 優先 M/L/K，再回退 J/N
  for (const col of qtyCols) {
    const raw = row?.[col];
    const parsed = parseNumber(raw);
    if (parsed > 0) return parsed;

    // 相容格式：例如含單位、空白、逗號等字串
    const text = String(raw ?? '').replace(/,/g, '').trim();
    if (!text) continue;
    const m = text.match(/-?\d+(?:\.\d+)?/);
    if (!m) continue;
    const loose = Number(m[0]);
    if (Number.isFinite(loose) && loose > 0) return loose;
  }

  return 0;
}

export function parseCodeAndNameFromColA(raw: string) {
  const text = String(raw || '').replace(/　/g, ' ').trim();
  if (!text) {
    return { code: '', nameFromA: '' };
  }

  const firstToken = text.split(/\s+/)[0] || '';
  const code = firstToken
    .toUpperCase()
    .replace(/[\s'"`]/g, '')
    .replace(/[^A-Z0-9]/g, '');

  const nameFromA = text.slice(firstToken.length).trim();
  return { code, nameFromA };
}

export function parseClaimDrugName(row: any[], fallbackNameFromA: string) {
  // 兼容不同匯出格式：藥品名稱可能落在 B~I 欄任一位置
  const nameCols = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const col of nameCols) {
    const value = String(row?.[col] ?? '').trim();
    if (!value) continue;
    if (/^診所別[:：]/.test(value)) continue;
    return value;
  }
  return fallbackNameFromA || '';
}

export function buildRowDebugSample(rows: any[][]) {
  return rows
    .map((row, idx) => {
      const colA = String(row?.[0] || '').trim();
      const colB = String(row?.[1] || '').trim();
      const colC = String(row?.[2] || '').trim();
      const colD = String(row?.[3] || '').trim();
      const rawK = row?.[10] ?? '';
      const rawL = row?.[11] ?? '';
      const rawM = row?.[12] ?? '';
      if (!colA && !colB && String(rawK).trim() === '' && String(rawL).trim() === '' && String(rawM).trim() === '') {
        return null;
      }
      return {
        lineNo: idx + 1,
        colA,
        colB,
        colC,
        colD,
        colK: rawK,
        colL: rawL,
        colM: rawM,
        qtyParsed: parseClaimQty(row || []),
        drugNameParsed: parseClaimDrugName(row || [], parseCodeAndNameFromColA(colA).nameFromA),
        codeParsed: parseCodeAndNameFromColA(colA).code,
      };
    })
    .filter(Boolean)
    .slice(0, 25);
}

export function extractItems(rows: any[][]): ParsedClaim {
  const sourceB2Text = String(rows[1]?.[1] || '').trim();
  const sourceB4Text = String(rows[3]?.[1] || '').trim();
  const sourceB6Text = String(rows[5]?.[1] || '').trim();
  const sourceB7Text = String(rows[6]?.[1] || '').trim();

  let clinicCode: string | null = null;
  let clinicName: string | null = null;

  clinicCode = parseClinicCodeFromRange(sourceB6Text) || parseClinicCodeFromRange(sourceB7Text);

  const clinicFromB14 = parseClinicInfo(String(rows[13]?.[1] || ''));
  if (clinicFromB14) {
    if (!clinicCode) clinicCode = clinicFromB14.code;
    clinicName = clinicFromB14.name;
  }

  const period = parsePeriod(sourceB4Text);
  const items: ParsedClaimItem[] = [];
  const debugStats: ParseDebugStats = {
    scannedRows: rows.length,
    acceptedRows: 0,
    skippedClinicLine: 0,
    skippedEmpty: 0,
    skippedHeaderOrCount: 0,
    skippedNoInsuranceCode: 0,
    skippedNoQty: 0,
    skippedExcludedCode: 0,
    skippedInvalidCode: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();
    const parsedColA = parseCodeAndNameFromColA(colA);
    const drugName = parseClaimDrugName(row, parsedColA.nameFromA);
    const qty = parseClaimQty(row);
    const normalizedCode = parsedColA.code;

    const clinicLine = parseClinicInfo(colB);
    if (clinicLine) {
      clinicCode = clinicLine.code;
      clinicName = clinicLine.name;
      debugStats.skippedClinicLine += 1;
      continue;
    }

    if (!colA) {
      debugStats.skippedEmpty += 1;
      continue;
    }
    if (/^健保代號/.test(colA) || /^count\s*[:：]/i.test(colA)) {
      debugStats.skippedHeaderOrCount += 1;
      continue;
    }
    if (normalizedCode === '無健保碼') {
      debugStats.skippedNoInsuranceCode += 1;
      continue;
    }
    if (qty <= 0) {
      debugStats.skippedNoQty += 1;
      continue;
    }
    if (EXCLUDED_HEALTH_INSURANCE_CODES.has(normalizedCode)) {
      debugStats.skippedExcludedCode += 1;
      continue;
    }

    const looksLikeCode = /^[A-Z0-9]{4,}$/.test(normalizedCode);
    if (!looksLikeCode) {
      debugStats.skippedInvalidCode += 1;
      continue;
    }

    items.push({
      lineNo: i + 1,
      healthInsuranceCode: normalizedCode,
      drugName: drugName || '未提供藥品名稱',
      qty,
    });
    debugStats.acceptedRows += 1;
  }

  return {
    clinicCode,
    clinicName,
    sourceB2Text,
    sourceB4Text,
    periodStart: period.start,
    periodEnd: period.end,
    items,
    debugStats,
  };
}
