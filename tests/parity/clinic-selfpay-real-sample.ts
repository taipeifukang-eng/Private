import fs from 'node:fs';
import path from 'node:path';
import { extractItems } from '../../lib/clinic-selfpay/claim-parser';
import { readClaimRows, readPriceWorkbook } from '../../lib/clinic-selfpay/files';
import { buildRecords, deduplicatePriceRecords } from '../../lib/clinic-selfpay/price-parser';
import { legacyClaimParser, legacyPriceParser } from '../support/legacy-clinic-selfpay';

/**
 * 診所自費藥毛利：真實去識別樣本（Z4）比對。樣本尚未提供（2026-11-23 使用者決定先用自造檔開發），所以這組測試在找不到樣本時乾淨略過；
 * 樣本到位後直接執行即可，不必改程式：
 *   把檔案放進專案根目錄的「盤點測試檔」資料夾（已被 git 排除），檔名形如 *診所*價格*.xls(x)（價格檔）與 *診所*.xls(x)（診所檔）。
 *   執行：node tests/run-all.cjs --layers parity --page M6-W30 --no-sweep
 * 做法：以舊版原始碼（原樣載入、不修改）與新的共用解析函式各解析一次，要求結果完全相同。
 * 隱私：輸出只有筆數與健保碼；不輸出檔名、藥品名稱、價格、病患資料；不複製、不提交、不印出樣本內容；比對不一致時只報告位置，不報告值。
 */
export const SAMPLE_DIR = path.resolve(__dirname, '..', '..', '盤點測試檔');
const PRICE_RE = /診所.*價格.*\.xlsx?$/i;
const CLAIM_RE = /診所.*\.xlsx?$/i;
const TEMP_RE = /^~\$/;

export function findSamples(dir = SAMPLE_DIR): { price: string[]; claim: string[] } {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { price: [], claim: [] };
  const names = fs.readdirSync(dir).filter((n) => !TEMP_RE.test(n));
  const price = names.filter((n) => PRICE_RE.test(n)).sort();
  const claim = names.filter((n) => CLAIM_RE.test(n) && !PRICE_RE.test(n)).sort();
  return { price: price.map((n) => path.join(dir, n)), claim: claim.map((n) => path.join(dir, n)) };
}

/** 兩個值第一個不同的位置（只回報路徑，不回報值）；相同回傳 null。 */
export function firstDifference(a: unknown, b: unknown, at = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return at;
  if (Array.isArray(a) !== Array.isArray(b)) return at;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return `${at}.length`;
  for (const k of ka) {
    const d = firstDifference((a as any)[k], (b as any)[k], Array.isArray(a) ? `${at}[${k}]` : `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

export type ClaimResult = { items: number; accepted: number; skipped: Record<string, number>; codes: string[]; same: boolean; diffAt: string | null };
export function compareClaimFile(file: string): ClaimResult {
  const { rows } = readClaimRows(fs.readFileSync(file));
  const legacy = legacyClaimParser().extractItems(rows);
  const shared = extractItems(rows);
  const diffAt = firstDifference(legacy, shared);
  const { scannedRows, acceptedRows, ...skipped } = shared.debugStats;
  void scannedRows;
  return { items: shared.items.length, accepted: acceptedRows, skipped, codes: Array.from(new Set(shared.items.map((i) => i.healthInsuranceCode))).sort(), same: diffAt === null, diffAt };
}

export type PriceResult = { sheets: number; rows: number; records: number; afterDedupe: number; codes: string[]; same: boolean; diffAt: string | null };
export function comparePriceFile(file: string): PriceResult {
  const wb = readPriceWorkbook(fs.readFileSync(file));
  const legacy = legacyPriceParser();
  let rows = 0, records = 0, afterDedupe = 0;
  const codes = new Set<string>();
  let diffAt: string | null = null;
  wb.SheetNames.forEach((sheetName, idx) => {
    const data = wb.rowsOf(sheetName);
    rows += data.length;
    // 每個工作表都以同一組假的門市、年月、檔名、使用者代入（只比對解析規則，不寫入任何資料）
    const a = buildRecords(data, 'S', '2038-11', 'sample', 'U');
    const b = legacy.buildRecords(data, 'S', '2038-11', 'sample', 'U');
    const d = firstDifference(a, b, `$sheet[${idx}]`) || firstDifference(deduplicatePriceRecords(a), legacy.deduplicatePriceRecords(b), `$sheet[${idx}].dedupe`);
    if (d && !diffAt) diffAt = d;
    records += a.length;
    afterDedupe += deduplicatePriceRecords(a).records.length;
    a.forEach((r) => codes.add(r.health_insurance_code));
  });
  return { sheets: wb.SheetNames.length, rows, records, afterDedupe, codes: Array.from(codes).sort(), same: diffAt === null, diffAt };
}
