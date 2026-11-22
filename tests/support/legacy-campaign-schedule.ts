import { campaignDates } from '../../vue-workspace/src/campaign-scheduling';

// 舊版 app/admin/activity-management/schedule/[id]/page.tsx autoSchedule（約 543-700 行）逐行移植成的純函式（只放在測試用）。
// 拿掉 console.log、confirm/alert 與 React state；日期運算用 UTC（舊版用本機時區，台灣時區下兩者相同）。
// 單元層與對等層共用同一份移植與同一組隨機案例產生器。

export type Store = { id: string; store_name: string; supervisor_id?: string | null };
export type Setting = { store_id: string; allowed_days?: number[] | null; forbidden_days?: number[] | null };
export type EventRow = { event_date: string; is_blocked: boolean };

export function legacyAutoSchedule(stores: Store[], calendarDates: string[], settings: Setting[], events: EventRow[]) {
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
export function rng(seed: number) {
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

export function randomCase(seed: number) {
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

