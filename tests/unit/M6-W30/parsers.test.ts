import { describe, expect, it } from 'vitest';
import { clinicFixture, clinicFixtures, BASIC_EXPECTED, PRICES_2038_11 } from '../../support/clinic-selfpay-fixtures';
import { legacyBatchDetail, legacyClaimParser, legacyLib, legacyPriceParser } from '../../support/legacy-clinic-selfpay';
import { extractItems, buildRowDebugSample, parseClaimQty, parseCodeAndNameFromColA, parseClaimDrugName } from '../../../lib/clinic-selfpay/claim-parser';
import { parseNumber, parseRocDateToIso, toYearMonth, parseScreenshotPaths, serializeScreenshotPaths } from '../../../lib/clinic-selfpay/common';
import { buildRecords, deduplicatePriceRecords, getCell, parseYearMonthSheetName, parsePriceWorkbook, selectTargetSheets } from '../../../lib/clinic-selfpay/price-parser';
import { readClaimRows, readPriceWorkbook } from '../../../lib/clinic-selfpay/files';
import { roundTo1 } from '../../../lib/clinic-selfpay/margin';

/**
 * 診所檔／價格檔解析：
 *  1. 自造測試檔的預期值（依舊版規則手算）。
 *  2. 與「舊版原始碼原樣載入」逐筆比對（loadLegacyModule 不修改舊檔）：同一份輸入，新共用函式與舊版私有函式輸出必須完全相同。
 */
const legacy = legacyClaimParser();
const legacyLibFns = legacyLib();
const legacyPrice = legacyPriceParser();
const legacyDetail = legacyBatchDetail();
const rowsOf = (name: string) => readClaimRows(clinicFixture(name)).rows;
const CLAIM_FILES = Object.keys(clinicFixtures()).filter((n) => n.startsWith('claim-'));

describe('自造診所檔：依舊版規則的預期值', () => {
  it('claim-basic：診所、期間、8 筆明細、數量欄優先順序 M、L、K、J、N，數量為文字也能讀', () => {
    const p = extractItems(rowsOf('claim-basic.xlsx'));
    expect(p.clinicCode).toBe(BASIC_EXPECTED.clinicCode);
    expect(p.clinicName).toBe(BASIC_EXPECTED.clinicName);
    expect(p.periodStart).toBe(BASIC_EXPECTED.periodStart);
    expect(p.periodEnd).toBe(BASIC_EXPECTED.periodEnd);
    expect(p.items.map((i) => ({ code: i.healthInsuranceCode, qty: i.qty }))).toEqual(BASIC_EXPECTED.items);
    // A 欄含藥名者，名稱取自 A 欄；其餘取 B 欄
    expect(p.items[1].drugName).toBe('測試藥品乙膠囊');
    expect(p.items[0].drugName).toBe('測試藥品甲錠');
  });
  it('6 個固定排除健保碼、無健保碼、數量 0、代碼太短、表頭與 Count 列各自被計入略過統計', () => {
    const s = extractItems(rowsOf('claim-basic.xlsx')).debugStats;
    expect(s.skippedExcludedCode).toBe(6);
    // 舊版的「無健保碼」判斷是死碼（代碼會先被濾成只剩英數字，變成空字串），所以這列實際落在「不像代碼」；新版沿用，不改行為
    expect(s.skippedNoInsuranceCode).toBe(0);
    expect(s.skippedNoQty).toBe(2); // 報表標題列（A 欄有字、沒有數量）與數量 0 的列
    expect(s.skippedInvalidCode).toBe(2);
    expect(s.skippedHeaderOrCount).toBe(2);
    expect(s.acceptedRows).toBe(8);
  });
  it('.xls（biff8）與 .xlsx 解析結果相同', () => {
    expect(extractItems(rowsOf('claim-basic.xls')).items).toEqual(extractItems(rowsOf('claim-basic.xlsx')).items);
  });
  it('其他版面：十月期間、沒有期間、沒有診所代碼、列內診所別（最後一個為準）、全是排除代碼', () => {
    expect(extractItems(rowsOf('claim-october.xlsx')).periodStart).toBe('2038-10-01');
    expect(extractItems(rowsOf('claim-no-period.xlsx')).periodStart).toBeNull();
    const none = extractItems(rowsOf('claim-no-clinic.xlsx'));
    expect(none.clinicCode).toBeNull();
    expect(none.clinicName).toBeNull();
    const inBody = extractItems(rowsOf('claim-clinic-in-body.xlsx'));
    expect(inBody.clinicCode).toBe('ZT038009');
    expect(inBody.clinicName).toBe('測試診所丙');
    expect(extractItems(rowsOf('claim-empty.xlsx')).items).toEqual([]);
    expect(extractItems(rowsOf('claim-clinic-b.xlsx')).clinicCode).toBe('ZT038002');
  });
  it('單元：數量欄、A 欄代碼拆解（小寫、引號、全形空白）、藥名欄位', () => {
    const row = (o: Record<number, unknown>) => { const r: unknown[] = []; for (const [k, v] of Object.entries(o)) r[Number(k)] = v; return r as any[]; };
    expect(parseClaimQty(row({ 12: 0, 11: 7 }))).toBe(7);
    expect(parseClaimQty(row({ 12: '', 11: '', 10: '', 9: '', 13: '2.5 盒' }))).toBe(2.5);
    expect(parseClaimQty(row({ 12: '-3' }))).toBe(0);
    expect(parseCodeAndNameFromColA("'zta00-0001　藥名")).toEqual({ code: 'ZTA000001', nameFromA: '藥名' });
    expect(parseClaimDrugName(row({ 3: '第三欄藥名' }), 'A欄藥名')).toBe('第三欄藥名');
    expect(parseClaimDrugName(row({ 1: '診所別：X 診所' }), 'A欄藥名')).toBe('A欄藥名');
  });
});

describe('診所檔解析：與舊版原始碼逐筆比對', () => {
  for (const name of CLAIM_FILES.filter((n) => /\.xlsx?$/.test(n))) {
    it(`${name}：extractItems 與 buildRowDebugSample 輸出完全相同`, () => {
      const rows = rowsOf(name);
      expect(extractItems(rows)).toEqual(legacy.extractItems(rows));
      expect(buildRowDebugSample(rows)).toEqual(legacy.buildRowDebugSample(rows));
    });
  }
  it('排除碼集合相同', () => {
    expect(Array.from(legacy.EXCLUDED_HEALTH_INSURANCE_CODES).sort()).toEqual(['A100000100', 'A400000100', 'A900000100', 'B000000100', 'B100000100', 'B200000100']);
  });
  it('隨機版面（固定種子）：各欄混入數字、文字、空白、全形，新舊結果相同', () => {
    let seed = 20381123;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const pool: unknown[] = ['', ' ', 0, 1, 2.5, '3', '1,000', '4盒', '-2', 'abc', '診所別：ZT9 某診所', '診所別：ZT8', 'ZTA000001', "'zta000002 名", 'A100000100', '無健保碼', '健保代號', 'Count: 3', 'ＺＴ全形', '　', null, undefined];
    for (let i = 0; i < 200; i += 1) {
      const rows: any[][] = Array.from({ length: 5 + Math.floor(rnd() * 20) }, () => Array.from({ length: 14 }, () => pool[Math.floor(rnd() * pool.length)]));
      expect(extractItems(rows), `第 ${i} 組`).toEqual(legacy.extractItems(rows));
    }
  });
  it('共用小函式：數字、民國日期、年月、截圖路徑、四捨五入與舊版相同（含邊界輸入）', () => {
    const nums = [null, undefined, '', '1,234.5', ' 12 ', 'abc', '1e3', 0, -1, NaN, Infinity, '0x10', true, {}];
    for (const n of nums) expect(parseNumber(n), String(n)).toBe(legacyLibFns.parseNumber(n));
    for (const d of ['1271101', '127 11 01', '1271301', '1270001', '12711', '', 'abcdefg', '9991231']) expect(parseRocDateToIso(d)).toBe(legacyLibFns.parseRocDateToIso(d));
    for (const d of ['2038-11-01', '2038-11', null, '2038/11/01', '']) expect(toYearMonth(d as string | null)).toBe(legacyLibFns.toYearMonth(d as string | null));
    for (const p of [null, '', 'a/b.jpg', '["a/1.jpg","b/2.jpg"]', '[1,"",null,"x"]', '{"a":1}', '[bad json', ' spaced ']) expect(parseScreenshotPaths(p)).toEqual(legacyDetail.parseScreenshotPaths(p));
    for (const v of [0, 1.05, 1.25, 2.675, 123456.789, -0.05, 99.95, 1e-7]) expect(roundTo1(v)).toBe(legacyDetail.roundTo1(v));
    expect(roundTo1(5.55)).toBe(legacy.roundTo1(5.55));
  });
  it('截圖路徑寫入格式：單張純字串、多張 JSON 陣列（舊頁都讀得到），讀回相同', () => {
    expect(serializeScreenshotPaths([])).toBeNull();
    expect(serializeScreenshotPaths(['a.jpg'])).toBe('a.jpg');
    expect(serializeScreenshotPaths(['a.jpg', 'b.jpg'])).toBe('["a.jpg","b.jpg"]');
    for (const paths of [['a.jpg'], ['a.jpg', 'b.png', 'c.webp']]) expect(legacyDetail.parseScreenshotPaths(serializeScreenshotPaths(paths))).toEqual(paths);
  });
});

describe('價格檔：自造檔預期與舊版逐筆比對', () => {
  const ctxArgs = { storeId: 'S1', yearMonth: '2038-11', fileName: 'price.xlsx', userId: 'U1' };
  const wb = () => readPriceWorkbook(clinicFixture('price-multi-month.xlsx'));
  it('依工作表名 YYYY-MM 分月，非月份工作表忽略；別名欄位、文字金額、小寫與空白代碼、缺品號或缺健保碼略過、同代碼保留最後一筆', () => {
    const r = parsePriceWorkbook(wb(), ctxArgs);
    expect(r.targetMonths).toEqual(['2038-10', '2038-11']);
    const m11 = r.deduped.records.filter((x) => x.year_month === '2038-11');
    expect(m11.map((x) => x.health_insurance_code).sort()).toEqual(['ZTA000001', 'ZTA000002', 'ZTA000003', 'ZTB000010']);
    const b = m11.find((x) => x.health_insurance_code === 'ZTB000010')!;
    expect([b.member_price, b.cost_price, b.selfpay_drug_name]).toEqual([1250.5, 900, '測試藥品丁粉']);
    expect(m11.find((x) => x.health_insurance_code === 'ZTA000002')!.member_price).toBe(250.5);
    expect(m11.find((x) => x.health_insurance_code === 'ZTA000001')!.product_code).toBe('00012345'); // 前導零保留
    expect(r.deduped.duplicateCount).toBe(1);
    expect(r.deduped.records.filter((x) => x.year_month === '2038-10')).toHaveLength(3);
    expect(r.deduped.records.find((x) => x.year_month === '2038-10' && x.health_insurance_code === 'ZTA000001')!.member_price).toBe(90); // 別名欄位
  });
  it('已關帳月份略過；全部略過時沒有紀錄', () => {
    const r = parsePriceWorkbook(wb(), { ...ctxArgs, closedMonths: new Set(['2038-10']) });
    expect(r.skippedClosedMonths).toEqual(['2038-10']);
    expect(r.deduped.records.every((x) => x.year_month === '2038-11')).toBe(true);
    expect(parsePriceWorkbook(wb(), { ...ctxArgs, closedMonths: new Set(['2038-10', '2038-11']) }).records).toEqual([]);
  });
  it('沒有月份工作表時讀第一個工作表，月份用畫面選的；空檔沒有紀錄', () => {
    const r = parsePriceWorkbook(readPriceWorkbook(clinicFixture('price-single-sheet.xlsx')), ctxArgs);
    expect(r.targetMonths).toEqual(['2038-11']);
    expect(r.deduped.records.map((x) => [x.health_insurance_code, x.member_price, x.cost_price])).toEqual(PRICES_2038_11.map((p) => [p.code, p.member, p.cost]));
    expect(parsePriceWorkbook(readPriceWorkbook(clinicFixture('price-empty.xlsx')), ctxArgs).records).toEqual([]);
    expect(selectTargetSheets(['備註', 'Sheet1'], '2038-11')).toEqual([{ sheetName: '備註', yearMonth: '2038-11' }]);
  });
  for (const name of ['price-multi-month.xlsx', 'price-single-sheet.xlsx', 'price-missing-some.xlsx', 'price-oct-only.xlsx']) {
    it(`${name}：每個工作表的 buildRecords 與去重和舊版完全相同`, () => {
      const w = readPriceWorkbook(clinicFixture(name));
      for (const sheetName of w.SheetNames) {
        const rows = w.rowsOf(sheetName);
        const a = buildRecords(rows, 'S1', '2038-11', 'f.xlsx', 'U1');
        const b = legacyPrice.buildRecords(rows, 'S1', '2038-11', 'f.xlsx', 'U1');
        expect(a, sheetName).toEqual(b);
        expect(deduplicatePriceRecords(a)).toEqual(legacyPrice.deduplicatePriceRecords(b));
      }
    });
  }
  it('getCell 與月份工作表名判斷和舊版相同', () => {
    const row = { a: ' ', b: null, c: ' x ', d: 0 };
    expect(getCell(row, ['a', 'b', 'c'])).toBe(legacyPrice.getCell(row, ['a', 'b', 'c']));
    expect(getCell(row, ['d'])).toBe(legacyPrice.getCell(row, ['d']));
    for (const n of ['2038-11', ' 2038-11 ', '2038-1', 'Sheet1', '']) expect(parseYearMonthSheetName(n)).toBe(legacyPrice.parseYearMonthSheetName(n));
  });
});
