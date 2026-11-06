import { describe, expect, it } from 'vitest';
import {
  annualFeeReminder,
  applyBonusConfirmation,
  BONUS_FIELDS,
  countConfirmable,
  homeFlags,
  isStillActive,
  keelungReminderStart,
  licenseReminder,
  licenseReminderStart,
  monthBirthdays,
  onboardingList,
  pickHomeTasks,
  summarizeBonus,
  taipeiDate,
  transferPendingScope,
} from '../../../lib/workspace/home-rules';

// W11 單元層（M3 C.1–C.4、C.6）：首頁的純規則。舊版規則照搬（年費 4 月起、基隆規則、執照到期前兩年、離職排除、壽星排序、獎金 20 欄位），
// 新規則：Q12 獎金月份確認標註、Q13 督導只數可確認的調店、Q14 未完成優先。

const at = (ymd: string) => taipeiDate(new Date(`${ymd}T04:00:00+08:00`));

describe('可見對象旗標（Q11 照舊版，含缺口）', () => {
  it('管理員、經理看壽星、年費、執照；範圍是全部', () => {
    for (const role of ['admin', 'manager']) {
      const f = homeFlags({ role, jobTitle: '營業部主管' });
      expect(f).toMatchObject({ canViewBirthdays: true, canViewAnnualFee: true, canViewLicense: true, reminderScopeAll: true, licenseGroupByZone: true });
    }
  });
  it('督導：壽星、年費、執照都看，範圍只有自己的門市，執照平列', () => {
    expect(homeFlags({ role: 'supervisor', jobTitle: '督導' })).toMatchObject({
      canViewBirthdays: true, canViewAnnualFee: true, canViewLicense: true, reminderScopeAll: false, licenseGroupByZone: false,
    });
  });
  it('店長與代理店長：看壽星與年費，不看執照（舊版缺口維持）', () => {
    for (const jobTitle of ['店長', '代理店長'])
      expect(homeFlags({ role: 'store_manager', jobTitle })).toMatchObject({ canViewBirthdays: true, canViewAnnualFee: true, canViewLicense: false });
  });
  it('營業部行政主管：年費與執照看全部並分督導區，但不看壽星', () => {
    expect(homeFlags({ role: 'member', jobTitle: '營業部行政助理主管' })).toMatchObject({
      canViewBirthdays: false, canViewAnnualFee: true, canViewLicense: true, reminderScopeAll: true, licenseGroupByZone: true,
    });
  });
  it('role 是 manager 但職稱是督導或店長時，不算經理（舊版 isManagerOrAdmin）', () => {
    expect(homeFlags({ role: 'manager', jobTitle: '督導' }).isManagerOrAdmin).toBe(false);
    expect(homeFlags({ role: 'manager', jobTitle: '店長' }).isManagerOrAdmin).toBe(false);
  });
  it('一般成員什麼提醒都沒有', () => {
    expect(homeFlags({ role: 'member', jobTitle: '店員' })).toMatchObject({ canViewBirthdays: false, canViewAnnualFee: false, canViewLicense: false });
    expect(homeFlags({ role: null, jobTitle: null }).canViewAnnualFee).toBe(false);
  });
});

describe('台北日期', () => {
  it('UTC 月底晚間已是台北隔天', () => {
    const d = taipeiDate(new Date('2026-11-30T17:00:00Z'));
    expect(d).toMatchObject({ year: 2026, month: 12, day: 1, yearMonth: '2026-12', monthEnd: '2026-12-31' });
  });
  it('月底日期（含閏年二月）', () => {
    expect(taipeiDate(new Date('2028-02-10T00:00:00Z')).monthEnd).toBe('2028-02-29');
    expect(taipeiDate(new Date('2026-11-07T00:00:00Z')).monthEnd).toBe('2026-11-30');
  });
});

describe('常年會費提醒', () => {
  const rec = (over: object = {}) => ({ association_city: '台北市', fee_year: null, fee_period_end: null, ...over });
  it('一般縣市：4 月前不提醒，4 月起提醒', () => {
    expect(annualFeeReminder([], at('2026-03-31'))).toBeNull();
    expect(annualFeeReminder([], at('2026-04-01'))).toMatchObject({ city: '未設定', reason: '115 年（民國）尚無常年會費申請記錄' });
  });
  it('當年度（西元或民國）有繳費紀錄就不提醒', () => {
    expect(annualFeeReminder([rec({ fee_year: 2026 })], at('2026-11-07'))).toBeNull();
    expect(annualFeeReminder([rec({ fee_year: 115 })], at('2026-11-07'))).toBeNull();
    expect(annualFeeReminder([rec({ fee_year: 114 })], at('2026-11-07'))).toMatchObject({ city: '台北市' });
  });
  it('城市取最新一筆（輸入已新到舊）', () => {
    expect(annualFeeReminder([rec({ association_city: '新北市' }), rec()], at('2026-11-07'))!.city).toBe('新北市');
  });
  it('基隆市：上一期結束日所在月份加 4 個月的 1 日起提醒', () => {
    expect(keelungReminderStart('2026-06-30')).toBe('2026-10-01');
    expect(keelungReminderStart('2026-09-15')).toBe('2027-01-01');
    expect(keelungReminderStart('2026-12-31')).toBe('2027-04-01');
    expect(keelungReminderStart(null)).toBeNull();
    const r = (end: string | null) => [rec({ association_city: '基隆市', fee_period_end: end })];
    expect(annualFeeReminder(r('2026-06-30'), at('2026-09-30'))).toBeNull();
    expect(annualFeeReminder(r('2026-06-30'), at('2026-10-01'))!.reason).toBe('基隆規則：上一期結束後第4個月起提醒（上一期至 2026-06-30）');
  });
  it('基隆市沒有結束日：暫以 4 月起；已有當年度紀錄也照基隆規則（舊版行為）', () => {
    const r = [rec({ association_city: '基隆市', fee_year: 2026 })];
    expect(annualFeeReminder(r, at('2026-03-01'))).toBeNull();
    expect(annualFeeReminder(r, at('2026-04-01'))!.reason).toBe('基隆規則：尚無上一期結束日，暫以 4 月起提醒');
  });
});

describe('執照更新提醒', () => {
  it('到期年前兩年的 1/1 起提醒（只看年份）', () => {
    expect(licenseReminderStart('2028-12-31')).toBe('2026-01-01');
    expect(licenseReminder('2028-12-31', at('2025-12-31'))).toBeNull();
    expect(licenseReminder('2028-12-31', at('2026-01-01'))).toMatchObject({ date: '2028-12-31', reason: '執照更新日 2028/12/31，已進入到期前 2 年提醒區間' });
  });
  it('到期後持續提醒；日期缺漏不提醒', () => {
    expect(licenseReminder('2020-01-01', at('2026-11-07'))).not.toBeNull();
    expect(licenseReminder(null, at('2026-11-07'))).toBeNull();
    expect(licenseReminder('abc', at('2026-11-07'))).toBeNull();
  });
});

describe('離職排除', () => {
  it('離職日不早於復職或到職日就算已離職；沒有離職紀錄算在職', () => {
    expect(isStillActive(null, null)).toBe(true);
    expect(isStillActive(null, '2026-01-01')).toBe(true);
    expect(isStillActive('2026-05-01', null)).toBe(false);
    expect(isStillActive('2026-05-01', '2026-05-01')).toBe(false);
    expect(isStillActive('2026-05-01', '2026-06-01')).toBe(true);
  });
});

describe('本月壽星', () => {
  const b = (code: string, birthday: string, name = code) => ({ employee_code: code, employee_name: name, birthday });
  it('只留本月、同員編去重（保留先出現者）、依日期排序', () => {
    const rows = [b('A3', '1990-11-20'), b('A1', '1985-11-03'), b('A2', '1992-10-30'), b('A1', '1985-11-04', 'dup'), b('A4', '1988-11-03')];
    expect(monthBirthdays(rows, 11).map((r) => r.employee_code)).toEqual(['A1', 'A4', 'A3']);
    expect(monthBirthdays(rows, 11)[0].employee_name).toBe('A1');
    expect(monthBirthdays(rows, 12)).toEqual([]);
  });
});

describe('新人入職', () => {
  const o = (code: string, date: string, store: string | null, name = '新人', extra: object = {}) => ({
    employee_code: code, employee_name: name, movement_date: date, store_id: store, store_code: store, store_name: store, onboarding_is_pharmacist: null, ...extra,
  });
  it('同員編同門市只留第一筆；員編轉大寫；缺姓名或員編的略過；依到職日、門市、員編排序（含未來日期）', () => {
    const list = onboardingList([
      o('fk2', '2026-11-20', 'S2'), o('FK1', '2026-11-05', 'S2'), o('fk1', '2026-11-06', 'S2', '重複'), o('FK3', '2026-11-05', 'S1'),
      o('FK1', '2026-11-05', 'S3'), o('', '2026-11-01', 'S1'), o('FK9', '2026-11-01', 'S1', '  '),
    ]);
    expect(list.map((r) => `${r.movement_date} ${r.store_id} ${r.employee_code}`)).toEqual([
      '2026-11-05 S1 FK3', '2026-11-05 S2 FK1', '2026-11-05 S3 FK1', '2026-11-20 S2 FK2',
    ]);
    expect(list[1].employee_name).toBe('新人');
  });
});

describe('每月獎金明細', () => {
  const row = (ym: string, store: string, over: Record<string, unknown> = {}) => ({ year_month: ym, store_id: store, ...over });
  it('20 個欄位、合計加總、金額為 0 的欄位與月份不顯示', () => {
    expect(BONUS_FIELDS).toHaveLength(20);
    const m = summarizeBonus([row('2026-10', 'S1', { group_bonus: 1000, talent_bonus: '250.5', transport_fee: -100 }), row('2026-09', 'S1', { group_bonus: 0 })]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ yearMonth: '2026-10', total: 1150.5 });
    expect(m[0].items.map((i) => i.key)).toEqual(['group_bonus', 'talent_bonus', 'transport_fee']);
  });
  it('同月多門市加總；其他獎金備註去重並以「；」串接，其他獎金為 0 時不帶備註', () => {
    const m = summarizeBonus([
      row('2026-10', 'S1', { other_bonus: 100, other_bonus_note: '加班' }), row('2026-10', 'S2', { other_bonus: 50, other_bonus_note: '加班' }),
      row('2026-10', 'S2', { other_bonus: 10, other_bonus_note: '全勤' }), row('2026-10', 'S3', { group_bonus: 5, other_bonus: 0, other_bonus_note: '不顯示' }),
    ]);
    expect(m[0]).toMatchObject({ total: 165, otherNote: '加班；全勤' });
    expect(m[0].storeIds).toEqual(['S1', 'S2', 'S3']);
  });
  it('只留最近 12 個月，新到舊', () => {
    const yms = ['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03'];
    const rows = yms.map((ym) => row(ym, 'S1', { group_bonus: 1 }));
    const m = summarizeBonus(rows);
    expect(m).toHaveLength(12);
    expect([m[0].yearMonth, m[11].yearMonth]).toEqual(['2026-03', '2025-04']);
  });
  it('Q12：該月所有門市都已確認才算已確認；查不到視為未確認', () => {
    const months = summarizeBonus([row('2026-10', 'S1', { group_bonus: 1 }), row('2026-10', 'S2', { group_bonus: 1 }), row('2026-09', 'S1', { group_bonus: 1 })]);
    const done = new Set(['2026-10::S1', '2026-10::S2']);
    const out = applyBonusConfirmation(months, (ym, s) => done.has(`${ym}::${s}`));
    expect(out.map((m) => [m.yearMonth, m.confirmed])).toEqual([['2026-10', true], ['2026-09', false]]);
    const partial = applyBonusConfirmation(months, (ym, s) => ym === '2026-10' && s === 'S1');
    expect(partial[0].confirmed).toBe(false);
  });
});

describe('調店待確認數（Q13）', () => {
  it('沒有確認權限不顯示；管理員與有建立權限者看全部；其他（督導）只數可確認的', () => {
    expect(transferPendingScope({ isAdmin: false, canCreate: true, canConfirm: false })).toBe('none');
    expect(transferPendingScope({ isAdmin: true, canCreate: false, canConfirm: true })).toBe('all');
    expect(transferPendingScope({ isAdmin: false, canCreate: true, canConfirm: true })).toBe('all');
    expect(transferPendingScope({ isAdmin: false, canCreate: false, canConfirm: true })).toBe('supervised');
  });
  it('原店或新店任一邊是我督導的門市才算可確認', () => {
    const sup = new Set(['A', 'B']);
    const reqs = [
      { from_store_id: 'A', to_store_id: 'X' }, { from_store_id: 'X', to_store_id: 'B' }, { from_store_id: 'A', to_store_id: 'B' }, { from_store_id: 'X', to_store_id: 'Y' },
    ];
    expect(countConfirmable(reqs, sup)).toBe(3);
    expect(countConfirmable(reqs, new Set())).toBe(0);
  });
});

describe('首頁我的任務（Q14）', () => {
  const t = (id: string, status: string, created: string, to = 'me') => ({ id, status, created_at: created, assigned_to: to });
  it('只列指派給我的；未完成優先、新到舊；最多 3 筆', () => {
    const rows = [t('a', 'completed', '2026-11-06'), t('b', 'pending', '2026-11-01'), t('c', 'in_progress', '2026-11-03'), t('d', 'pending', '2026-11-05'), t('e', 'pending', '2026-11-07', 'other')];
    expect(pickHomeTasks(rows, 'me').map((r) => r.id)).toEqual(['d', 'c', 'b']);
  });
  it('未完成不足 3 筆才補已完成（已完成也依新到舊）', () => {
    const rows = [t('a', 'completed', '2026-11-06'), t('b', 'pending', '2026-11-01'), t('z', 'completed', '2026-11-08'), t('y', 'completed', '2026-11-02')];
    expect(pickHomeTasks(rows, 'me').map((r) => r.id)).toEqual(['b', 'z', 'a']);
  });
  it('沒有任務回空陣列', () => {
    expect(pickHomeTasks([], 'me')).toEqual([]);
  });
});
