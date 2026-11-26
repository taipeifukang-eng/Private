import crypto from 'node:crypto';
import { expect } from '@playwright/test';
import { adminDb, callFn, cleanupM7M8, cleanupM7Users } from './m7m8-fixtures';
import { runIdOrThrow } from './m5-fixtures';
import { uniqueTaxId } from './m7m8-po-fixtures';

/**
 * 總務採購與請款改善第一批（ga-improve-b1）測試共用工具。
 * 帳號沿用 m7m8-ga45-fixtures 的 setupGa45Users（m7m8-test-ga45-*，teardown 與下次 setup 開頭依標記清除）；
 * 資料：廠商與買受人公司名稱帶 QA-GAIB1- 標記（再帶 runId），採購單備註帶 [自動測試]M7M8 標記；只用 DEV，年份 2038 的帳單或日期不涉及；
 * 清除：ga_dev_cleanup_ga_improve_b1（請款單、預付餘額帳、發票、同仁帳戶、公司、廠商）＋ cleanupM7M8（採購單、進貨單、庫存），只清自己建立的。
 */
export const GAIB1_PREFIX = 'QA-GAIB1-';
export const gaib1Name = (suffix: string) => `${GAIB1_PREFIX}${runIdOrThrow()}-${suffix}`;
export const key = () => crypto.randomUUID();

export async function seedGaib1Vendor(suffix: string, over: Record<string, unknown> = {}) {
  const r = await adminDb().from('ga_vendors').insert({
    name: gaib1Name(`V-${suffix}`), vendor_type: 'company', status: 'active', tax_id: uniqueTaxId(), payment_terms: '月結 30 天',
    bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試戶名', ...over,
  }).select('*').single();
  if (r.error) throw new Error(`建立測試廠商 ${suffix} 失敗：${r.error.message}`);
  return r.data as any;
}

/** 假公司（統編用隨機 8 碼，不重複；名稱帶標記）。 */
export const fakeCompany = (suffix: string) => ({ name: gaib1Name(`C-${suffix}`), tax_id: uniqueTaxId() });

export async function cleanupGaib1(): Promise<string[]> {
  const db = adminDb();
  const log: string[] = [];
  const r1 = await db.rpc('ga_dev_cleanup_ga_improve_b1');
  if (r1.error && r1.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_ga_improve_b1: ${r1.error.message}`);
  log.push(...(await cleanupM7M8()));
  const r2 = await db.rpc('ga_dev_cleanup_ga_improve_b1');
  if (r2.error && r2.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_ga_improve_b1(2): ${r2.error.message}`);
  for (const [table, col] of [['ga_vendors', 'name'], ['ga_buyer_companies', 'name']] as const) {
    const left = await db.from(table).select('id', { count: 'exact', head: true }).like(col, `${GAIB1_PREFIX}%`);
    if (left.error) { if (left.error.code !== '42P01' && left.error.code !== 'PGRST205') log.push(`${table}: ${left.error.message}`); }
    else if (left.count) log.push(`${table} 殘留 ${left.count} 筆`);
  }
  return log;
}
export { cleanupM7Users };

export function expectErr(r: any, status: number, code?: string, part?: string) {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.status, JSON.stringify(r)).toBe(status);
  if (code) expect(r.code, JSON.stringify(r)).toBe(code);
  if (part) expect(r.error as string).toContain(part);
  expect(typeof r.error).toBe('string');
  expect(r.error as string).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
}
export const okData = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};

export type Client = { client: any };
export const call = (u: Client, name: string, args: Record<string, unknown> = {}) => callFn(u.client, name, args);
export const itemId = (po: any, line: number) => po.items.find((i: any) => i.line_no === line).id as string;

/** 建立並下訂採購單（備註帶 M7M8 標記；總額不超過核准門檻 5,000 時免核准）。 */
export async function mkPo(u: Client, vendor: any, opts: { notes: string; items?: Record<string, unknown>[]; header?: Record<string, unknown>; place?: boolean } = { notes: 'po' }) {
  const items = opts.items ?? [{ item_name: 'QA-GAIB1 品項', unit: '個', quantity: 10, unit_price: 100 }];
  const c = okData(await call(u, 'ga_ws_po_create', { p_header: { notes: `[自動測試]M7M8 ${runIdOrThrow()}T ${opts.notes}`, vendor_id: vendor.id, ...(opts.header ?? {}) }, p_items: items, p_create_key: key() }));
  if (opts.place === false) return c;
  return okData(await call(u, 'ga_ws_po_action', { p_id: c.id, p_action: 'place_order', p_expected_updated_at: c.updated_at, p_note: null }));
}

/** 全部品項各收 qty 的進貨（預設收滿），lines 可自訂。 */
export async function receive(u: Client, po: any, lines?: { line: number; qty: number }[]) {
  const l = (lines ?? po.items.map((i: any) => ({ line: i.line_no, qty: Number(i.quantity) }))).map((x: any) => ({ po_item_id: itemId(po, x.line), delivered_qty: x.qty }));
  const r = await call(u, 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: l, p_key: key() });
  return okData(r);
}
export const poGet = async (u: Client, id: string) => okData(await call(u, 'ga_ws_po_get', { p_id: id }));
export const receiptsGet = async (u: Client, id: string) => okData(await call(u, 'ga_ws_po_receipts_get', { p_po_id: id }));
export const prAct = (u: Client, pr: any, action: string, payload: Record<string, unknown> = {}) =>
  call(u, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: key(), p_expected_updated_at: pr.updated_at });
export const prGet = async (u: Client, id: string) => okData(await call(u, 'ga_ws_pay_request_get', { p_id: id }));
/** 請款單詳情的完整回應（含 data 以外的 buyer、can_manage）。 */
export const prGetRaw = async (u: Client, id: string) => {
  const r = await call(u, 'ga_ws_pay_request_get', { p_id: id });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as any;
};
