import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { deleteRunData, scheduleRows, seedCampaign, stores } from '../support/m5-fixtures';
import { autoCampaignSchedule, campaignDates, runAutoSchedule } from '../../vue-workspace/src/campaign-scheduling';
import { legacyAutoSchedule, randomCase } from '../support/legacy-campaign-schedule';

// W19 活動排程對等層：自動排程演算法與儲存排程，舊版與新版同輸入、同輸出。
// 資料：VW/ZT 測試門市、2099 年活動，名稱帶「[自動測試]M5 <runId>」；只刪自己建立的資料。

const schedMap = loadMap('campaign-schedule');
const sched = new ParityRecorder('campaign-schedule');
// 與列順序、物件鍵順序無關的比較：以門市代碼排序後，逐筆（鍵,值）序列化
const canonical = (rows: Record<string, string>) => JSON.stringify(Object.entries(rows).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)));
const entry = (map: typeof schedMap, id: string) => map.entries.find((e) => e.id === id)!;

test.afterAll(async () => {
  await deleteRunData();
});

test('W19 自動排程：舊版演算法 vs 新版，200 組隨機資料同輸入同輸出', async () => {
  const e = entry(schedMap, 'auto-schedule-random');
  const diffs: Diff[] = [];
  let compared = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = randomCase(seed * 104729);
    const legacy = legacyAutoSchedule(c.stores, c.dates, c.settings, c.events);
    const native = runAutoSchedule(c.stores, c.dates, c.settings, c.events);
    compared++;
    if (legacy.noDates || native.noDates) {
      if (legacy.noDates !== native.noDates) diffs.push({ kind: 'changed', key: `case#${seed}.noDates`, legacy: legacy.noDates, native: native.noDates });
      continue;
    }
    if (JSON.stringify(legacy.schedules) !== JSON.stringify(native.schedules)) diffs.push({ kind: 'changed', key: `case#${seed}.schedules`, legacy: legacy.schedules.length, native: native.schedules.length });
    if (JSON.stringify(legacy.failed.map((s) => s.id)) !== JSON.stringify(native.failed.map((s: any) => s.id))) diffs.push({ kind: 'changed', key: `case#${seed}.failed`, legacy: legacy.failed.length, native: native.failed.length });
  }
  assertNoUnlistedDiffs(
    sched.record({
      entry: e.id,
      mechanism: 'write-readback',
      role: 'admin',
      title: '自動排程 200 組隨機資料',
      legacy: { endpoint: e.legacy.source || '' },
      native: { endpoint: e.native.source || '' },
      compared: { cases: compared },
      diffs,
    }),
  );
  // 仍可直接呼叫的舊匯出沒有被破壞
  expect(autoCampaignSchedule([{ id: 'a' }], campaignDates('2099-03-04', '2099-03-04'), [], []).schedules).toHaveLength(1);
});

test('W19 儲存排程：舊版逐筆 POST 與新版整批 PUT，最終排程列相同', async () => {
  const e = entry(schedMap, 'schedule-save');
  const admin = await apiAs('admin');
  try {
    const s = await stores();
    const a = await seedCampaign({ tag: 'par-save-legacy', start: '2099-06-01', end: '2099-06-30' });
    const b = await seedCampaign({ tag: 'par-save-native', start: '2099-06-01', end: '2099-06-30' });
    const rows: [string, string][] = [['VW001', '2099-06-06'], ['ZT01', '2099-06-07'], ['ZT02', '2099-06-10']];
    for (const [code, date] of rows) {
      const r = await admin.post('/api/campaign-schedules', { data: { campaign_id: a.id, store_id: s[code].id, activity_date: date } });
      expect(r.ok(), `舊版儲存 ${code}`).toBe(true);
    }
    const get = await admin.get(`/api/workspace/campaign-tools?resource=schedules&campaign_id=${b.id}`);
    const version = (await get.json()).version;
    const put = await admin.put('/api/workspace/campaign-tools?resource=schedules', { data: { campaign_id: b.id, rows: rows.map(([code, date]) => ({ store_id: s[code].id, activity_date: date })), version, requestId: randomUUID() } });
    expect(put.ok()).toBe(true);
    const l = await scheduleRows(a.id);
    const n = await scheduleRows(b.id);
    assertNoUnlistedDiffs(
      sched.record({
        entry: e.id,
        mechanism: 'write-readback',
        role: 'admin',
        title: '儲存排程最終列',
        legacy: { endpoint: 'POST /api/campaign-schedules ×3' },
        native: { endpoint: 'PUT /api/workspace/campaign-tools?resource=schedules' },
        compared: { legacy: Object.keys(l).length, native: Object.keys(n).length },
        diffs: canonical(l) === canonical(n) ? [] : [{ kind: 'changed', key: 'schedules', legacy: l, native: n }],
      }),
    );
  } finally {
    await admin.dispose();
  }
});
