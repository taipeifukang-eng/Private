import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { autoCampaignSchedule, availableCampaignDates, campaignDates, NO_AVAILABLE_DATES_MESSAGE, runAutoSchedule } from '../../../vue-workspace/src/campaign-scheduling';

// W19 活動自動排程：新舊同輸入同輸出（表格驅動對照測試）。
// legacyAutoSchedule 是 app/admin/activity-management/schedule/[id]/page.tsx autoSchedule（約 543-700 行）逐行移植成的純函式：
// 只拿掉 console.log、confirm/alert 與 React state；日期運算用 UTC（舊版用本機時區，台灣時區下兩者相同）。
// 差異時輸出案例 JSON，方便重現。

type Store = { id: string; store_name: string; supervisor_id?: string | null };
type Setting = { store_id: string; allowed_days?: number[] | null; forbidden_days?: number[] | null };
type EventRow = { event_date: string; is_blocked: boolean };

function legacyAutoSchedule(stores: Store[], calendarDates: string[], settings: Setting[], events: EventRow[]) {
  const allowedDays = [3, 6, 7];
  const dow = (s: string) => new Date(s + 'T00:00:00Z').getUTCDay() || 7;
  const availableDates = calendarDates.filter((dateStr) => {
    if (!allowedDays.includes(dow(dateStr))) return false;
    const event = events.find((e) => e.event_date.split('T')[0] === dateStr);
    return !event?.is_blocked;
  });
  if (availableDates.length === 0) return { noDates: true as const };
  const newSchedules: { store_id: string; activity_date: string }[] = [];
  const failedStores: { store: Store }[] = [];
  const dateSupervisors = new Map<string, Set<string>>();
  availableDates.forEach((d) => dateSupervisors.set(d, new Set<string>()));
  for (const store of stores) {
    const storeSettings = settings.find((s) => s.store_id === store.id);
    const supervisorId = store.supervisor_id || 'unassigned';
    let assigned = false;
    for (const dateStr of availableDates) {
      const dayOfWeek = dow(dateStr);
      if (storeSettings) {
        if (storeSettings.forbidden_days?.includes(dayOfWeek)) continue;
        if (storeSettings.allowed_days && storeSettings.allowed_days.length > 0 && !storeSettings.allowed_days.includes(dayOfWeek)) continue;
      }
      if (dateSupervisors.get(dateStr)?.has(supervisorId)) continue;
      let adjacent = false;
      for (let offset = -1; offset <= 1; offset += 2) {
        const check = new Date(dateStr + 'T00:00:00Z');
        check.setUTCDate(check.getUTCDate() + offset);
        if (dateSupervisors.get(check.toISOString().split('T')[0])?.has(supervisorId)) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) continue;
      newSchedules.push({ store_id: store.id, activity_date: dateStr });
      dateSupervisors.get(dateStr)!.add(supervisorId);
      assigned = true;
      break;
    }
    if (!assigned) failedStores.push({ store });
  }
  const remainingFailed: { store: Store }[] = [];
  for (const { store } of failedStores) {
    const storeSettings = settings.find((s) => s.store_id === store.id);
    const supervisorId = store.supervisor_id || 'unassigned';
    let assigned = false;
    for (const dateStr of availableDates) {
      const dayOfWeek = dow(dateStr);
      if (storeSettings) {
        if (storeSettings.forbidden_days?.includes(dayOfWeek)) continue;
        if (storeSettings.allowed_days && storeSettings.allowed_days.length > 0 && !storeSettings.allowed_days.includes(dayOfWeek)) continue;
      }
      if (dateSupervisors.get(dateStr)?.has(supervisorId)) continue;
      newSchedules.push({ store_id: store.id, activity_date: dateStr });
      dateSupervisors.get(dateStr)!.add(supervisorId);
      assigned = true;
      break;
    }
    if (!assigned) remainingFailed.push({ store });
  }
  return { noDates: false as const, schedules: newSchedules, failed: remainingFailed.map((f) => f.store) };
}

// 可重現的亂數（mulberry32）
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length)];
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function randomCase(seed: number) {
  const r = rng(seed);
  const start = addDays('2099-01-01', int(r, 0, 330));
  const length = int(r, 7, 60);
  const dates = campaignDates(start, addDays(start, length - 1));
  const supervisors = Array.from({ length: int(r, 1, 6) }, (_, i) => 'sup-' + i);
  const stores: Store[] = Array.from({ length: int(r, 1, 30) }, (_, i) => ({
    id: 'store-' + String(i).padStart(2, '0'),
    store_name: '店' + i,
    supervisor_id: r() < 0.1 ? null : pick(r, supervisors),
  }));
  const settings: Setting[] = [];
  for (const s of stores) {
    if (r() < 0.4) {
      const allowed = r() < 0.5 ? [] : Array.from({ length: int(r, 1, 3) }, () => int(r, 1, 7));
      const forbidden = Array.from({ length: int(r, 0, 3) }, () => int(r, 1, 7)).filter((d) => !allowed.includes(d));
      settings.push({ store_id: s.id, allowed_days: r() < 0.1 ? null : allowed, forbidden_days: r() < 0.1 ? null : forbidden });
    }
  }
  const events: EventRow[] = [];
  const used = new Set<string>();
  for (let i = int(r, 0, 8); i > 0; i--) {
    const d = pick(r, dates);
    if (used.has(d)) continue; // event_date 在資料庫是唯一的
    used.add(d);
    events.push({ event_date: r() < 0.3 ? d + 'T00:00:00' : d, is_blocked: r() < 0.7 });
  }
  return { start, length, dates, stores, settings, events };
}

describe('W19 自動排程：舊版演算法 vs 新版，200 組隨機資料同輸入同輸出', () => {
  it('排程集合（含順序）與失敗門市完全相同', () => {
    const diffs: unknown[] = [];
    let noDates = 0;
    let withFailures = 0;
    let allPlaced = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c = randomCase(seed * 7919);
      const legacy = legacyAutoSchedule(c.stores, c.dates, c.settings, c.events);
      const native = runAutoSchedule(c.stores, c.dates, c.settings, c.events);
      if (legacy.noDates) {
        noDates++;
        if (!native.noDates) diffs.push({ seed, kind: 'legacy-no-dates', c });
        continue;
      }
      if (native.noDates) {
        diffs.push({ seed, kind: 'native-no-dates', c });
        continue;
      }
      if (JSON.stringify(legacy.schedules) !== JSON.stringify(native.schedules)) diffs.push({ seed, kind: 'schedules', legacy: legacy.schedules, native: native.schedules, c });
      if (JSON.stringify(legacy.failed.map((s) => s.id)) !== JSON.stringify(native.failed.map((s: Store) => s.id))) diffs.push({ seed, kind: 'failed', legacy: legacy.failed, native: native.failed, c });
      if (legacy.failed.length) withFailures++;
      else allPlaced++;
    }
    expect(diffs, JSON.stringify(diffs[0], null, 1)).toEqual([]);
    // 資料有涵蓋到「全部排進去」「有無法排程」兩種結果，避免測試變成空轉。
    expect(withFailures).toBeGreaterThan(5);
    expect(allPlaced).toBeGreaterThan(5);
    expect(noDates).toBeGreaterThanOrEqual(0);
  });

  const table: { name: string; stores: Store[]; start: string; end: string; settings?: Setting[]; events?: EventRow[]; expectNoDates?: boolean }[] = [
    { name: '2099-03-01（週日）到 2099-03-07：週三六日共 3 天', stores: [{ id: 'a', store_name: 'a', supervisor_id: 's1' }], start: '2099-03-01', end: '2099-03-07' },
    { name: '期間內沒有週三六日（週一到週二）', stores: [{ id: 'a', store_name: 'a' }], start: '2099-03-02', end: '2099-03-03', expectNoDates: true },
    { name: '唯一可用的週三被阻擋 → 沒有可用日期', stores: [{ id: 'a', store_name: 'a' }], start: '2099-03-04', end: '2099-03-04', events: [{ event_date: '2099-03-04', is_blocked: true }], expectNoDates: true },
    { name: '被阻擋的週六排除；未阻擋的特殊日期仍可排', stores: [{ id: 'a', store_name: 'a' }, { id: 'b', store_name: 'b' }], start: '2099-03-04', end: '2099-03-08', events: [{ event_date: '2099-03-07', is_blocked: true }, { event_date: '2099-03-08', is_blocked: false }] },
    { name: '同督導 3 店：第一階段避開相鄰日，放寬後可連續', stores: ['a', 'b', 'c'].map((id) => ({ id, store_name: id, supervisor_id: 's1' })), start: '2099-03-04', end: '2099-03-09' },
    { name: '門市只能週三且期間只有一個週三，第二間同督導排不進去', stores: ['a', 'b'].map((id) => ({ id, store_name: id, supervisor_id: 's1' })), start: '2099-03-04', end: '2099-03-10', settings: [{ store_id: 'a', allowed_days: [3] }, { store_id: 'b', allowed_days: [3] }] },
    { name: '禁止與允許同時設定（舊資料）', stores: [{ id: 'a', store_name: 'a' }], start: '2099-03-04', end: '2099-03-10', settings: [{ store_id: 'a', allowed_days: [6, 7], forbidden_days: [6] }] },
    { name: '督導為空的門市歸同一個「未指派」群組', stores: ['a', 'b', 'c'].map((id) => ({ id, store_name: id, supervisor_id: null })), start: '2099-03-01', end: '2099-03-31' },
    { name: '跨月、跨年', stores: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, store_name: id, supervisor_id: 's' + (i % 2) })), start: '2099-12-25', end: '2100-01-10' },
    { name: '特殊日期帶時間字串', stores: [{ id: 'a', store_name: 'a' }], start: '2099-03-04', end: '2099-03-07', events: [{ event_date: '2099-03-04T00:00:00', is_blocked: true }, { event_date: '2099-03-07T00:00:00', is_blocked: true }], expectNoDates: true },
  ];
  for (const t of table) {
    it(`表格案例：${t.name}`, () => {
      const dates = campaignDates(t.start, t.end);
      const legacy = legacyAutoSchedule(t.stores, dates, t.settings || [], t.events || []);
      const native = runAutoSchedule(t.stores, dates, t.settings || [], t.events || []);
      if (t.expectNoDates) {
        expect(legacy.noDates).toBe(true);
        expect(native.noDates).toBe(true);
        if (native.noDates) expect(native.message).toBe(NO_AVAILABLE_DATES_MESSAGE);
        return;
      }
      expect(legacy.noDates).toBe(false);
      expect(native.noDates).toBe(false);
      if (!legacy.noDates && !native.noDates) {
        expect(native.schedules).toEqual(legacy.schedules);
        expect(native.failed.map((s: Store) => s.id)).toEqual(legacy.failed.map((s) => s.id));
      }
    });
  }

  it('「沒有可用日期」的提示文字與舊版 alert 相同，且與舊版原始碼一致', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../app/admin/activity-management/schedule/[id]/page.tsx'), 'utf8');
    expect(src).toContain(NO_AVAILABLE_DATES_MESSAGE);
    expect(src).toContain('const allowedDays = [3, 6, 7]');
  });

  it('可用日期 = 週三六日且未被阻擋（與舊版過濾相同）', () => {
    const dates = campaignDates('2099-03-01', '2099-03-14');
    const events = [{ event_date: '2099-03-07', is_blocked: true }];
    expect(availableCampaignDates(dates, events)).toEqual(['2099-03-01', '2099-03-04', '2099-03-08', '2099-03-11', '2099-03-14']);
  });

  it('已知且不會發生的差異：同一天有兩筆特殊日期（資料庫 event_date 唯一）時，新版以任一筆禁止為準，舊版只看第一筆', () => {
    const dates = campaignDates('2099-03-04', '2099-03-04');
    const ev = [{ event_date: '2099-03-04', is_blocked: false }, { event_date: '2099-03-04', is_blocked: true }];
    expect(availableCampaignDates(dates, ev)).toEqual([]);
    expect(legacyAutoSchedule([{ id: 'a', store_name: 'a' }], dates, [], ev).noDates).toBe(false);
  });

  it('autoCampaignSchedule 仍可直接呼叫（既有匯出不變）', () => {
    const r = autoCampaignSchedule([{ id: 'a', supervisor_id: null }], campaignDates('2099-03-04', '2099-03-04'), [], []);
    expect(r.schedules).toEqual([{ store_id: 'a', activity_date: '2099-03-04' }]);
  });
});
