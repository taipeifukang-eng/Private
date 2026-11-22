import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCalendarEntries,
  CALENDAR_DESCRIPTION_MAX,
  diffHolidays,
  entriesByMonth,
  entriesOnDate,
  holidayDiffSummary,
  holidayPublishNeedsConfirm,
  isSearchableColleague,
  monthGridDays,
  normalizePeopleQuery,
  PEOPLE_RESULT_LIMIT,
  validateCalendarDraft,
  type HolidayRow,
} from '@/lib/workspace/calendar-rules';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

// 固定種子的隨機數（結果可重現）
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('W23 月曆格線：與舊版 getMonthDays 逐月相同', () => {
  // 舊版 components/organization/OrganizationCalendarClient.tsx 的逐字副本
  function legacyMonthDays(year: number, month: number) {
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const count = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: count }, (_, index) => {
      const dayNumber = index - firstWeekday + 1;
      const date = new Date(Date.UTC(year, month, dayNumber));
      return { value: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
    });
  }
  it('舊版原始碼仍是這個寫法（被改動時先失敗，提醒重新比對）', () => {
    const src = read('components/organization/OrganizationCalendarClient.tsx');
    expect(src).toContain('const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();');
    expect(src).toContain('const count = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;');
    expect(src).toContain('const dayNumber = index - firstWeekday + 1;');
  });
  it('2020 到 2040 年每個月（含閏年二月、跨年）都相同', () => {
    let months = 0;
    for (let y = 2020; y <= 2040; y++) for (let m = 0; m < 12; m++) {
      expect(monthGridDays(y, m), `${y}-${m + 1}`).toEqual(legacyMonthDays(y, m));
      months++;
    }
    expect(months).toBe(252);
  });
  it('固定案例：2026 年 11 月週日為首、35 格；2026 年 2 月剛好 28 格；12 月補到隔年 1 月', () => {
    const nov = monthGridDays(2026, 10);
    expect(nov).toHaveLength(35);
    expect(nov[0]).toEqual({ value: '2026-11-01', day: 1, inMonth: true });
    expect(nov[34]).toEqual({ value: '2026-12-05', day: 5, inMonth: false });
    expect(monthGridDays(2026, 1)).toHaveLength(28);
    const dec = monthGridDays(2026, 11);
    expect(dec[dec.length - 1].value.startsWith('2027-01')).toBe(true);
    expect(dec[0]).toEqual({ value: '2026-11-29', day: 29, inMonth: false });
  });
  it('永遠是 7 的倍數，且當月每一天剛好出現一次', () => {
    for (let m = 0; m < 12; m++) {
      const cells = monthGridDays(2028, m);
      expect(cells.length % 7).toBe(0);
      const inMonth = cells.filter((c) => c.inMonth).map((c) => c.day);
      expect(inMonth).toEqual(Array.from({ length: new Date(Date.UTC(2028, m + 1, 0)).getUTCDate() }, (_, i) => i + 1));
    }
  });
});

describe('W23 行事清單：來源篩選、排序、單日與全年歸月', () => {
  const data = {
    companyEvents: [
      { id: 'c1', title: 'B會議', event_type: 'meeting', start_date: '2026-03-10', end_date: '2026-03-12' },
      { id: 'c2', title: 'A會議', event_type: 'meeting', start_date: '2026-03-10', end_date: '2026-03-10' },
    ],
    personalEvents: [{ id: 'p1', title: '個人', start_date: '2026-01-31', end_date: '2026-02-02', owner_id: 'u1' }],
    holidays: [{ id: 'h1', name: '春節', holiday_date: '2026-02-17', day_type: 'national_holiday' }],
  };
  const all = { company: true, personal: true, holiday: true };
  it('三種來源合併，依開始日再依名稱排序，key 帶來源', () => {
    const list = buildCalendarEntries(data, all);
    expect(list.map((e) => e.key)).toEqual(['personal:p1', 'holiday:h1', 'company:c2', 'company:c1']);
    expect(list.find((e) => e.source === 'holiday')).toMatchObject({ title: '春節', start_date: '2026-02-17', end_date: '2026-02-17', day_type: 'national_holiday' });
  });
  it('來源篩選：只勾政府假日時只剩假日；全不勾是空清單', () => {
    expect(buildCalendarEntries(data, { company: false, personal: false, holiday: true }).map((e) => e.source)).toEqual(['holiday']);
    expect(buildCalendarEntries(data, { company: false, personal: false, holiday: false })).toEqual([]);
  });
  it('跨日行事每一天都算；全年清單只算在開始日的那個月', () => {
    const list = buildCalendarEntries(data, all);
    expect(entriesOnDate(list, '2026-03-11').map((e) => e.key)).toEqual(['company:c1']);
    expect(entriesOnDate(list, '2026-02-01').map((e) => e.key)).toEqual(['personal:p1']);
    const byMonth = entriesByMonth(list);
    expect(byMonth).toHaveLength(12);
    expect(byMonth.map((m) => m.events.length)).toEqual([1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(byMonth.reduce((n, m) => n + m.events.length, 0)).toBe(list.length);
  });
});

describe('W23 Q21：政府假日差異', () => {
  const row = (d: string, name = '假日', t = 'national_holiday'): HolidayRow => ({ holiday_date: d, name, day_type: t });
  it('完全相同：沒有差異', () => {
    const a = [row('2099-01-01'), row('2099-02-18')];
    const d = diffHolidays(a, [...a].reverse());
    expect(d).toMatchObject({ identical: true, changeCount: 0, unchanged: 2 });
    expect(holidayDiffSummary(d)).toBe('與現有版本完全相同');
  });
  it('新增、移除、改名、改類型各自計算；同一天又改名又改類型算兩件', () => {
    const before = [row('2099-01-01', '元旦'), row('2099-02-19', '春節'), row('2099-04-04', '兒童節'), row('2099-05-01', '勞動節')];
    const after = [row('2099-01-01', '開國紀念日'), row('2099-04-04', '兒童節補假', 'substitute_holiday'), row('2099-05-01', '勞動節'), row('2099-10-10', '國慶日')];
    const d = diffHolidays(before, after);
    expect(d.added.map((r) => r.holiday_date)).toEqual(['2099-10-10']);
    expect(d.removed.map((r) => r.holiday_date)).toEqual(['2099-02-19']);
    expect(d.renamed).toEqual([
      { holiday_date: '2099-01-01', before: '元旦', after: '開國紀念日' },
      { holiday_date: '2099-04-04', before: '兒童節', after: '兒童節補假' },
    ]);
    expect(d.retyped).toEqual([{ holiday_date: '2099-04-04', before: 'national_holiday', after: 'substitute_holiday' }]);
    expect(d.unchanged).toBe(1);
    expect(d.changeCount).toBe(1 + 1 + 2 + 1);
    expect(d.identical).toBe(false);
    expect(holidayDiffSummary(d)).toBe('新增 1 筆、移除 1 筆、改名 2 筆、改類型 1 筆');
  });
  it('第一次匯入（現有版本是空的）：全部算新增', () => {
    const d = diffHolidays([], [row('2099-01-01'), row('2099-01-02')]);
    expect(d).toMatchObject({ changeCount: 2, unchanged: 0 });
    expect(d.added).toHaveLength(2);
  });
  it('隨機 300 組：把差異套回現有版本一定得到新版本；筆數守恆', () => {
    const rand = rng(20261108);
    const names = ['元旦', '春節', '清明節', '端午節', '中秋節', '國慶日', '補假'];
    const types = ['national_holiday', 'substitute_holiday', 'makeup_workday'];
    const make = () => {
      const out = new Map<string, HolidayRow>();
      const n = Math.floor(rand() * 14);
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rand() * 28);
        const mon = 1 + Math.floor(rand() * 12);
        const date = `2099-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        out.set(date, row(date, names[Math.floor(rand() * names.length)], types[Math.floor(rand() * types.length)]));
      }
      return Array.from(out.values());
    };
    for (let i = 0; i < 300; i++) {
      const before = make();
      const after = make();
      const d = diffHolidays(before, after);
      // 套用差異
      const applied = new Map(before.map((r) => [r.holiday_date, { ...r }]));
      for (const r of d.removed) applied.delete(r.holiday_date);
      for (const r of d.added) applied.set(r.holiday_date, { ...r });
      for (const r of d.renamed) applied.get(r.holiday_date)!.name = r.after;
      for (const r of d.retyped) applied.get(r.holiday_date)!.day_type = r.after;
      const sort = (rows: HolidayRow[]) => [...rows].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
      expect(sort(Array.from(applied.values())), `case ${i}`).toEqual(sort(after));
      expect(d.unchanged + d.removed.length + d.renamed.filter((r) => d.retyped.every((t) => t.holiday_date !== r.holiday_date)).length + d.retyped.length).toBeGreaterThanOrEqual(0);
      const kept = before.length - d.removed.length;
      expect(d.unchanged + new Set([...d.renamed, ...d.retyped].map((r) => r.holiday_date)).size, `case ${i} kept`).toBe(kept);
      expect(d.identical).toBe(d.changeCount === 0);
    }
  });
  it('發布前要不要二次確認：同年度已有發布版本，而且確認旗標必須剛好是 true', () => {
    expect(holidayPublishNeedsConfirm(false, undefined)).toBe(false);
    expect(holidayPublishNeedsConfirm(false, true)).toBe(false);
    expect(holidayPublishNeedsConfirm(true, undefined)).toBe(true);
    expect(holidayPublishNeedsConfirm(true, false)).toBe(true);
    for (const v of ['true', 1, 'yes', null, {}]) expect(holidayPublishNeedsConfirm(true, v), String(v)).toBe(true);
    expect(holidayPublishNeedsConfirm(true, true)).toBe(false);
  });
});

describe('W23 Q18：分享對象搜尋', () => {
  it('停用、離職、沒有任何在職主檔的人搜不到；沒有員工主檔的帳號（例如總部）視為在職', () => {
    const emp = (is_active: boolean | null, employment_status: string | null) => ({ is_active, employment_status });
    const cases: [string, Parameters<typeof isSearchableColleague>[0], boolean][] = [
      ['在職', { disabled: false, employeeRows: [emp(true, 'active')] }, true],
      ['沒有主檔', { disabled: false, employeeRows: [] }, true],
      ['帳號停用', { disabled: true, employeeRows: [emp(true, 'active')] }, false],
      ['帳號停用且沒有主檔', { disabled: true, employeeRows: [] }, false],
      ['離職（狀態）', { disabled: false, employeeRows: [emp(true, 'resigned')] }, false],
      ['離職（停用旗標）', { disabled: false, employeeRows: [emp(false, null)] }, false],
      ['多筆主檔，只要一筆在職就算在職（調店後舊店那筆已停用）', { disabled: false, employeeRows: [emp(false, 'resigned'), emp(true, 'active')] }, true],
      ['旗標空值視為在職', { disabled: false, employeeRows: [emp(null, null)] }, true],
      ['旗標空值但狀態離職', { disabled: false, employeeRows: [emp(null, 'resigned')] }, false],
    ];
    for (const [name, facts, expected] of cases) expect(isSearchableColleague(facts), name).toBe(expected);
  });
  it('搜尋文字處理與舊版 people API 相同（舊版原始碼仍是這個寫法）', () => {
    const src = read('app/api/organization/calendar/people/route.ts');
    expect(src).toContain(".replace(/[%_]/g, ' ').trim()");
    expect(src).toContain('query.length < 2');
    expect(src).toContain('query.length > 80');
    expect(src).toContain('.slice(0, 30)');
    expect(PEOPLE_RESULT_LIMIT).toBe(30);
    expect(normalizePeopleQuery('  王%小_明 ')).toEqual({ query: '王 小 明', tooShort: false, tooLong: false });
    expect(normalizePeopleQuery('a')).toMatchObject({ tooShort: true });
    expect(normalizePeopleQuery(' % ')).toMatchObject({ query: '', tooShort: true });
    expect(normalizePeopleQuery('x'.repeat(81))).toMatchObject({ tooLong: true });
    expect(normalizePeopleQuery('x'.repeat(80))).toMatchObject({ tooLong: false });
    expect(normalizePeopleQuery(null)).toMatchObject({ query: '', tooShort: true });
  });
});

describe('W23 表單預檢：與舊版個人行程／公司行事的驗證逐組相同', () => {
  // 舊版 app/api/organization/calendar/personal-events/route.ts validatePersonalEvent 的邏輯副本（錯誤文字取自原始碼）
  function legacy(d: { title: string; start_date: string; end_date: string; is_all_day: boolean; start_time: string; end_time: string; location: string; description: string }) {
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
    const title = d.title.trim();
    if (!title || title.length > 160) return '請輸入行事名稱（最多 160 字）';
    if (!isDate(d.start_date) || !isDate(d.end_date) || d.end_date < d.start_date) return '請確認行事日期範圍';
    if (d.location.trim().length > 500) return '地點最多 500 字';
    const validTime = (v: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (!d.is_all_day && (!validTime(d.start_time) || !validTime(d.end_time) || (d.start_date === d.end_date && d.end_time <= d.start_time))) {
      return '請確認開始與結束時間；同一天的結束時間需晚於開始時間';
    }
    if (d.description.trim().length > 3000) return '補充說明最多 3000 字';
    return null;
  }
  it('舊版原始碼的錯誤文字沒有變', () => {
    const src = read('app/api/organization/calendar/personal-events/route.ts');
    for (const text of ['請輸入行事名稱（最多 160 字）', '請確認行事日期範圍', '地點最多 500 字', '請確認開始與結束時間；同一天的結束時間需晚於開始時間', '補充說明最多 3000 字']) expect(src).toContain(text);
    expect(CALENDAR_DESCRIPTION_MAX).toBe(3000);
  });
  it('隨機 600 組輸入，結果都相同', () => {
    const rand = rng(77);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const dates = ['2099-03-10', '2099-03-11', '2099-02-30', '2099/03/10', '', '2099-13-01', '2098-12-31'];
    const times = ['09:00', '10:30', '25:00', '9:00', '', '23:59', '00:00'];
    for (let i = 0; i < 600; i++) {
      const d = {
        title: pick(['', '  ', '會議', 'x'.repeat(160), 'x'.repeat(161), ' 會議 ']),
        start_date: pick(dates), end_date: pick(dates), is_all_day: rand() < 0.5,
        start_time: pick(times), end_time: pick(times),
        location: pick(['', '總部', 'x'.repeat(500), 'x'.repeat(501)]),
        description: pick(['', '說明', 'x'.repeat(3000), 'x'.repeat(3001)]),
      };
      expect(validateCalendarDraft(d), JSON.stringify(d)).toBe(legacy(d));
    }
  });
});
