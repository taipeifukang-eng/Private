import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import { buildPrescriptionTemplateWorkbook, writePrescriptionTemplate, type TemplateReport } from '../../../lib/performance/prescription-template';
import {
  LEGACY_FORMAT_DISABLED_ERROR, buildImportPlan, checkTotals, detectFormat, matchAlias, normalizeAlias, parseAmount, parseGoogleSheet, parseMonthLabel, planIsImportable,
  type StoreLite,
} from '../../../lib/performance/prescription-import';
import { gsheetBuffer, legacyBuffer, read, type FixtureStore } from '../../support/rx-fixtures';

const stores: StoreLite[] = [
  { id: 's1', store_code: '0101', store_name: '富康南港店' },
  { id: 's2', store_code: '0102', store_name: '富康東湖店' },
  { id: 's3', store_code: '0103', store_name: '富康三民店' },
  { id: 's4', store_code: '0104', store_name: '富康三民二店' },
  { id: 's5', store_code: '0105', store_name: '富康百福店' },
];

type Pair = [string | number, string | number];
const month = (r: Pair, c: Pair, t: Pair) => ({ regular: r, chronic: c, total: t });
const sample: FixtureStore[] = [
  { alias: '南港', months: { 八月: month(['1,000', '2,500,000'], ['500', '1,200,000'], ['1,500', '3,700,000']), 十月: month(['1,200', '2,600,000'], ['550', '1,250,000'], ['1,750', '3,850,000']) } },
  { alias: '東湖', months: { 八月: month([10, 20], [1, 2], [11, 22]), 十月: month([100, '300.5'], [50, '100.25'], [150, '400.75']) } },
];

describe('基本工具', () => {
  it('月份標題：十月、10月、十月份、2026年10月 都認得', () => {
    expect([parseMonthLabel('十月'), parseMonthLabel('10月'), parseMonthLabel('十月份'), parseMonthLabel('2026年10月'), parseMonthLabel(' 八 月 '), parseMonthLabel('十二月'), parseMonthLabel('08月')]).toEqual([10, 10, 10, 10, 8, 12, 8]);
    expect(parseMonthLabel('張數')).toBe(0);
    expect(parseMonthLabel('13月')).toBe(0);
  });
  it('數字：千分位逗號、空白、破折號、錯誤格式', () => {
    expect(parseAmount('1,234', false)).toBe(1234);
    expect(parseAmount('1,234.5', true)).toBe(1234.5);
    expect(parseAmount('', false)).toBeNull();
    expect(parseAmount('-', true)).toBeNull();
    expect(parseAmount('1.5', false)).toBeUndefined();
    expect(parseAmount('abc', true)).toBeUndefined();
    expect(parseAmount(-3, false)).toBeUndefined();
    expect(parseAmount(12, false)).toBe(12);
  });
  it('簡稱正規化：去空白、全形轉半形', () => {
    expect(normalizeAlias(' 南 港　')).toBe('南港');
    expect(normalizeAlias('Ａ１')).toBe('A1');
  });
  it('加總核對', () => {
    expect(checkTotals({ count: 1, points: 10 }, { count: 2, points: 20 }, { count: 3, points: 30 })).toEqual([]);
    expect(checkTotals({ count: 1, points: 10 }, { count: 2, points: 20 }, { count: 4, points: 30 })).toHaveLength(1);
    expect(checkTotals({ count: 1, points: 10 }, { count: 2, points: 20 }, { count: 4, points: 31 })).toHaveLength(2);
    expect(checkTotals({ count: 1, points: 10 }, { count: 2, points: 20 }, null)).toEqual([]);
  });
});

describe('Google Sheet 解析', () => {
  it('合併儲存格、多月份、逗號數字：只讀選定月份', () => {
    const wb = read(gsheetBuffer({ monthLabels: ['八月', '九月', '十月'], stores: sample.map(s => ({ ...s, months: { ...s.months, 九月: s.months['八月'] } })) }));
    const r = parseGoogleSheet(wb, '2038-10');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.monthLabel).toBe('十月');
    expect(r.rows.map(x => x.alias)).toEqual(['南港', '東湖']);
    expect(r.rows[0].regular).toEqual({ count: 1200, points: 2600000 });
    expect(r.rows[0].chronic).toEqual({ count: 550, points: 1250000 });
    expect(r.rows[1].regular).toEqual({ count: 100, points: 300.5 });
    expect(r.rows[0].mismatches).toEqual([]);
    const aug = parseGoogleSheet(wb, '2038-08');
    expect(aug.ok && aug.rows[0].regular.count).toBe(1000);
  });
  it('月份標題寫成「10月」、沒有合併儲存格、前面有不屬於月份的欄、前面有別的工作表', () => {
    const wb = read(gsheetBuffer({ monthLabels: ['9月', '10月'], stores: sample.map(s => ({ ...s, months: { '9月': s.months['八月'], '10月': s.months['十月'] } })), leadingColumn: true, mergeMonth: false, extraSheetFirst: true }));
    expect(detectFormat(wb)).toEqual({ format: 'gsheet', sheetName: '處方箋' });
    const r = parseGoogleSheet(wb, '2038-10');
    expect(r.ok && r.rows[1].chronic).toEqual({ count: 50, points: 100.25 });
  });
  it('店別沒有合併、每列都重複寫店名也能讀', () => {
    const wb = read(gsheetBuffer({ monthLabels: ['十月'], stores: sample }));
    const sheet = wb.Sheets['處方箋'];
    sheet['!merges'] = [];
    // 資料從第 4 列開始（1 起算）：南港 4-6、東湖 7-9
    for (let row = 4; row <= 9; row++) sheet[`A${row}`] = { t: 's', v: row <= 6 ? '南港' : '東湖' };
    const r = parseGoogleSheet(wb, '2038-10');
    expect(r.ok && r.rows.map(x => x.alias)).toEqual(['南港', '東湖']);
  });
  it('加總不符：標出來但仍列出（張數或金額任一）', () => {
    const bad: FixtureStore[] = [
      { alias: '南港', months: { 十月: month([10, 100], [5, 50], [16, 150]) } },
      { alias: '東湖', months: { 十月: month([10, 100], [5, 50], [15, 999]) } },
      { alias: '文德', months: { 十月: month([10, 100], [5, 50], [15, 150]) } },
    ];
    const r = parseGoogleSheet(read(gsheetBuffer({ monthLabels: ['十月'], stores: bad })), '2038-10');
    expect(r.ok && r.rows.map(x => x.mismatches.length)).toEqual([1, 1, 0]);
  });
  it('找不到月份：清楚報錯並列出檔案內的月份', () => {
    const r = parseGoogleSheet(read(gsheetBuffer({ monthLabels: ['八月', '九月'], stores: sample })), '2038-10');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('找不到');
      expect(r.error).toContain('八月');
      expect(r.error).toContain('九月');
    }
  });
  it('沒有「店別」欄位的檔案', () => {
    const r = parseGoogleSheet(read(legacyBuffer([])), '2038-10');
    expect(r.ok).toBe(false);
  });
  it('錯誤數字格式會回報在該店', () => {
    const bad: FixtureStore[] = [{ alias: '南港', months: { 十月: month(['12x', 100], [5, 50], [5, 150]) } }];
    const r = parseGoogleSheet(read(gsheetBuffer({ monthLabels: ['十月'], stores: bad })), '2038-10');
    expect(r.ok && r.rows[0].errors.length).toBe(1);
  });
  it('忽略「合計」之類的總計區塊', () => {
    const withTotal: FixtureStore[] = [...sample, { alias: '合計', months: { 十月: month([1, 1], [1, 1], [2, 2]) } }];
    const r = parseGoogleSheet(read(gsheetBuffer({ monthLabels: ['十月'], stores: withTotal })), '2038-10');
    expect(r.ok && r.rows.length).toBe(2);
    expect(r.ok && r.ignoredLabels).toEqual(['合計']);
  });
});

describe('簡稱比對', () => {
  it('對照表優先於自動比對', () => {
    const m = matchAlias('南港', new Map([['南港', 's2']]), stores);
    expect(m.status === 'mapped' && m.store.id).toBe('s2');
  });
  it('簡稱唯一包含於某門市名稱才算自動對上', () => {
    const m = matchAlias('東湖', new Map(), stores);
    expect(m.status === 'auto' && m.store.id).toBe('s2');
  });
  it('多個候選要使用者選', () => {
    const m = matchAlias('三民', new Map(), stores);
    expect(m.status).toBe('ambiguous');
    expect(m.status === 'ambiguous' && m.candidates.map(s => s.id)).toEqual(['s3', 's4']);
  });
  it('沒有候選 → 未知；對照表指向的門市不在清單 → 視同沒有對照', () => {
    expect(matchAlias('義一', new Map(), stores).status).toBe('unknown');
    expect(matchAlias('義一', new Map([['義一', 'gone']]), stores).status).toBe('unknown');
    expect(matchAlias('', new Map(), stores).status).toBe('unknown');
  });
});

describe('匯入計畫（預覽）', () => {
  const buf = gsheetBuffer({
    monthLabels: ['十月'],
    stores: [
      { alias: '南港', months: { 十月: month([10, 100], [5, 50], [15, 150]) } },
      { alias: '三民', months: { 十月: month([10, 100], [5, 50], [16, 150]) } },
      { alias: '義一', months: { 十月: month([10, 100], [5, 50], [15, 150]) } },
    ],
  });
  it('自動對上、多候選、未知各自標示，且有未選門市就不能匯入', () => {
    const r = buildImportPlan(read(buf), '2038-10', stores, new Map());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.format).toBe('gsheet');
    expect(r.plan.rows.map(x => x.status)).toEqual(['auto', 'ambiguous', 'unknown']);
    expect(r.plan.rows[1].mismatches).toHaveLength(1);
    expect(planIsImportable(r.plan)).toBe(false);
  });
  it('使用者選好門市後可匯入；同一家門市被選兩次、選到範圍外的門市會擋下', () => {
    const ok = buildImportPlan(read(buf), '2038-10', stores, new Map(), { 三民: 's3', 義一: 's5' });
    expect(ok.ok && planIsImportable(ok.plan)).toBe(true);
    const dup = buildImportPlan(read(buf), '2038-10', stores, new Map(), { 三民: 's1', 義一: 's5' });
    expect(dup.ok && planIsImportable(dup.plan)).toBe(false);
    const outside = buildImportPlan(read(buf), '2038-10', stores, new Map(), { 三民: 'not-mine', 義一: 's5' });
    expect(outside.ok && planIsImportable(outside.plan)).toBe(false);
  });
  it('已有對照表就直接對上', () => {
    const r = buildImportPlan(read(buf), '2038-10', stores, new Map([['義一', 's5'], ['三民', 's4']]));
    expect(r.ok && planIsImportable(r.plan)).toBe(true);
    expect(r.ok && r.plan.rows.map(x => x.status)).toEqual(['auto', 'mapped', 'mapped']);
  });
});

describe('舊格式（一門市一列）已停用', () => {
  it('舊範本上傳：回明確的停用錯誤，不再解析', () => {
    const buf = legacyBuffer([['2038-10', '0101', '富康南港店', 10, 100, 5, '50.5']]);
    const wb = read(buf);
    expect(detectFormat(wb)).toEqual({ format: 'legacy', looksLegacy: true });
    const r = buildImportPlan(wb, '2038-10', stores, new Map());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('這是舊版範本格式，已停用，請重新下載本月範本');
    expect(!r.ok && r.error).toBe(LEGACY_FORMAT_DISABLED_ERROR);
  });
  it('既不是舊範本也沒有「店別」的檔案：回找不到店別的說明', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['隨便'], ['資料']]), 'Sheet1');
    const r = buildImportPlan(wb, '2038-10', stores, new Map());
    expect(!r.ok && r.error).toContain('店別');
  });
});

describe('本月範本：產生 → 解析 round-trip', () => {
  const rxStores: StoreLite[] = stores;
  const reports = new Map<string, TemplateReport>([
    ['s1', { regular_prescription_count: 1200, regular_prescription_point_value: 2600000, chronic_prescription_count: 550, chronic_prescription_point_value: 1250000.5 }],
    ['s3', { regular_prescription_count: 7, regular_prescription_point_value: null, chronic_prescription_count: null, chronic_prescription_point_value: null }],
  ]);
  const build = () => read(Buffer.from(writePrescriptionTemplate(buildPrescriptionTemplateWorkbook('2038-11', rxStores, reports))));

  it('版面：標題、合併、公式、凍結窗格、欄寬', () => {
    const bytes = writePrescriptionTemplate(buildPrescriptionTemplateWorkbook('2038-11', rxStores, reports));
    const wb = read(Buffer.from(bytes));
    expect(wb.SheetNames).toEqual(['處方箋月報']);
    const sheet = wb.Sheets['處方箋月報'];
    const v = (a: string) => sheet[a]?.v;
    expect([v('A1'), v('B1'), v('C1'), v('D1'), v('D2'), v('E2')]).toEqual(['門市代號', '店別', '項目', '11月', '張數', '金額']);
    expect([v('A3'), v('B3'), v('C3'), v('C4'), v('C5')]).toEqual(['0101', '富康南港店', '一般', '連續', '加總']);
    expect([v('D3'), v('E3'), v('D4'), v('E4')]).toEqual([1200, 2600000, 550, 1250000.5]);
    expect(sheet['D5'].f).toBe('D3+D4');
    expect(sheet['E5'].f).toBe('E3+E4');
    const merges = (sheet['!merges'] || []).map(m => XLSX.utils.encode_range(m));
    expect(merges).toEqual(expect.arrayContaining(['A1:A2', 'B1:B2', 'C1:C2', 'D1:E1', 'A3:A5', 'B3:B5', 'A6:A8', 'B6:B8']));
    expect(strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])).toContain('<cols>');
    const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('xSplit="2"');
  });
  it('門市順序與傳入順序完全相同，每店三列', () => {
    const sheet = build().Sheets['處方箋月報'];
    const codes = [3, 6, 9, 12, 15].map(r => sheet[`A${r}`]?.v);
    expect(codes).toEqual(['0101', '0102', '0103', '0104', '0105']);
  });
  it('解析得到與寫入一致的值；沒有值的留空（null）', () => {
    const r = parseGoogleSheet(build(), '2038-11');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hasCodeColumn).toBe(true);
    expect(r.monthLabel).toBe('11月');
    expect(r.rows.map(x => x.code)).toEqual(['0101', '0102', '0103', '0104', '0105']);
    expect(r.rows[0].regular).toEqual({ count: 1200, points: 2600000 });
    expect(r.rows[0].chronic).toEqual({ count: 550, points: 1250000.5 });
    expect(r.rows[0].total).toEqual({ count: 1750, points: 3850000.5 });
    expect(r.rows[0].mismatches).toEqual([]);
    expect(r.rows[1].regular).toEqual({ count: null, points: null });
    expect(r.rows[2].regular).toEqual({ count: 7, points: null });
    expect(r.rows.every(x => x.mismatches.length === 0)).toBe(true);
  });
  it('匯入計畫：用門市代號直接對門市，不查簡稱對照表（即使對照表有衝突）', () => {
    const r = buildImportPlan(build(), '2038-11', rxStores, new Map([['富康南港店', 's5']]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.hasCodeColumn).toBe(true);
    expect(r.plan.rows.map(x => x.status)).toEqual(['coded', 'coded', 'coded', 'coded', 'coded']);
    expect(r.plan.rows.map(x => x.store?.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(planIsImportable(r.plan)).toBe(true);
  });
  it('模擬「貼上數字」：改 D/E 欄後解析；貼上會蓋掉加總公式；千分位逗號文字也可', () => {
    const wb = build();
    const sheet = wb.Sheets['處方箋月報'];
    sheet['D3'] = { t: 'n', v: 111 };
    sheet['E3'] = { t: 's', v: '2,222,222' };
    sheet['D4'] = { t: 'n', v: 33 };
    sheet['E4'] = { t: 'n', v: 4444.25 };
    sheet['D5'] = { t: 'n', v: 144 };
    sheet['E5'] = { t: 'n', v: 2226666.25 };
    const r = parseGoogleSheet(wb, '2038-11');
    expect(r.ok && r.rows[0].regular).toEqual({ count: 111, points: 2222222 });
    expect(r.ok && r.rows[0].chronic).toEqual({ count: 33, points: 4444.25 });
    expect(r.ok && r.rows[0].total).toEqual({ count: 144, points: 2226666.25 });
    expect(r.ok && r.rows[0].mismatches).toEqual([]);
  });
  it('加總不符會標示（貼上的加總列對不起來）', () => {
    const wb = build();
    const sheet = wb.Sheets['處方箋月報'];
    sheet['D5'] = { t: 'n', v: 9999 };
    sheet['E5'] = { t: 'n', v: 1 };
    const r = buildImportPlan(wb, '2038-11', rxStores, new Map());
    expect(r.ok && r.plan.rows[0].mismatches).toHaveLength(2);
    expect(r.ok && r.plan.rows[1].mismatches).toHaveLength(0);
    expect(r.ok && planIsImportable(r.plan)).toBe(true);
  });
  it('門市代號找不到、代號空白：列為錯誤，不能匯入', () => {
    const wb = build();
    const sheet = wb.Sheets['處方箋月報'];
    sheet['A3'] = { t: 's', v: '9999' };
    sheet['A6'] = { t: 's', v: '' };
    const r = buildImportPlan(wb, '2038-11', rxStores, new Map());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.rows[0].status).toBe('error');
    expect(r.plan.rows[0].errors.join('')).toContain('9999');
    expect(planIsImportable(r.plan)).toBe(false);
  });
  it('同一代號出現兩次會擋下', () => {
    const wb = build();
    wb.Sheets['處方箋月報']['A6'] = { t: 's', v: '0101' };
    const r = buildImportPlan(wb, '2038-11', rxStores, new Map());
    expect(r.ok && r.plan.rows.some(x => x.errors.length > 0)).toBe(true);
    expect(r.ok && planIsImportable(r.plan)).toBe(false);
  });
  it('選了別的月份：找不到該月份，列出檔案內的月份', () => {
    const r = buildImportPlan(build(), '2038-10', rxStores, new Map());
    expect(!r.ok && r.error).toContain('11月');
  });
  it('沒有任何門市也能產生空範本（只有標題）', () => {
    const wb = read(Buffer.from(writePrescriptionTemplate(buildPrescriptionTemplateWorkbook('2038-11', [], new Map()))));
    const r = parseGoogleSheet(wb, '2038-11');
    expect(r.ok && r.rows).toEqual([]);
  });
  it('Google Sheet 原檔（沒有代號欄）仍走簡稱對照表', () => {
    const r = buildImportPlan(read(gsheetBuffer({ monthLabels: ['十月'], stores: sample })), '2038-10', stores, new Map());
    expect(r.ok && r.plan.hasCodeColumn).toBe(false);
    expect(r.ok && r.plan.rows.map(x => x.status)).toEqual(['auto', 'auto']);
  });
});
