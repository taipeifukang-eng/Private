import { expect, test } from '@playwright/test';
import {
  adminDb, callFn, cleanupM7M8, m7Name, row, rowsWhere, rpcClientFor, seedCategory, seedEquipment, seedFacility, seedRepairRequest, stores,
} from '../support/m7m8-fixtures';

// M7/M8 第 2 批（G06-G10）資料庫函式整合測試：直接用各角色的登入身分呼叫 ga_ws_* 函式，驗證資料庫端的權限、狀態流轉與「全成或全不變」。
//   A 異動紀錄與轉移單（Q8 恢復 QR、Q10 未結案單禁止刪除／更正門市、Q28 轉移單）
//   B 設備與設施貼標流程（Q29：上傳、複核、退回兩項都要求、進度與完成率）
//   C Excel 整批匯入（預檢、全成或全不變、防重複送出）、維修紀錄（Q11：門市範圍與每台修過幾次）
// 資料只用測試門市 VW／ZT 與帶標記（[自動測試]M7M8）的資料；結束時只刪自己建立的資料。
const clients: Record<string, any> = {};
let eqCat: { id: string; code: string };
let facCat: { id: string; code: string };
let codedCat: { id: string; code: string }; // DEV 既有、能自動產生資產編號的第二層設備分類（只讀使用，不改動）
let sid: Record<string, string> = {};
let managerA = ''; // ZT01 店長（role-matrix store_manager）
let managerB = ''; // VW001 店長（ga_store_manager_b）
let gaUser = '';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(180_000);
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ['ga_works', 'ga_facility_view', 'ga_facility_edit', 'store_manager', 'ga_store_manager_b', 'denied']) clients[k] = await rpcClientFor(k);
  const s = await stores();
  sid = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.id]));
  const uid = async (k: string) => (await clients[k].auth.getUser()).data.user.id as string;
  managerA = await uid('store_manager');
  managerB = await uid('ga_store_manager_b');
  gaUser = await uid('ga_works');
  eqCat = await seedCategory('equipment', 'EC');
  const cats = ((await adminDb().from('ga_equipment_categories').select('id,code,parent_id,requires_brand,requires_model,requires_serial_number').is('deleted_at', null).eq('is_active', true)).data || []) as any[];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const l2 = cats.find((c) => /^[A-Z]{2}[0-9]{2}$/.test(c.code) && c.parent_id && byId.get(c.parent_id) && !byId.get(c.parent_id).parent_id);
  if (!l2) throw new Error('DEV 找不到可自動產生資產編號的第二層設備分類，停止');
  codedCat = { id: l2.id, code: l2.code };
  facCat = await seedCategory('facility', 'FC');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const eventsOf = async (assetId: string) => (await rowsWhere('ga_asset_events', 'asset_id', assetId)).sort((a, b) => a.created_at.localeCompare(b.created_at));

// ------------------------------------------------------------------ A. 刪除與未結案單（Q10）
test('Q10 有未結案單禁止刪除並回張數；已結案才可刪；原因必填；沒有管理權限做不到', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'DEL');
  const open = await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'DEL-open', 'IN_PROGRESS', managerA);
  await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'DEL-done', 'COMPLETED', managerA);

  const pre = await callFn(clients.ga_works, 'ga_ws_asset_open_orders', { p_type: 'EQUIPMENT', p_id: eq.id });
  expect(pre.ok).toBe(true);
  expect(pre.data.open_count).toBe(1);

  // 無原因、無權限
  expect((await callFn(clients.ga_works, 'ga_ws_delete_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '  ' })).status).toBe(400);
  const denied = await callFn(clients.ga_facility_edit, 'ga_ws_delete_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '測試' });
  expect(denied.ok).toBe(false);
  expect(denied.status).toBe(403);
  expect((await callFn(clients.store_manager, 'ga_ws_delete_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '測試' })).status).toBe(403);

  const blocked = await callFn(clients.ga_works, 'ga_ws_delete_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '不要了' });
  expect(blocked).toMatchObject({ ok: false, status: 409, code: 'OPEN_ORDERS', open_count: 1 });
  expect(blocked.error).toContain('1 張未結案單');
  expect((await row('ga_equipment', eq.id)).deleted_at).toBeNull();

  // 工單未完成也算未結案（需求單已完成，但工單還開著）
  const wo = (await adminDb().from('maintenance_requests').insert({
    store_id: sid.ZT01, title: m7Name('DEL-wo'), reported_by: managerA, reporter_name: 'm7m8', status: 'PROCESSING',
  }).select('id').single()).data;
  await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED', maintenance_request_id: wo.id }).eq('id', open.id);
  const still = await callFn(clients.ga_works, 'ga_ws_asset_open_orders', { p_type: 'EQUIPMENT', p_id: eq.id });
  expect(still.data).toMatchObject({ open_count: 1, open_requests: 0, open_work_orders: 1 });
  await adminDb().from('maintenance_requests').update({ status: 'COMPLETED' }).eq('id', wo.id);
  await adminDb().from('ga_service_requests').update({ maintenance_request_id: null }).eq('id', open.id);
  expect((await callFn(clients.ga_works, 'ga_ws_asset_open_orders', { p_type: 'EQUIPMENT', p_id: eq.id })).data.open_count).toBe(0);

  const ok = await callFn(clients.ga_works, 'ga_ws_delete_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '不要了' });
  expect(ok.ok).toBe(true);
  const after = await row('ga_equipment', eq.id);
  expect(after.deleted_at).not.toBeNull();
  expect(after.deletion_reason).toBe('不要了');
  expect(after.qr_token_revoked_at).not.toBeNull(); // 刪除自動作廢 QR（既有觸發器）
  await adminDb().from('maintenance_requests').delete().eq('id', wo.id);
});

test('Q10 設施刪除同規則；進行中轉移單也擋刪除', async () => {
  const fac = await seedFacility('ZT01', facCat.id, 'FDEL');
  await seedRepairRequest('ZT01', { facilityId: fac.id }, 'FDEL-open', 'ACCEPTED', managerA);
  const blocked = await callFn(clients.ga_works, 'ga_ws_delete_asset', { p_type: 'FACILITY', p_id: fac.id, p_reason: '拆除' });
  expect(blocked).toMatchObject({ ok: false, status: 409, code: 'OPEN_ORDERS', open_count: 1 });
  await adminDb().from('ga_service_requests').update({ main_status: 'CANCELED' }).eq('facility_id', fac.id);

  const eq = await seedEquipment('ZT01', eqCat.id, 'TDEL');
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { p_type: 'EQUIPMENT', p_asset_id: eq.id, p_to_store_id: sid.VW001, p_reason: '搬店' })).ok).toBe(true);
  const b = await callFn(clients.ga_works, 'ga_ws_delete_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '刪' });
  expect(b).toMatchObject({ ok: false, status: 409, code: 'OPEN_TRANSFER' });
  const fin = await callFn(clients.ga_works, 'ga_ws_delete_asset', { p_type: 'FACILITY', p_id: fac.id, p_reason: '拆除' });
  expect(fin.ok).toBe(true);
});

// ------------------------------------------------------------------ A. 更正所屬門市（Q10）
test('Q10 更正所屬門市：必填原因、寫異動紀錄、不能同店、不影響 QR；有進行中轉移單不可做；店長做不到', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'FIX');
  await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'FIX-open', 'PENDING_INTAKE', managerA);
  const token = eq.qr_token;

  expect((await callFn(clients.store_manager, 'ga_ws_correct_asset_store', { p_type: 'EQUIPMENT', p_id: eq.id, p_to_store_id: sid.ZT02, p_reason: 'x' })).status).toBe(403);
  expect((await callFn(clients.ga_works, 'ga_ws_correct_asset_store', { p_type: 'EQUIPMENT', p_id: eq.id, p_to_store_id: sid.ZT02, p_reason: '' })).status).toBe(400);
  expect((await callFn(clients.ga_works, 'ga_ws_correct_asset_store', { p_type: 'EQUIPMENT', p_id: eq.id, p_to_store_id: sid.ZT01, p_reason: '同店' })).status).toBe(400);
  // 過期版本
  expect((await callFn(clients.ga_works, 'ga_ws_correct_asset_store', { p_type: 'EQUIPMENT', p_id: eq.id, p_to_store_id: sid.ZT02, p_reason: '建檔選錯店', p_expected_updated_at: '2020-01-01T00:00:00Z' })).code).toBe('STALE');

  const ok = await callFn(clients.ga_works, 'ga_ws_correct_asset_store', { p_type: 'EQUIPMENT', p_id: eq.id, p_to_store_id: sid.ZT02, p_reason: '建檔選錯店', p_expected_updated_at: eq.updated_at });
  expect(ok.ok).toBe(true);
  expect(ok.data.open_count).toBe(1);
  const after = await row('ga_equipment', eq.id);
  expect(after.store_id).toBe(sid.ZT02);
  expect(after.qr_token).toBe(token);
  const ev = await eventsOf(eq.id);
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ event_type: 'STORE_CORRECTION', from_store_id: sid.ZT01, to_store_id: sid.ZT02, reason: '建檔選錯店', open_request_count: 1, actor_id: gaUser });

  // 異動紀錄不可被一般身分修改或刪除
  const del = await clients.ga_works.from('ga_asset_events').delete().eq('id', ev[0].id);
  expect(del.error || (await eventsOf(eq.id)).length === 1).toBeTruthy();
  expect(await eventsOf(eq.id)).toHaveLength(1);

  // 進行中轉移單時不可更正
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { p_type: 'EQUIPMENT', p_asset_id: eq.id, p_to_store_id: sid.VW001, p_reason: '搬' })).ok).toBe(true);
  const b = await callFn(clients.ga_works, 'ga_ws_correct_asset_store', { p_type: 'EQUIPMENT', p_id: eq.id, p_to_store_id: sid.ZT03, p_reason: '再改' });
  expect(b).toMatchObject({ ok: false, status: 409 });
});

// ------------------------------------------------------------------ A. 恢復 QR（Q8）
test('Q8 報廢自動作廢 QR；總務恢復使用後沿用原 token；退役設備不作廢；已刪除不能恢復；店長與只讀做不到', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'RST');
  const token = eq.qr_token;
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', eq.id);
  const scrapped = await row('ga_equipment', eq.id);
  expect(scrapped.qr_token_revoked_at).not.toBeNull();

  expect((await callFn(clients.store_manager, 'ga_ws_restore_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '誤按' })).status).toBe(403);
  expect((await callFn(clients.ga_facility_view, 'ga_ws_restore_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '誤按' })).status).toBe(403);
  expect((await callFn(clients.ga_works, 'ga_ws_restore_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: ' ' })).status).toBe(400);

  const ok = await callFn(clients.ga_works, 'ga_ws_restore_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '誤按報廢' });
  expect(ok.ok).toBe(true);
  const back = await row('ga_equipment', eq.id);
  expect(back).toMatchObject({ status: 'ACTIVE', qr_token_revoked_at: null, qr_token: token });
  expect((await eventsOf(eq.id)).map((e) => e.event_type)).toEqual(['QR_RESTORED']);
  // 沒有作廢的不需要恢復
  expect((await callFn(clients.ga_works, 'ga_ws_restore_asset', { p_type: 'EQUIPMENT', p_id: eq.id, p_reason: '再恢復' })).status).toBe(409);

  // 設備退役：舊版規則不作廢 QR
  await adminDb().from('ga_equipment').update({ status: 'RETIRED' }).eq('id', eq.id);
  expect((await row('ga_equipment', eq.id)).qr_token_revoked_at).toBeNull();

  // 設施退役會作廢，可恢復
  const fac = await seedFacility('ZT01', facCat.id, 'RST');
  await adminDb().from('ga_facilities').update({ status: 'RETIRED' }).eq('id', fac.id);
  expect((await row('ga_facilities', fac.id)).qr_token_revoked_at).not.toBeNull();
  expect((await callFn(clients.ga_works, 'ga_ws_restore_asset', { p_type: 'FACILITY', p_id: fac.id, p_reason: '誤按退役' })).ok).toBe(true);
  expect(await row('ga_facilities', fac.id)).toMatchObject({ status: 'ACTIVE', qr_token_revoked_at: null, qr_token: fac.qr_token });

  // 已刪除不能恢復
  const gone = await seedEquipment('ZT01', eqCat.id, 'RST-del');
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED', deleted_at: new Date().toISOString(), deleted_by: gaUser, deletion_reason: '測' }).eq('id', gone.id);
  expect((await callFn(clients.ga_works, 'ga_ws_restore_asset', { p_type: 'EQUIPMENT', p_id: gone.id, p_reason: '救回' })).status).toBe(404);
});

// ------------------------------------------------------------------ A. 轉移單（Q28）
test('Q28 轉移單：總務發起 → A 店店長確認交出 → B 店店長確認收到才換店；QR 沿用；紀錄完整；越權與亂序都被擋', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TRF');
  const token = eq.qr_token;
  const base = { p_type: 'EQUIPMENT', p_asset_id: eq.id, p_to_store_id: sid.VW001 };

  // 發起：店長與只讀做不到；缺原因；同店
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_create', { ...base, p_reason: '搬' })).status).toBe(403);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { ...base, p_reason: '' })).status).toBe(400);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { ...base, p_to_store_id: sid.ZT01, p_reason: '搬' })).status).toBe(400);
  const created = await callFn(clients.ga_works, 'ga_ws_transfer_create', { ...base, p_reason: '總部調度' });
  expect(created.ok).toBe(true);
  expect(created.data.status).toBe('PENDING_HANDOVER');
  expect(created.data.transfer_no).toMatch(/^AT\d{8}-\d{4}$/);
  const tid = created.data.id as string;
  // 同一資產同時只能有一張進行中
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { ...base, p_reason: '重複' })).code).toBe('OPEN_TRANSFER');
  // 發起後資產還在 A 店
  expect((await row('ga_equipment', eq.id)).store_id).toBe(sid.ZT01);

  // 亂序與越權：B 店先收（A 還沒交出）、B 店不能替 A 交出、非店長者不能動、其他店店長不能動
  expect((await callFn(clients.ga_store_manager_b, 'ga_ws_transfer_confirm_receive', { p_transfer_id: tid })).status).toBe(409); // B 店是對的門市，但 A 店還沒交出
  expect((await callFn(clients.ga_store_manager_b, 'ga_ws_transfer_confirm_handover', { p_transfer_id: tid })).status).toBe(403);
  expect((await callFn(clients.denied, 'ga_ws_transfer_confirm_handover', { p_transfer_id: tid })).status).toBe(403);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_confirm_handover', { p_transfer_id: tid })).status).toBe(403); // 總務不是 A 店店長
  // 店長可讀自己門市的轉移單，其他人不行
  expect((await clients.store_manager.from('ga_asset_transfers').select('id').eq('id', tid)).data).toHaveLength(1);
  expect((await clients.ga_store_manager_b.from('ga_asset_transfers').select('id').eq('id', tid)).data).toHaveLength(1);
  expect((await clients.denied.from('ga_asset_transfers').select('id').eq('id', tid)).data).toHaveLength(0);
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_confirm_receive', { p_transfer_id: tid })).status).toBe(403);

  // A 店確認交出（附一張照片）
  const photo = { path: `asset-transfers/${tid}/handover/p1.jpg`, file_name: 'p1.jpg', content_type: 'image/jpeg', size_bytes: 1234 };
  const badPhoto = { ...photo, path: 'asset-transfers/other/handover/p1.jpg' };
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_confirm_handover', { p_transfer_id: tid, p_photos: [badPhoto] })).ok).toBe(false);
  expect((await row('ga_asset_transfers', tid)).status).toBe('PENDING_HANDOVER'); // 照片驗證失敗，整步沒有生效
  const hand = await callFn(clients.store_manager, 'ga_ws_transfer_confirm_handover', { p_transfer_id: tid, p_note: '已打包', p_photos: [photo] });
  expect(hand.ok).toBe(true);
  expect(await row('ga_asset_transfers', tid)).toMatchObject({ status: 'PENDING_RECEIVE', handover_by: managerA, handover_note: '已打包' });
  expect((await row('ga_equipment', eq.id)).store_id).toBe(sid.ZT01); // 還沒收到，不換店
  // 重複交出 → 409（重新載入）
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_confirm_handover', { p_transfer_id: tid })).code).toBe('STALE');
  // A 店不能替 B 店收
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_confirm_receive', { p_transfer_id: tid })).status).toBe(403);

  // B 店確認收到 → 換店
  const recv = await callFn(clients.ga_store_manager_b, 'ga_ws_transfer_confirm_receive', {
    p_transfer_id: tid, p_note: '已上架', p_photos: [{ ...photo, path: `asset-transfers/${tid}/receive/r1.jpg`, file_name: 'r1.jpg' }],
  });
  expect(recv.ok).toBe(true);
  const after = await row('ga_equipment', eq.id);
  expect(after.store_id).toBe(sid.VW001);
  expect(after.qr_token).toBe(token); // QR 沿用
  expect(after.qr_token_revoked_at).toBeNull();
  expect(await row('ga_asset_transfers', tid)).toMatchObject({ status: 'COMPLETED', received_by: managerB, receive_note: '已上架' });
  expect((await callFn(clients.ga_store_manager_b, 'ga_ws_transfer_confirm_receive', { p_transfer_id: tid })).code).toBe('STALE');
  const photos = await rowsWhere('ga_asset_transfer_photos', 'transfer_id', tid);
  expect(photos.map((p) => p.step).sort()).toEqual(['HANDOVER', 'RECEIVE']);
  expect((await eventsOf(eq.id)).map((e) => e.event_type)).toEqual(['TRANSFER_REQUESTED', 'TRANSFER_HANDED_OVER', 'STORE_TRANSFER']);
  expect((await eventsOf(eq.id))[2]).toMatchObject({ from_store_id: sid.ZT01, to_store_id: sid.VW001, actor_id: managerB });

  // 換店後：B 店店長讀得到設備、A 店店長讀不到（RLS）
  expect((await clients.ga_store_manager_b.from('ga_equipment').select('id').eq('id', eq.id)).data).toHaveLength(1);
  expect((await clients.store_manager.from('ga_equipment').select('id').eq('id', eq.id)).data).toHaveLength(0);
});

test('Q28 取消轉移單：只有總務、只能取消未完成的；資產不動；取消後可重新發起；報廢資產不能發起', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'CAN');
  const created = await callFn(clients.ga_works, 'ga_ws_transfer_create', { p_type: 'EQUIPMENT', p_asset_id: eq.id, p_to_store_id: sid.VW001, p_reason: '搬' });
  const tid = created.data.id as string;
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_cancel', { p_transfer_id: tid, p_reason: '不搬' })).status).toBe(403);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_cancel', { p_transfer_id: tid, p_reason: '' })).status).toBe(400);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_cancel', { p_transfer_id: tid, p_reason: '不搬了' })).ok).toBe(true);
  expect(await row('ga_asset_transfers', tid)).toMatchObject({ status: 'CANCELLED', cancel_reason: '不搬了' });
  expect((await row('ga_equipment', eq.id)).store_id).toBe(sid.ZT01);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_cancel', { p_transfer_id: tid, p_reason: '再取消' })).code).toBe('STALE');
  // A 店已交出的單，B 店不能再收（已取消）
  expect((await callFn(clients.ga_store_manager_b, 'ga_ws_transfer_confirm_receive', { p_transfer_id: tid })).status).toBe(409);
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { p_type: 'EQUIPMENT', p_asset_id: eq.id, p_to_store_id: sid.VW001, p_reason: '重新發起' })).ok).toBe(true);
  expect((await eventsOf(eq.id)).map((e) => e.event_type)).toEqual(['TRANSFER_REQUESTED', 'TRANSFER_CANCELLED', 'TRANSFER_REQUESTED']);

  const scrapped = await seedEquipment('ZT01', eqCat.id, 'CAN2', { status: 'SCRAPPED' });
  expect((await callFn(clients.ga_works, 'ga_ws_transfer_create', { p_type: 'EQUIPMENT', p_asset_id: scrapped.id, p_to_store_id: sid.VW001, p_reason: '搬' })).status).toBe(409);
});

test('Q28 設施也能走轉移單；收到時資產已被刪除或已更正門市會被擋', async () => {
  const fac = await seedFacility('ZT01', facCat.id, 'FTR');
  const t = await callFn(clients.ga_works, 'ga_ws_transfer_create', { p_type: 'FACILITY', p_asset_id: fac.id, p_to_store_id: sid.VW001, p_reason: '搬設施' });
  expect(t.ok).toBe(true);
  expect((await callFn(clients.ga_facility_view, 'ga_ws_transfer_create', { p_type: 'FACILITY', p_asset_id: fac.id, p_to_store_id: sid.VW002, p_reason: '只讀' })).status).toBe(403);
  expect((await callFn(clients.store_manager, 'ga_ws_transfer_confirm_handover', { p_transfer_id: t.data.id })).ok).toBe(true);
  await adminDb().from('ga_facilities').update({ store_id: sid.ZT03 }).eq('id', fac.id); // 繞過函式的更動（模擬舊版直接改店）
  const blocked = await callFn(clients.ga_store_manager_b, 'ga_ws_transfer_confirm_receive', { p_transfer_id: t.data.id });
  expect(blocked).toMatchObject({ ok: false, status: 409 });
  expect((await row('ga_asset_transfers', t.data.id)).status).toBe('PENDING_RECEIVE'); // 沒有半套
});

// ------------------------------------------------------------------ B. 貼標流程（Q29）
for (const type of ['EQUIPMENT', 'FACILITY'] as const) {
  test(`Q29 ${type === 'EQUIPMENT' ? '設備' : '設施'}貼標：待上傳照片 → 待上傳貼標照 → 待複核 → 退回（兩項都要求）→ 重傳 → 完成；店長只能處理自己門市`, async () => {
    const tbl = type === 'EQUIPMENT' ? 'ga_equipment' : 'ga_facilities';
    const asset = type === 'EQUIPMENT' ? await seedEquipment('ZT01', eqCat.id, 'ONB') : await seedFacility('ZT01', facCat.id, 'ONB');
    const sub = (client: any, purpose: string, n: string) => callFn(client, 'ga_ws_submit_onboarding_photo', {
      p_type: type, p_id: asset.id, p_purpose: purpose, p_path: `${type.toLowerCase()}/${asset.id}/${purpose.toLowerCase()}/${n}.jpg`, p_file_name: `${n}.jpg`, p_content_type: 'image/jpeg', p_size_bytes: 1000,
    });
    const status = async () => (await row(tbl, asset.id)).onboarding_status;
    expect(await status()).toBe('NEEDS_EQUIPMENT_PHOTO');

    // 待辦清單：A 店店長看得到，B 店店長看不到
    const mine = await callFn(clients.store_manager, 'ga_ws_onboarding_list', { p_statuses: ['NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO'] });
    expect(mine.data.rows.some((r: any) => r.id === asset.id && r.asset_type === type)).toBe(true);
    const other = await callFn(clients.ga_store_manager_b, 'ga_ws_onboarding_list', { p_statuses: ['NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO'] });
    expect(other.data.rows.some((r: any) => r.id === asset.id)).toBe(false);

    // 越權與亂序
    expect((await sub(clients.ga_store_manager_b, 'PRIMARY_IMAGE', 'x')).status).toBe(403);
    expect((await sub(clients.denied, 'PRIMARY_IMAGE', 'x')).status).toBe(403);
    expect((await sub(clients.store_manager, 'LABEL_POSITION_IMAGE', 'x')).code).toBe('STALE'); // 先要主照片
    expect((await callFn(clients.store_manager, 'ga_ws_submit_onboarding_photo', { p_type: type, p_id: asset.id, p_purpose: 'PRIMARY_IMAGE', p_path: `${type.toLowerCase()}/${asset.id}/a.pdf`, p_file_name: 'a.pdf', p_content_type: 'application/pdf', p_size_bytes: 10 })).status).toBe(400);

    // 路徑必須在這項資產自己的資料夾底下（不能把別人的檔案登錄成自己的附件）
    const foreign = (p: string) => callFn(clients.store_manager, 'ga_ws_submit_onboarding_photo', { p_type: type, p_id: asset.id, p_purpose: 'PRIMARY_IMAGE', p_path: p, p_file_name: 'f.jpg', p_content_type: 'image/jpeg', p_size_bytes: 10 });
    expect((await foreign('equipment/00000000-0000-0000-0000-000000000000/primary_image/x.jpg')).status).toBe(400);
    expect((await foreign(`${type.toLowerCase()}/${asset.id}/label_position_image/x.jpg`)).status).toBe(400);
    expect((await foreign('receipts/someone-else.jpg')).status).toBe(400);
    expect(await status()).toBe('NEEDS_EQUIPMENT_PHOTO');

    expect((await sub(clients.store_manager, 'PRIMARY_IMAGE', 'p1')).ok).toBe(true);
    expect(await status()).toBe('NEEDS_LABEL_PHOTO');
    expect((await sub(clients.store_manager, 'PRIMARY_IMAGE', 'p1b')).code).toBe('STALE');
    expect((await sub(clients.store_manager, 'LABEL_POSITION_IMAGE', 'l1')).ok).toBe(true);
    expect(await status()).toBe('PENDING_GA_REVIEW');

    // 複核：店長與只讀做不到；退回缺原因
    const review = (client: any, action: string, note?: string) => callFn(client, 'ga_ws_review_onboarding', { p_type: type, p_id: asset.id, p_action: action, p_note: note ?? null });
    expect((await review(clients.store_manager, 'approve')).status).toBe(403);
    expect((await review(type === 'EQUIPMENT' ? clients.ga_facility_edit : clients.ga_facility_view, 'approve')).status).toBe(403);
    expect((await review(clients.ga_works, 'reject', '  ')).status).toBe(400);
    expect((await review(clients.ga_works, 'reject', '貼標位置照片太模糊')).ok).toBe(true);
    expect(await row(tbl, asset.id)).toMatchObject({
      onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true, onboarding_review_note: '貼標位置照片太模糊',
    });
    expect((await review(clients.ga_works, 'approve')).code).toBe('STALE'); // 已不是待複核

    // 退回後兩項都要重傳
    expect((await sub(clients.store_manager, 'PRIMARY_IMAGE', 'p2')).ok).toBe(true);
    expect(await status()).toBe('NEEDS_LABEL_PHOTO');
    expect((await sub(clients.store_manager, 'LABEL_POSITION_IMAGE', 'l2')).ok).toBe(true);
    expect(await status()).toBe('PENDING_GA_REVIEW');
    // 主照片只會有一張 is_primary
    const prim = (await rowsWhere('ga_resource_attachments', 'resource_id', asset.id)).filter((a) => a.purpose === 'PRIMARY_IMAGE' && a.is_primary && !a.deleted_at);
    expect(prim).toHaveLength(1);
    expect((await review(clients.ga_works, 'approve')).ok).toBe(true);
    expect(await row(tbl, asset.id)).toMatchObject({ onboarding_status: 'COMPLETED', onboarding_requires_primary_photo: false, onboarding_requires_label_photo: false, onboarding_reviewed_by: gaUser });
    // 完成後不再出現在待辦
    expect((await callFn(clients.store_manager, 'ga_ws_onboarding_list', { p_statuses: ['NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO', 'PENDING_GA_REVIEW'] })).data.rows.some((r: any) => r.id === asset.id)).toBe(false);
  });
}

test('Q29 上線貼標進度：每店各階段筆數與完成率；排除已刪除與已作廢；沒有資產的店不算 100%；店長只看自己門市', async () => {
  const e1 = await seedEquipment('ZT04', eqCat.id, 'PRG1');
  const e2 = await seedEquipment('ZT04', eqCat.id, 'PRG2', { onboarding_status: 'COMPLETED' });
  await seedEquipment('ZT04', eqCat.id, 'PRG3', { onboarding_status: 'PENDING_GA_REVIEW' });
  await seedEquipment('ZT04', eqCat.id, 'PRG4', { status: 'SCRAPPED' }); // 不計
  const f1 = await seedFacility('ZT04', facCat.id, 'PRG5', { onboarding_status: 'NEEDS_LABEL_PHOTO' });
  await seedFacility('ZT04', facCat.id, 'PRG6', { onboarding_status: 'COMPLETED' });
  void e1; void e2; void f1;
  const res = await callFn(clients.ga_works, 'ga_ws_onboarding_progress', {});
  expect(res.ok).toBe(true);
  const zt4 = res.data.stores.find((s: any) => s.store_code === 'ZT04');
  expect(zt4.equipment).toMatchObject({ total: 3, needs_photo: 1, pending_review: 1, completed: 1 });
  expect(zt4.facility).toMatchObject({ total: 2, needs_label: 1, completed: 1 });
  expect(zt4.total).toBe(5);
  expect(zt4.completed).toBe(2);
  expect(zt4.completion_rate).toBe(40);
  const zt5 = res.data.stores.find((s: any) => s.store_code === 'ZT05');
  expect(zt5.total).toBe(0);
  expect(zt5.completion_rate).toBeNull();

  // 店長只看自己門市；沒有名單身分也沒有查看權限者 403
  const mine = await callFn(clients.store_manager, 'ga_ws_onboarding_progress', {});
  expect(mine.data.stores.map((s: any) => s.store_code)).toEqual(['ZT01']);
  expect((await callFn(clients.denied, 'ga_ws_onboarding_progress', {})).status).toBe(403);
  expect((await callFn(clients.ga_works, 'ga_ws_onboarding_progress', { p_store_id: sid.ZT04, p_include_empty: false })).data.stores).toHaveLength(1);
});

test('Q29 店長替自己門市的設施上傳照片：資料表層（RLS 觸發器）也放行；其他門市與完成後不行', async () => {
  const fac = await seedFacility('ZT01', facCat.id, 'RLS');
  const ins = (client: any) => client.from('ga_resource_attachments').insert({
    resource_type: 'FACILITY', resource_id: fac.id, purpose: 'OTHER', storage_bucket: 'general-affairs-attachments', storage_path: `facility/${fac.id}/other/${Date.now()}.jpg`,
    file_name: 'a.jpg', content_type: 'image/jpeg', size_bytes: 10,
  });
  expect((await ins(clients.store_manager)).error).toBeNull();
  expect((await ins(clients.ga_store_manager_b)).error).not.toBeNull();
  await adminDb().from('ga_facilities').update({ onboarding_status: 'COMPLETED' }).eq('id', fac.id);
  expect((await ins(clients.store_manager)).error).not.toBeNull(); // 完成後店長不能再動
  expect((await ins(clients.ga_facility_edit)).error).toBeNull(); // 有設施管理權限者仍可
});

// ------------------------------------------------------------------ C. Excel 匯入（Q29）
test('Q29 匯入：預檢不留資料；任何一列有錯整批不寫入；全部通過一次寫入；同一識別碼重送不重複；權限分設備與設施', async () => {
  const mk = (n: number, over: Record<string, unknown> = {}) => ({
    row_no: n + 1, kind: 'EQUIPMENT', store_code: 'ZT05', category_code: codedCat.code, name: m7Name(`IMP${n}`), brand: 'B', model: 'M', serial_number: `SN${n}`, purchased_at: '2026-01-15', ...over,
  });
  const good = [mk(1), mk(2), { ...mk(3), kind: 'FACILITY', category_code: facCat.code, quantity: 2, unit: '組' }];
  const count = async () => ((await adminDb().from('ga_equipment').select('id', { count: 'exact', head: true }).like('name', '[自動測試]M7M8 T%IMP%')).count || 0)
    + ((await adminDb().from('ga_facilities').select('id', { count: 'exact', head: true }).like('name', '[自動測試]M7M8 T%IMP%')).count || 0);
  const file = m7Name('匯入.xlsx');

  // 預檢：全過，但不寫入；回預計編號
  const dry = await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: good, p_file_name: file, p_idempotency_key: 'k-dry', p_dry_run: true });
  expect(dry.ok).toBe(true);
  expect(dry.data).toMatchObject({ dry_run: true, committed: false, equipment_count: 2, facility_count: 1, store_count: 1 });
  expect(dry.data.errors).toEqual([]);
  expect(dry.data.rows[0].code).toMatch(/^[A-Z]{2}\d{2}20260115\d{3}$/);
  expect(dry.data.rows[0].id).toBeUndefined();
  expect(await count()).toBe(0);

  // 有錯：整批不寫入，逐列回報
  const bad = [...good, mk(4, { store_code: 'NOPE99' }), mk(5, { category_code: 'NOCAT' }), mk(6, { purchased_at: '2026-13-45' }), mk(7, { name: ' ' }), mk(8, { status: 'BROKEN' })];
  const bres = await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: bad, p_file_name: file, p_idempotency_key: 'k-bad', p_dry_run: false });
  expect(bres.ok).toBe(true);
  expect(bres.data.committed).toBe(false);
  expect(bres.data.errors.map((e: any) => e.row_no)).toEqual([5, 6, 7, 8, 9]);
  expect(bres.data.errors[0].error).toContain('NOPE99');
  expect(bres.data.errors[2].error).toContain('日期');
  expect(await count()).toBe(0);
  expect((await rowsWhere('ga_asset_import_batches', 'idempotency_key', 'k-bad'))).toHaveLength(0);

  // 權限：只有設施管理權限者不能匯入設備；沒有權限 403
  expect((await callFn(clients.ga_facility_edit, 'ga_ws_import_assets', { p_rows: good, p_file_name: file, p_idempotency_key: 'k-p', p_dry_run: true })).status).toBe(403);
  expect((await callFn(clients.store_manager, 'ga_ws_import_assets', { p_rows: good, p_file_name: file, p_idempotency_key: 'k-p', p_dry_run: true })).status).toBe(403);
  const facOnly = await callFn(clients.ga_facility_edit, 'ga_ws_import_assets', { p_rows: [good[2]], p_file_name: file, p_idempotency_key: 'k-fac', p_dry_run: true });
  expect(facOnly.data.errors).toEqual([]);
  // kind 前後帶空白也要走同一個權限檢查（預檢與寫入用同一種正規化）
  const padded = good.map((r: any) => ({ ...r, kind: ` ${r.kind} ` }));
  expect((await callFn(clients.store_manager, 'ga_ws_import_assets', { p_rows: padded, p_file_name: file, p_idempotency_key: 'k-pad-sm', p_dry_run: false })).status).toBe(403);
  expect((await callFn(clients.ga_facility_edit, 'ga_ws_import_assets', { p_rows: padded, p_file_name: file, p_idempotency_key: 'k-pad-fe', p_dry_run: false })).status).toBe(403);
  expect(await count()).toBe(0);
  expect((await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: [], p_file_name: file, p_idempotency_key: 'k-e', p_dry_run: false })).status).toBe(400);
  expect((await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: good, p_file_name: file, p_idempotency_key: '', p_dry_run: false })).status).toBe(400);

  // 正式寫入
  const ok = await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: good, p_file_name: file, p_idempotency_key: 'k-ok', p_dry_run: false });
  expect(ok.data).toMatchObject({ committed: true, already_imported: false, equipment_count: 2, facility_count: 1 });
  expect(await count()).toBe(3);
  const created = ok.data.rows.map((r: any) => r.id);
  expect(created).toHaveLength(3);
  const eqRows = (await adminDb().from('ga_equipment').select('*').in('id', created)).data as any[];
  expect(eqRows).toHaveLength(2);
  for (const e of eqRows) expect(e).toMatchObject({ store_id: sid.ZT05, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', status: 'ACTIVE' });
  expect(new Set(eqRows.map((e) => e.asset_code)).size).toBe(2); // 兩台各自流水號
  expect(eqRows[0].specs.import_batch_id).toBe(ok.data.batch_id);
  const facRows = (await adminDb().from('ga_facilities').select('*').in('id', created)).data as any[];
  expect(facRows[0]).toMatchObject({ store_id: sid.ZT05, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', quantity: 2, unit: '組' });
  expect((await rowsWhere('ga_asset_import_batches', 'id', ok.data.batch_id))[0]).toMatchObject({ equipment_count: 2, facility_count: 1, total_rows: 3, created_by: gaUser });

  // 同一識別碼重送：不重複建立
  const again = await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: good, p_file_name: file, p_idempotency_key: 'k-ok', p_dry_run: false });
  expect(again.data).toMatchObject({ committed: true, already_imported: true, batch_id: ok.data.batch_id });
  expect(await count()).toBe(3);

  // 檔案內資產編號重複：整批失敗
  const dup = [mk(11, { asset_code: 'M7M8DUP0001' }), mk(12, { asset_code: 'M7M8DUP0001' })];
  const dres = await callFn(clients.ga_works, 'ga_ws_import_assets', { p_rows: dup, p_file_name: file, p_idempotency_key: 'k-dup', p_dry_run: false });
  expect(dres.data.committed).toBe(false);
  expect(dres.data.errors).toHaveLength(1);
  expect(dres.data.errors[0].error).toContain('重複');
  expect(await count()).toBe(3);
});

// ------------------------------------------------------------------ C. 維修紀錄（Q11）
test('Q11 維修紀錄讀需求單與工單：總務看全部、門市負責人只看自己門市；分頁與搜尋；每台修過幾次', async () => {
  const a = await seedEquipment('ZT01', eqCat.id, 'HIS-A');
  const b = await seedEquipment('VW001', eqCat.id, 'HIS-B');
  const f = await seedFacility('ZT01', facCat.id, 'HIS-F');
  await seedRepairRequest('ZT01', { equipmentId: a.id }, 'HIS-a1', 'COMPLETED', managerA);
  await seedRepairRequest('ZT01', { equipmentId: a.id }, 'HIS-a2', 'IN_PROGRESS', managerA);
  await seedRepairRequest('VW001', { equipmentId: b.id }, 'HIS-b1', 'PENDING_INTAKE', managerB);
  await seedRepairRequest('ZT01', { facilityId: f.id }, 'HIS-f1', 'REJECTED', managerA);
  // 非報修（添購單）不算
  await adminDb().from('ga_service_requests').insert({
    store_id: sid.ZT01, created_by: managerA, request_type: 'PURCHASE_SUPPLEMENT', title: m7Name('HIS-buy'), description: 'x', resource_type: 'OTHER_PURCHASE', main_status: 'PENDING_INTAKE',
  });

  const ga = await callFn(clients.ga_works, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT', p_search: 'HIS-' });
  expect(ga.ok).toBe(true);
  expect(ga.data.rows.map((r: any) => r.title).sort()).toEqual([m7Name('HIS-a1'), m7Name('HIS-a2'), m7Name('HIS-b1')].sort());
  expect(ga.data.total).toBe(3);
  const mineA = await callFn(clients.store_manager, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT', p_search: 'HIS-' });
  expect(mineA.data.rows.map((r: any) => r.store_code)).toEqual(['ZT01', 'ZT01']);
  expect(mineA.data.rows.every((r: any) => r.work_order === null || r.work_order.assignee_name === null)).toBe(true);
  // 店長指定別店資產：看不到
  expect((await callFn(clients.store_manager, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT', p_asset_id: b.id })).data.total).toBe(0);
  expect((await callFn(clients.denied, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT' })).status).toBe(403);
  // 狀態與分頁
  expect((await callFn(clients.ga_works, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT', p_search: 'HIS-', p_status: 'OPEN' })).data.total).toBe(2);
  expect((await callFn(clients.ga_works, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT', p_search: 'HIS-', p_status: 'CLOSED' })).data.total).toBe(1);
  const page = await callFn(clients.ga_works, 'ga_ws_asset_maintenance_history', { p_type: 'EQUIPMENT', p_search: 'HIS-', p_limit: 1, p_offset: 1 });
  expect(page.data.rows).toHaveLength(1);
  expect(page.data.total).toBe(3);
  // 搜尋框輸入逗號、括號、百分號不會壞
  expect((await callFn(clients.ga_works, 'ga_ws_asset_maintenance_history', { p_type: 'FACILITY', p_search: '(,%)' })).ok).toBe(true);
  expect((await callFn(clients.ga_works, 'ga_ws_asset_maintenance_history', { p_type: 'FACILITY', p_search: 'HIS-f1' })).data.total).toBe(1);

  const sum = await callFn(clients.ga_works, 'ga_ws_asset_repair_summary', { p_type: 'EQUIPMENT', p_search: 'HIS-A' });
  expect(sum.data.rows).toHaveLength(1);
  expect(sum.data.rows[0]).toMatchObject({ asset_id: a.id, repair_count: 2, open_count: 1, store_code: 'ZT01' });
});
