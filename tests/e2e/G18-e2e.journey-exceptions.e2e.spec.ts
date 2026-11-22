import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertGaBaseline, cleanupM7M8, M7_FILE_PREFIX, m7Name, seedCategory, seedEquipment, seedWorkOrder, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow, openGaCenter } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { multipartBody } from '../support/multipart';
import { makePng } from '../support/png';
import { attachments, db, dialogFits, gaNav, openAs, openCenter, openMyRequest, openWo, realErrors, reqEvents, reqRow, submitForm, vis, woEvents, woRow, woUpdates } from '../support/g18-journey';

// M7/M8 第 5 批 G18.journey-exceptions 角色接力劇本「例外情境」（桌機 project 跑一次；總務與工務桌機 1440、店長手機 390）：
//  1. 強制結案：總務管理者在工單中心按「不處理，強制結案」（原因必填；缺強制結案權限的更新者看到缺哪個權限）→ 需求單標已完成、工單結案方式標示「強制結案」→ 店長在我的追蹤只看到「總務已結案」、原因不外洩（畫面與 API）。
//  2. 需求單已退回或取消時，工單端存進度不會把需求單翻回處理中（也不翻回待複核）；工單照常記錄進度。
//  3. 刪除規則：已受理與已連需求單的單，回報人與總務都不能刪（說明改用強制結案）；未受理且沒連需求單的單，回報人只能刪自己的、總務可刪；刪除時附件照片只標記刪除、不實刪。
//  4. 轉店帶單回歸（第 4 批 B6／D20，沿用 G27 的更正所屬門市）：設備更正門市後，未結案的維修單與工單一起轉到新門市，工單時間軸多一筆公開的 STORE_MOVED，新門市店長看得到、舊門市店長看不到。
const N = '/api/workspace/general-affairs';
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let sid: Record<string, string> = {};
let seq = 0;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_store_a', 'wo_store_b', 'wo_manager', 'wo_works', 'wo_update_noforce', 'tf_ga', 'wo_outsider_own']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

const open = { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', assignee_name: 'M7M8 工務乙' };
/** 連結需求單的工單（需求單與工單互相連結）。 */
async function linked(suffix: string, reqStatus = 'IN_PROGRESS', storeCode: 'VW001' | 'ZT01' = 'VW001', woOver: Record<string, unknown> = {}, reqOver: Record<string, unknown> = {}) {
  const creator = storeCode === 'VW001' ? users.wo_store_a.id : users.wo_store_b.id;
  const r = (await db().from('ga_service_requests').insert({ store_id: sid[storeCode], created_by: creator, request_type: 'REPAIR', title: m7Name(`EX-REQ-${suffix}-${(seq += 1)}`), description: 'm7m8 例外劇本',
    main_status: reqStatus, intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS', ...reqOver }).select('*').single()).data as any;
  const w = await seedWorkOrder(storeCode, `EX-${suffix}`, creator, { ...open, accepted_at: new Date().toISOString(), ga_service_request_id: r.id, ...woOver });
  await db().from('ga_service_requests').update({ maintenance_request_id: w.id }).eq('id', r.id);
  return { r: await reqRow(r.id), w: await woRow(w.id) };
}

test('強制結案：按鈕「不處理，強制結案」、原因必填、缺權限講清楚；需求單標已完成、結案方式標示；店長只看到「總務已結案」，原因不外洩', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const reason = '門市已自行處理完畢，不需要派工 EX1';
  const { r, w } = await linked('FC');
  // 只有更新、沒有強制結案權限的工務：看得到缺哪個權限，API 被擋
  const nf = await openAs(browser, states.wo_update_noforce, 'desktop');
  try {
    await openCenter(nf.page);
    await openWo(nf.page, 'EX-FC');
    await expect(vis(nf.page, 'act-force-close')).toHaveCount(0);
    await expect(vis(nf.page, 'reason-force-close')).toContainText('強制結案');
    const c = await apiForUser(users.wo_update_noforce as any);
    const blocked = await c.post(`${N}/work-orders/${w.id}/force-close`, { data: { force_close_reason: reason, expected_updated_at: (await woRow(w.id)).updated_at } });
    expect(blocked.status()).toBe(403);
    await c.dispose();
    expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING' });
  } finally {
    await nf.ctx.close();
  }
  // 總務管理者（桌機）強制結案
  const ga = await openAs(browser, states.wo_manager, 'desktop');
  try {
    await openCenter(ga.page);
    await openWo(ga.page, 'EX-FC');
    await expect(vis(ga.page, 'act-force-close')).toHaveText('不處理，強制結案');
    await vis(ga.page, 'act-force-close').click();
    await dialogFits(ga.page);
    await dialog(ga.page).getByTestId('wo-submit').click();
    await expect(dialog(ga.page).getByTestId('wo-form-error')).toContainText('原因');
    expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING' }); // 沒填原因：沒送出
    await dialog(ga.page).getByTestId('f-notes').fill(reason);
    await submitForm(ga.page, '已強制結案');
    const w2 = await woRow(w.id);
    expect(w2).toMatchObject({ status: 'COMPLETED', completion_method: 'ADMIN_FORCE_CLOSED' });
    expect(w2.completed_by).toBe(users.wo_manager.id);
    expect(await reqRow(r.id)).toMatchObject({ main_status: 'COMPLETED' });
    await expect(vis(ga.page, 'wo-completion-method')).toContainText('強制結案');
    // 內部原因與公開通知兩筆進度、兩筆事件
    const ups = await woUpdates(w.id);
    expect(ups.filter((u) => u.visibility === 'INTERNAL' && String(u.notes).includes(reason))).toHaveLength(1);
    expect(ups.filter((u) => u.visibility === 'PUBLIC' && String(u.notes).includes('總務已結案'))).toHaveLength(1);
    expect(ups.filter((u) => u.visibility === 'PUBLIC').every((u) => !String(u.notes).includes(reason))).toBe(true);
    expect((await woEvents(w.id)).map((e) => `${e.event_type}:${e.visibility}`)).toEqual(expect.arrayContaining(['FORCE_CLOSE:INTERNAL', 'FORCE_CLOSE_NOTICE:PUBLIC']));
    // 總務自己看得到原因（內部時間軸）
    await expect(vis(ga.page, 'wo-timeline-item').filter({ hasText: reason }).first()).toBeVisible();
    // 結案後所有動作都消失
    for (const t of ['act-progress', 'act-completion', 'act-force-close', 'act-supplement', 'act-issue-part']) await expect(vis(ga.page, t), t).toHaveCount(0);
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  // 店長（手機）：我的追蹤只看到「總務已結案」，沒有原因
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store.page);
    await gaNav(store.page, '我的追蹤');
    await openMyRequest(store.page, r.request_no);
    await expect(dialog(store.page).getByTestId('request-detail')).toContainText('總務已結案');
    const text = (await dialog(store.page).innerText()) || '';
    expect(text).not.toContain(reason);
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(realErrors(store.errors)).toEqual([]);
    // API：店長看工單與需求單詳情，原因不外洩
    const c = await apiForUser(users.wo_store_a as any);
    const wd = JSON.stringify((await (await c.get(`${N}/work-orders/${w.id}`)).json()).data);
    expect(wd).toContain('總務已結案');
    expect(wd).not.toContain(reason);
    const rd = JSON.stringify(await (await c.get(`${N}/requests/${r.id}?surface=MY_REPORTS`)).json());
    expect(rd).not.toContain(reason);
    const evs = JSON.stringify(await reqEvents(r.id));
    expect(evs).not.toContain(reason.slice(0, 8)); // 需求單事件裡也沒有原因（內部欄位）
    await c.dispose();
  } finally {
    await store.ctx.close();
  }
});

test('需求單已退回或取消時：工單存進度不把需求單翻回處理中，工單照常記錄進度（API 與工務畫面）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const c = await apiForUser(users.wo_works as any);
  for (const st of ['REJECTED', 'CANCELED'] as const) {
    const { r, w } = await linked(`NOFLIP-${st}`, st, 'VW001', {}, st === 'REJECTED' ? { rejection_reason: 'OTHER', rejection_note: '測試退回' } : { cancel_reason: '測試取消' });
    const res = await c.post(`${N}/work-orders/${w.id}/progress`, { data: { notes: `工務照常處理 ${st}`, progress_stage: 'VENDOR_WORKING', expected_updated_at: w.updated_at } });
    expect(res.status(), await res.text()).toBe(200);
    expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
    expect((await woUpdates(w.id)).map((u) => u.notes)).toContain(`工務照常處理 ${st}`);
    const after = await reqRow(r.id);
    expect(after.main_status, `需求單 ${st} 不翻回`).toBe(st);
    expect(after.public_progress).toBe(r.public_progress); // 對外進度也沒被覆蓋
    // 送門市確認同樣不翻回需求單
    const w1 = await woRow(w.id);
    const done = await c.post(`${N}/work-orders/${w.id}/request-completion`, { data: { notes: '處理完成', expected_updated_at: w1.updated_at } });
    expect(done.status(), await done.text()).toBe(200);
    expect((await reqRow(r.id)).main_status, `送確認後需求單 ${st} 不翻回`).toBe(st);
  }
  await c.dispose();
  // 畫面：工務在工單中心對「需求單已取消」的單存進度，畫面成功、不報錯
  const { r, w } = await linked('NOFLIP-UI', 'CANCELED', 'VW001', {}, { cancel_reason: '測試取消 UI' });
  const works = await openAs(browser, states.wo_works, 'desktop');
  try {
    await openCenter(works.page);
    await openWo(works.page, 'EX-NOFLIP-UI');
    await vis(works.page, 'act-progress').click();
    await dialog(works.page).getByTestId('f-notes').fill('需求單已取消，工單仍記錄現況');
    await submitForm(works.page, '進度已更新');
    expect((await reqRow(r.id)).main_status).toBe('CANCELED');
    expect((await woRow(w.id)).status).toBe('PROCESSING');
    expect(realErrors(works.errors)).toEqual([]);
  } finally {
    await works.ctx.close();
  }
});

test('刪除規則：已受理與已連需求單不可刪（說明改用強制結案）；未受理且沒連需求單：回報人只能刪自己的、總務可刪；附件照片只標記刪除不實刪', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const png = makePng({ width: 100, height: 80, inkPixels: 20 });
  const ma = await apiForUser(users.wo_manager as any);
  const sa = await apiForUser(users.wo_store_a as any);
  const sb = await apiForUser(users.wo_store_b as any);
  const del = (c: any, id: string, v: string) => c.delete(`${N}/work-orders/${id}`, { data: { expected_updated_at: v } });
  // 已受理 → 回報人與總務管理者都不能刪
  const acc = await seedWorkOrder('VW001', `EX-DEL-ACC-${(seq += 1)}`, users.wo_store_a.id, { status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString() });
  for (const c of [sa, ma]) {
    const r = await del(c, acc.id, acc.updated_at);
    expect(r.status()).toBe(409);
    expect(JSON.stringify(await r.json())).toContain('強制結案');
  }
  expect(await woRow(acc.id)).not.toBeNull();
  // 未受理但已連需求單 → 不能刪
  const lk = await linked('DEL-LINK', 'PENDING_INTAKE', 'VW001', { status: 'UNACCEPTED', progress_stage: null, assignee_name: null, accepted_at: null });
  for (const c of [sa, ma]) expect((await del(c, lk.w.id, lk.w.updated_at)).status()).toBe(409);
  expect(await woRow(lk.w.id)).not.toBeNull();
  // 未受理且沒連需求單：別人（B 店店長）不能刪店長 A 的單；回報人本人可刪
  const mine = await seedWorkOrder('VW001', `EX-DEL-OWN-${(seq += 1)}`, users.wo_store_a.id);
  expect((await del(sb, mine.id, mine.updated_at)).status()).toBeGreaterThanOrEqual(403);
  expect(await woRow(mine.id)).not.toBeNull();
  // 附件：店長 A 上傳回報照片 → 刪除工單後附件列只標記刪除（deleted_at），儲存空間的檔案還在
  const mp = multipartBody([{ name: `${M7_FILE_PREFIX}ex-del.png`, mimeType: 'image/png', buffer: png }], { kind: 'REPORT_PHOTO' });
  const up = await sa.post(`${N}/work-orders/${mine.id}/attachments`, { data: mp.data, headers: mp.headers });
  expect(up.status(), await up.text()).toBe(201);
  const before = (await attachments(mine.id)).filter((a) => !a.deleted_at);
  expect(before).toHaveLength(1);
  const path = before[0].storage_path as string;
  const bucket = (before[0].storage_bucket as string) || 'general-affairs-attachments';
  // 畫面：回報人（手機）在工單中心刪除自己的單
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openCenter(store.page);
    await openWo(store.page, 'EX-DEL-OWN');
    await vis(store.page, 'act-delete').click();
    await dialogFits(store.page);
    await dialog(store.page).getByTestId('wo-submit').click();
    await expect(vis(store.page, 'wob-notice')).toContainText('工單已刪除');
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  expect(await woRow(mine.id)).toBeNull();
  const rows = await attachments(mine.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].deleted_at).toBeTruthy(); // 只標記刪除
  const still = await db().storage.from(bucket).download(path);
  expect(still.error, '儲存空間的檔案仍在').toBeNull();
  // 總務可刪未受理且沒連需求單的單（別人回報的）
  const other = await seedWorkOrder('ZT01', `EX-DEL-GA-${(seq += 1)}`, users.wo_store_b.id);
  const rr = await del(ma, other.id, other.updated_at);
  expect(rr.status(), await rr.text()).toBe(200);
  expect(await woRow(other.id)).toBeNull();
  for (const c of [ma, sa, sb]) await c.dispose();
  // 清掉測試附件的檔案（資料列保留標記，由 cleanupM7M8 處理）；路徑以 M7_FILE_PREFIX 命名
  await db().storage.from(bucket).remove([path]);
});

test('轉店帶單回歸（G27）：設備更正所屬門市後，未結案的維修單與工單一起轉到新門市；工單時間軸多一筆公開的「因設備所屬門市更正…」（STORE_MOVED）；新門市店長看得到、舊門市店長看不到；已結案與添購單不搬', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const eqCat = await seedCategory('equipment', 'EXJ');
  const eq = await seedEquipment('ZT01', eqCat.id, 'EX-冷凍櫃');
  const mkReq = async (type: string, status: string, withWo: boolean, woStatus = 'PROCESSING') => {
    const n = (seq += 1);
    const req = (await db().from('ga_service_requests').insert({ store_id: sid.ZT01, created_by: users.wo_outsider_own.id, request_type: type, title: m7Name(`EX-MV-R${n}`), description: '轉店劇本', resource_type: 'EQUIPMENT', equipment_id: eq.id, main_status: status }).select('*').single()).data as any;
    let wo: any = null;
    if (withWo) {
      wo = await seedWorkOrder('ZT01', `EX-MV-W${n}`, users.wo_outsider_own.id, { status: woStatus, resource_type: 'equipment', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString(), ga_service_request_id: req.id });
      await db().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('id', req.id);
    }
    return { req, wo };
  };
  const open1 = await mkReq('REPAIR', 'IN_PROGRESS', true);
  const done = await mkReq('REPAIR', 'COMPLETED', true, 'COMPLETED');
  const purchase = await mkReq('PURCHASE_SUPPLEMENT', 'IN_PROGRESS', false);
  const tf = await apiForUser(users.tf_ga as any);
  const sbApi = await apiForUser(users.wo_store_b as any);
  const saApi = await apiForUser(users.wo_store_a as any);
  // 回報人另有其人（回報人本人永遠看得到自己的單，所以不用任一店店長當回報人）
  // 轉店前：舊門市（ZT01）店長看得到工單，新門市（VW001）店長看不到
  expect((await sbApi.get(`${N}/work-orders/${open1.wo.id}`)).status()).toBe(200);
  expect((await saApi.get(`${N}/work-orders/${open1.wo.id}`)).status()).toBe(404);
  const res = await tf.post(`${N}/equipment/${eq.id}/correct-store`, { data: { to_store_id: sid.VW001, reason: '建檔時選錯門市 EX4' } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  // 資料庫：未結案的維修單與工單轉到 VW001；已結案與添購單留在 ZT01
  expect((await reqRow(open1.req.id)).store_id).toBe(sid.VW001);
  expect((await woRow(open1.wo.id)).store_id).toBe(sid.VW001);
  expect((await reqRow(done.req.id)).store_id).toBe(sid.ZT01);
  expect((await woRow(done.wo.id)).store_id).toBe(sid.ZT01);
  expect((await reqRow(purchase.req.id)).store_id).toBe(sid.ZT01);
  const evs = (await woEvents(open1.wo.id)).filter((e) => e.event_type === 'STORE_MOVED');
  expect(evs).toHaveLength(1);
  expect(evs[0]).toMatchObject({ visibility: 'PUBLIC' });
  expect(evs[0].description || evs[0].title || '').toMatch(/因設備所屬門市更正/);
  expect((await woEvents(done.wo.id)).filter((e) => e.event_type === 'STORE_MOVED')).toHaveLength(0);
  // API：新門市（VW001）店長看得到、舊門市店長看不到；時間軸有公開的搬單事件
  expect((await sbApi.get(`${N}/work-orders/${open1.wo.id}`)).status()).toBe(404);
  const seen = await saApi.get(`${N}/work-orders/${open1.wo.id}`);
  expect(seen.status()).toBe(200);
  expect(JSON.stringify((await seen.json()).data.timeline)).toContain('因設備所屬門市更正');
  await tf.dispose();
  await sbApi.dispose();
  await saApi.dispose();
  // 畫面：新門市店長（手機）在工單中心看得到這張單，時間軸顯示搬單事件
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openCenter(store.page);
    await openWo(store.page, 'EX-MV-W');
    await expect(vis(store.page, 'wo-timeline-item').filter({ hasText: '因設備所屬門市更正' })).toHaveCount(1);
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
});
