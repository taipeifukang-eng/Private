import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  DETAIL_HEADERS, DETAIL_SHEET_NAME, PERIOD_LONG_DAYS, addDays, checkPeriod, dailyAverage, detailSheet, gapNote, isLongPeriod, isPeriodRequired, mergePeriods, paperPeriodText, paperPeriodsByType, parsePrevPeriodParams, periodDays, periodText, slashDate,
} from '@/lib/workspace/general-affairs/utility-period-rules';
import { REASON_COL_CAPACITY, REASON_MIN_SCALE, buildPaperPrint, reasonFit } from '@/lib/workspace/general-affairs/payment-print-rules';
import { BILL_PAYLOAD_FIELDS, pickBillPayload } from '@/lib/workspace/general-affairs/utility-bill-rules';
import { buildSheetsWorkbook } from '../../../vue-workspace/src/lib/xlsx';

describe('必填與檢查（A1、A2）', () => {
  it('水費、電費必填；電話、網路選填', () => {
    expect(isPeriodRequired('WATER')).toBe(true);
    expect(isPeriodRequired('ELECTRICITY')).toBe(true);
    expect(isPeriodRequired('PHONE')).toBe(false);
    expect(isPeriodRequired('INTERNET')).toBe(false);
    expect(isPeriodRequired(null)).toBe(false);
  });
  it('水電沒填：白話訊息；舊帳單編輯時訊息請「補上」', () => {
    for (const t of ['WATER', 'ELECTRICITY']) {
      const r = checkPeriod(t, '', '');
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.code).toBe('PERIOD_REQUIRED'); expect(r.message).toContain('計費期間'); }
    }
    const legacy = checkPeriod('WATER', null, null, true);
    if (!legacy.ok) expect(legacy.message).toContain('舊帳單');
    else throw new Error('應失敗');
  });
  it('電話、網路可以都空；只填一邊不行', () => {
    expect(checkPeriod('PHONE', '', '')).toEqual({ ok: true, days: null, long: false });
    expect(checkPeriod('INTERNET', undefined, undefined)).toEqual({ ok: true, days: null, long: false });
    for (const t of ['PHONE', 'WATER']) {
      expect(checkPeriod(t, '2038-01-01', '')).toMatchObject({ ok: false, code: 'PERIOD_INCOMPLETE' });
      expect(checkPeriod(t, '', '2038-01-31')).toMatchObject({ ok: false, code: 'PERIOD_INCOMPLETE' });
    }
  });
  it('迄日不得早於起日；同一天可以（1 天）；日期格式錯誤', () => {
    expect(checkPeriod('WATER', '2038-02-01', '2038-01-31')).toMatchObject({ ok: false, code: 'PERIOD_ORDER' });
    expect(checkPeriod('WATER', '2038-02-01', '2038-02-01')).toEqual({ ok: true, days: 1, long: false });
    expect(checkPeriod('WATER', '2038-02-30', '2038-03-01')).toMatchObject({ ok: false, code: 'DATE_FORMAT' });
    expect(checkPeriod('WATER', '2038/02/01', '2038-03-01')).toMatchObject({ ok: false, code: 'DATE_FORMAT' });
  });
  it('天數含頭含尾；跨年、閏年正確', () => {
    expect(periodDays('2038-11-05', '2038-12-04')).toBe(30);
    expect(periodDays('2038-11-05', '2039-01-04')).toBe(61);
    expect(periodDays('2040-02-01', '2040-03-01')).toBe(30); // 閏年 2 月 29 天
    expect(periodDays('2039-02-01', '2039-03-01')).toBe(29);
    expect(periodDays('2038-02-01', '2038-01-01')).toBeNull();
    expect(periodDays('', '2038-01-01')).toBeNull();
  });
  it('超過 70 天只提醒（ok 仍為 true）：70 天不提醒、71 天提醒', () => {
    expect(PERIOD_LONG_DAYS).toBe(70);
    const d70 = checkPeriod('WATER', '2038-01-01', addDays('2038-01-01', 69));
    const d71 = checkPeriod('WATER', '2038-01-01', addDays('2038-01-01', 70));
    expect(d70).toEqual({ ok: true, days: 70, long: false });
    expect(d71).toEqual({ ok: true, days: 71, long: true });
    expect(isLongPeriod(71)).toBe(true);
    expect(isLongPeriod(null)).toBe(false);
  });
});

describe('自動帶入與空檔提醒（A3）', () => {
  it('起日＝上一期迄日＋1（含跨月、跨年）', () => {
    expect(addDays('2038-01-31', 1)).toBe('2038-02-01');
    expect(addDays('2038-12-31', 1)).toBe('2039-01-01');
    expect(addDays('2040-02-28', 1)).toBe('2040-02-29');
  });
  it('銜接正常不提醒；空檔與重疊各有白話提醒（不擋）', () => {
    expect(gapNote('2038-02-01', '2038-01-31')).toMatchObject({ kind: 'ok' });
    const gap = gapNote('2038-02-05', '2038-01-31');
    expect(gap).toMatchObject({ kind: 'gap', days: 4 });
    expect(gap?.message).toContain('空了 4 天');
    expect(gap?.message).toContain('2038/01/31');
    const ov = gapNote('2038-01-30', '2038-01-31');
    expect(ov).toMatchObject({ kind: 'overlap', days: 2 });
    expect(ov?.message).toContain('重疊');
    expect(gapNote('', '2038-01-31')).toBeNull();
  });
  it('讀上一期的查詢參數只收白名單欄位並截長度', () => {
    const q = parsePrevPeriodParams(new URLSearchParams({ store_id: 's', expense_type: 'WATER', service_identifier: 'W1', evil: 'x', exclude_id: 'e' }));
    expect(q).toEqual({ store_id: 's', expense_type: 'WATER', service_identifier: 'W1', exclude_id: 'e' });
  });
  it('API 白名單帶期間欄位', () => {
    expect(BILL_PAYLOAD_FIELDS).toContain('service_period_start');
    expect(BILL_PAYLOAD_FIELDS).toContain('service_period_end');
    expect(pickBillPayload({ service_period_start: '2038-01-01', service_period_end: '2038-01-31', id: 'x' })).toEqual({ service_period_start: '2038-01-01', service_period_end: '2038-01-31' });
  });
});

describe('顯示（A4）', () => {
  it('畫面：2026/11/05～2027/01/04（61 天）；沒期間空字串', () => {
    expect(periodText('2026-11-05', '2027-01-04')).toBe('2026/11/05～2027/01/04（61 天）');
    expect(periodText('2026-11-05', '2026-12-04', false)).toBe('2026/11/05～2026/12/04');
    expect(periodText(null, null)).toBe('');
    expect(slashDate('2026-11-05T00:00:00Z')).toBe('2026/11/05');
  });
  it('紙本：同年用月/日；跨年用民國年/月/日', () => {
    expect(paperPeriodText('2026-11-05', '2026-12-04', '水費')).toBe('水費 11/05～12/04');
    expect(paperPeriodText('2026-12-05', '2027-01-04', '電費')).toBe('電費 115/12/05～116/01/04');
    expect(paperPeriodText('2026-12-05', null)).toBe('');
  });
  it('依費用類型分段：各類型一段、同類型取最早～最晚、沒期間的類型不寫、跨年各段自己判斷', () => {
    const p = (t: string, s?: string, e?: string) => ({ expense_type: t, service_period_start: s ?? null, service_period_end: e ?? null });
    expect(paperPeriodsByType([p('WATER', '2038-01-01', '2038-03-31')])).toBe('01/01～03/31');
    expect(paperPeriodsByType([p('ELECTRICITY', '2038-02-01', '2038-03-01'), p('ELECTRICITY', '2037-12-20', '2038-01-19')])).toBe('126/12/20～127/03/01');
    expect(paperPeriodsByType([p('WATER')])).toBe('');
    expect(paperPeriodsByType([p('WATER', '2038-01-01', '2038-03-31'), p('ELECTRICITY', '2038-01-05', '2038-02-04')])).toBe('水費 01/01～03/31、電費 01/05～02/04');
    expect(paperPeriodsByType([p('PHONE'), p('WATER', '2038-01-01', '2038-03-31')])).toBe('水費 01/01～03/31'); // 含多種類型（電話費沒期間）仍寫名稱
    expect(paperPeriodsByType([p('PHONE'), p('INTERNET')])).toBe('');
    expect(paperPeriodsByType([p('ELECTRICITY', '2038-02-01', '2038-03-01'), p('ELECTRICITY', '2037-12-20', '2038-01-19'), p('WATER', '2038-01-01', '2038-03-31')])).toBe('電費 126/12/20～127/03/01、水費 01/01～03/31');
  });
  it('同一列多張帳單：取最早起日～最晚迄日；沒有期間的舊帳單略過；全都沒有回 null', () => {
    expect(mergePeriods([{ service_period_start: '2026-11-05', service_period_end: '2026-12-04' }, { service_period_start: '2026-10-28', service_period_end: '2026-11-27' }, {}])).toEqual({ start: '2026-10-28', end: '2026-12-04' });
    expect(mergePeriods([{}, { service_period_start: null, service_period_end: null }])).toBeNull();
  });
});

const bill = (n: number, store: string, name: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: `b${n}`, line_no: n, store_id: store, location_name: name, expense_type: 'ELECTRICITY', billing_month: '2026-11-01', due_date: '2026-11-30', claim_total: amount, active: true, ...extra,
});
const utilityPr = (lines: ReturnType<typeof bill>[]) => ({
  pr_no: 'PY-1', source: 'UTILITY', bill_month: '2026-11-01', created_at: '2026-11-24T02:00:00Z', amount_total: lines.reduce((s, l) => s + l.claim_total, 0), tax_amount: 0, vendor_name_snapshot: '台灣電力公司', bill_lines: lines,
});

describe('紙本請款單事由含計費期間', () => {
  it('每列事由加上計費期間；沒有期間的舊帳單不加', () => {
    const p = buildPaperPrint(utilityPr([
      bill(1, 's1', '甲店', 1000, { service_period_start: '2026-11-05', service_period_end: '2026-12-04' }),
      bill(2, 's2', '乙店', 2000),
    ]), null);
    expect(p.rows[0].reason).toBe('115年11月電費 11/05～12/04');
    expect(p.rows[1].reason).toBe('115年11月電費');
  });
  it('跨年期間用民國年完整寫；多張合併列取最早～最晚', () => {
    const p = buildPaperPrint(utilityPr([
      bill(1, 's1', '甲店', 1000, { service_period_start: '2026-12-05', service_period_end: '2027-01-04' }),
      bill(2, 's1', '甲店', 500, { service_period_start: '2026-12-01', service_period_end: '2027-01-03' }),
    ]), null);
    expect(p.rows[0].reason).toBe('115年11月電費（共 2 個電號） 115/12/01～116/01/04');
  });
  it('同一列多種類型：沒有期間的電話費不寫、水電各寫一段', () => {
    const p = buildPaperPrint(utilityPr([
      bill(1, 's1', '甲店', 1000, { expense_type: 'PHONE' }),
      bill(2, 's1', '甲店', 500, { expense_type: 'WATER', service_period_start: '2026-11-01', service_period_end: '2026-12-31' }),
      bill(3, 's2', '乙店', 700, { service_period_start: '2026-11-05', service_period_end: '2026-12-04' }),
      bill(4, 's2', '乙店', 300, { expense_type: 'WATER', service_period_start: '2026-10-01', service_period_end: '2026-11-30' }),
    ]), null);
    expect(p.rows[0].reason).toBe('115年11月電話費、水費（共 2 張帳單） 水費 11/01～12/31');
    expect(p.rows[1].reason).toBe('115年11月電費、水費（共 2 張帳單） 電費 11/05～12/04、水費 10/01～11/30');
  });
  it('請款單有申請事由覆寫時照覆寫印，不加期間', () => {
    const p = buildPaperPrint({ ...utilityPr([bill(1, 's1', '甲店', 1000, { service_period_start: '2026-11-05', service_period_end: '2026-12-04' })]), reason_override: '十一月電費' }, null);
    expect(p.rows[0].reason).toBe('十一月電費');
  });
  it('事由變長時先縮字（不截斷、不小於下限）、再放不下才換行', () => {
    expect(reasonFit('115年11月電費')).toEqual({ scale: 1, wrap: false });
    const long = '115年11月電費（共 2 個電號） 電費 115/12/01～116/01/04';
    const f = reasonFit(long);
    expect(f.scale).toBeLessThan(1);
    expect(f.scale).toBeGreaterThanOrEqual(REASON_MIN_SCALE);
    expect(f.wrap).toBe(false);
    const huge = reasonFit('一二三四五六七八九十'.repeat(5));
    expect(huge).toEqual({ scale: REASON_MIN_SCALE, wrap: true });
    expect(REASON_COL_CAPACITY).toBeGreaterThan(20);
  });
});

describe('Excel「帳單明細」頁（A5）', () => {
  const rows = [
    { location_name: 'ZT01 乙店', store_code: 'ZT01', expense_type: 'WATER', billing_month: '2038-03-01', service_period_start: '2038-02-01', service_period_end: '2038-03-02', electricity_kwh: null, amount: 600 },
    { location_name: 'VW001 甲店', store_code: 'VW001', expense_type: 'ELECTRICITY', billing_month: '2038-04-01', service_period_start: '2038-03-05', service_period_end: '2038-05-04', electricity_kwh: 1234.5, amount: 3050 },
    { location_name: 'VW001 甲店', store_code: 'VW001', expense_type: 'WATER', billing_month: '2038-04-01', service_period_start: null, service_period_end: null, electricity_kwh: null, amount: 410 },
    { location_name: 'VW001 甲店', store_code: 'VW001', expense_type: 'ELECTRICITY', billing_month: '2038-03-01', service_period_start: '2038-01-05', service_period_end: '2038-03-04', electricity_kwh: 900, amount: 2000, identifier: '01-23-4567-89-0' },
    { location_name: '倉庫', store_code: null, expense_type: 'PHONE', billing_month: '2038-03-01', service_period_start: '2038-03-01', service_period_end: '2038-03-31', electricity_kwh: 99, amount: 310 },
  ];
  it('欄位與排序：門市→費用類型→帳單月份；其他據點排最後', () => {
    const s = detailSheet(rows);
    expect(s.name).toBe(DETAIL_SHEET_NAME);
    expect(s.aoa[0]).toEqual(Array.from(DETAIL_HEADERS));
    expect(s.aoa.slice(1).map((r) => `${r[0]}|${r[1]}|${r[2]}`)).toEqual([
      'VW001 甲店|水費|2038-04', 'VW001 甲店|電費|2038-03', 'VW001 甲店|電費|2038-04', 'ZT01 乙店|水費|2038-03', '倉庫|電話費|2038-03',
    ]);
  });
  it('天數、度數（只有電費）、每日平均金額（金額÷天數）；無期間的天數與平均留空', () => {
    const a = detailSheet(rows).aoa;
    const noPeriod = a[1];
    expect(noPeriod.slice(3)).toEqual(['', '', '', '', 410, '', '']);
    const e1 = a[2];
    expect(e1.slice(3)).toEqual(['2038/01/05', '2038/03/04', 59, 900, 2000, 33.9, '01-23-4567-89-0']);
    const e2 = a[3];
    expect(e2.slice(3)).toEqual(['2038/03/05', '2038/05/04', 61, 1234.5, 3050, 50, '']);
    const w = a[4];
    expect(w.slice(3)).toEqual(['2038/02/01', '2038/03/02', 30, '', 600, 20, '']);
    const phone = a[5];
    expect(phone[6]).toBe(''); // 電話費不帶度數
    expect(dailyAverage(100, 0)).toBeNull();
    expect(dailyAverage(1000, 3)).toBe(333.33);
  });
  it('真的寫出 xlsx 再讀回來，內容一致', () => {
    const book = buildSheetsWorkbook(XLSX, [detailSheet(rows)]);
    const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    const back = XLSX.read(buf, { type: 'buffer' });
    expect(back.SheetNames).toEqual([DETAIL_SHEET_NAME]);
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets[DETAIL_SHEET_NAME], { header: 1 });
    expect(aoa[0]).toEqual(Array.from(DETAIL_HEADERS));
    expect(aoa[2]).toEqual(['VW001 甲店', '電費', '2038-03', '2038/01/05', '2038/03/04', 59, 900, 2000, 33.9, '01-23-4567-89-0']);
    expect(aoa).toHaveLength(6);
  });
});
