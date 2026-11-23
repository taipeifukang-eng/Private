// 診所自費藥毛利：共用純函式（數字、日期、截圖路徑）。逐字沿用舊版 app/api/clinic-selfpay/_lib.ts 與 batches/[id]/route.ts，
// 新舊解析同源；舊版頁面與 API 一行未改，等價性由 tests/unit/M6-W30 以真實舊版原始碼逐筆比對。

export function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

export function parseRocDateToIso(raw: string): string | null {
  const s = raw.replace(/\s/g, '');
  const m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toYearMonth(isoDate: string | null): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  return isoDate.slice(0, 7);
}

export function parseScreenshotPaths(raw: unknown): string[] {
  const value = String(raw || '').trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v || '').trim()).filter(Boolean);
    }
  } catch {
    // legacy single-path format
  }
  return [value];
}

/** 與舊版相同：單張存純路徑字串、多張存 JSON 陣列字串（新舊頁面並行時舊頁都讀得到）。 */
export function serializeScreenshotPaths(paths: string[]): string | null {
  if (!paths.length) return null;
  return paths.length > 1 ? JSON.stringify(paths) : paths[0];
}
