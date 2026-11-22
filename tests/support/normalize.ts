/**
 * 雙版本對等比對用的正規化器（T02）。
 *
 * 目的：舊版 API / UI / 匯出檔與新版 workspace API 的回傳，在「排序、日期與數字格式、null 與空字串、
 * 欄位命名、不該比較的欄位」上常有無害差異。先把兩邊都正規化成同一種形狀，再做深度比對。
 *
 * 路徑語法（用於 ignore / dateFields / numberFields / sortBy 等）：
 * - 以「.」串接欄位名，陣列不佔一層（stores.0.code 寫成 stores.code）。
 * - 不含「.」的樣式（例如 updated_at）比對任何層級的同名欄位。
 * - 含「.」的樣式從根開始完整比對，「*」可代表單一層欄位名。
 * - 根陣列的路徑為空字串 ''（sortBy 用）。
 *
 * 純函式、無 I/O，可在 Vitest 直接測試。
 */

export interface NormalizeRules {
  /** 欄位改名對照（舊名 → 正規名）。套用於任何層級的物件鍵；若多個來源改名成同一鍵，後者覆蓋前者。 */
  rename?: Record<string, string>;
  /** 要忽略（刪除）的欄位路徑樣式，例如 updated_at、workspace_version、user.*.token。 */
  ignore?: string[];
  /** 正規化為日期（YYYY-MM-DD）的欄位。帶時區的時間點會換算到 timeZone。 */
  dateFields?: string[];
  /** 正規化為 UTC 時間點（YYYY-MM-DDTHH:mm:ssZ，捨去毫秒）的欄位。 */
  datetimeFields?: string[];
  /** 強制轉成數字的欄位（容許千分位、前後空白、全形數字）。 */
  numberFields?: string[];
  /** 強制轉成布林的欄位（true/false、t/f、1/0、yes/no、是/否）。 */
  booleanFields?: string[];
  /** 數字小數位數，預設 6。 */
  numberPrecision?: number;
  /** undefined 與 '' 視為 null，預設 true。 */
  emptyAsNull?: boolean;
  /** 字串前後空白去除，預設 true。 */
  trimStrings?: boolean;
  /** 日期換算用時區，預設 Asia/Taipei。 */
  timeZone?: string;
  /** 陣列排序鍵：路徑樣式 → 欄位名（可多個）。未列出的物件陣列依內容的穩定序列化排序。 */
  sortBy?: Record<string, string | string[]>;
  /** 這些路徑的陣列順序是業務意義（例如步驟順序），不排序。 */
  keepOrder?: string[];
  /** 所有陣列都保留原順序（等同每個路徑都列入 keepOrder）。 */
  keepAllOrder?: boolean;
}

const DEFAULT_TZ = 'Asia/Taipei';

// ---------------------------------------------------------------------------
// 路徑樣式
// ---------------------------------------------------------------------------

export function matchesPattern(pattern: string, path: string): boolean {
  if (!pattern.includes('.')) {
    if (pattern === '*') return true;
    const last = path.split('.').pop() as string;
    return last === pattern;
  }
  const p = pattern.split('.');
  const s = path.split('.');
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg === '*' || seg === s[i]);
}

function matchesAny(patterns: string[] | undefined, path: string): boolean {
  return !!patterns && patterns.some((p) => matchesPattern(p, path));
}

// ---------------------------------------------------------------------------
// 純量正規化
// ---------------------------------------------------------------------------

/** 全形數字、全形符號轉半形。 */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, '.')
    .replace(/[，]/g, ',')
    .replace(/[－]/g, '-')
    .replace(/[／]/g, '/')
    .replace(/[：]/g, ':');
}

function pad2(n: number | string): string {
  return String(n).padStart(2, '0');
}

function formatInZone(date: Date, timeZone: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value as string;
  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * 轉成 YYYY-MM-DD。無法解析時回傳 null（呼叫端應保留原值）。
 * - 純日期字串（2026-11-02、2026/11/2、20261102）直接取日期，不做時區換算。
 * - 帶時區的時間點（Z 或 ±hh:mm）、Date 物件、epoch 毫秒：換算到 timeZone 的日曆日。
 * - 不帶時區的日期時間（2026-11-02 09:00:00）：取日期部分。
 */
export function toDateString(value: unknown, timeZone = DEFAULT_TZ): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const { y, m, d } = formatInZone(value, timeZone);
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toDateString(new Date(value), timeZone);
  }
  if (typeof value !== 'string') return null;
  const s = toHalfWidth(value.trim());
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, zone] = m;
  if (zone) {
    const iso = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(hh)}:${mi}:${ss || '00'}${/^z$/i.test(zone) ? 'Z' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    return toDateString(dt, timeZone);
  }
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** 轉成 UTC 時間點字串（YYYY-MM-DDTHH:mm:ssZ）。不帶時區的字串視為 timeZone 的當地時間（僅支援 Asia/Taipei 的固定 +08:00）。 */
export function toInstantString(value: unknown, timeZone = DEFAULT_TZ): string | null {
  let dt: Date | null = null;
  if (value instanceof Date) dt = value;
  else if (typeof value === 'number' && Number.isFinite(value)) dt = new Date(value);
  else if (typeof value === 'string') {
    const s = toHalfWidth(value.trim());
    const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
    if (!m) return null;
    const [, y, mo, d, hh, mi, ss, zone] = m;
    let z = zone;
    if (!z) {
      if (timeZone !== 'Asia/Taipei') return null;
      z = '+08:00';
    }
    const zz = /^z$/i.test(z) ? 'Z' : z.length === 5 ? `${z.slice(0, 3)}:${z.slice(3)}` : z;
    dt = new Date(`${y}-${pad2(mo)}-${pad2(d)}T${pad2(hh || '0')}:${mi || '00'}:${ss || '00'}${zz}`);
  }
  if (!dt || Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 轉成數字。無法解析回傳 null。 */
export function toNumber(value: unknown, precision = 6): number | null {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const s = toHalfWidth(value).replace(/[\s,]/g, '');
    if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    n = Number(s);
  } else if (typeof value === 'bigint') n = Number(value);
  else return null;
  if (!Number.isFinite(n)) return null;
  const f = 10 ** precision;
  const r = Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'y', '是'].includes(s)) return true;
    if (['false', 'f', '0', 'no', 'n', '否'].includes(s)) return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 深度正規化
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** 穩定序列化（鍵排序），用於陣列元素排序與相等判斷。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function compareScalar(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function sortArray(items: unknown[], path: string, rules: NormalizeRules): unknown[] {
  if (rules.keepAllOrder || matchesAny(rules.keepOrder, path)) return items;
  const sortKeysRaw = Object.entries(rules.sortBy || {}).find(([pattern]) =>
    pattern === '' ? path === '' : matchesPattern(pattern, path),
  )?.[1];
  const keys = sortKeysRaw === undefined ? null : Array.isArray(sortKeysRaw) ? sortKeysRaw : [sortKeysRaw];
  const copy = [...items];
  if (keys) {
    copy.sort((a, b) => {
      for (const k of keys) {
        const c = compareScalar(isPlainObject(a) ? a[k] : undefined, isPlainObject(b) ? b[k] : undefined);
        if (c !== 0) return c;
      }
      return stableStringify(a) < stableStringify(b) ? -1 : stableStringify(a) > stableStringify(b) ? 1 : 0;
    });
    return copy;
  }
  if (copy.every((x) => !isPlainObject(x) && !Array.isArray(x))) {
    copy.sort(compareScalar);
  } else {
    copy.sort((a, b) => {
      const sa = stableStringify(a);
      const sb = stableStringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  }
  return copy;
}

function normalizeScalar(value: unknown, path: string, rules: NormalizeRules): unknown {
  const emptyAsNull = rules.emptyAsNull !== false;
  const trim = rules.trimStrings !== false;
  const tz = rules.timeZone || DEFAULT_TZ;
  const precision = rules.numberPrecision ?? 6;

  let v: unknown = value;
  if (typeof v === 'string' && trim) v = v.trim();
  if (v === undefined) return emptyAsNull ? null : undefined;
  if (v === '' && emptyAsNull) return null;
  if (v === null) return null;

  if (matchesAny(rules.datetimeFields, path)) {
    const r = toInstantString(v, tz);
    return r ?? v;
  }
  if (matchesAny(rules.dateFields, path)) {
    const r = toDateString(v, tz);
    return r ?? v;
  }
  if (matchesAny(rules.numberFields, path)) {
    const r = toNumber(v, precision);
    return r ?? v;
  }
  if (matchesAny(rules.booleanFields, path)) {
    const r = toBoolean(v);
    return r ?? v;
  }
  if (typeof v === 'number') return toNumber(v, precision) ?? v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return v;
}

function walk(value: unknown, path: string, rules: NormalizeRules): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((x) => walk(x, path, rules));
    return sortArray(mapped, path, rules);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const rawKey of Object.keys(value)) {
      const key = rules.rename && Object.prototype.hasOwnProperty.call(rules.rename, rawKey) ? rules.rename[rawKey] : rawKey;
      const childPath = path ? `${path}.${key}` : key;
      // ignore 以改名後的路徑判斷，同時也容許以原名忽略。
      if (matchesAny(rules.ignore, childPath) || matchesAny(rules.ignore, path ? `${path}.${rawKey}` : rawKey)) continue;
      out[key] = walk(value[rawKey], childPath, rules);
    }
    return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  }
  return normalizeScalar(value, path, rules);
}

/** 正規化任意 JSON 值。回傳全新結構，不修改輸入。 */
export function normalize<T = unknown>(value: unknown, rules: NormalizeRules = {}): T {
  return walk(value, '', rules) as T;
}

/** 正規化列集合（陣列）。與 normalize 相同，但保證輸入為陣列。 */
export function normalizeRows(rows: unknown, rules: NormalizeRules = {}): Record<string, unknown>[] {
  if (!Array.isArray(rows)) throw new TypeError('normalizeRows 需要陣列');
  return normalize<Record<string, unknown>[]>(rows, rules);
}

// ---------------------------------------------------------------------------
// 深度差異
// ---------------------------------------------------------------------------

export type DiffKind = 'changed' | 'only-legacy' | 'only-native' | 'type' | 'count';

export interface ValueDiff {
  kind: DiffKind;
  path: string;
  legacy?: unknown;
  native?: unknown;
}

/** 深度比對兩個已正規化的值。路徑中的陣列以 [i] 表示（兩邊皆已排序，索引可對應）。 */
export function diffNormalized(legacy: unknown, native: unknown, path = ''): ValueDiff[] {
  if (Array.isArray(legacy) && Array.isArray(native)) {
    const diffs: ValueDiff[] = [];
    if (legacy.length !== native.length) {
      diffs.push({ kind: 'count', path: path || '(root)', legacy: legacy.length, native: native.length });
    }
    const n = Math.min(legacy.length, native.length);
    for (let i = 0; i < n; i += 1) diffs.push(...diffNormalized(legacy[i], native[i], `${path}[${i}]`));
    return diffs;
  }
  if (isPlainObject(legacy) && isPlainObject(native)) {
    const diffs: ValueDiff[] = [];
    const keys = new Set([...Object.keys(legacy), ...Object.keys(native)]);
    for (const k of Array.from(keys).sort()) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in native)) diffs.push({ kind: 'only-legacy', path: p, legacy: legacy[k] });
      else if (!(k in legacy)) diffs.push({ kind: 'only-native', path: p, native: native[k] });
      else diffs.push(...diffNormalized(legacy[k], native[k], p));
    }
    return diffs;
  }
  if (Array.isArray(legacy) !== Array.isArray(native) || isPlainObject(legacy) !== isPlainObject(native)) {
    return [{ kind: 'type', path: path || '(root)', legacy, native }];
  }
  if (legacy === native || stableStringify(legacy) === stableStringify(native)) return [];
  return [{ kind: 'changed', path: path || '(root)', legacy, native }];
}

export interface RowSetComparison {
  legacyCount: number;
  nativeCount: number;
  onlyLegacy: string[];
  onlyNative: string[];
  duplicateKeys: { side: 'legacy' | 'native'; key: string }[];
  fieldDiffs: { key: string; diffs: ValueDiff[] }[];
}

export function keyOf(row: Record<string, unknown>, key: string | string[]): string {
  const keys = Array.isArray(key) ? key : [key];
  return keys.map((k) => String(row[k] ?? '')).join('|');
}

/**
 * 以比較鍵配對兩邊的列，再逐欄比對。rows 應已正規化。
 * 比較鍵重複時會記錄在 duplicateKeys，並以最後一筆為準（不隱藏問題）。
 */
export function compareRowSets(
  legacyRows: Record<string, unknown>[],
  nativeRows: Record<string, unknown>[],
  key: string | string[],
): RowSetComparison {
  const index = (rows: Record<string, unknown>[], side: 'legacy' | 'native', dups: RowSetComparison['duplicateKeys']) => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const k = keyOf(r, key);
      if (m.has(k)) dups.push({ side, key: k });
      m.set(k, r);
    }
    return m;
  };
  const duplicateKeys: RowSetComparison['duplicateKeys'] = [];
  const l = index(legacyRows, 'legacy', duplicateKeys);
  const n = index(nativeRows, 'native', duplicateKeys);
  const onlyLegacy = Array.from(l.keys()).filter((k) => !n.has(k)).sort();
  const onlyNative = Array.from(n.keys()).filter((k) => !l.has(k)).sort();
  const fieldDiffs: RowSetComparison['fieldDiffs'] = [];
  for (const k of Array.from(l.keys()).filter((x) => n.has(x)).sort()) {
    const diffs = diffNormalized(l.get(k), n.get(k));
    if (diffs.length) fieldDiffs.push({ key: k, diffs });
  }
  return { legacyCount: legacyRows.length, nativeCount: nativeRows.length, onlyLegacy, onlyNative, duplicateKeys, fieldDiffs };
}

/** 依點路徑（a.b.c）取值；路徑為空回傳原值。 */
export function pick(value: unknown, dotted?: string): unknown {
  if (!dotted) return value;
  let cur: unknown = value;
  for (const seg of dotted.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
