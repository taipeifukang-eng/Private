import { adminDb, m7Name, seedCategory, seedEquipment, seedFacility, seedLocation, seedPart, seedTransfer, seedWorkOrder, stores } from './m7m8-fixtures';
import { seedRequest } from './m7m8-po-fixtures';
import { seedGa6Vendor } from './m7m8-ga6-fixtures';
import { ATTENTION } from '../../lib/workspace/general-affairs/home-rules';
import { shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

/**
 * M7/M8 第 6 批 G22／G24 共用種子與「獨立計算」：
 *   oracle()：用 service role 直接查資料表、以 JS 重新寫一遍九項條件（不呼叫任何被測的資料庫函式），算出預期數字。
 *   seedAttention()：九項待辦各種一批資料（含邊界）。資料只放 VW／ZT 測試門市、2038 年與帶標記的名稱，結束由 cleanupM7M8 清掉。
 */
const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
};
const db = () => adminDb();
export const dayOffset = (offset: number) => { const d = new Date(`${taipeiToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
export const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export type Counts = Record<'request_intake' | 'bill_overdue' | 'contract_due' | 'transfer_overdue' | 'store_wait' | 'po_pending' | 'po_overdue' | 'wo_store_rejected' | 'onboarding_review', number>;

async function count(q: any): Promise<number> {
  const r = await q;
  if (r.error) throw new Error(`oracle 查詢失敗：${r.error.message}`);
  return r.count || 0;
}

/** 預期數字：storeIds＝呼叫者（店長）負責的門市。 */
export async function oracle(storeIds: string[] = [], transferDays = 3): Promise<Counts> {
  const today = taipeiToday();
  const head = (t: string) => db().from(t).select('id', { count: 'exact', head: true });
  const out: Partial<Counts> = {};
  out.request_intake = await count(head('ga_service_requests').is('deleted_at', null).eq('main_status', ATTENTION.requestIntakeStatus));
  out.store_wait = storeIds.length ? await count(head('ga_service_requests').is('deleted_at', null).in('main_status', [...ATTENTION.storeWaitStatuses]).in('store_id', storeIds)) : 0;
  out.bill_overdue = await count(head('ga_utility_bills').is('deleted_at', null).is('paid_at', null).not('due_date', 'is', null).lt('due_date', today));
  out.contract_due = await count(head('ga_vendors').eq('status', 'active').eq('contract_required', true).not('contract_end_date', 'is', null).lte('contract_end_date', dayOffset(ATTENTION.contractDueDays)));
  out.transfer_overdue = await count(head('ga_inventory_transfers').is('deleted_at', null).in('status', [...ATTENTION.transferAwaitingStatuses]).not('source_confirmed_at', 'is', null).lt('source_confirmed_at', new Date(Date.now() - transferDays * 86_400_000).toISOString()));
  out.po_pending = await count(head('ga_purchase_orders').eq('status', ATTENTION.poPendingStatus));
  out.po_overdue = await count(head('ga_purchase_orders').in('status', [...ATTENTION.poOverdueStatuses]).not('expected_delivery_date', 'is', null).lt('expected_delivery_date', today));
  out.wo_store_rejected = await count(head('maintenance_requests').neq('status', 'COMPLETED').eq('progress_stage', 'REOPENED'));
  const eq = await count(head('ga_equipment').is('deleted_at', null).neq('status', 'SCRAPPED').eq('onboarding_status', 'PENDING_GA_REVIEW'));
  const fac = await count(head('ga_facilities').is('deleted_at', null).neq('status', 'RETIRED').eq('onboarding_status', 'PENDING_GA_REVIEW'));
  out.onboarding_review = eq + fac;
  return out as Counts;
}

export async function transferDays(): Promise<number> {
  const r = await db().from('ga_inventory_transfer_settings').select('overdue_days').eq('id', true).maybeSingle();
  return Number(r.data?.overdue_days) || 3;
}

/** 以 service role 建立一筆採購單（直接寫入；測試前置資料）。notes 帶標記，cleanupM7M8 的採購清除函式依此清。 */
export async function seedPo(suffix: string, over: Record<string, unknown> = {}, items: Array<Record<string, unknown>> = []) {
  const po = must(
    await db().from('ga_purchase_orders').insert({ po_no: `PO-M7M8-G22-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(), status: 'DRAFT', notes: m7Name(suffix), ...over }).select('*').single(),
    `建立採購單 ${suffix}`,
  ) as any;
  if (items.length) must(await db().from('ga_purchase_order_items').insert(items.map((it, i) => ({ po_id: po.id, line_no: i + 1, item_name: m7Name(`item-${suffix}-${i}`), unit: '個', fulfil_mode: 'NO_STOCK', quantity: 1, quantity_base: 1, unit_price: 100, line_amount: 100, ...it }))), `建立採購單明細 ${suffix}`);
  return po;
}

export type AttentionSeed = {
  vendorDue: any[];
  requests: Record<string, any>;
  transfers: any[];
  pos: any[];
  wos: any[];
  equipment: any[];
  facility: any;
};

/**
 * 九項待辦的種子（每項含邊界）。userId＝建立人（任一測試帳號）；storeMgrStore＝店長負責的門市（VW001），其他門市 VW002。
 * 帳單另由呼叫端用 ga_ws_ub_save 建立（寫入一定走函式，見 G23）：本函式只回傳需要的日期參考。
 */
export async function seedAttention(userId: string, tag = 'AT'): Promise<AttentionSeed> {
  const st = await stores();
  const partCat = await seedCategory('part', `${tag}pc`);
  const part = await seedPart(partCat.id, `${tag}part`);
  const req = async (suffix: string, status: string, storeCode = 'VW001', over: Record<string, unknown> = {}) =>
    seedRequest(st[storeCode].id, userId, `${tag}-${suffix}`, { part_id: part.id, desired_quantity: 1, main_status: status, ...over });
  const requests: Record<string, any> = {};
  for (let i = 0; i < 3; i += 1) requests[`intake${i}`] = await req(`intake${i}`, 'PENDING_INTAKE');
  requests.confirmA = await req('confirmA', 'WAITING_STORE_CONFIRMATION', 'VW001', { waiting_confirm_since: hoursAgo(1) });
  requests.confirmB = await req('confirmB', 'WAITING_STORE_CONFIRMATION', 'VW001', { waiting_confirm_since: hoursAgo(2) });
  requests.supp = await req('supp', 'WAITING_STORE_SUPPLEMENT');
  requests.otherStore = await req('otherStore', 'WAITING_STORE_CONFIRMATION', 'VW002', { waiting_confirm_since: hoursAgo(3) });
  requests.done = await req('done', 'COMPLETED');
  requests.gaReview = await req('gaReview', 'WAITING_GA_REVIEW');
  // 合約到期：到期日 +10、已過期 -5 計入；+31、不需簽約、暫停、沒有到期日不計
  const vendorDue = [
    await seedGa6Vendor(`${tag}-d10`, { contract_required: true, contract_end_date: dayOffset(10) }),
    await seedGa6Vendor(`${tag}-dexp`, { contract_required: true, contract_end_date: dayOffset(-5) }),
    await seedGa6Vendor(`${tag}-d30`, { contract_required: true, contract_end_date: dayOffset(ATTENTION.contractDueDays) }),
    await seedGa6Vendor(`${tag}-d31`, { contract_required: true, contract_end_date: dayOffset(ATTENTION.contractDueDays + 1) }),
    await seedGa6Vendor(`${tag}-noreq`, { contract_required: false, contract_end_date: dayOffset(3) }),
    await seedGa6Vendor(`${tag}-paused`, { contract_required: true, contract_end_date: dayOffset(3), status: 'paused' }),
    await seedGa6Vendor(`${tag}-nodate`, { contract_required: true, contract_end_date: null }),
  ];
  // 調撥：超過逾期天數的待收貨計入（SOURCE_CONFIRMED、IN_TRANSIT）；剛交出、已收貨、未交出不計
  const days = await transferDays();
  const src = await seedLocation(null, `${tag}src`);
  const dst = await seedLocation('VW001', `${tag}dst`);
  const mkT = async (suffix: string, status: string, at: string | null) => {
    const t = await seedTransfer(src.id, dst.id, part.id, `${tag}-${suffix}`, 'REQUESTED');
    must(await db().from('ga_inventory_transfers').update({ status, source_confirmed_at: at }).eq('id', t.id), `調撥單 ${suffix} 改狀態`);
    return t;
  };
  const transfers = [
    await mkT('late-sc', 'SOURCE_CONFIRMED', hoursAgo(days * 24 + 5)),
    await mkT('late-it', 'IN_TRANSIT', hoursAgo(days * 24 + 30)),
    await mkT('fresh', 'SOURCE_CONFIRMED', hoursAgo(2)),
    await mkT('received', 'RECEIVED', hoursAgo(days * 24 + 100)),
    await mkT('requested', 'REQUESTED', null),
  ];
  // 採購單：待核准 2、逾期 3（ORDERED×2、PARTIALLY_RECEIVED×1）；未逾期、沒預計日、已收貨逾期日不計
  const pos = [
    await seedPo(`${tag}-pend0`, { status: 'PENDING_APPROVAL', submitted_at: hoursAgo(5) }),
    await seedPo(`${tag}-pend1`, { status: 'PENDING_APPROVAL', submitted_at: hoursAgo(4) }),
    await seedPo(`${tag}-late0`, { status: 'ORDERED', ordered_at: hoursAgo(80), expected_delivery_date: dayOffset(-1) }),
    await seedPo(`${tag}-late1`, { status: 'ORDERED', ordered_at: hoursAgo(80), expected_delivery_date: dayOffset(-10) }),
    await seedPo(`${tag}-late2`, { status: 'PARTIALLY_RECEIVED', ordered_at: hoursAgo(80), expected_delivery_date: dayOffset(-2) }),
    await seedPo(`${tag}-today`, { status: 'ORDERED', ordered_at: hoursAgo(80), expected_delivery_date: dayOffset(0) }),
    await seedPo(`${tag}-future`, { status: 'ORDERED', ordered_at: hoursAgo(80), expected_delivery_date: dayOffset(5) }),
    await seedPo(`${tag}-nodate`, { status: 'ORDERED', ordered_at: hoursAgo(80) }),
    await seedPo(`${tag}-recv`, { status: 'RECEIVED', ordered_at: hoursAgo(80), expected_delivery_date: dayOffset(-3) }),
  ];
  // 工單：門市退回（PROCESSING＋REOPENED）2；進行中、已完成不計
  const wos = [
    await seedWorkOrder('VW001', `${tag}-rej0`, userId, { status: 'PROCESSING', progress_stage: 'REOPENED', accepted_at: hoursAgo(30) }),
    await seedWorkOrder('VW002', `${tag}-rej1`, userId, { status: 'PROCESSING', progress_stage: 'REOPENED', accepted_at: hoursAgo(30) }),
    await seedWorkOrder('VW001', `${tag}-parts`, userId, { status: 'PROCESSING', progress_stage: 'WAITING_PARTS', accepted_at: hoursAgo(30) }),
    await seedWorkOrder('VW001', `${tag}-done`, userId, { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED', accepted_at: hoursAgo(50), completed_at: hoursAgo(10) }),
  ];
  // 貼標待複核：設備 2、設施 1；已完成不計
  const eqCat = await seedCategory('equipment', `${tag}ec`);
  const facCat = await seedCategory('facility', `${tag}fc`);
  const equipment = [
    await seedEquipment('VW001', eqCat.id, `${tag}-eq0`, { onboarding_status: 'PENDING_GA_REVIEW' }),
    await seedEquipment('VW002', eqCat.id, `${tag}-eq1`, { onboarding_status: 'PENDING_GA_REVIEW' }),
    await seedEquipment('VW001', eqCat.id, `${tag}-eq2`, { onboarding_status: 'COMPLETED' }),
  ];
  const facility = await seedFacility('VW001', facCat.id, `${tag}-fa0`, { onboarding_status: 'PENDING_GA_REVIEW' });
  void st; void shiftMonth;
  return { vendorDue, requests, transfers, pos, wos, equipment, facility };
}
