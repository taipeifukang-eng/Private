import { describe, expect, it } from 'vitest';
import {
  activeCodeSet,
  addDays,
  canDeleteReport,
  canReportForStore,
  canRespondTo,
  clampPage,
  clampPageSize,
  defaultTab,
  deriveStatus,
  findRecentDuplicate,
  isResponseActive,
  monthRange,
  normalizeForReminder,
  recentStart,
  shouldShowReminder,
  taipeiDate,
  taipeiMonthKey,
  validateReport,
  validateResponse,
  type Caps,
} from '../../../lib/stockout/response';

// 舊 app/cross-dept/merchandise/page.tsx 的判斷（改成「today 可注入」，作為 C1 兩套門檻的對照基準）
const legacyDay = (today: string, offset: number) => {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
};
const legacyActive = (r: { eta_date: string | null } | null, today: string) => (!r ? false : !r.eta_date ? true : r.eta_date >= legacyDay(today, -15));
const legacyReminder = (r: { eta_date: string | null } | null, today: string) => (!r ? false : !r.eta_date ? true : r.eta_date >= legacyDay(today, -30));

const T = '2038-03-15';
const caps = (o: Partial<Caps> = {}): Caps => ({ submit: false, viewAll: false, respond: false, ...o });

describe('M6-W29 C1：15 天算已回覆、30 天內仍提醒（照舊）', () => {
  it('邊界：今天往前 15 天（含）仍有效，16 天失效；30 天（含）仍提醒，31 天不再提醒', () => {
    expect(isResponseActive({ eta_date: addDays(T, -15) }, T)).toBe(true);
    expect(isResponseActive({ eta_date: addDays(T, -16) }, T)).toBe(false);
    expect(shouldShowReminder({ eta_date: addDays(T, -30) }, T)).toBe(true);
    expect(shouldShowReminder({ eta_date: addDays(T, -31) }, T)).toBe(false);
  });
  it('沒有預計到貨日一律有效且提醒；沒有回覆就是無效', () => {
    expect(isResponseActive({ eta_date: null }, T)).toBe(true);
    expect(shouldShowReminder({ eta_date: null }, T)).toBe(true);
    expect(isResponseActive(null, T)).toBe(false);
    expect(shouldShowReminder(undefined, T)).toBe(false);
    expect(normalizeForReminder({ eta_date: addDays(T, -31) }, T)).toBeNull();
    expect(normalizeForReminder({ eta_date: addDays(T, -20) }, T)).toEqual({ eta_date: addDays(T, -20) });
  });
  it('與舊版判斷逐日一致（預計到貨日 今天-60 到 今天+60）', () => {
    for (let off = -60; off <= 60; off++) {
      const r = { eta_date: addDays(T, off) };
      expect(isResponseActive(r, T), `active ${off}`).toBe(legacyActive(r, T));
      expect(shouldShowReminder(r, T), `reminder ${off}`).toBe(legacyReminder(r, T));
    }
  });
});

describe('M6-W29 C3：狀態由「目前有效回覆」即時算出，不讀資料欄位', () => {
  const responses = [
    { product_code: 'A', eta_date: addDays(T, 3) },
    { product_code: 'B', eta_date: addDays(T, -15) },
    { product_code: 'C', eta_date: addDays(T, -16) },
    { product_code: 'D', eta_date: null },
  ];
  it('有效回覆的商品為 responded，過期或沒有回覆為 pending', () => {
    const active = activeCodeSet(responses, T);
    expect([...active].sort()).toEqual(['A', 'B', 'D']);
    expect(deriveStatus('A', active)).toBe('responded');
    expect(deriveStatus('C', active)).toBe('pending');
    expect(deriveStatus('Z', active)).toBe('pending');
  });
  it('同一份回覆，隨著 today 往後推，狀態自動從 responded 回到 pending（不需改寫資料）', () => {
    const r = [{ product_code: 'A', eta_date: '2038-03-20' }];
    expect(deriveStatus('A', activeCodeSet(r, '2038-03-20'))).toBe('responded');
    expect(deriveStatus('A', activeCodeSet(r, '2038-04-04'))).toBe('responded');
    expect(deriveStatus('A', activeCodeSet(r, '2038-04-05'))).toBe('pending');
  });
});

describe('M6-W29 e：日期一律 Asia/Taipei', () => {
  it('taipeiDate：UTC 傍晚已是台北隔天', () => {
    expect(taipeiDate('2038-03-14T16:00:00Z')).toBe('2038-03-15');
    expect(taipeiDate('2038-03-14T15:59:59Z')).toBe('2038-03-14');
    expect(taipeiDate(new Date('2038-12-31T16:30:00Z'))).toBe('2039-01-01');
  });
  it('月份分組：UTC 前七碼會把台北月初的回報分到上個月，新版用台北月份', () => {
    const at = '2038-02-28T16:30:00Z';
    expect(at.slice(0, 7)).toBe('2038-02');
    expect(taipeiMonthKey(at)).toBe('2038-03');
    expect(taipeiMonthKey('2038-03-31T15:59:00Z')).toBe('2038-03');
    expect(taipeiMonthKey('2038-03-31T16:00:00Z')).toBe('2038-04');
  });
  it('monthRange：台北時間起訖，12 月跨年，格式錯誤回 null', () => {
    expect(monthRange('2038-03')).toEqual({ start: '2038-03-01T00:00:00+08:00', end: '2038-04-01T00:00:00+08:00' });
    expect(monthRange('2038-12')).toEqual({ start: '2038-12-01T00:00:00+08:00', end: '2039-01-01T00:00:00+08:00' });
    expect(monthRange('2038-13')).toBeNull();
    expect(monthRange('2038-3')).toBeNull();
    expect(monthRange('abc')).toBeNull();
    const r = monthRange('2038-03')!;
    expect(Date.parse('2038-02-28T16:00:00Z')).toBe(Date.parse(r.start));
    expect(taipeiMonthKey('2038-02-28T16:00:00Z')).toBe('2038-03');
  });
  it('recentStart：台北今天往前 30 天的 00:00，跨月跨年', () => {
    expect(recentStart('2038-03-15')).toBe('2038-02-13T00:00:00+08:00');
    expect(recentStart('2038-01-10')).toBe('2037-12-11T00:00:00+08:00');
  });
  it('addDays 跨月、跨年、閏年', () => {
    expect(addDays('2038-03-01', -1)).toBe('2038-02-28');
    expect(addDays('2040-03-01', -1)).toBe('2040-02-29');
    expect(addDays('2038-12-31', 1)).toBe('2039-01-01');
  });
});

describe('M6-W29：分頁上限、預設分頁與權限判斷', () => {
  it('每頁預設 30、上限 100；歷程預設 10、上限 50；壞值回預設', () => {
    expect(clampPageSize(undefined, 30, 100)).toBe(30);
    expect(clampPageSize('500', 30, 100)).toBe(100);
    expect(clampPageSize('0', 30, 100)).toBe(30);
    expect(clampPageSize('abc', 30, 100)).toBe(30);
    expect(clampPageSize('7', 30, 100)).toBe(7);
    expect(clampPageSize('999', 10, 50)).toBe(50);
    expect(clampPage('0')).toBe(1);
    expect(clampPage('-3')).toBe(1);
    expect(clampPage('abc')).toBe(1);
    expect(clampPage('4')).toBe(4);
  });
  it('預設分頁：只有提交 -> 我的門市；有 view_all 或 respond -> 全部門市', () => {
    expect(defaultTab(caps({ submit: true }))).toBe('my-store');
    expect(defaultTab(caps({ submit: true, viewAll: true }))).toBe('all');
    expect(defaultTab(caps({ respond: true }))).toBe('all');
    expect(defaultTab(caps({ viewAll: true }))).toBe('all');
  });
  it('b：POST 回報的門市範圍，商品部不限；只有提交權限者只能是自己管轄的門市', () => {
    expect(canReportForStore(caps({ submit: true }), 's1', ['s1'])).toBe(true);
    expect(canReportForStore(caps({ submit: true }), 's2', ['s1'])).toBe(false);
    expect(canReportForStore(caps({ submit: true }), 's1', [])).toBe(false);
    expect(canReportForStore(caps({ viewAll: true }), 's9', [])).toBe(true);
    expect(canReportForStore(caps({ respond: true }), 's9', [])).toBe(true);
    expect(canReportForStore(caps(), 's1', ['s1'])).toBe(false);
  });
  it('刪除回報：商品部可刪任意，其他只能刪自己的；回覆：respond 或 view_all', () => {
    expect(canDeleteReport(caps({ submit: true }), 'u1', 'u1')).toBe(true);
    expect(canDeleteReport(caps({ submit: true }), 'u2', 'u1')).toBe(false);
    expect(canDeleteReport(caps({ respond: true }), 'u2', 'u1')).toBe(true);
    expect(canDeleteReport(caps({ viewAll: true }), 'u2', 'u1')).toBe(true);
    expect(canRespondTo(caps({ submit: true }))).toBe(false);
    expect(canRespondTo(caps({ respond: true }))).toBe(true);
    expect(canRespondTo(caps({ viewAll: true }))).toBe(true);
  });
});

describe('M6-W29 C6：同門市同商品 7 天內重複回報要提示', () => {
  const at = (day: string) => `${day}T10:00:00+08:00`;
  const rows = (day: string) => [{ store_id: 's1', product_code: 'P', created_at: at(day) }];
  it('7 天（含）內算重複，8 天前不算', () => {
    expect(findRecentDuplicate(rows(addDays(T, -7)), 's1', 'P', T)).not.toBeNull();
    expect(findRecentDuplicate(rows(addDays(T, -8)), 's1', 'P', T)).toBeNull();
    expect(findRecentDuplicate(rows(T), 's1', 'P', T)).not.toBeNull();
  });
  it('不同門市或不同商品不算重複；多筆取最新', () => {
    expect(findRecentDuplicate(rows(T), 's2', 'P', T)).toBeNull();
    expect(findRecentDuplicate(rows(T), 's1', 'Q', T)).toBeNull();
    const many = [
      { store_id: 's1', product_code: 'P', created_at: at(addDays(T, -5)) },
      { store_id: 's1', product_code: 'P', created_at: at(addDays(T, -1)) },
    ];
    expect(findRecentDuplicate(many, 's1', 'P', T)?.created_at).toBe(at(addDays(T, -1)));
  });
  it('以台北日期判斷：UTC 前一天傍晚的回報在台北已是隔天', () => {
    expect(findRecentDuplicate([{ store_id: 's1', product_code: 'P', created_at: '2038-03-07T16:30:00Z' }], 's1', 'P', T)).not.toBeNull();
    expect(findRecentDuplicate([{ store_id: 's1', product_code: 'P', created_at: '2038-03-07T15:59:00Z' }], 's1', 'P', T)).toBeNull();
  });
});

describe('M6-W29：欄位檢查（訊息沿用舊版）', () => {
  it('回報缺欄位 -> 缺少必要欄位；數量必須是正整數', () => {
    expect(validateReport({ store_id: 's', product_code: '', product_name: 'n', required_qty: 1 })).toEqual({ ok: false, message: '缺少必要欄位' });
    expect(validateReport({ store_id: 's', product_code: 'a', product_name: 'n', required_qty: 0 })).toEqual({ ok: false, message: '缺少必要欄位' });
    expect(validateReport({ product_code: 'a', product_name: 'n', required_qty: 1 })).toEqual({ ok: false, message: '缺少必要欄位' });
    expect(validateReport({ store_id: 's', product_code: 'a', product_name: 'n', required_qty: 2.5 }).ok).toBe(false);
    expect(validateReport({ store_id: 's', product_code: 'a', product_name: 'n', required_qty: -1 }).ok).toBe(false);
    expect(validateReport({ store_id: 's', product_code: ' a ', product_name: ' n ', required_qty: '3' })).toEqual({ ok: true, value: { store_id: 's', product_code: 'a', product_name: 'n', required_qty: 3 } });
  });
  it('回覆必填四欄；日期格式要正確', () => {
    const ok = { product_code: 'a', product_name: 'n', response_content: ' 內容 ', eta_date: '2038-03-20' };
    expect(validateResponse(ok)).toEqual({ ok: true, value: { product_code: 'a', product_name: 'n', response_content: '內容', eta_date: '2038-03-20' } });
    expect(validateResponse({ ...ok, response_content: '  ' })).toEqual({ ok: false, message: '缺少必要欄位' });
    expect(validateResponse({ ...ok, eta_date: '' })).toEqual({ ok: false, message: '缺少必要欄位' });
    expect(validateResponse({ ...ok, eta_date: '2038-02-30' }).ok).toBe(false);
    expect(validateResponse({ ...ok, eta_date: '2038/03/20' }).ok).toBe(false);
  });
});
