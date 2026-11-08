import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  adminDb,
  apiForUser,
  campaignRow,
  countRows,
  deleteRunData,
  eventOn,
  m5Name,
  m5Prefix,
  scheduleRows,
  seedCampaign,
  seedChildren,
  seedEvent,
  seedSchedules,
  setupM5Users,
  stores,
  withStoreSetting,
  type M5User,
} from '../support/m5-fixtures';

// W19 / P05 整合層（M5 Q1-Q5）：新版 workspace API 對照規格。
//  Q1 寫入只看角色權限（與舊版 profiles.role 不同的帳號列出來）、Q2 停用對督導／店長／檢視端隱藏、
//  Q3 刪除要輸入名稱且列出筆數、Q4 改期列出期間外門市並移回尚未安排、特殊日期與門市設定的重疊擋下。
// 資料：VW/ZT 測試門市、2099 年活動與特殊日期，活動名稱帶「[自動測試]M5 <runId>」，只刪自己建立的資料。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};

async function as(key: string): Promise<APIRequestContext> {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['editor_member', 'manager_viewer', 'viewer', 'store_manager', 'supervisor', 'store_detail']);
  users = s.users;
  teardownUsers = s.teardown;
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  await deleteRunData();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const body = (tag: string, over: Record<string, unknown> = {}) => ({
  name: m5Name(tag),
  start_date: '2099-05-01',
  end_date: '2099-05-31',
  campaign_type: 'promotion',
  is_active: true,
  requestId: randomUUID(),
  ...over,
});

test('Q1 寫入只看角色權限：新增活動的新舊結果（舊版看 profiles.role，新版看角色權限）', async () => {
  // 舊版 POST 要同時過兩關：(1) profiles.role 是 admin／manager（否則 403「權限不足」）；(2) 資料庫 RLS 要有 activity.campaign.edit／activity.manage（否則 500）。
  // 所以「舊式身分是經理、但角色沒有編輯權」的人舊版其實也寫不進去（500），與新版（403）同為拒絕——不是原規格預期的「舊版放行」。
  const expected: Record<string, { native: number; legacy: number }> = {
    editor_member: { native: 201, legacy: 403 }, // 有編輯權、舊式身分一般成員：新版放行、舊版擋下
    manager_viewer: { native: 403, legacy: 500 }, // 舊式身分經理、只有檢視：新舊都寫不進去
    viewer: { native: 403, legacy: 403 },
    store_manager: { native: 403, legacy: 403 },
    store_detail: { native: 403, legacy: 403 },
  };
  const diffs: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const api = await as(key);
    const n = await api.post('/api/workspace/campaigns', { data: body(`q1-${key}-native`) });
    const l = await api.post('/api/campaigns', { data: { name: m5Name(`q1-${key}-legacy`), start_date: '2099-05-01', end_date: '2099-05-31', campaign_type: 'promotion' } });
    expect(n.status(), `${key} 新版新增`).toBe(want.native);
    expect(l.status(), `${key} 舊版新增`).toBe(want.legacy);
    if ((n.status() < 300) !== (l.status() < 300)) diffs.push(`${key}: 新版 ${n.status()} / 舊版 ${l.status()}`);
  }
  // 新舊結果不同的帳號類型只有「有編輯權、舊式身分不是管理員／經理」（預覽 SQL m5-sql/w19_q1_write_permission_diff.sql 對正式區列出實際名單）。
  expect(diffs).toEqual(['editor_member: 新版 201 / 舊版 403']);
});

test('Q1 排程、特殊日期、門市設定的儲存同樣只看角色權限（有編輯權、舊式身分一般成員可存）', async () => {
  const c = await seedCampaign({ tag: 'q1-save', start: '2099-05-01', end: '2099-05-31' });
  const s = await stores();
  const editor = await as('editor_member');
  const get = await editor.get(`/api/workspace/campaign-tools?resource=schedules&campaign_id=${c.id}`);
  expect(get.status()).toBe(200);
  const version = (await get.json()).version;
  const put = await editor.put('/api/workspace/campaign-tools?resource=schedules', {
    data: { campaign_id: c.id, rows: [{ store_id: s.VW001.id, activity_date: '2099-05-06' }], version, requestId: randomUUID() },
  });
  expect(put.status()).toBe(200);
  expect(await scheduleRows(c.id)).toEqual({ VW001: '2099-05-06' });
  // 同一份寫入，只有檢視權限（舊式身分經理）新版擋下
  const viewer = await as('manager_viewer');
  const denied = await viewer.put('/api/workspace/campaign-tools?resource=schedules', {
    data: { campaign_id: c.id, rows: [], version: (await (await viewer.get(`/api/workspace/campaign-tools?resource=schedules&campaign_id=${c.id}`)).json()).version, requestId: randomUUID() },
  });
  expect(denied.status()).toBe(403);
  expect(await scheduleRows(c.id)).toEqual({ VW001: '2099-05-06' });
});

test('Q1 排程入口權限旗標：編輯權、門市細節權可進；只有檢視不行', async () => {
  const flags = async (key: string) => (await (await as(key)).get('/api/workspace/campaign-tools?resource=permissions')).json();
  const e = await flags('editor_member');
  expect(e.permissions.schedules).toBe(true);
  const d = await flags('store_detail');
  expect(d.permissions.details).toBe(true);
  expect(d.permissions.schedules).toBe(false);
  const v = await flags('viewer');
  expect(Object.values(v.permissions).some(Boolean)).toBe(false);
  expect(v.marketing).toBe(false);
  expect(v.merchandise).toBe(false);
});

test('Q2 停用：編輯者的列表仍看得到（標停用）；檢視者、店長、督導、活動檢視、門市端都看不到', async () => {
  const on = await seedCampaign({ tag: 'q2-on', start: '2099-05-01', end: '2099-05-31', publish: { sup: true, sm: true, inv: true } });
  const off = await seedCampaign({ tag: 'q2-off', start: '2099-05-01', end: '2099-05-31', active: false, publish: { sup: true, sm: true, inv: true } });
  const s = await stores();
  await seedSchedules(off.id, [['VW001', '2099-05-06']]);
  const q = encodeURIComponent(m5Prefix());
  const listNames = async (key: string) => {
    const r = await (await as(key)).get(`/api/workspace/campaigns?q=${q}`);
    expect(r.status(), key).toBe(200);
    const j = await r.json();
    return { names: (j.records as any[]).map((x) => x.name), canSeeInactive: j.canSeeInactive as boolean };
  };
  const editor = await listNames('editor_member');
  expect(editor.canSeeInactive).toBe(true);
  expect(editor.names).toContain(off.name);
  expect(editor.names).toContain(on.name);
  for (const key of ['viewer', 'store_manager', 'supervisor']) {
    const r = await listNames(key);
    expect(r.canSeeInactive, key).toBe(false);
    expect(r.names, `${key} 看不到停用`).not.toContain(off.name);
    expect(r.names, `${key} 仍看得到啟用`).toContain(on.name);
  }
  // 活動檢視（每月人員狀態內）清單與明細
  for (const key of ['viewer', 'store_manager', 'supervisor']) {
    const api = await as(key);
    const base = `/api/workspace/monthly/tools?store=${(key === 'supervisor' ? s.ZT01 : s.VW001).id}&month=2099-05`;
    const list = await api.get(`${base}&op=activity`);
    expect(list.status(), `${key} 活動檢視清單`).toBe(200);
    const names = ((await list.json()).data as any[]).map((x) => x.name);
    expect(names).not.toContain(off.name);
    expect(names).toContain(on.name);
    const detailOff = await api.get(`${base}&op=activityDetail&id=${off.id}`);
    expect(detailOff.status(), `${key} 停用活動明細`).toBe(404);
    const detailOn = await api.get(`${base}&op=activityDetail&id=${on.id}`);
    expect(detailOn.status(), `${key} 啟用活動明細`).toBe(200);
    // 門市端分頁（排程等）直接帶活動編號也讀不到
    const sched = await api.get(`/api/workspace/campaign-tools?resource=schedules&campaign_id=${off.id}`);
    expect(sched.status(), `${key} 停用活動排程`).toBe(404);
  }
  // 編輯者不受影響
  const edSched = await (await as('editor_member')).get(`/api/workspace/campaign-tools?resource=schedules&campaign_id=${off.id}`);
  expect(edSched.status()).toBe(200);
  // 還原啟用後，店長立刻又看得到（旗標而非刪除）
  await adminDb().from('campaigns').update({ is_active: true }).eq('id', off.id);
  expect((await listNames('store_manager')).names).toContain(off.name);
});

test('Q3 刪除前預覽筆數與資料庫實際筆數相同；沒輸入名稱或輸入錯誤伺服器端也擋下；輸入正確才刪', async () => {
  const c = await seedCampaign({ tag: 'q3-delete', start: '2099-05-01', end: '2099-05-31' });
  const expectedCounts = await seedChildren(c.id);
  const editor = await as('editor_member');
  const pv = await editor.get(`/api/workspace/campaigns?id=${c.id}&preview=delete`);
  expect(pv.status()).toBe(200);
  const counts = Object.fromEntries(((await pv.json()).counts as any[]).map((x) => [x.key, x.count]));
  expect(counts).toEqual(expectedCounts);
  // 預覽只給有編輯權的人
  expect((await (await as('viewer')).get(`/api/workspace/campaigns?id=${c.id}&preview=delete`)).status()).toBe(403);
  const row = await campaignRow(c.id);
  const del = (name?: string) => editor.delete(`/api/workspace/campaigns?id=${c.id}&version=${row.workspace_version}${name === undefined ? '' : '&confirmName=' + encodeURIComponent(name)}`);
  expect((await del()).status()).toBe(400);
  expect((await del('錯誤的名稱')).status()).toBe(400);
  expect((await del(c.name.slice(0, -1))).status()).toBe(400);
  expect(await countRows('campaign_schedules', c.id), '被擋下後資料還在').toBe(2);
  expect((await del(`  ${c.name}  `)).status()).toBe(200);
  expect(await campaignRow(c.id)).toBeNull();
  for (const t of ['campaign_schedules', 'campaign_store_details', 'campaign_store_headcount', 'campaign_store_own_staff', 'campaign_checklist_items', 'campaign_equipment_trips', 'campaign_support_requests']) {
    expect(await countRows(t, c.id), `${t} 已一併刪除`).toBe(0);
  }
});

test('Q3 沒有編輯權的人不能刪（即使知道名稱）', async () => {
  const c = await seedCampaign({ tag: 'q3-denied', start: '2099-05-01', end: '2099-05-31' });
  const row = await campaignRow(c.id);
  const r = await (await as('manager_viewer')).delete(`/api/workspace/campaigns?id=${c.id}&version=${row.workspace_version}&confirmName=${encodeURIComponent(c.name)}`);
  expect(r.status()).toBe(403);
  expect(await campaignRow(c.id)).not.toBeNull();
});

test('Q4 活動期間縮短：預覽列出期間外門市；沒確認不給存；確認後只移回那幾間，期間內的保留', async () => {
  const c = await seedCampaign({ tag: 'q4-shorten', start: '2099-05-01', end: '2099-05-31' });
  await seedSchedules(c.id, [['VW001', '2099-05-06'], ['ZT01', '2099-05-20'], ['ZT02', '2099-05-30']]);
  const editor = await as('editor_member');
  const pv = await editor.get(`/api/workspace/campaigns?id=${c.id}&preview=outside&start=2099-05-01&end=2099-05-15`);
  expect(pv.status()).toBe(200);
  const outside = ((await pv.json()).outside as any[]).map((o) => `${o.store_code}:${o.activity_date}`).sort();
  expect(outside).toEqual(['ZT01:2099-05-20', 'ZT02:2099-05-30']);
  // 沒有期間外：空清單
  expect(((await (await editor.get(`/api/workspace/campaigns?id=${c.id}&preview=outside&start=2099-05-01&end=2099-05-31`)).json()).outside as any[]).length).toBe(0);
  const row = await campaignRow(c.id);
  const put = (extra: Record<string, unknown> = {}) =>
    editor.put('/api/workspace/campaigns', { data: { id: c.id, version: row.workspace_version, name: c.name, start_date: '2099-05-01', end_date: '2099-05-15', campaign_type: 'promotion', is_active: true, ...extra } });
  const blocked = await put();
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error).toContain('2 間門市');
  expect((await campaignRow(c.id)).end_date, '被擋下後日期沒變').toBe('2099-05-31');
  expect(await scheduleRows(c.id)).toEqual({ VW001: '2099-05-06', ZT01: '2099-05-20', ZT02: '2099-05-30' });
  const ok = await put({ moveOutside: true });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).moved).toBe(2);
  expect((await campaignRow(c.id)).end_date).toBe('2099-05-15');
  expect(await scheduleRows(c.id), '只剩期間內的門市；移回的門市變成尚未安排').toEqual({ VW001: '2099-05-06' });
});

test('Q4 活動期間往後移：開始日往後，開始日之前的排程也算期間外；期間沒變就不動排程', async () => {
  const c = await seedCampaign({ tag: 'q4-shift', start: '2099-05-01', end: '2099-05-31' });
  await seedSchedules(c.id, [['VW001', '2099-05-03'], ['ZT01', '2099-05-20']]);
  const editor = await as('editor_member');
  const row = await campaignRow(c.id);
  // 只改名稱：不動排程
  const rename = await editor.put('/api/workspace/campaigns', { data: { id: c.id, version: row.workspace_version, name: c.name + ' 改名', start_date: '2099-05-01', end_date: '2099-05-31', campaign_type: 'promotion', is_active: true } });
  expect(rename.status()).toBe(200);
  expect((await rename.json()).moved).toBe(0);
  expect(await scheduleRows(c.id)).toEqual({ VW001: '2099-05-03', ZT01: '2099-05-20' });
  const v2 = (await campaignRow(c.id)).workspace_version;
  const shift = await editor.put('/api/workspace/campaigns', { data: { id: c.id, version: v2, name: c.name + ' 改名', start_date: '2099-05-10', end_date: '2099-05-31', campaign_type: 'promotion', is_active: true, moveOutside: true } });
  expect(shift.status()).toBe(200);
  expect(await scheduleRows(c.id)).toEqual({ ZT01: '2099-05-20' });
});

test('Q4 版本過期時不會先移走排程（先擋版本衝突）', async () => {
  const c = await seedCampaign({ tag: 'q4-stale', start: '2099-05-01', end: '2099-05-31' });
  await seedSchedules(c.id, [['ZT01', '2099-05-25']]);
  const editor = await as('editor_member');
  const v1 = (await campaignRow(c.id)).workspace_version;
  const bump = await editor.put('/api/workspace/campaigns', { data: { id: c.id, version: v1, name: c.name, start_date: '2099-05-01', end_date: '2099-05-31', campaign_type: 'promotion', is_active: false } });
  expect(bump.status()).toBe(200); // 另一個人先改了活動，版本往前
  const stale = await editor.put('/api/workspace/campaigns', { data: { id: c.id, version: v1, name: c.name, start_date: '2099-05-01', end_date: '2099-05-10', campaign_type: 'promotion', is_active: true, moveOutside: true } });
  expect(stale.status()).toBe(409);
  expect((await campaignRow(c.id)).end_date, '版本衝突時日期也不變').toBe('2099-05-31');
  expect(await scheduleRows(c.id), '版本衝突時排程完整保留').toEqual({ ZT01: '2099-05-25' });
});

test('門市設定：允許與禁止星期重疊被擋（400）；特殊日期同一天再存會覆蓋（畫面會先提醒）', async () => {
  const editor = await as('editor_member');
  await withStoreSetting('ZT05', null, async (storeId) => {
    const bad = await editor.post('/api/workspace/campaign-tools?resource=settings', { data: { store_id: storeId, allowed_days: [3, 6], forbidden_days: [6], notes: '' } });
    expect(bad.status()).toBe(400);
    const ok = await editor.post('/api/workspace/campaign-tools?resource=settings', { data: { store_id: storeId, allowed_days: [3, 6], forbidden_days: [7], notes: '' } });
    expect(ok.status()).toBe(200);
  });
  const date = '2099-06-03';
  await seedEvent(date, { type: 'holiday', blocked: true, tag: 'q5a-first' });
  const second = await editor.post('/api/workspace/campaign-tools?resource=events', { data: { event_date: date, description: m5Name('q5a-second'), event_type: 'other', is_blocked: false } });
  expect(second.status()).toBe(200);
  const now = await eventOn(date);
  expect(now.description).toBe(m5Name('q5a-second'));
  expect(now.is_blocked).toBe(false);
  const dup = await adminDb().from('event_dates').select('id', { count: 'exact', head: true }).eq('event_date', date);
  expect(dup.count, '同一天只有一筆').toBe(1);
});

test('管理員（角色矩陣 admin）可新增、改期、刪除；denied 與 employee 不行', async () => {
  const admin = await apiAs('admin');
  try {
    const created = await admin.post('/api/workspace/campaigns', { data: body('admin-flow') });
    expect(created.status()).toBe(201);
    const rec = (await created.json()).record;
    const pv = await admin.get(`/api/workspace/campaigns?id=${rec.id}&preview=delete`);
    expect(pv.status()).toBe(200);
    const del = await admin.delete(`/api/workspace/campaigns?id=${rec.id}&version=${rec.workspace_version}&confirmName=${encodeURIComponent(rec.name)}`);
    expect(del.status()).toBe(200);
  } finally {
    await admin.dispose();
  }
  for (const role of ['denied', 'employee']) {
    const api = await apiAs(role);
    try {
      expect((await api.post('/api/workspace/campaigns', { data: body('denied-' + role) })).status(), role).toBe(403);
    } finally {
      await api.dispose();
    }
  }
});

test('本次建立的活動都帶標記（sweeper 與 teardown 只靠標記清除，不用日期大量刪除）', async () => {
  const r = await adminDb().from('campaigns').select('name').ilike('name', `%M5 ${process.env.TEST_RUN_ID}%`);
  expect(r.error).toBeNull();
  const names = (r.data as { name: string }[]).map((x) => x.name);
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n.startsWith(m5Prefix()))).toBe(true);
});
