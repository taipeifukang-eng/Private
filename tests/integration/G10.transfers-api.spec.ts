import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { apiAs } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, seedCategory, seedEquipment, seedFacility, seedRepairRequest, stores } from '../support/m7m8-fixtures';
import { makePng } from '../support/png';

// M7/M8 第 2 批 Q28 設備／設施轉移單 API（/api/workspace/general-affairs/transfers/**）整合層。
// 流程：總務發起（不換店）→ A 店店長（ZT01）確認交出 → B 店店長（VW001）確認收到（同一交易換店）；QR 沿用；全程寫入異動紀錄。
// 涵蓋：全流程與讀回資料庫、待我處理範圍、照片（張數／格式／失敗不留檔案）、越權（總務不能代替店長、他店店長、督導不算、無權限者 403）、
//      重複發起 409、取消（原因必填、資產不動）、更正門市後收到 409、未結案單張數警示且單子不搬、設施同規則。
const nodeRequire = createRequire(path.join(__dirname, 'G10.transfers-api.spec.ts'));
const accountId = (k: string) => (nodeRequire('../support/credentials.cjs') as { getAccount: (k: string) => { userId: string } }).getAccount(k).userId;
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_equipment_edit', 'ga_facility_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string };
let facCat: { id: string };
let sid: Record<string, string> = {};
const png = makePng({ width: 64, height: 64, inkPixels: 10 });
const photo = (name = 'p.png') => ({ name, mimeType: 'image/png', buffer: png });

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqCat = await seedCategory('equipment', 'TE');
  facCat = await seedCategory('facility', 'TF');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const post = async (k: string, p: string, data: unknown) => j(await apis[k].post(`${BASE}/${p}`, { data }));
// Playwright 的 multipart 選項不能對同一個欄位放多個檔案，這裡手動組 multipart 本文（瀏覽器 FormData 也是同欄位重複）。
const step = async (k: string, id: string, which: 'handover' | 'receive', fields: Record<string, any>) => {
  const boundary = `----m7m8${Date.now()}${Math.random().toString(16).slice(2)}`;
  const nl = '\r\n';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v && typeof v === 'object' && 'buffer' in v) {
        parts.push(Buffer.from(`--${boundary}${nl}Content-Disposition: form-data; name="${name}"; filename="${v.name}"${nl}Content-Type: ${v.mimeType}${nl}${nl}`), v.buffer, Buffer.from(nl));
      } else {
        parts.push(Buffer.from(`--${boundary}${nl}Content-Disposition: form-data; name="${name}"${nl}${nl}${String(v)}${nl}`));
      }
    }
  }
  parts.push(Buffer.from(`--${boundary}--${nl}`));
  return j(await apis[k].post(`${BASE}/transfers/${id}/${which}`, { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, data: Buffer.concat(parts) }));
};
const create = (k: string, assetType: string, assetId: string, to: string, reason = '營運調整') => post(k, 'transfers', { assetType, assetId, toStoreId: sid[to], reason });
const eqRow = async (id: string) => (await adminDb().from('ga_equipment').select('*').eq('id', id).single()).data as any;
const facRow = async (id: string) => (await adminDb().from('ga_facilities').select('*').eq('id', id).single()).data as any;
const events = async (assetId: string) => ((await adminDb().from('ga_asset_events').select('*').eq('asset_id', assetId).order('created_at')).data || []) as any[];
const storageList = async (prefix: string) => ((await adminDb().storage.from('general-affairs-attachments').list(prefix)).data || []) as any[];

test('全流程：總務發起不換店 → A 店店長交出 → B 店店長收到才換店；QR 沿用；異動紀錄與照片完整；舊設備詳情讀回新門市', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TR-流程');
  const made = await create('ga_works', 'EQUIPMENT', eq.id, 'VW001', '分店調撥');
  expect(made.status).toBe(201);
  expect(made.body.data.transfer_no).toMatch(/^AT\d{8}-\d{4}$/);
  const id = made.body.data.id as string;
  // 發起不換店
  expect((await eqRow(eq.id)).store_id).toBe(sid.ZT01);

  // 待我處理：A 店長（ZT01）要交出；B 店長還沒有
  const mineA = await get('store_manager', 'transfers?mine=1');
  expect(mineA.status).toBe(200);
  expect(mineA.body.data.map((r: any) => r.id)).toContain(id);
  expect(mineA.body.data.find((r: any) => r.id === id)).toMatchObject({ canHandover: true, canReceive: false, canCancel: false, from_store_name: expect.stringContaining('ZT01'), to_store_name: expect.stringContaining('VW001') });
  expect(mineA.body.todoCount).toBeGreaterThanOrEqual(1);
  expect((await get('ga_store_manager_b', 'transfers?mine=1')).body.data.map((r: any) => r.id)).not.toContain(id);

  // B 店不能提前確認收到（還沒交出）-> 409 STALE，且沒傳任何檔案
  const early = await step('ga_store_manager_b', id, 'receive', { note: 'x', files: photo() });
  expect(early.status).toBe(409);
  expect(early.body.code).toBe('STALE');
  expect(await storageList(`asset-transfers/${id}/receive`)).toEqual([]);

  // A 店長確認交出（附兩張照片）
  const h = await step('store_manager', id, 'handover', { note: '已打包', files: [photo('a1.png'), photo('a2.png')] });
  expect(h.status).toBe(200);
  expect(h.body.data.status).toBe('PENDING_RECEIVE');
  expect((await eqRow(eq.id)).store_id).toBe(sid.ZT01); // 交出也還沒換店
  expect((await get('ga_store_manager_b', 'transfers?mine=1')).body.data.find((r: any) => r.id === id)).toMatchObject({ canReceive: true, canHandover: false });
  expect((await get('store_manager', 'transfers?mine=1')).body.data.map((r: any) => r.id)).not.toContain(id);

  // B 店長確認收到 -> 換店
  const r = await step('ga_store_manager_b', id, 'receive', { note: '已收到', files: photo('b1.png') });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ status: 'COMPLETED', to_store_id: sid.VW001 });
  const after = await eqRow(eq.id);
  expect(after.store_id).toBe(sid.VW001);
  expect(after.qr_token).toBe(eq.qr_token); // QR 沿用
  expect(after.qr_token_revoked_at).toBeNull();

  // 異動紀錄：三筆、順序與操作人
  const ev = await events(eq.id);
  expect(ev.map((e) => e.event_type)).toEqual(['TRANSFER_REQUESTED', 'TRANSFER_HANDED_OVER', 'STORE_TRANSFER']);
  expect(ev[2]).toMatchObject({ from_store_id: sid.ZT01, to_store_id: sid.VW001, transfer_id: id });
  expect(ev.every((e) => e.actor_name)).toBe(true);

  // 詳情：時間軸、照片簽名網址（交出 2、收到 1）
  const d = await get('ga_works', `transfers/${id}`);
  expect(d.status).toBe(200);
  expect(d.body.data).toMatchObject({ status: 'COMPLETED', handover_note: '已打包', receive_note: '已收到', reason: '分店調撥' });
  expect(d.body.data.events.map((e: any) => e.event_type)).toEqual(['TRANSFER_REQUESTED', 'TRANSFER_HANDED_OVER', 'STORE_TRANSFER']);
  expect(d.body.data.photos.filter((p: any) => p.step === 'HANDOVER')).toHaveLength(2);
  expect(d.body.data.photos.filter((p: any) => p.step === 'RECEIVE')).toHaveLength(1);
  expect(d.body.data.photos.every((p: any) => typeof p.url === 'string' && p.url.startsWith('http'))).toBe(true);

  // B 店看得到設備（設備詳情 200）、A 店看不到（404）；A 店的設備清單搜尋不到
  expect((await get('ga_store_manager_b', `equipment/${eq.id}`)).status).toBe(200);
  expect((await get('store_manager', `equipment/${eq.id}`)).status).toBe(404);
  const listA = await get('store_manager', `equipment?search=${encodeURIComponent('TR-流程')}`);
  expect(listA.body.data.map((x: any) => x.id)).not.toContain(eq.id);
  // 設備詳情的異動紀錄（總務）含轉移完成
  const evApi = await get('ga_works', `equipment/${eq.id}/events`);
  expect(evApi.body.data.map((e: any) => e.event_type)).toContain('STORE_TRANSFER');
  // 重複確認 -> 409
  expect((await step('ga_store_manager_b', id, 'receive', {})).status).toBe(409);
});

test('權限：總務不能代替店長、他店店長不算、店長／設備查看／無權限者不能發起或取消；讀取範圍', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TR-權限');
  // 發起：店長、設備查看、設施管理（對設備）、無權限 -> 403
  for (const k of ['store_manager', 'ga_equipment_view', 'ga_facility_edit', 'denied']) {
    const r = await create(k, 'EQUIPMENT', eq.id, 'VW001');
    expect(r.status, k).toBe(403);
  }
  expect((await eqRow(eq.id)).store_id).toBe(sid.ZT01);
  const made = await create('ga_equipment_edit', 'EQUIPMENT', eq.id, 'VW001');
  expect(made.status).toBe(201);
  const id = made.body.data.id as string;

  // 確認交出：總務（不是名單店長）、B 店店長（不是轉出門市）、設備管理者 -> 403；且沒有留下檔案
  for (const k of ['ga_works', 'ga_store_manager_b', 'ga_equipment_edit', 'ga_equipment_view', 'denied']) {
    const r = await step(k, id, 'handover', { files: photo() });
    expect([403, 404], k).toContain(r.status);
  }
  expect(await storageList(`asset-transfers/${id}/handover`)).toEqual([]);
  // 取消：店長、設備查看、無權限 -> 403
  for (const k of ['store_manager', 'ga_store_manager_b', 'ga_equipment_view', 'denied']) {
    expect((await post(k, `transfers/${id}/cancel`, { reason: '試試看' })).status, k).toBe(403);
  }
  // 讀取：無權限 403；設備查看者看得到；他店店長以外的人看不到單（詳情 404 已在別處驗）
  expect((await get('denied', 'transfers')).status).toBe(403);
  expect((await get('denied', `transfers/${id}`)).status).toBe(403);
  expect((await get('ga_equipment_view', `transfers/${id}`)).status).toBe(200);
  // 交出後，A 店店長不能確認收到（轉入門市是 B）
  expect((await step('store_manager', id, 'handover', {})).status).toBe(200);
  expect((await step('store_manager', id, 'receive', {})).status).toBe(403);
  expect((await step('ga_works', id, 'receive', {})).status).toBe(403);
  expect((await eqRow(eq.id)).store_id).toBe(sid.ZT01);
  // 轉入門市店長才可收（督導身分不算店長的資料庫判斷在 G06.asset-db 測試）
  expect((await step('ga_store_manager_b', id, 'receive', {})).status).toBe(200);
  expect((await eqRow(eq.id)).store_id).toBe(sid.VW001);
});

test('照片規則：最多 3 張、只收圖片、單檔 4MB；失敗不留檔案也不改狀態', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TR-照片');
  const id = (await create('ga_works', 'EQUIPMENT', eq.id, 'VW001')).body.data.id as string;
  const four = [photo('1.png'), photo('2.png'), photo('3.png'), photo('4.png')];
  const tooMany = await step('store_manager', id, 'handover', { files: four });
  expect(tooMany.status).toBe(400);
  expect(tooMany.body.error).toContain('3');
  const pdf = await step('store_manager', id, 'handover', { files: { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') } });
  expect(pdf.status).toBe(400);
  const big = await step('store_manager', id, 'handover', { files: { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 10, 1) } });
  expect(big.status).toBe(400);
  expect(await storageList(`asset-transfers/${id}/handover`)).toEqual([]);
  expect((await get('ga_works', `transfers/${id}`)).body.data.status).toBe('PENDING_HANDOVER');
  // 備註超過 500 字：資料庫函式拒絕，剛傳的照片要被移除
  const longNote = await step('store_manager', id, 'handover', { note: 'x'.repeat(501), files: photo() });
  expect(longNote.status).toBe(400);
  expect(await storageList(`asset-transfers/${id}/handover`)).toEqual([]);
  expect((await get('ga_works', `transfers/${id}`)).body.data.photos).toEqual([]);
  // 不帶照片也可以確認（照片可選）
  expect((await step('store_manager', id, 'handover', { note: '' })).status).toBe(200);
});

test('發起規則：原因必填、同店、已報廢、重複進行中、資產類型；取消需原因且資產不動，取消後可重新發起', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TR-規則');
  expect((await post('ga_works', 'transfers', { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: sid.VW001, reason: '  ' })).status).toBe(400);
  expect((await create('ga_works', 'EQUIPMENT', eq.id, 'ZT01')).status).toBe(400); // 同店
  expect((await post('ga_works', 'transfers', { assetType: 'PART', assetId: eq.id, toStoreId: sid.VW001, reason: 'x' })).status).toBe(400);
  expect((await post('ga_works', 'transfers', { assetType: 'EQUIPMENT', assetId: 'bad', toStoreId: sid.VW001, reason: 'x' })).status).toBe(400);
  const first = await create('ga_works', 'EQUIPMENT', eq.id, 'VW001');
  expect(first.status).toBe(201);
  const dup = await create('ga_works', 'EQUIPMENT', eq.id, 'VW002');
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('OPEN_TRANSFER');
  // 取消需原因
  const id = first.body.data.id as string;
  expect((await post('ga_works', `transfers/${id}/cancel`, { reason: '' })).status).toBe(400);
  expect((await post('ga_works', `transfers/${id}/cancel`, { reason: '店長說不用了' })).status).toBe(200);
  expect((await eqRow(eq.id)).store_id).toBe(sid.ZT01);
  expect((await get('ga_works', `transfers/${id}`)).body.data).toMatchObject({ status: 'CANCELLED', cancel_reason: '店長說不用了' });
  // 取消後不能再交出（409），也不能再取消
  expect((await step('store_manager', id, 'handover', {})).status).toBe(409);
  expect((await post('ga_works', `transfers/${id}/cancel`, { reason: '再取消' })).status).toBe(409);
  expect((await events(eq.id)).map((e) => e.event_type)).toEqual(['TRANSFER_REQUESTED', 'TRANSFER_CANCELLED']);
  // 取消後可重新發起
  expect((await create('ga_works', 'EQUIPMENT', eq.id, 'VW002')).status).toBe(201);
  // 已報廢不能轉
  const dead = await seedEquipment('ZT01', eqCat.id, 'TR-報廢');
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', dead.id);
  const r = await create('ga_works', 'EQUIPMENT', dead.id, 'VW001');
  expect(r.status).toBe(409);
});

test('交出後總務更正門市或刪除：收到被擋（整步不生效）；總務取消後資產不動', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TR-衝突');
  const id = (await create('ga_works', 'EQUIPMENT', eq.id, 'VW001')).body.data.id as string;
  // 有進行中轉移單：更正門市與刪除都被擋
  const cur = await eqRow(eq.id);
  const corr = await post('ga_works', `equipment/${eq.id}/correct-store`, { to_store_id: sid.VW002, reason: '更正', expected_updated_at: cur.updated_at });
  expect(corr.status).toBeGreaterThanOrEqual(400);
  expect((await eqRow(eq.id)).store_id).toBe(sid.ZT01);
  // 直接用資料庫把設備改到別店（模擬舊版畫面直接改門市）-> 收到被擋
  expect((await step('store_manager', id, 'handover', {})).status).toBe(200);
  await adminDb().from('ga_equipment').update({ store_id: sid.VW002 }).eq('id', eq.id);
  const rec = await step('ga_store_manager_b', id, 'receive', { files: photo() });
  expect(rec.status).toBe(409);
  expect((await eqRow(eq.id)).store_id).toBe(sid.VW002);
  expect((await get('ga_works', `transfers/${id}`)).body.data.status).toBe('PENDING_RECEIVE');
  expect(await storageList(`asset-transfers/${id}/receive`)).toEqual([]);
});

test('未結案單張數：發起時記錄並顯示，換店後單子仍屬原門市；設施同規則', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'TR-未結');
  const uid = accountId('store_manager');
  const req = await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'TR-未結單', 'IN_PROGRESS', uid);
  const made = await create('ga_works', 'EQUIPMENT', eq.id, 'VW001');
  expect(made.body.data.open_count).toBe(1);
  const id = made.body.data.id as string;
  expect((await get('store_manager', `transfers/${id}`)).body.data.open_request_count).toBe(1);
  await step('store_manager', id, 'handover', {});
  expect((await step('ga_store_manager_b', id, 'receive', {})).status).toBe(200);
  const { data: reqAfter } = await adminDb().from('ga_service_requests').select('store_id').eq('id', req.id).single();
  expect(reqAfter!.store_id).toBe(sid.ZT01); // 解讀 (h)：單子留在原門市
  expect((await events(eq.id)).find((e) => e.event_type === 'STORE_TRANSFER').open_request_count).toBe(1);

  // 設施：設施管理者發起、店長交出收到、QR 沿用
  const fac = await seedFacility('ZT01', facCat.id, 'TR-設施');
  expect((await create('ga_equipment_edit', 'FACILITY', fac.id, 'VW001')).status).toBe(403);
  const fm = await create('ga_facility_edit', 'FACILITY', fac.id, 'VW001');
  expect(fm.status).toBe(201);
  const fid = fm.body.data.id as string;
  expect((await step('store_manager', fid, 'handover', { files: photo() })).status).toBe(200);
  expect((await step('ga_store_manager_b', fid, 'receive', {})).status).toBe(200);
  const f2 = await facRow(fac.id);
  expect(f2.store_id).toBe(sid.VW001);
  expect(f2.qr_token).toBe(fac.qr_token);
  expect((await get('ga_facility_edit', `facilities/${fac.id}/events`)).body.data.map((e: any) => e.event_type)).toContain('STORE_TRANSFER');
});

test('清單：篩選、搜尋（逗號括號不壞）、分頁、參數錯誤', async () => {
  const a = await seedEquipment('ZT01', eqCat.id, 'TR-清單甲');
  const made = await create('ga_works', 'EQUIPMENT', a.id, 'VW001');
  const all = await get('ga_works', 'transfers?status=PENDING_HANDOVER,PENDING_RECEIVE&pageSize=100');
  expect(all.status).toBe(200);
  expect(all.body.data.map((r: any) => r.id)).toContain(made.body.data.id);
  expect(all.body.meta).toMatchObject({ page: 1, pageSize: 100 });
  expect((await get('ga_works', `transfers?q=${encodeURIComponent('TR-清單甲')}`)).body.total).toBe(1);
  expect((await get('ga_works', `transfers?q=${encodeURIComponent('a,(b)"c')}`)).status).toBe(200);
  expect((await get('ga_works', 'transfers?status=BOGUS')).status).toBe(400);
  expect((await get('ga_works', 'transfers?assetType=PART')).status).toBe(400);
  expect((await get('ga_works', 'transfers?storeId=x')).status).toBe(400);
  expect((await get('ga_works', `transfers?assetType=FACILITY&storeId=${sid.ZT01}`)).body.data.map((r: any) => r.id)).not.toContain(made.body.data.id);
  expect((await get('ga_works', 'transfers/not-a-uuid')).status).toBe(400);
  expect((await get('ga_works', 'transfers/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  // 他店店長看不到這張單
  const x = await apis['ga_store_manager_b'].get(`${BASE}/transfers?q=${encodeURIComponent('TR-清單甲')}`);
  expect((await x.json()).total).toBe(1); // B 是轉入門市，看得到
  const y = await get('store_manager', `transfers?q=${encodeURIComponent('TR-清單甲')}`);
  expect(y.body.total).toBe(1); // A 是轉出門市
});
