import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { UTILITY_BILL_CODE_MESSAGES, messageForCode } from '@/lib/workspace/general-affairs/utility-bill-messages';
import {
  BILL_PAYLOAD_FIELDS, billStatus, computeAnomaly, EXPENSE_TYPES, identifierLabel, isNoDueDate, isOverdue, monthStart, normalizeLocationName, paidChangedFields, paidDateRange,
  parseReportParams, parseUtilityFilters, pickBillPayload, shiftMonth, utilityBillAbilities, validatePaidDate,
} from '@/lib/workspace/general-affairs/utility-bill-rules';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';
import { emptyBillForm, formFromBill, formProblem, payloadFromForm, type Bill } from '../../../vue-workspace/src/lib/ga-utility-bills';

// 第 6 批 G23（水電網費）單元測試：異常基準（歷史 0／1／2／3／4 筆、雙月、排除自己與 0 元、恰好 2 倍與一半不提醒、本筆 0 元提醒）、標記已繳日期範圍、逾期定義、已繳關鍵欄位、
// 請求整形、其他據點名稱正規化、權限與導覽旗標一致、頁面登錄、SQL 檔與規則逐條對照（原始碼層級）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (...allowed: string[]) => (...codes: string[]) => codes.some((c) => allowed.includes(c));
const VIEW = 'general_affairs.utility_bill.view';
const MANAGE = 'general_affairs.utility_bill.manage';
const h = (month: string, amount: number) => ({ billing_month: `${month}-01`, amount });
const cur = (month: string, amount: number) => ({ billing_month: `${month}-01`, amount });

describe('金額異常基準（V7）', () => {
  it('歷史 0 筆：不比較，只有 0 元才提醒', () => {
    expect(computeAnomaly([], cur('2038-05', 99999))).toMatchObject({ warn: false, sample_count: 0, baseline: null, partial: false });
    expect(computeAnomaly([], cur('2038-05', 0))).toMatchObject({ warn: true, reason: 'ZERO', baseline: null });
  });
  it('歷史 1 筆與 2 筆：照用現有筆數並標「僅 N 筆參考」', () => {
    const one = computeAnomaly([h('2038-04', 1000)], cur('2038-05', 2500));
    expect(one).toMatchObject({ warn: true, reason: 'HIGH', baseline: 1000, sample_count: 1, partial: true });
    const two = computeAnomaly([h('2038-04', 1000), h('2038-03', 2000)], cur('2038-05', 600));
    expect(two).toMatchObject({ warn: true, reason: 'LOW', baseline: 1500, sample_count: 2, partial: true });
  });
  it('歷史 3 筆：平均三筆，不標僅 N 筆', () => {
    const r = computeAnomaly([h('2038-04', 900), h('2038-03', 1000), h('2038-02', 1100)], cur('2038-05', 1000));
    expect(r).toMatchObject({ warn: false, baseline: 1000, sample_count: 3, partial: false });
  });
  it('歷史 4 筆：只取最近 3 筆（最舊的那筆不算）', () => {
    const r = computeAnomaly([h('2038-01', 9000), h('2038-02', 1000), h('2038-03', 1000), h('2038-04', 1000)], cur('2038-05', 1000));
    expect(r.baseline).toBe(1000);
    expect(r.samples.map((s) => s.billing_month)).toEqual(['2038-04-01', '2038-03-01', '2038-02-01']);
  });
  it('雙月帳單（隔月一筆）照樣取最近三筆，不補齊月份', () => {
    const r = computeAnomaly([h('2038-01', 600), h('2038-03', 800), h('2038-05', 1000), h('2038-07', 5000)], cur('2038-09', 3000));
    expect(r.samples.map((s) => s.billing_month)).toEqual(['2038-07-01', '2038-05-01', '2038-03-01']);
    expect(r.baseline).toBe(2266.67);
  });
  it('排除 0 元與本筆月份以後的帳單；排除後不足三筆就用現有筆數', () => {
    const r = computeAnomaly([h('2038-04', 0), h('2038-03', 1000), h('2038-05', 7777), h('2038-06', 8888)], cur('2038-05', 1200));
    expect(r.sample_count).toBe(1);
    expect(r.baseline).toBe(1000);
    expect(r.warn).toBe(false);
  });
  it('恰好 2 倍與恰好一半不提醒；超過一點點就提醒', () => {
    const base = [h('2038-04', 1000), h('2038-03', 1000), h('2038-02', 1000)];
    expect(computeAnomaly(base, cur('2038-05', 2000)).warn).toBe(false);
    expect(computeAnomaly(base, cur('2038-05', 2000.01))).toMatchObject({ warn: true, reason: 'HIGH' });
    expect(computeAnomaly(base, cur('2038-05', 500)).warn).toBe(false);
    expect(computeAnomaly(base, cur('2038-05', 499.99))).toMatchObject({ warn: true, reason: 'LOW' });
  });
  it('本筆 0 元一律提醒（原因是 ZERO，不是 LOW）', () => {
    expect(computeAnomaly([h('2038-04', 1000)], cur('2038-05', 0)).reason).toBe('ZERO');
  });
  it('多打一個零（10 倍）提醒並附基準與明細', () => {
    const r = computeAnomaly([h('2038-04', 1200), h('2038-03', 1300), h('2038-02', 1100)], cur('2038-05', 12000));
    expect(r).toMatchObject({ warn: true, reason: 'HIGH', baseline: 1200, sample_count: 3 });
    expect(r.samples).toHaveLength(3);
  });
});

describe('逾期定義（V8）', () => {
  const today = '2038-06-15';
  it('到期當天不逾期、前一天逾期', () => {
    expect(isOverdue({ due_date: '2038-06-15' }, today)).toBe(false);
    expect(isOverdue({ due_date: '2038-06-14' }, today)).toBe(true);
  });
  it('沒有到期日永不逾期；已繳不逾期；已刪除不逾期', () => {
    expect(isOverdue({ due_date: null }, today)).toBe(false);
    expect(isOverdue({ due_date: '2038-01-01', paid_at: '2038-01-02' }, today)).toBe(false);
    expect(isOverdue({ due_date: '2038-01-01', deleted_at: '2038-02-01T00:00:00Z' }, today)).toBe(false);
  });
  it('未繳且沒填到期日另列提示（不計逾期）', () => {
    expect(isNoDueDate({ due_date: null })).toBe(true);
    expect(isNoDueDate({ due_date: null, paid_at: '2038-01-01' })).toBe(false);
    expect(isNoDueDate({ due_date: '2038-01-01' })).toBe(false);
  });
  it('狀態文字：已刪除、已繳、逾期、待繳', () => {
    expect(billStatus({ deleted_at: 'x', due_date: '2000-01-01' }, today)).toBe('deleted');
    expect(billStatus({ paid_at: '2038-01-01', due_date: '2000-01-01' }, today)).toBe('paid');
    expect(billStatus({ due_date: '2038-06-01' }, today)).toBe('overdue');
    expect(billStatus({ due_date: '2038-06-20' }, today)).toBe('unpaid');
  });
});

describe('標記已繳日期範圍（V8）', () => {
  const today = '2038-03-20';
  it('範圍：帳單月份前 1 個月的 1 日到今天', () => {
    expect(paidDateRange('2038-03-01', today)).toEqual({ min: '2038-02-01', max: today });
    expect(paidDateRange('2038-03', today).min).toBe('2038-02-01');
    expect(paidDateRange('2038-01-01', today).min).toBe('2037-12-01');
  });
  it('今天可、明天不可；帳單月份前 1 個月的 1 日可、再早一天不可', () => {
    expect(validatePaidDate('2038-03-20', '2038-03-01', today).ok).toBe(true);
    expect(validatePaidDate('2038-03-21', '2038-03-01', today)).toMatchObject({ ok: false, code: 'PAID_FUTURE' });
    expect(validatePaidDate('2038-02-01', '2038-03-01', today).ok).toBe(true);
    expect(validatePaidDate('2038-01-31', '2038-03-01', today)).toMatchObject({ ok: false, code: 'PAID_TOO_EARLY' });
  });
  it('日期格式錯誤與不存在的日期', () => {
    expect(validatePaidDate('2038/03/10', '2038-03-01', today)).toMatchObject({ ok: false, code: 'DATE_FORMAT' });
    expect(validatePaidDate('2038-02-30', '2038-03-01', today)).toMatchObject({ ok: false, code: 'DATE_FORMAT' });
  });
  it('月份工具', () => {
    expect(monthStart('2038-03')).toBe('2038-03-01');
    expect(monthStart('2038-03-17')).toBe('2038-03-01');
    expect(monthStart('2038-13')).toBeNull();
    expect(monthStart('abc')).toBeNull();
    expect(shiftMonth('2038-01-01', -1)).toBe('2037-12-01');
    expect(shiftMonth('2038-12-01', 1)).toBe('2039-01-01');
  });
});

describe('已繳帳單改關鍵欄位（V6）', () => {
  const base = { amount: 1200, store_id: 's1', location_name: 'VW001 測試一店', expense_type: 'WATER', billing_month: '2038-03-01', provider_name: '自來水公司', service_identifier: 'W-1', equipment_serial: null, account_number: null };
  it('沒有改關鍵欄位：空陣列（可直接存）', () => {
    expect(paidChangedFields(base, { ...base, due_date: '2038-04-01', notes: 'x' })).toEqual([]);
    expect(paidChangedFields(base, { ...base, billing_month: '2038-03' })).toEqual([]);
  });
  it('金額、據點、類型、月份、供應商、識別號碼各自偵測', () => {
    expect(paidChangedFields(base, { ...base, amount: 1300 })).toEqual(['amount']);
    expect(paidChangedFields(base, { ...base, store_id: 's2', location_name: 'VW002 測試二店' })).toEqual(['location']);
    expect(paidChangedFields(base, { ...base, expense_type: 'PHONE' })).toEqual(['expense_type']);
    expect(paidChangedFields(base, { ...base, billing_month: '2038-04-01' })).toEqual(['billing_month']);
    expect(paidChangedFields(base, { ...base, provider_name: '別家' })).toEqual(['provider_name']);
    expect(paidChangedFields(base, { ...base, service_identifier: 'W-2' })).toEqual(['identifier']);
    expect(paidChangedFields(base, { ...base, account_number: 'A1' })).toEqual(['identifier']);
  });
  it('空字串與 null 視為相同（不算被改）', () => {
    expect(paidChangedFields({ ...base, provider_name: null }, { ...base, provider_name: '' })).toEqual([]);
  });
});

describe('請求整形', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('列表篩選：月份、類型（轉大寫）、據點、狀態、逾期、已刪除、搜尋（截 100 字）', () => {
    expect(parseUtilityFilters(q('month=2038-03&type=water&status=overdue&search=%20abc%20'))).toEqual({ month: '2038-03', type: 'WATER', status: 'overdue', search: 'abc' });
    expect(parseUtilityFilters(q('overdue=1&deleted=1'))).toEqual({ overdue: true, deleted: true });
    expect(parseUtilityFilters(q(`search=${'x'.repeat(150)}`)).search).toHaveLength(100);
    expect(parseUtilityFilters(q(''))).toEqual({});
  });
  it('列表篩選：錯誤值丟白話錯誤', () => {
    expect(() => parseUtilityFilters(q('month=2038-13'))).toThrow('月份格式');
    expect(() => parseUtilityFilters(q('type=GAS'))).toThrow('費用類型');
    expect(() => parseUtilityFilters(q('storeId=abc'))).toThrow('據點格式');
    expect(() => parseUtilityFilters(q('status=zzz'))).toThrow('狀態篩選');
  });
  it('報表參數：月、季、年；年度 2000–2100；月份要與年度一致', () => {
    expect(parseReportParams(q('mode=month&year=2038&period=2038-03'))).toEqual({ mode: 'month', year: 2038, period: '2038-03' });
    expect(parseReportParams(q('mode=quarter&year=2038&period=4'))).toEqual({ mode: 'quarter', year: 2038, period: '4' });
    expect(parseReportParams(q('mode=year&year=2038'))).toEqual({ mode: 'year', year: 2038, period: null });
    expect(() => parseReportParams(q('mode=month&year=2038&period=2037-03'))).toThrow('月份');
    expect(() => parseReportParams(q('mode=quarter&year=2038&period=5'))).toThrow('季度');
    expect(() => parseReportParams(q('mode=year&year=1999'))).toThrow('年度');
    expect(() => parseReportParams(q('mode=week&year=2038'))).toThrow('月、季或年');
  });
  it('寫入欄位白名單：丟掉 id、建立者、刪除欄位', () => {
    const picked = pickBillPayload({ amount: 5, id: 'x', created_by: 'y', deleted_at: 'z', deletion_reason: 'w', updated_by: 'q', notes: 'n' });
    expect(picked).toEqual({ amount: 5, notes: 'n' });
    expect(BILL_PAYLOAD_FIELDS).not.toContain('deleted_at' as never);
    expect(BILL_PAYLOAD_FIELDS).toHaveLength(15);
  });
  it('其他據點名稱正規化：全半形、前後與連續空白、大小寫', () => {
    expect(normalizeLocationName('  ＡＢＣ　倉庫 ')).toBe('abc 倉庫');
    expect(normalizeLocationName('abc   倉庫')).toBe('abc 倉庫');
    expect(normalizeLocationName('')).toBe('未命名據點');
    expect(normalizeLocationName(null)).toBe('未命名據點');
  });
  it('類型與識別欄位標示', () => {
    expect(EXPENSE_TYPES).toEqual(['WATER', 'ELECTRICITY', 'PHONE', 'INTERNET']);
    expect(identifierLabel('ELECTRICITY')).toBe('電號');
    expect(identifierLabel('WATER')).toBe('水號');
  });
});

describe('表單規則（畫面層）', () => {
  const ok = () => ({ ...emptyBillForm(), store_id: 's', service_identifier: 'W1', amount: '100', billing_month: '2038-03' });
  it('必填：據點、金額、識別號碼；網路費電路編號或設備序號擇一', () => {
    expect(formProblem({ ...ok(), store_id: '', location_name: '' })).toMatch(/據點/);
    expect(formProblem({ ...ok(), amount: '' })).toMatch(/金額/);
    expect(formProblem({ ...ok(), amount: '-5' })).toMatch(/金額/);
    expect(formProblem({ ...ok(), service_identifier: '' })).toMatch(/水號/);
    expect(formProblem({ ...ok(), expense_type: 'INTERNET', service_identifier: '', equipment_serial: '' })).toMatch(/電路編號或設備序號/);
    expect(formProblem({ ...ok(), expense_type: 'INTERNET', service_identifier: '', equipment_serial: 'SN1' })).toBe('');
    expect(formProblem(ok())).toBe('');
  });
  it('繳費日期在表單先擋未來與過早（與資料庫同規則）', () => {
    expect(formProblem({ ...ok(), billing_month: '2000-03', paid_at: '2000-01-31' })).toMatch(/不能早於/);
    expect(formProblem({ ...ok(), billing_month: '2000-03', paid_at: '2000-02-01' })).toBe('');
    expect(formProblem({ ...ok(), billing_month: '2000-03', paid_at: '2999-01-01' })).toMatch(/未來/);
  });
  it('送出欄位：空字串送成 null、電度只給電費、設備序號只給網路費', () => {
    const p = payloadFromForm({ ...ok(), expense_type: 'WATER', electricity_kwh: '50', equipment_serial: 'x' });
    expect(p).toMatchObject({ store_id: 's', electricity_kwh: null, equipment_serial: null, due_date: null, paid_at: null, amount: '100' });
    const e = payloadFromForm({ ...ok(), expense_type: 'ELECTRICITY', electricity_kwh: '50' });
    expect(e.electricity_kwh).toBe('50');
  });
  it('金額與度數輸入框是 type=number，v-model 會把值變成數字：表單檢查與送出欄位都要能處理（不可呼叫字串方法出錯）', () => {
    const f = { ...ok(), amount: 12000 as unknown as string, expense_type: 'ELECTRICITY' as const, electricity_kwh: 321.5 as unknown as string };
    expect(formProblem(f)).toBe('');
    expect(payloadFromForm(f)).toMatchObject({ amount: '12000', electricity_kwh: '321.5' });
    expect(formProblem({ ...ok(), amount: 0 as unknown as string })).toBe('');
    expect(formProblem({ ...ok(), amount: null as unknown as string })).toMatch(/金額/);
    expect(payloadFromForm({ ...ok(), amount: 0 as unknown as string }).amount).toBe('0');
  });
  it('編輯表單帶入原值', () => {
    const b = { id: 'b', store_id: 's', location_name: 'VW001', expense_type: 'PHONE', billing_month: '2038-03-01', provider_name: 'P', service_label: null, service_identifier: '02', account_number: null, equipment_serial: null,
      amount: 88, electricity_kwh: null, due_date: '2038-04-01', paid_at: null, reference_no: null, notes: null } as unknown as Bill;
    expect(formFromBill(b)).toMatchObject({ store_id: 's', expense_type: 'PHONE', billing_month: '2038-03', amount: '88', due_date: '2038-04-01', paid_at: '' });
  });
});

describe('權限、導覽旗標與頁面登錄', () => {
  const f = (...c: string[]) => gaFlags(has(...c), false, false, false, has(...c));
  it('入口與 API 用同一組條件：檢視或管理可進、只有管理可寫', () => {
    expect(f(VIEW)).toMatchObject({ gaUtilityBills: true, gaUtilityBillManage: false });
    expect(f(MANAGE)).toMatchObject({ gaUtilityBills: true, gaUtilityBillManage: true });
    expect(f()).toMatchObject({ gaUtilityBills: false, gaUtilityBillManage: false });
    expect(f('general_affairs.vendor.manage').gaUtilityBills).toBe(false);
    for (const c of [VIEW, MANAGE]) {
      const a = utilityBillAbilities(new Set([c]));
      expect(f(c).gaUtilityBills, c).toBe(a.canView);
      expect(f(c).gaUtilityBillManage, c).toBe(a.canManage);
    }
    expect(utilityBillAbilities(new Set())).toEqual({ canView: false, canManage: false });
  });
  it('管理員後備不放寬：has 為真但資料庫語意沒有權限時，頁面旗標是 false', () => {
    expect(gaFlags(() => true, false, false, false, () => false)).toMatchObject({ gaUtilityBills: false, gaUtilityBillManage: false });
  });
  it('店長（只有店長身分）看不到水電網費', () => {
    expect(gaFlags(() => false, true, true, true, () => false).gaUtilityBills).toBe(false);
  });
  it('舊網址對到新版 kind', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/utility-bills']).toEqual({ kind: 'ga-utility-bills', flag: 'gaUtilityBills' });
    expect(GA_PAGE_BY_HREF['/general-affairs/utility-bills/report']).toEqual({ kind: 'ga-utility-bills-report', flag: 'gaUtilityBills' });
  });
  it('側欄：水電網費與費用報表只對有權限者顯示，並指到新版頁面', () => {
    const nav = (perms: string[]) => gaNavigation({ has: has(...perms, 'general_affairs.service_center.access'), permissions: new Set(perms), roleCodes: new Set<string>(), isAdmin: false } as any);
    const kinds = (g: any[]) => JSON.stringify(g);
    expect(kinds(nav([VIEW]))).toContain('ga-utility-bills');
    expect(kinds(nav([VIEW]))).toContain('ga-utility-bills-report');
    expect(kinds(nav([]))).not.toContain('ga-utility-bills');
    expect(kinds(nav(['general_affairs.vendor.manage']))).not.toContain('ga-utility-bills');
  });
  it('側欄結構：「水電電話網路費」本身是展開鈕，底下有「帳單列表」與「費用報表」兩個可點的項目（有子項的項目外殼不當連結，所以列表要有自己的入口）', () => {
    const nav = gaNavigation({ has: has(VIEW, 'general_affairs.service_center.access'), permissions: new Set([VIEW]), roleCodes: new Set<string>(), isAdmin: false } as any);
    const item = nav.flatMap((g: any) => g.items).find((i: any) => i.id === 'utility-bills');
    expect(item.kind).toBeUndefined();
    expect(item.children.map((c: any) => [c.label, c.kind])).toEqual([['帳單列表', 'ga-utility-bills'], ['費用報表', 'ga-utility-bills-report']]);
  });
  it('kind、標題、權限鍵與頁面登錄都在', () => {
    for (const k of ['ga-utility-bills', 'ga-utility-bills-report'] as const) expect(WORKSPACE_TAB_KINDS).toContain(k);
    expect(WORKSPACE_PAGE_META['ga-utility-bills']).toMatchObject({ title: '水電電話網路費', permission: ['gaUtilityBills'] });
    expect(WORKSPACE_PAGE_META['ga-utility-bills-report']).toMatchObject({ title: '費用報表', permission: ['gaUtilityBills'] });
    const pages = read('vue-workspace/src/workspace-pages.ts');
    expect(pages).toMatch(/"ga-utility-bills": UtilityBills,/);
    expect(pages).toMatch(/"ga-utility-bills-report": UtilityBillsReport,/);
    expect(read('vue-workspace/src/stores.ts')).toMatch(/gaUtilityBills: boolean;/);
  });
});

describe('錯誤碼白話對照', () => {
  it('資料庫函式可能回的每個代碼都有白話', () => {
    const sql = read('supabase/workspace-dev/20261118110000_m7m8_b6_utility_bills.sql');
    const codes = new Set<string>();
    for (const m of sql.matchAll(/ga_rq_(?:err|raise)\(\s*\d+,\s*'([A-Z_]+)'/g)) codes.add(m[1]);
    expect(codes.size).toBeGreaterThan(20);
    for (const c of codes) expect(UTILITY_BILL_CODE_MESSAGES[c], c).toBeTruthy();
    expect(messageForCode('NO_SUCH')).toBe('操作失敗，請稍後重試');
  });
});

describe('SQL 與規則逐條對照（原始碼層級）', () => {
  const up = read('supabase/workspace-dev/20261118110000_m7m8_b6_utility_bills.sql');
  const down = read('supabase/workspace-dev/20261118110000_m7m8_b6_utility_bills.rollback.sql');
  it('每支函式都是 SECURITY DEFINER、固定 search_path，對外函式只授權 authenticated（不給 anon）', () => {
    const defs = up.match(/CREATE OR REPLACE FUNCTION public\.ga_ws_ub_[a-z_]+/g) || [];
    expect(defs).toHaveLength(9);
    expect(up).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*ga_ws_ub_report\(text, integer, text\) FROM PUBLIC, anon;/);
    expect(up).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*ga_ws_ub_report\(text, integer, text\) TO authenticated;/);
    expect(up).not.toMatch(/GRANT EXECUTE[^;]*ga_ub_/);
  });
  it('權限只用 has_permission（沒有 profiles.role 與管理員後備）', () => {
    expect(up).toMatch(/has_permission\(p_uid, 'general_affairs\.utility_bill\.view'\)/);
    expect(up).not.toMatch(/profiles[^;]*role\s*=\s*'admin'/);
  });
  it('逾期是 < 台北今天（不含當天）、未繳、有到期日；部分索引存在', () => {
    expect(up).toMatch(/p_due_date < public\.ga_po_today\(\)/);
    expect(up).toMatch(/idx_ga_utility_bills_unpaid_due ON public\.ga_utility_bills \(due_date\) WHERE paid_at IS NULL AND deleted_at IS NULL/);
  });
  it('異常門檻：> 2 倍、< 一半、0 元；只取最近三筆、排除自己與 0 元', () => {
    expect(up).toMatch(/p_amount > 2 \* v_avg/);
    expect(up).toMatch(/p_amount < v_avg \/ 2/);
    expect(up).toMatch(/b\.amount > 0/);
    expect(up).toMatch(/LIMIT 3/);
    expect(up).toMatch(/b\.id IS DISTINCT FROM p_exclude/);
  });
  it('標記已繳範圍：不可未來、不早於帳單月份前 1 個月', () => {
    expect(up).toMatch(/p_month - interval '1 month'/);
    expect(up).toMatch(/p_paid > public\.ga_po_today\(\)/);
  });
  it('已繳改關鍵欄位與刪除需確認並回原值；改回待繳需確認；刪除必填原因並軟刪除', () => {
    expect(up).toMatch(/PAID_CHANGE_CONFIRM_REQUIRED/);
    expect(up).toMatch(/UNPAY_CONFIRM_REQUIRED/);
    expect(up).toMatch(/REASON_REQUIRED/);
    expect(up).toMatch(/SET deleted_at = now\(\), deleted_by = v_uid, deletion_reason = v_reason/);
    expect(up).not.toMatch(/DELETE FROM public\.ga_utility_bills/);
  });
  it('店長直讀條件已從讀取 policy 移除，rollback 會還原', () => {
    const policy = up.slice(up.indexOf('CREATE POLICY ga_utility_bills_read'), up.indexOf('-- ================================================================ 3.'));
    expect(policy).not.toMatch(/current_user_manages_store/);
    expect(down).toMatch(/current_user_manages_store/);
  });
  it('rollback 移除全部函式與索引，且不刪資料欄位', () => {
    for (const fn of up.match(/CREATE OR REPLACE FUNCTION public\.(ga_(?:ws_)?ub_[a-z_]+)/g) || []) {
      const name = fn.split('public.')[1];
      expect(down, name).toContain(name);
    }
    expect(down).toMatch(/DROP INDEX IF EXISTS public\.idx_ga_utility_bills_unpaid_due/);
    expect(down).not.toMatch(/DROP COLUMN/);
  });
  it('附件：附件管理判斷函式補上 UTILITY_BILL 分支（讀出現行定義只改結尾，已有就略過；結尾不符就中止），rollback 拿掉分支；API 寫入與標記刪除改用使用者身分', () => {
    expect(up).toContain("position('UTILITY_BILL' in v_def) > 0 THEN RETURN;");
    expect(up).toContain("pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure)");
    expect(up).toMatch(/p_resource_type = 'UTILITY_BILL' THEN[\s\S]*utility_bill\.manage[\s\S]*b\.deleted_at IS NULL/);
    expect(up).toContain("RAISE EXCEPTION 'ga_resource_attachment_can_manage 現行定義的結尾");
    expect(down).toContain('UTILITY_BILL');
    const att = read('lib/workspace/general-affairs/attachments.ts');
    expect(att).toContain('const ins = await (ctx.auth as any).from("ga_resource_attachments").insert(records);');
    expect(att).not.toContain('update({ deleted_at: new Date().toISOString(), deleted_by: ctx.user.id');
    expect(att).toContain('await utilityGate(ctx, att.resource_type, att.resource_id, true);');
  });
  it('套用腳本有登錄這支檔；對外 API 沒有 DELETE 入口、寫入有 Origin 檢查（runGa）', () => {
    expect(read('scripts/apply-workspace-m7m8-b6-dev.cjs')).toMatch(/20261118110000_m7m8_b6_utility_bills/);
    const api = read('lib/workspace/general-affairs/utility-bills.ts');
    expect(api).not.toMatch(/method === "DELETE"|m === "DELETE"/);
    expect(api).toMatch(/needManage/);
    expect(read('lib/workspace/general-affairs/router.ts')).toMatch(/case "utility-bills":/);
  });
});

describe('原始碼層級的畫面規則', () => {
  it('頁面不做圖表（V10）：沒有 CSV／chart 套件；列表頁不匯出；報表頁的 Excel 匯出（GAUBMATRIX）只走共用的 lib/xlsx，不直接 import xlsx 套件', () => {
    for (const p of ['pages/ga/UtilityBills.vue', 'pages/ga/UtilityBillsReport.vue']) {
      const s = read(`vue-workspace/src/${p}`);
      expect(s, p).not.toMatch(/text\/csv|chart\.js|echarts/i);
    }
    expect(read('vue-workspace/src/pages/ga/UtilityBills.vue')).not.toMatch(/xlsx/i);
    expect(read('vue-workspace/src/pages/ga/UtilityBillsReport.vue')).not.toMatch(/from ["']xlsx["']|import\(["']xlsx["']\)/);
  });
  it('摘要卡：待繳與逾期是全部月份（global），「本月費用」改標「篩選結果合計」', () => {
    const s = read('vue-workspace/src/pages/ga/UtilityBills.vue');
    expect(s).toMatch(/篩選結果合計/);
    expect(s).not.toMatch(/本月費用/);
    expect(s).toMatch(/待繳（全部月份）/);
    expect(s).toMatch(/data-testid="no-due-hint"/);
  });
  it('詳情：附件沿用共用面板（UTILITY_BILL、BILL_DOCUMENT）；已刪除不顯示附件', () => {
    const s = read('vue-workspace/src/components/ga/UtilityBillDetail.vue');
    expect(s).toMatch(/resource-type="UTILITY_BILL"/);
    expect(s).toMatch(/purpose="BILL_DOCUMENT"/);
    expect(s).toMatch(/v-if="live"/);
  });
  it('失敗一律顯示明確原因：頁面與元件都走 errorText', () => {
    for (const p of ['pages/ga/UtilityBills.vue', 'pages/ga/UtilityBillsReport.vue', 'components/ga/UtilityBillForm.vue', 'components/ga/UtilityBillDetail.vue']) {
      expect(read(`vue-workspace/src/${p}`), p).toMatch(/errorText/);
    }
  });
});
