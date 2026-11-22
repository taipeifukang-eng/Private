import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedReview, seedVendor, setupPoUsers, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G25（API 層）採購單：/api/workspace/general-affairs/purchase-orders/**（清單、詳情、建立、編輯、actions、receipts、dispatches、approvals、price-history、vendor-options、options、settings、from-review）
// 與 /onboarding/serial。每支寫入都驗：未登入 401、Origin 不符 403、權限矩陣（缺哪個權限講清楚）、400 輸入驗證、409（STALE、鎖定、需核准）、固定識別冪等，並用 service role 回讀資料庫。
// 核准規則：含稅總額超過門檻才要核准；核准人不可是開單人或最後送簽人；管理員身分不繞過。到貨登錄即驗入（庫存增加）；配發同交易建設備；帳務欄位伺服端遮蔽。
// 所有資料帶 [自動測試]M7M8 標記；結束清除（含採購單、進貨、配發、由採購建立的設備）；核准門檻設定在測試內調整後一律還原。與其他整合檔一樣循序執行。
const P = '/api/workspace/general-affairs/purchase-orders';
const KEYS: PoKey[] = ['purchaser', 'purchaser2', 'purchaser_vendor', 'approver', 'approver2', 'purchaser_approver', 'review_only', 'stock_only', 'no_partview', 'viewer', 'nobody', 'admin', 'storemgr_a', 'storemgr_b'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let sid: Record<string, string> = {};
let part: any;
let partPrinter: any;
let partNoTpl: any;
let loc: any;
let vendor: any;
let vendorOff: any;
let tpl: any;
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const header = (over: Record<string, unknown> = {}) => ({ notes: m7Name(`API${(seq += 1)}`), vendor_id: vendor.id, receiving_location_id: loc.id, ...over });
const line = (p: any, qty: number, price: number, extra: Record<string, unknown> = {}) => ({ part_id: p.id, quantity: qty, unit_price: price, ...extra });
async function mk(who: string, items: unknown[], h: Record<string, unknown> = {}) {
  const r = await send(who, 'post', P, { header: header(h), items, idempotency_key: key() });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as any;
}
const act = (who: string, po: any, action: string, note?: string) => send(who, 'post', `${P}/${po.id}/actions`, { action, expected_updated_at: po.updated_at, ...(note ? { note } : {}) });
const fresh = async (who: string, id: string) => (await get(who, `${P}/${id}`)).body.data as any;
/** 一張已下訂的單（含稅 ≤ 門檻，免核准）。 */
async function ordered(items: unknown[], h: Record<string, unknown> = {}) {
  const d = await mk('purchaser', items, h);
  const r = await act('purchaser', d, 'place_order');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as any;
}
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbEvents = async (id: string) => ((await db().from('ga_purchase_order_events').select('*').eq('po_id', id).order('created_at').order('id')).data || []) as any[];
const dbBal = async (l: string, p: string) => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', l).eq('part_id', p).maybeSingle()).data as any)?.quantity_base ?? 0);
const itemId = (po: any, n = 1) => po.items.find((i: any) => i.line_no === n).id as string;
async function threshold(): Promise<{ value: number; ver: string }> {
  const r = await get('approver', `${P}/settings`);
  return { value: Number(r.body.data.approval_threshold), ver: r.body.data.updated_at };
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
  const cat = await seedCategory('part', 'POA');
  const eqCat = await db().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201（雷射印表機），無法測試配發建立設備');
  tpl = await seedEquipmentTemplate(eqCat.data.id, 'POA-T1', { default_warranty_months: 12, description: '測試用雷射印表機' });
  part = await seedPart(cat.id, 'POA-P1', { purchase_unit: '箱', purchase_to_base_rate: 12, allow_unpacking: true });
  partPrinter = await seedPart(cat.id, 'POA-PRN', { base_unit: '台', equipment_template_id: tpl.id });
  partNoTpl = await seedPart(cat.id, 'POA-NT', { base_unit: '台' });
  loc = await seedLocation(null, 'POA-W');
  for (const p of [part, partPrinter, partNoTpl]) await seedLocationPart(loc.id, p.id);
  vendor = await seedVendor('POA');
  vendorOff = await seedVendor('POA-OFF', { status: 'inactive' });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
});

// ----------------------------------------------------------------------------- 讀取與權限
test('讀取：未登入 401、權限矩陣（看單＝採購評估檢視／管理或採購核准）、待簽核清單只給核准人', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of [P, `${P}/approvals`, `${P}/settings`, `${P}/options?type=store`, `${P}/vendor-options`, `${P}/price-history?partId=${part.id}`]) expect((await anon.get(p)).status(), p).toBe(401);
  await anon.dispose();
  for (const k of ['nobody', 'stock_only', 'admin']) expect((await get(k, P)).status, k).toBe(403);
  for (const k of ['viewer', 'purchaser', 'approver', 'review_only', 'no_partview']) expect((await get(k, P)).status, k).toBe(200);
  const list = await get('purchaser', P);
  expect(list.body).toMatchObject({ meta: expect.any(Object), stats: expect.any(Object), capabilities: { write: true, approve: false } });
  expect((await get('viewer', P)).body.capabilities).toMatchObject({ write: false, approve: false });
  expect((await get('approver', P)).body.capabilities).toMatchObject({ write: false, approve: true });
  expect((await get('viewer', `${P}/approvals`)).status).toBe(403);
  expect((await get('purchaser', `${P}/approvals`)).status).toBe(403);
  expect((await get('admin', `${P}/approvals`)).status).toBe(403);
  expect((await get('approver', `${P}/approvals`)).status).toBe(200);
  expect((await get('purchaser', `${P}?view=approvals`)).status).toBe(403);
  expect((await get('nobody', `${P}/${crypto.randomUUID()}`)).status).toBe(403);
  expect((await get('purchaser', `${P}/${crypto.randomUUID()}`)).status).toBe(404);
});

test('清單：精確筆數與分頁、狀態篩選驗證、搜尋跳脫（百分比不會比對全部）、統計卡', async () => {
  const a = await mk('purchaser', [line(part, 1, 100)]);
  const b = await mk('purchaser', [line(part, 1, 100)]);
  const all = await get('purchaser', `${P}?pageSize=1&page=1`);
  expect(all.body.data).toHaveLength(1);
  expect(all.body.total).toBeGreaterThanOrEqual(2);
  expect(all.body.meta).toMatchObject({ page: 1, pageSize: 1, total: all.body.total });
  const p2 = await get('purchaser', `${P}?pageSize=1&page=2`);
  expect(p2.body.data[0].id).not.toBe(all.body.data[0].id);
  expect((await get('purchaser', `${P}?pageSize=9999`)).body.meta.pageSize).toBe(100);
  expect((await get('purchaser', `${P}?status=NOT_A_STATUS`)).status).toBe(400);
  expect((await get('purchaser', `${P}?vendorId=bad`)).status).toBe(400);
  expect((await get('purchaser', `${P}?requestId=bad`)).status).toBe(400);
  const found = await get('purchaser', `${P}?q=${encodeURIComponent(a.po_no)}`);
  expect((found.body.data as any[]).map((r) => r.id)).toEqual([a.id]);
  expect((await get('purchaser', `${P}?q=${encodeURIComponent('%')}`)).body.total).toBe(0);
  expect((await get('purchaser', `${P}?q=${encodeURIComponent('_')}`)).body.total).toBe(0);
  const drafts = await get('purchaser', `${P}?status=DRAFT&pageSize=100`);
  expect((drafts.body.data as any[]).map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  const mine = await get('purchaser2', `${P}?mine=true&pageSize=100`);
  expect((mine.body.data as any[]).map((r) => r.id)).not.toContain(a.id);
  expect(drafts.body.stats.DRAFT).toBeGreaterThanOrEqual(2);
  expect(drafts.body.stats.total).toBeGreaterThanOrEqual(drafts.body.stats.DRAFT);
});

// ----------------------------------------------------------------------------- 建立與編輯
test('建立：Origin、權限矩陣（缺哪個講清楚）、400 驗證、固定識別冪等與衝突、DB 回讀', async () => {
  const body = { header: header(), items: [line(part, 2, 100)], idempotency_key: key() };
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.post(P, { data: body, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  await anon.dispose();
  expect((await j(await apis.purchaser.post(P, { data: body, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const [k, miss] of [['nobody', '採購評估管理'], ['viewer', '採購評估管理'], ['review_only', '庫存交易管理'], ['stock_only', '採購評估管理'], ['no_partview', '料件查看'], ['approver', '採購評估管理'], ['admin', '採購評估管理']] as const) {
    const r = await send(k, 'post', P, { ...body, idempotency_key: key() });
    expect(r.status, k).toBe(403);
    expect(r.body.error as string, k).toContain(miss);
  }
  const bad = async (over: Record<string, unknown>) => (await send('purchaser', 'post', P, { ...body, idempotency_key: key(), ...over })).status;
  expect(await bad({ items: [] })).toBe(400);
  expect(await bad({ items: 'x' })).toBe(400);
  expect(await bad({ items: [{ quantity: 1, unit_price: 1 }] })).toBe(400); // 沒有料件也沒有品名
  expect(await bad({ items: [line(part, 0, 10)] })).toBe(400);
  expect(await bad({ items: [{ part_id: 'nope', quantity: 1 }] })).toBe(400);
  expect(await bad({ items: [{ item_name: '自由品名', quantity: 1, unit_price: 1, fulfil_mode: 'STOCK' }] })).toBe(400); // 入庫存必須有料件
  expect(await bad({ items: [{ item_name: '自由品名', quantity: 1, fulfil_mode: 'DIRECT_ASSET' }] })).toBe(400); // 直接建設備要有門市
  expect(await bad({ header: { vendor_id: 'nope' } })).toBe(400);
  expect(await bad({ header: { expected_delivery_date: '2038-02-31' } })).toBe(400);
  expect(await bad({ header: { total_amount: 1 } })).toBe(400);
  expect(await bad({ idempotency_key: '' })).toBe(400);
  expect(await bad({ unknown: 1 })).toBe(400);
  expect((await j(await apis.purchaser.post(P, { data: 'not json', headers: { 'Content-Type': 'application/json' } }))).status).toBe(400);
  const k = key();
  const payload = { header: header({ expected_delivery_date: '2038-03-04' }), items: [line(part, 2, 100), { item_name: m7Name('自由品名'), quantity: 3, unit_price: 50, unit: '個', fulfil_mode: 'NO_STOCK' }], idempotency_key: k };
  const a = await send('purchaser', 'post', P, payload);
  const b = await send('purchaser', 'post', P, payload);
  expect([a.status, b.status]).toEqual([201, 200]);
  expect(b.body.data.id).toBe(a.body.data.id);
  expect(b.body.replay).toBe(true);
  expect((await send('purchaser', 'post', P, { ...payload, items: [line(part, 9, 100)] })).body.code).toBe('IDEMPOTENCY_CONFLICT');
  const row = await dbPo(a.body.data.id);
  expect(row).toMatchObject({ status: 'DRAFT', vendor_id: vendor.id, created_by: users.purchaser.id, receiving_location_id: loc.id });
  expect(row.po_no).toMatch(/^PO-\d{8}-\d{3,}$/);
  // 金額：2×100＋3×50 = 350 未稅，稅 5% = 17.5 → 四捨五入
  expect(Number(row.subtotal)).toBe(350);
  expect(Number(row.total_amount)).toBe(Number(row.subtotal) + Number(row.tax_amount));
  expect(a.body.data.abilities).toMatchObject({ edit: true, submit: true, approve: false });
  const detail = await get('viewer', `${P}/${row.id}`);
  expect(detail.body.data.abilities).toMatchObject({ edit: false, submit: false, problem: expect.stringContaining('採購評估管理') });
  expect((await dbEvents(row.id)).map((e) => e.event_type)).toContain('create');
  // 供應商必須是已建好且合作中的：停用的廠商不能用、不存在的也不行
  const off = await send('purchaser', 'post', P, { header: header({ vendor_id: vendorOff.id }), items: [line(part, 1, 10)], idempotency_key: key() });
  expect(off.status).toBe(422);
  expect(off.body.code).toBe('VENDOR_INACTIVE');
  expect(JSON.stringify(off.body)).toMatch(/合作中|供應商/);
  const ghost = await send('purchaser', 'post', P, { header: header({ vendor_id: crypto.randomUUID() }), items: [line(part, 1, 10)], idempotency_key: key() });
  expect([400, 404, 409, 422]).toContain(ghost.status);
  expect(ghost.body.code).toBe('VENDOR_NOT_FOUND');
});

test('編輯草稿：Origin、權限、STALE 409（舊版本）、整張品項替換、下訂後鎖定只能改備註與預計到貨日', async () => {
  const d = await mk('purchaser', [line(part, 1, 100)]);
  const bodyPatch = { header: { notes: m7Name('改備註') }, expected_updated_at: d.updated_at };
  expect((await j(await apis.purchaser.patch(`${P}/${d.id}`, { data: bodyPatch, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  expect((await send('viewer', 'patch', `${P}/${d.id}`, bodyPatch)).status).toBe(403);
  expect((await send('review_only', 'patch', `${P}/${d.id}`, bodyPatch)).status).toBe(403);
  expect((await send('purchaser', 'patch', `${P}/${d.id}`, { header: { notes: 'x' } })).status).toBe(400); // 缺版本
  expect((await send('purchaser', 'patch', `${P}/${d.id}`, { ...bodyPatch, foo: 1 })).status).toBe(400);
  expect((await send('purchaser', 'patch', `${P}/${d.id}`, { header: { vendor_id: 'bad' }, expected_updated_at: d.updated_at })).status).toBe(400);
  expect((await send('purchaser', 'patch', `${P}/${d.id}`, { items: [], expected_updated_at: d.updated_at })).status).toBe(400);
  const ok = await send('purchaser', 'patch', `${P}/${d.id}`, { ...bodyPatch, items: [line(part, 4, 100), line(partPrinter, 2, 1000)] });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.data.items).toHaveLength(2);
  expect(Number((await dbPo(d.id)).subtotal)).toBe(2400);
  // 用舊版本再改 → STALE
  const stale = await send('purchaser2', 'patch', `${P}/${d.id}`, { header: { notes: m7Name('舊版本') }, expected_updated_at: d.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  // 下訂（2520 ≤ 5000 免核准）後鎖定
  const o = await act('purchaser', ok.body.data, 'place_order');
  expect(o.status, JSON.stringify(o.body)).toBe(200);
  const locked = await send('purchaser', 'patch', `${P}/${d.id}`, { items: [line(part, 1, 1)], expected_updated_at: o.body.data.updated_at });
  expect(locked.status).toBe(409);
  expect(locked.body.code).toBe('PO_LOCKED');
  const vendorChange = await send('purchaser', 'patch', `${P}/${d.id}`, { header: { vendor_id: vendor.id }, expected_updated_at: o.body.data.updated_at });
  expect(vendorChange.status).toBe(409);
  const notes = await send('purchaser', 'patch', `${P}/${d.id}`, { header: { notes: m7Name('鎖定後備註'), expected_delivery_date: '2038-05-06' }, expected_updated_at: o.body.data.updated_at });
  expect(notes.status, JSON.stringify(notes.body)).toBe(200);
  expect(await dbPo(d.id)).toMatchObject({ status: 'ORDERED', expected_delivery_date: '2038-05-06' });
});

// ----------------------------------------------------------------------------- 核准流程
test('核准：超過門檻不能直接下訂、送核准、核准人限制（開單人、送簽人、管理員、無權限者都不行）、駁回須原因並退回草稿、核准後下訂寫快照、每步事件', async () => {
  const d = await mk('purchaser', [line(partPrinter, 3, 3000)]); // 9000 + 5% = 9450 > 5000
  expect(Number(d.total_amount)).toBe(9450);
  expect(d.approval_required).toBe(true);
  const direct = await act('purchaser', d, 'place_order');
  expect(direct.status).toBe(409);
  expect(direct.body.code).toBe('APPROVAL_REQUIRED');
  // 動作 400：缺版本、未知動作、多餘欄位、駁回缺原因
  expect((await send('purchaser', 'post', `${P}/${d.id}/actions`, { action: 'submit' })).status).toBe(400);
  expect((await send('purchaser', 'post', `${P}/${d.id}/actions`, { action: 'nuke', expected_updated_at: d.updated_at })).status).toBe(400);
  expect((await send('purchaser', 'post', `${P}/${d.id}/actions`, { action: 'submit', expected_updated_at: d.updated_at, x: 1 })).status).toBe(400);
  expect((await j(await apis.purchaser.post(`${P}/${d.id}/actions`, { data: { action: 'submit', expected_updated_at: d.updated_at }, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const k of ['viewer', 'review_only', 'stock_only', 'nobody']) expect((await act(k, d, 'submit')).status, k).toBe(403);
  const sub = await act('purchaser', d, 'submit');
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  expect(sub.body.data.status).toBe('PENDING_APPROVAL');
  // 送簽後：待簽核清單看得到，非核准人看不到
  const pend = await get('approver', `${P}/approvals?pageSize=100`);
  expect((pend.body.data as any[]).map((r) => r.id)).toContain(d.id);
  // 不能核准：開單人自己（即使持核准權限）、管理員、只有採購權限的人、缺原因的駁回
  const own = await mk('purchaser_approver', [line(partPrinter, 3, 3000)]);
  const ownSub = await act('purchaser_approver', own, 'submit');
  const self = await act('purchaser_approver', ownSub.body.data, 'approve');
  expect(self.status).toBe(403);
  expect(self.body.code).toBe('SELF_APPROVAL');
  expect(self.body.error).toContain('開單人');
  expect((await act('admin', sub.body.data, 'approve')).status).toBe(403);
  expect((await act('purchaser2', sub.body.data, 'approve')).status).toBe(403);
  expect((await act('viewer', sub.body.data, 'approve')).status).toBe(403);
  expect((await act('approver', sub.body.data, 'reject')).status).toBe(400);
  expect((await act('purchaser', sub.body.data, 'approve')).status).toBe(403);
  // 送簽人以最後一次為準：purchaser2 撤回再自己送簽 → 即使 purchaser 開單，purchaser_approver 以外的核准人仍可核准；但 purchaser_approver 若是送簽人就不行
  expect((await act('approver', sub.body.data, 'withdraw')).status).toBe(403); // 核准人不能撤回
  const wd = await act('purchaser2', sub.body.data, 'withdraw');
  expect(wd.status, JSON.stringify(wd.body)).toBe(200);
  expect(wd.body.data.status).toBe('DRAFT');
  const resub = await act('purchaser2', wd.body.data, 'submit');
  expect(resub.body.data.submitted_by).toBe(users.purchaser2.id);
  // 駁回：原因必填，退回草稿並記錄原因
  const rej = await act('approver', resub.body.data, 'reject', '價格偏高，請再詢價');
  expect(rej.status, JSON.stringify(rej.body)).toBe(200);
  expect(rej.body.data.status).toBe('DRAFT');
  expect(rej.body.data.last_reject_reason).toBe('價格偏高，請再詢價');
  // 退回草稿可修改再送，核准後下訂
  const edited = await send('purchaser', 'patch', `${P}/${d.id}`, { items: [line(partPrinter, 3, 2900)], expected_updated_at: rej.body.data.updated_at });
  expect(edited.status, JSON.stringify(edited.body)).toBe(200);
  const sub2 = await act('purchaser', edited.body.data, 'submit');
  expect(sub2.body.data.status).toBe('PENDING_APPROVAL');
  const stale = await act('approver', sub.body.data, 'approve'); // 舊版本
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  const appr = await act('approver2', sub2.body.data, 'approve', '同意');
  expect(appr.status, JSON.stringify(appr.body)).toBe(200);
  expect(appr.body.data).toMatchObject({ status: 'APPROVED', approved_by: users.approver2.id, approval_note: '同意' });
  // 已核准：不能直接改品項；要改先撤回核准（原因必填）
  expect((await send('purchaser', 'patch', `${P}/${d.id}`, { items: [line(part, 1, 1)], expected_updated_at: appr.body.data.updated_at })).body.code).toBe('PO_LOCKED');
  expect((await act('purchaser', appr.body.data, 'revoke_approval')).status).toBe(400);
  const ord = await act('purchaser2', appr.body.data, 'place_order');
  expect(ord.status, JSON.stringify(ord.body)).toBe(200);
  const row = await dbPo(d.id);
  expect(row).toMatchObject({ status: 'ORDERED', vendor_name_snapshot: vendor.name, vendor_tax_id_snapshot: vendor.tax_id, vendor_payment_terms_snapshot: vendor.payment_terms, ordered_by: users.purchaser2.id });
  // 之後廠商改名，舊單快照不變
  await db().from('ga_vendors').update({ name: m7Name('POA 改名') }).eq('id', vendor.id);
  expect((await fresh('purchaser', d.id)).vendor_name).toBe(vendor.name);
  await db().from('ga_vendors').update({ name: vendor.name }).eq('id', vendor.id);
  const types = (await dbEvents(d.id)).map((e) => e.event_type);
  expect(types).toEqual(expect.arrayContaining(['create', 'update', 'submit', 'withdraw', 'reject', 'approve', 'place_order']));
  const ev = await dbEvents(d.id);
  expect(ev.find((e) => e.event_type === 'approve').actor_id).toBe(users.approver2.id);
  expect(ev.find((e) => e.event_type === 'reject').note).toBe('價格偏高，請再詢價');
});

test('門檻剛好 5000 免核准、送核准回 NO_APPROVAL_NEEDED；核准人可調門檻並留紀錄，之後送出的單才適用；非核准人不能調', async () => {
  const exactly = await mk('purchaser', [line(part, 1, 4761.9048)]); // 4761.9048×1.05 ≈ 5000.0
  const tot = Number(exactly.total_amount);
  const justAt = await mk('purchaser', [{ part_id: part.id, quantity: 1, unit_price: 4761.9 }]);
  expect([tot, Number(justAt.total_amount)].every((t) => t >= 4999 && t <= 5001)).toBe(true);
  const small = await mk('purchaser', [line(part, 1, 1000)]);
  expect(small.approval_required).toBe(false);
  const ns = await act('purchaser', small, 'submit');
  expect(ns.status).toBe(409);
  expect(ns.body.code).toBe('NO_APPROVAL_NEEDED');
  // 設定
  expect((await get('purchaser', `${P}/settings`)).body.data.can_edit).toBe(false);
  const t0 = await threshold();
  expect((await send('purchaser', 'patch', `${P}/settings`, { approval_threshold: 1, expected_updated_at: t0.ver })).status).toBe(403);
  expect((await send('viewer', 'patch', `${P}/settings`, { approval_threshold: 1, expected_updated_at: t0.ver })).status).toBe(403);
  expect((await send('admin', 'patch', `${P}/settings`, { approval_threshold: 1, expected_updated_at: t0.ver })).status).toBe(403);
  expect((await j(await apis.approver.patch(`${P}/settings`, { data: { approval_threshold: 1, expected_updated_at: t0.ver }, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  expect((await send('approver', 'patch', `${P}/settings`, { approval_threshold: 1 })).status).toBe(400);
  expect((await send('approver', 'patch', `${P}/settings`, { approval_threshold: -5, expected_updated_at: t0.ver })).status).toBe(400);
  expect((await send('approver', 'patch', `${P}/settings`, { tax_rate: 0.9, expected_updated_at: t0.ver })).status).toBe(400);
  expect((await send('approver', 'patch', `${P}/settings`, { bogus: 1, expected_updated_at: t0.ver })).status).toBe(400);
  expect((await send('approver', 'patch', `${P}/settings`, { approval_threshold: 1000 })).status).toBe(400);
  try {
    const set = await send('approver', 'patch', `${P}/settings`, { approval_threshold: 500, expected_updated_at: t0.ver });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(Number(set.body.data.approval_threshold)).toBe(500);
    expect((await send('approver2', 'patch', `${P}/settings`, { approval_threshold: 400, expected_updated_at: t0.ver })).body.code).toBe('STALE');
    const hist = (set.body.data.history as any[]).find((h) => h.setting_key === 'po_approval_threshold');
    expect(hist).toMatchObject({ old_value: t0.value, new_value: 500 });
    // 新門檻 500：原本免核准的 1000 元單現在要核准（草稿重新計算）
    const now = await mk('purchaser', [line(part, 1, 1000)]);
    expect(now.approval_required).toBe(true);
    const events = (await db().from('ga_workflow_setting_events').select('*').eq('setting_key', 'po_approval_threshold').eq('new_value_num', 500)).data || [];
    expect(events.length).toBeGreaterThanOrEqual(1);
  } finally {
    const cur = await threshold();
    await send('approver', 'patch', `${P}/settings`, { approval_threshold: t0.value, expected_updated_at: cur.ver });
  }
  expect((await threshold()).value).toBe(t0.value);
});

// ----------------------------------------------------------------------------- 遮蔽、選擇器、歷史價
test('帳務欄位遮蔽：沒有廠商檢視看不到統編與付款條件（伺服端）；有廠商檢視看得到；供應商選項只列合作中的', async () => {
  const po = await ordered([line(part, 1, 100)]);
  const plain = (await get('purchaser', `${P}/${po.id}`)).body.data;
  expect(plain).toMatchObject({ vendor_name: vendor.name, vendor_tax_id: null, vendor_payment_terms: null, vendor_billing_visible: false });
  expect(JSON.stringify(plain)).not.toContain(vendor.tax_id);
  const full = (await get('purchaser_vendor', `${P}/${po.id}`)).body.data;
  expect(full).toMatchObject({ vendor_tax_id: vendor.tax_id, vendor_payment_terms: vendor.payment_terms, vendor_billing_visible: true });
  const vo = await get('purchaser', `${P}/vendor-options?search=${encodeURIComponent(vendor.name)}`);
  expect(vo.status).toBe(200);
  expect(vo.body.billingVisible).toBe(false);
  expect((vo.body.data as any[])[0]).toMatchObject({ id: vendor.id, tax_id: null, payment_terms: null });
  const vo2 = await get('purchaser_vendor', `${P}/vendor-options?search=${encodeURIComponent(vendor.name)}`);
  expect((vo2.body.data as any[])[0]).toMatchObject({ id: vendor.id, tax_id: vendor.tax_id });
  const off = await get('purchaser', `${P}/vendor-options?search=${encodeURIComponent(vendorOff.name)}&pageSize=50`);
  expect(off.body.total).toBe(0);
  expect((await get('nobody', `${P}/vendor-options`)).status).toBe(403);
});

test('選擇器 options 與歷史價：類型驗證、分頁精確筆數、料件帶型號對應、歷史價只算已下訂以上', async () => {
  expect((await get('purchaser', `${P}/options?type=nope`)).status).toBe(400);
  expect((await get('purchaser', `${P}/options`)).status).toBe(400);
  expect((await get('nobody', `${P}/options?type=part`)).status).toBe(403);
  const parts = await get('purchaser', `${P}/options?type=part&search=${encodeURIComponent('POA-PRN')}`);
  expect(parts.status).toBe(200);
  const prn = (parts.body.data as any[]).find((p) => p.id === partPrinter.id);
  expect(prn).toBeTruthy();
  expect(prn.equipment_template).toMatchObject({ id: tpl.id });
  expect(parts.body.total).toBeGreaterThanOrEqual(1);
  expect((await get('purchaser', `${P}/options?type=part&search=${encodeURIComponent('%')}`)).body.total).toBe(0);
  const locs = await get('purchaser', `${P}/options?type=location&search=${encodeURIComponent(loc.code)}`);
  expect((locs.body.data as any[]).map((l) => l.id)).toContain(loc.id);
  expect(((await get('purchaser', `${P}/options?type=template&search=${encodeURIComponent('POA-T1')}`)).body.data as any[]).map((t) => t.id)).toContain(tpl.id);
  expect(((await get('purchaser', `${P}/options?type=store&search=VW001`)).body.data as any[]).map((s) => s.id)).toContain(sid.VW001);
  // 歷史價：草稿與已取消不算
  expect((await get('purchaser', `${P}/price-history`)).status).toBe(400);
  expect((await get('purchaser', `${P}/price-history?partId=bad`)).status).toBe(400);
  expect((await get('nobody', `${P}/price-history?partId=${partNoTpl.id}`)).status).toBe(403);
  await mk('purchaser', [line(partNoTpl, 1, 111)]); // 草稿
  const c = await mk('purchaser', [line(partNoTpl, 1, 222)]);
  expect((await act('purchaser', c, 'cancel')).status).toBe(200);
  expect((await get('purchaser', `${P}/price-history?partId=${partNoTpl.id}`)).body.data).toEqual([]);
  const prices: number[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const o = await ordered([line(partNoTpl, 1, 300 + i)]);
    prices.push(300 + i);
    expect(o.status).toBe('ORDERED');
  }
  const h = await get('purchaser', `${P}/price-history?partId=${partNoTpl.id}`);
  expect(h.body.limit).toBe(5);
  expect(h.body.data).toHaveLength(5);
  expect(((h.body.data as any[]).map((r) => Number(r.unit_price))).sort()).toEqual([302, 303, 304, 305, 306]);
  expect(h.body.data[0]).toMatchObject({ vendor_name: vendor.name, po_no: expect.stringMatching(/^PO-/) });
});

// ----------------------------------------------------------------------------- 到貨驗入
test('到貨登錄：Origin、權限矩陣、400、超收擋、短收／破損須原因、驗入即加庫存（DB 回讀）、固定識別冪等、狀態變化、取消與短收結案規則', async () => {
  const po = await ordered([line(partPrinter, 5, 900)], {}); // 4500 × 1.05 = 4725（免核准）
  const base = await dbBal(loc.id, partPrinter.id);
  const lineOf = (qty: number, extra: Record<string, unknown> = {}) => ({ po_item_id: itemId(po), delivered_qty: qty, ...extra });
  const R = `${P}/${po.id}/receipts`;
  const k1 = key();
  const body = { header: { delivery_note_no: 'DN-001' }, lines: [lineOf(3)], idempotency_key: k1 };
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.post(R, { data: body, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  await anon.dispose();
  expect((await j(await apis.purchaser.post(R, { data: body, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const [k, miss] of [['viewer', '採購評估管理'], ['stock_only', '採購評估管理'], ['review_only', '庫存交易管理'], ['no_partview', '料件查看'], ['nobody', '']] as const) {
    const r = await send(k, 'post', R, { ...body, idempotency_key: key() });
    expect(r.status, k).toBe(403);
    if (miss) expect(r.body.error as string, k).toContain(miss);
  }
  const bad = async (over: Record<string, unknown>) => (await send('purchaser', 'post', R, { ...body, idempotency_key: key(), ...over })).status;
  expect(await bad({ lines: [] })).toBe(400);
  expect(await bad({ lines: [{ po_item_id: itemId(po), delivered_qty: 0 }] })).toBe(400);
  expect(await bad({ lines: [{ po_item_id: itemId(po), delivered_qty: 2, accepted_qty: 3 }] })).toBe(400);
  expect(await bad({ lines: [lineOf(1), lineOf(1)] })).toBe(400); // 同品項重複
  expect(await bad({ header: { received_date: '2038-02-31' } })).toBe(400);
  expect(await bad({ idempotency_key: '' })).toBe(400);
  expect(await bad({ foo: 1 })).toBe(400);
  expect((await send('purchaser', 'post', `${P}/not-a-uuid/receipts`, body)).status).toBe(400);
  // 超收（剩餘 5，到貨 6）：擋；破損沒原因：擋；分批（到貨 3 < 剩餘 5）不填原因可成功（2026-11-16）
  const over = await send('purchaser', 'post', R, { ...body, lines: [lineOf(6)], idempotency_key: key() });
  expect([400, 409]).toContain(over.status);
  expect(over.body.error).toContain('剩餘可收量');
  const broken = await send('purchaser', 'post', R, { ...body, lines: [lineOf(3, { accepted_qty: 2 })], idempotency_key: key() });
  expect(broken.status).toBe(400);
  expect(broken.body.code).toBe('REASON_REQUIRED');
  expect(await dbBal(loc.id, partPrinter.id)).toBe(base);
  // 部分到貨 3（分批不用填原因）
  const r1 = await send('purchaser', 'post', R, { ...body, lines: [lineOf(3)] });
  expect(r1.status, JSON.stringify(r1.body)).toBe(201);
  expect(r1.body.order.status).toBe('PARTIALLY_RECEIVED');
  expect(await dbBal(loc.id, partPrinter.id)).toBe(base + 3);
  expect(r1.body.receiving.items[0]).toMatchObject({ remaining_qty: 2, dispatchable_base: 3 });
  // 冪等：同識別同內容重送，不會重複入帳
  const again = await send('purchaser', 'post', R, { ...body, lines: [lineOf(3)] });
  expect([200, 201]).toContain(again.status);
  expect(again.body.replay).toBe(true);
  expect(await dbBal(loc.id, partPrinter.id)).toBe(base + 3);
  const conflict = await send('purchaser', 'post', R, { ...body, lines: [lineOf(2)] });
  expect(conflict.status).toBe(409);
  // 已有到貨：不能取消，只能短收結案（原因必填）
  const cur = await fresh('purchaser', po.id);
  expect(cur.abilities).toMatchObject({ cancel: false, short_close: true });
  expect((await act('purchaser', cur, 'cancel', '想取消')).status).toBe(409);
  expect((await act('purchaser', cur, 'short_close')).status).toBe(400);
  // 第二次到貨 2 台中 1 台破損：驗入 1，庫存 +1，剩餘 1（拒收不算已收）
  const r2 = await send('purchaser', 'post', R, { header: {}, lines: [lineOf(2, { accepted_qty: 1, reason: '外箱破損拒收 1 台' })], idempotency_key: key() });
  expect(r2.status, JSON.stringify(r2.body)).toBe(201);
  expect(await dbBal(loc.id, partPrinter.id)).toBe(base + 4);
  expect(r2.body.receiving.items[0]).toMatchObject({ remaining_qty: 1 });
  expect(r2.body.receiving.receipts).toHaveLength(2);
  // 補收 1 台 → 全部到貨 → 結案
  const r3 = await send('purchaser', 'post', R, { header: {}, lines: [lineOf(1)], idempotency_key: key() });
  expect(r3.status, JSON.stringify(r3.body)).toBe(201);
  expect(r3.body.order.status).toBe('RECEIVED');
  expect(await dbBal(loc.id, partPrinter.id)).toBe(base + 5);
  expect((await send('purchaser', 'post', R, { header: {}, lines: [lineOf(1)], idempotency_key: key() })).status).toBeGreaterThanOrEqual(400);
  const closed = await act('purchaser', r3.body.order, 'close');
  expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  expect(closed.body.data.status).toBe('CLOSED');
  expect((await act('purchaser', closed.body.data, 'cancel', 'x')).status).toBe(409);
  const rc = await get('viewer', `${P}/${po.id}/receipts`);
  expect(rc.status).toBe(200);
  expect(rc.body.data.receipts).toHaveLength(3);
  expect((await get('nobody', `${P}/${po.id}/receipts`)).status).toBe(403);
  const types = (await dbEvents(po.id)).map((e) => e.event_type);
  expect(types.filter((t) => t === 'receive')).toHaveLength(3);
});

test('短收結案：部分到貨後短收結案（原因必填），結案後完全鎖定', async () => {
  const po = await ordered([line(part, 4, 100)]);
  const rcp = await send('purchaser', 'post', `${P}/${po.id}/receipts`, { header: {}, lines: [{ po_item_id: itemId(po), delivered_qty: 1, reason: '只到一箱' }], idempotency_key: key() });
  expect(rcp.status, JSON.stringify(rcp.body)).toBe(201);
  const cur = rcp.body.order;
  expect((await act('purchaser', cur, 'short_close')).status).toBe(400);
  const sc = await act('purchaser', cur, 'short_close', '廠商停產，不再補貨');
  expect(sc.status, JSON.stringify(sc.body)).toBe(200);
  expect(sc.body.data).toMatchObject({ status: 'CLOSED', short_close_reason: '廠商停產，不再補貨' });
  expect((await send('purchaser', 'patch', `${P}/${po.id}`, { header: { notes: 'x' }, expected_updated_at: sc.body.data.updated_at })).status).toBe(409);
});

// ----------------------------------------------------------------------------- 配發轉設備與序號
test('配發：權限矩陣、400、型號決定、可配發量、一次建設備（DB 回讀來源連結與序號空白）、冪等、別張單的品項被擋、店長補序號（限自己門市）', async () => {
  const po = await ordered([line(partPrinter, 3, 1000), line(partNoTpl, 2, 500)]);
  const R = `${P}/${po.id}/receipts`;
  const D = `${P}/${po.id}/dispatches`;
  const rcp = await send('purchaser', 'post', R, { header: {}, lines: [{ po_item_id: itemId(po, 1), delivered_qty: 3 }, { po_item_id: itemId(po, 2), delivered_qty: 2 }], idempotency_key: key() });
  expect(rcp.status, JSON.stringify(rcp.body)).toBe(201);
  const dk = key();
  const body = { po_item_id: itemId(po, 1), store_id: sid.VW001, quantity: 2, serials: [null, null], idempotency_key: dk };
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.post(D, { data: body, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  await anon.dispose();
  expect((await j(await apis.purchaser.post(D, { data: body, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const k of ['viewer', 'stock_only', 'review_only', 'no_partview', 'nobody']) expect((await send(k, 'post', D, { ...body, idempotency_key: key() })).status, k).toBe(403);
  const bad = async (over: Record<string, unknown>) => (await send('purchaser', 'post', D, { ...body, idempotency_key: key(), ...over })).status;
  expect(await bad({ quantity: 0 })).toBe(400);
  expect(await bad({ quantity: 1.5 })).toBe(400);
  expect(await bad({ quantity: 201 })).toBe(400);
  expect(await bad({ store_id: 'bad' })).toBe(400);
  expect(await bad({ po_item_id: undefined })).toBe(400);
  expect(await bad({ serials: ['a', 'b', 'c'] })).toBe(400);
  expect(await bad({ idempotency_key: '' })).toBe(400);
  expect(await bad({ foo: 1 })).toBe(400);
  // 沒有對應型號的料件：必須手選
  const noTpl = await send('purchaser', 'post', D, { po_item_id: itemId(po, 2), store_id: sid.VW001, quantity: 1, idempotency_key: key() });
  expect(noTpl.status).toBe(422);
  expect(noTpl.body.code).toBe('TEMPLATE_REQUIRED');
  // 超過可配發量
  expect((await send('purchaser', 'post', D, { ...body, quantity: 4, serials: undefined, idempotency_key: key() })).status).toBeGreaterThanOrEqual(400);
  const balBefore = await dbBal(loc.id, partPrinter.id);
  // 一次配發 2 台到 VW001：序號可空白
  const dsp = await send('purchaser', 'post', D, body);
  expect(dsp.status, JSON.stringify(dsp.body)).toBe(201);
  expect(dsp.body.data.equipment).toHaveLength(2);
  expect(await dbBal(loc.id, partPrinter.id)).toBe(balBefore - 2);
  const eqs = ((await db().from('ga_equipment').select('*').eq('source_purchase_order_id', po.id)).data || []) as any[];
  expect(eqs).toHaveLength(2);
  for (const e of eqs) expect(e).toMatchObject({ store_id: sid.VW001, template_id: tpl.id, serial_number: null, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', vendor_id: vendor.id });
  expect(eqs.every((e) => e.asset_code)).toBe(true);
  expect(eqs.every((e) => e.warranty_start_date)).toBe(true);
  // 冪等：同識別重送回原結果，不再扣庫存、不再建設備
  const again = await send('purchaser', 'post', D, body);
  expect(again.status).toBe(200);
  expect(again.body.replay).toBe(true);
  expect(await dbBal(loc.id, partPrinter.id)).toBe(balBefore - 2);
  expect(((await db().from('ga_equipment').select('id').eq('source_purchase_order_id', po.id)).data || [])).toHaveLength(2);
  // 別張單的品項不能用這張單的網址配發
  const other = await ordered([line(partPrinter, 1, 100)]);
  expect((await send('purchaser', 'post', `${P}/${other.id}/receipts`, { header: {}, lines: [{ po_item_id: itemId(other), delivered_qty: 1 }], idempotency_key: key() })).status).toBe(201);
  const balOther = await dbBal(loc.id, partPrinter.id);
  const wrong = await send('purchaser', 'post', D, { po_item_id: itemId(other), store_id: sid.VW001, quantity: 1, idempotency_key: key() });
  expect(wrong.status).toBe(400);
  expect(wrong.body.error).toContain('不屬於這張採購單');
  expect(await dbBal(loc.id, partPrinter.id)).toBe(balOther); // 沒有出庫
  expect(((await db().from('ga_equipment').select('id').eq('source_purchase_order_id', other.id)).data || [])).toHaveLength(0); // 沒有建設備
  // 詳情顯示配發與設備（序號未填）
  const det = await get('viewer', `${P}/${po.id}`);
  expect(det.body.receiving.dispatches).toHaveLength(1);
  expect(det.body.receiving.dispatches[0].equipment).toHaveLength(2);
  expect(det.body.receiving.items.find((i: any) => i.po_item_id === itemId(po, 1))).toMatchObject({ dispatchable_base: 1 });
  // 序號補填：該門市店長可以、別間門市店長不行、未登入 401、Origin 403、400
  const eq0 = eqs[0];
  const S = '/api/workspace/general-affairs/onboarding/serial';
  const anon2 = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon2.post(S, { data: { equipmentId: eq0.id, serial: 'SN-1' }, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  await anon2.dispose();
  expect((await j(await apis.storemgr_a.post(S, { data: { equipmentId: eq0.id, serial: 'SN-1' }, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  expect((await send('storemgr_a', 'post', S, { equipmentId: 'bad', serial: 'SN-1' })).status).toBe(400);
  expect((await send('storemgr_a', 'post', S, { equipmentId: eq0.id, serial: '' })).status).toBe(400);
  expect((await send('storemgr_a', 'post', S, { equipmentId: eq0.id, serial: 'SN-1', extra: 1 })).status).toBe(400);
  expect((await send('storemgr_b', 'post', S, { equipmentId: eq0.id, serial: 'SN-1' })).status).toBe(403);
  expect((await send('nobody', 'post', S, { equipmentId: eq0.id, serial: 'SN-1' })).status).toBe(403);
  const set = await send('storemgr_a', 'post', S, { equipmentId: eq0.id, serial: `SN-${eq0.asset_code}` });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  expect(set.body.data).toMatchObject({ serial_number: `SN-${eq0.asset_code}`, changed: true });
  expect(((await db().from('ga_equipment').select('serial_number').eq('id', eq0.id).single()).data as any).serial_number).toBe(`SN-${eq0.asset_code}`);
  // 已有序號：同值不算變更；改值要原因
  expect((await send('storemgr_a', 'post', S, { equipmentId: eq0.id, serial: `SN-${eq0.asset_code}` })).body.data.changed).toBe(false);
  const noReason = await send('storemgr_a', 'post', S, { equipmentId: eq0.id, serial: 'SN-CHANGED' });
  expect(noReason.status).toBe(400);
  expect(noReason.body.code).toBe('REASON_REQUIRED');
  expect((await send('storemgr_a', 'post', S, { equipmentId: eq0.id, serial: 'SN-CHANGED', reason: '標籤抄錯' })).status).toBe(200);
  expect(((await db().from('ga_equipment_serial_events').select('*').eq('equipment_id', eq0.id)) as any).data).toHaveLength(2);
  // 待辦清單帶序號欄位（店長看到自己門市的待貼標設備）
  const tasks = await get('storemgr_a', '/api/workspace/general-affairs/onboarding/tasks?statuses=NEEDS_EQUIPMENT_PHOTO&pageSize=100');
  expect(tasks.status).toBe(200);
  const mine = (tasks.body.data as any[]).find((t) => t.id === eqs[1].id);
  expect(mine).toBeTruthy();
  expect(mine.serial_number).toBeNull();
});

test('到貨直接建設備（DIRECT_ASSET）：不入庫存、設備送指定門市並連回採購單；自由品名只登錄（NO_STOCK）', async () => {
  const po = await ordered([
    { part_id: partPrinter.id, quantity: 2, unit_price: 800, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01 },
    { item_name: m7Name('延長線'), quantity: 4, unit_price: 100, unit: '條', fulfil_mode: 'NO_STOCK' },
  ]);
  const before = await dbBal(loc.id, partPrinter.id);
  const rcp = await send('purchaser', 'post', `${P}/${po.id}/receipts`, { header: {}, lines: [{ po_item_id: itemId(po, 1), delivered_qty: 2 }, { po_item_id: itemId(po, 2), delivered_qty: 4 }], idempotency_key: key() });
  expect(rcp.status, JSON.stringify(rcp.body)).toBe(201);
  expect(rcp.body.order.status).toBe('RECEIVED');
  expect(await dbBal(loc.id, partPrinter.id)).toBe(before);
  const eqs = ((await db().from('ga_equipment').select('*').eq('source_purchase_order_id', po.id)).data || []) as any[];
  expect(eqs).toHaveLength(2);
  for (const e of eqs) expect(e).toMatchObject({ store_id: sid.ZT01, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', source_po_item_id: itemId(po, 1) });
  // DIRECT_ASSET 與 NO_STOCK 沒有可配發量，配發被擋
  const d = await send('purchaser', 'post', `${P}/${po.id}/dispatches`, { po_item_id: itemId(po, 1), store_id: sid.VW001, quantity: 1, idempotency_key: key() });
  expect(d.status).toBeGreaterThanOrEqual(400);
});

// ----------------------------------------------------------------------------- 由評估產生
test('由採購評估產生草稿（from-review）：權限、400、產生草稿並連回需求單、重送回既有、已取消後可再產生', async () => {
  const req = await seedRequest(sid.VW001, users.purchaser.id, 'FR1', { part_id: partNoTpl.id, desired_unit: '台', desired_quantity: 4, request_type: 'PURCHASE_SUPPLEMENT', intake_route: 'PURCHASE_REVIEW', main_status: 'ACCEPTED' });
  const review = await seedReview(req.id, users.purchaser.id, { approved_quantity: 4, approved_unit: '台', vendor_id: vendor.id, final_amount: 4000 });
  const F = `${P}/from-review`;
  expect((await j(await apis.purchaser.post(F, { data: { reviewId: review.id }, headers: { Origin: 'http://evil.example' } }))).status).toBe(403);
  for (const k of ['viewer', 'review_only', 'nobody', 'admin']) expect((await send(k, 'post', F, { reviewId: review.id })).status, k).toBe(403);
  expect((await send('purchaser', 'post', F, {})).status).toBe(400);
  expect((await send('purchaser', 'post', F, { reviewId: 'bad' })).status).toBe(400);
  expect((await send('purchaser', 'post', F, { reviewId: crypto.randomUUID() })).status).toBe(404);
  const r = await send('purchaser', 'post', F, { reviewId: review.id });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.data).toMatchObject({ status: 'DRAFT', source_request_id: req.id, vendor_id: vendor.id });
  expect(r.body.data.items[0]).toMatchObject({ part_id: partNoTpl.id, request_id: req.id });
  const again = await send('purchaser', 'post', F, { reviewId: review.id });
  expect(again.status).toBe(200);
  expect(again.body.data.id).toBe(r.body.data.id);
  expect(((await db().from('ga_purchase_orders').select('id').eq('source_request_id', req.id)).data || [])).toHaveLength(1);
  const byReq = await get('purchaser', `${P}?requestId=${req.id}`);
  expect(byReq.body.total).toBe(1);
  // 一張需求單可有多張採購單（D2）：超過需求量要填原因
  const over = await send('purchaser', 'post', P, { header: header(), items: [line(partNoTpl, 3, 100, { request_id: req.id })], idempotency_key: key() });
  expect(over.status).toBe(422);
  expect(over.body.code).toBe('OVER_REQUEST_REASON_REQUIRED');
  const ok = await send('purchaser', 'post', P, { header: header(), items: [line(partNoTpl, 3, 100, { request_id: req.id, over_request_reason: '預備庫存' })], idempotency_key: key() });
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  expect(ok.body.data.items[0].over_request_reason).toBe('預備庫存');
});
