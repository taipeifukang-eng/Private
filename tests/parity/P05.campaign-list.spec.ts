import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import {
  adminDb,
  apiForUser,
  countRows,
  deleteRunData,
  eventOn,
  m5Name,
  m5Prefix,
  scheduleRows,
  seedCampaign,
  seedChildren,
  seedSchedules,
  setupM5Users,
  stores,
  withStoreSetting,
  type M5User,
} from '../support/m5-fixtures';

// P05（活動列表、特殊日期、活動設定）對等層：舊版 API 與新版同輸入、同輸出。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 user (2026-11-08 survey/m5 Qn)）。
// 資料：VW/ZT 測試門市、2099 年活動與特殊日期，名稱帶「[自動測試]M5 <runId>」；只刪自己建立的資料。

const listMap = loadMap('campaign-list');
const list = new ParityRecorder('campaign-list');
const entry = (map: typeof listMap, id: string) => map.entries.find((e) => e.id === id)!;

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};
async function as(key: string) {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['editor_member', 'manager_viewer', 'viewer', 'store_manager', 'supervisor']);
  users = s.users;
  teardownUsers = s.teardown;
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  await deleteRunData();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const idSet = (rows: any[]) => new Set(rows.map((r) => String(r.id)));
function setDiffs(key: string, l: Set<string>, n: Set<string>): Diff[] {
  const out: Diff[] = [];
  for (const id of Array.from(l)) if (!n.has(id)) out.push({ kind: 'only-legacy', key: `${key}#${id}` });
  for (const id of Array.from(n)) if (!l.has(id)) out.push({ kind: 'only-native', key: `${key}#${id}` });
  return out;
}
const allowedClass = (status: number) => (status < 300 ? 'allowed' : 'denied');

test('列表可見的活動集合：舊 /api/campaigns vs 新 /api/workspace/campaigns（各角色）；停用只對編輯／發布權限者顯示', async () => {
  const on = await seedCampaign({ tag: 'par-on', start: '2099-05-01', end: '2099-05-31', publish: { sup: true, sm: true } });
  const off = await seedCampaign({ tag: 'par-off', start: '2099-05-01', end: '2099-05-31', active: false, publish: { sup: true, sm: true } });
  const draft = await seedCampaign({ tag: 'par-draft', start: '2099-05-01', end: '2099-05-31' });
  const mine = new Set([on.id, off.id, draft.id]);
  const e = entry(listMap, 'list-visible-set');
  for (const role of ['editor_member', 'viewer', 'store_manager', 'supervisor']) {
    const api = await as(role);
    const l = await api.get('/api/campaigns');
    const n = await api.get(`/api/workspace/campaigns?q=${encodeURIComponent(m5Prefix())}`);
    const lRows = l.ok() ? ((await l.json()).campaigns as any[]).filter((c) => mine.has(c.id)) : [];
    const nRows = n.ok() ? ((await n.json()).records as any[]).filter((c) => mine.has(c.id)) : [];
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `活動列表可見集合（${role}）`,
        legacy: { endpoint: 'GET /api/campaigns', status: l.status() },
        native: { endpoint: 'GET /api/workspace/campaigns', status: n.status() },
        compared: { legacy: lRows.length, native: nRows.length },
        diffs: setDiffs('campaign', idSet(lRows), idSet(nRows)),
      }),
    );
  }
});

test('活動檢視清單：舊 /api/campaigns/published vs 新 monthly tools op=activity（停用一律隱藏）', async () => {
  const on = await seedCampaign({ tag: 'par-view-on', start: '2099-05-01', end: '2099-05-31', publish: { sup: true, sm: true } });
  const off = await seedCampaign({ tag: 'par-view-off', start: '2099-05-01', end: '2099-05-31', active: false, publish: { sup: true, sm: true } });
  const mine = new Set([on.id, off.id]);
  const s = await stores();
  const e = entry(listMap, 'activity-view-list');
  for (const role of ['viewer', 'store_manager', 'supervisor']) {
    const api = await as(role);
    const l = await api.get('/api/campaigns/published');
    const n = await api.get(`/api/workspace/monthly/tools?store=${(role === 'supervisor' ? s.ZT01 : s.VW001).id}&month=2099-05&op=activity`);
    const lRows = l.ok() ? ((await l.json()).data as any[]).filter((c) => mine.has(c.id)) : [];
    const nRows = n.ok() ? ((await n.json()).data as any[]).filter((c) => mine.has(c.id)) : [];
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `活動檢視清單（${role}）`,
        legacy: { endpoint: 'GET /api/campaigns/published', status: l.status() },
        native: { endpoint: 'GET /api/workspace/monthly/tools?op=activity', status: n.status() },
        compared: { legacy: lRows.length, native: nRows.length },
        diffs: setDiffs('campaign', idSet(lRows), idSet(nRows)),
      }),
    );
  }
});

test('新增活動的允許與否：舊版（profiles.role＋RLS）vs 新版（角色權限）', async () => {
  const e = entry(listMap, 'write-permission');
  for (const role of ['editor_member', 'manager_viewer', 'viewer', 'store_manager']) {
    const api = await as(role);
    const l = await api.post('/api/campaigns', { data: { name: m5Name(`par-write-${role}-legacy`), start_date: '2099-05-01', end_date: '2099-05-31', campaign_type: 'promotion' } });
    const n = await api.post('/api/workspace/campaigns', { data: { name: m5Name(`par-write-${role}-native`), start_date: '2099-05-01', end_date: '2099-05-31', campaign_type: 'promotion', is_active: true, requestId: randomUUID() } });
    const diffs: Diff[] = allowedClass(l.status()) === allowedClass(n.status()) ? [] : [{ kind: 'status', key: 'create', legacy: allowedClass(l.status()), native: allowedClass(n.status()), detail: `舊版 ${l.status()}／新版 ${n.status()}` }];
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'write-readback',
        role,
        title: `新增活動允許與否（${role}）`,
        legacy: { endpoint: 'POST /api/campaigns', status: l.status() },
        native: { endpoint: 'POST /api/workspace/campaigns', status: n.status() },
        compared: { legacy: allowedClass(l.status()), native: allowedClass(n.status()) },
        diffs,
      }),
    );
  }
});

test('刪除活動：舊版一次確認就刪、新版要輸入名稱；刪除後所有子表都不留資料', async () => {
  const e = entry(listMap, 'delete-confirm');
  const admin = await apiAs('admin');
  try {
    const a = await seedCampaign({ tag: 'par-del-legacy', start: '2099-05-01', end: '2099-05-31' });
    const b = await seedCampaign({ tag: 'par-del-native', start: '2099-05-01', end: '2099-05-31' });
    await seedChildren(a.id);
    await seedChildren(b.id);
    const l = await admin.delete(`/api/campaigns?id=${a.id}`);
    // 新版：沒輸入名稱 → 被擋；輸入名稱 → 刪除
    const version = (await adminDb().from('campaigns').select('workspace_version').eq('id', b.id).single()).data.workspace_version;
    const nNoName = await admin.delete(`/api/workspace/campaigns?id=${b.id}&version=${version}`);
    const diffs: Diff[] = allowedClass(l.status()) === allowedClass(nNoName.status()) ? [] : [{ kind: 'status', key: 'delete-without-name', legacy: allowedClass(l.status()), native: allowedClass(nNoName.status()), detail: `舊版 ${l.status()}／新版 ${nNoName.status()}` }];
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'write-readback',
        role: 'admin',
        title: '刪除活動（不輸入名稱）',
        legacy: { endpoint: 'DELETE /api/campaigns', status: l.status() },
        native: { endpoint: 'DELETE /api/workspace/campaigns', status: nNoName.status() },
        compared: { legacy: l.status(), native: nNoName.status() },
        diffs,
      }),
    );
    const nOk = await admin.delete(`/api/workspace/campaigns?id=${b.id}&version=${version}&confirmName=${encodeURIComponent(b.name)}`);
    expect(nOk.status()).toBe(200);
    const tables = ['campaign_schedules', 'campaign_store_details', 'campaign_store_headcount', 'campaign_store_own_staff', 'campaign_checklist_items', 'campaign_equipment_trips', 'campaign_support_requests', 'campaign_support_staff', 'campaign_department_publish'];
    const legacyLeft: Record<string, number> = {};
    const nativeLeft: Record<string, number> = {};
    for (const t of tables) {
      legacyLeft[t] = await countRows(t, a.id);
      nativeLeft[t] = await countRows(t, b.id);
    }
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'write-readback',
        role: 'admin',
        title: '刪除後子表殘留',
        legacy: { endpoint: 'DELETE /api/campaigns（回讀各子表）' },
        native: { endpoint: 'DELETE /api/workspace/campaigns?confirmName（回讀各子表）' },
        compared: { tables: tables.length },
        diffs: JSON.stringify(legacyLeft) === JSON.stringify(nativeLeft) ? [] : [{ kind: 'changed', key: 'children-left', legacy: legacyLeft, native: nativeLeft }],
      }),
    );
    expect(Object.values(nativeLeft).every((n) => n === 0)).toBe(true);
  } finally {
    await admin.dispose();
  }
});

test('活動改短期間：舊版期間外的排程仍留著，新版確認後移回尚未安排', async () => {
  const e = entry(listMap, 'date-change-outside');
  const admin = await apiAs('admin');
  try {
    const mk = async (tag: string) => {
      const c = await seedCampaign({ tag, start: '2099-05-01', end: '2099-05-31' });
      await seedSchedules(c.id, [['VW001', '2099-05-06'], ['ZT01', '2099-05-20'], ['ZT02', '2099-05-30']]);
      return c;
    };
    const a = await mk('par-shorten-legacy');
    const b = await mk('par-shorten-native');
    const l = await admin.put('/api/campaigns', { data: { id: a.id, name: a.name, start_date: '2099-05-01', end_date: '2099-05-15', is_active: true, campaign_type: 'promotion' } });
    expect(l.status()).toBe(200);
    const version = (await adminDb().from('campaigns').select('workspace_version').eq('id', b.id).single()).data.workspace_version;
    const n = await admin.put('/api/workspace/campaigns', { data: { id: b.id, version, name: b.name, start_date: '2099-05-01', end_date: '2099-05-15', is_active: true, campaign_type: 'promotion', moveOutside: true } });
    expect(n.status()).toBe(200);
    const lRows = await scheduleRows(a.id);
    const nRows = await scheduleRows(b.id);
    const diffs: Diff[] = [];
    for (const code of Object.keys(lRows)) if (!(code in nRows)) diffs.push({ kind: 'only-legacy', key: `schedule#${code}`, legacy: lRows[code] });
    for (const code of Object.keys(nRows)) if (!(code in lRows)) diffs.push({ kind: 'only-native', key: `schedule#${code}`, native: nRows[code] });
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'write-readback',
        role: 'admin',
        title: '改短期間後的排程列',
        legacy: { endpoint: 'PUT /api/campaigns（回讀 campaign_schedules）' },
        native: { endpoint: 'PUT /api/workspace/campaigns?moveOutside（回讀 campaign_schedules）' },
        compared: { legacy: Object.keys(lRows).length, native: Object.keys(nRows).length },
        diffs,
      }),
    );
    expect(nRows).toEqual({ VW001: '2099-05-06' });
  } finally {
    await admin.dispose();
  }
});

test('門市設定：允許與禁止星期重疊，舊版照存、新版擋下', async () => {
  const e = entry(listMap, 'settings-overlap');
  const admin = await apiAs('admin');
  try {
    await withStoreSetting('ZT05', null, async (storeId) => {
      const l = await admin.post('/api/store-activity-settings', { data: { store_id: storeId, allowed_days: [3, 6], forbidden_days: [6], notes: '' } });
      const n = await admin.post('/api/workspace/campaign-tools?resource=settings', { data: { store_id: storeId, allowed_days: [3, 6], forbidden_days: [6], notes: '' } });
      expect(n.status()).toBe(400);
      assertNoUnlistedDiffs(
        list.record({
          entry: e.id,
          mechanism: 'write-readback',
          role: 'admin',
          title: '允許與禁止星期重疊',
          legacy: { endpoint: 'POST /api/store-activity-settings', status: l.status() },
          native: { endpoint: 'POST /api/workspace/campaign-tools?resource=settings', status: n.status() },
          compared: { legacy: allowedClass(l.status()), native: allowedClass(n.status()) },
          diffs: allowedClass(l.status()) === allowedClass(n.status()) ? [] : [{ kind: 'status', key: 'overlap', legacy: allowedClass(l.status()), native: allowedClass(n.status()), detail: `舊版 ${l.status()}／新版 ${n.status()}` }],
        }),
      );
    });
  } finally {
    await admin.dispose();
  }
});

test('特殊日期同一天再儲存：兩版都以日期覆蓋，最終資料列相同', async () => {
  const e = entry(listMap, 'event-overwrite');
  const admin = await apiAs('admin');
  try {
    const dates = ['2099-08-01', '2099-08-02'];
    const results: Record<string, any> = {};
    const routes = ['/api/event-dates', '/api/workspace/campaign-tools?resource=events'];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const date = dates[i];
      const post = (description: string, blocked: boolean, type: string) => admin.post(route, { data: { event_date: date, description: m5Name(description), event_type: type, is_blocked: blocked } });
      expect((await post('first', true, 'holiday')).ok()).toBe(true);
      expect((await post('second', false, 'other')).ok()).toBe(true);
      const row = await eventOn(date);
      results[route] = { description: String(row.description).replace(m5Prefix(), ''), is_blocked: row.is_blocked, event_type: row.event_type, rows: (await adminDb().from('event_dates').select('id', { count: 'exact', head: true }).eq('event_date', date)).count };
    }
    const [l, n] = Object.values(results);
    assertNoUnlistedDiffs(
      list.record({
        entry: e.id,
        mechanism: 'write-readback',
        role: 'admin',
        title: '特殊日期覆蓋',
        legacy: { endpoint: 'POST /api/event-dates ×2' },
        native: { endpoint: 'POST /api/workspace/campaign-tools?resource=events ×2' },
        compared: { rows: l.rows },
        diffs: JSON.stringify(l) === JSON.stringify(n) ? [] : [{ kind: 'changed', key: 'event-row', legacy: l, native: n }],
      }),
    );
  } finally {
    await admin.dispose();
  }
});
