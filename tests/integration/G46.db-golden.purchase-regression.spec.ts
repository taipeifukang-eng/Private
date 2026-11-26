import crypto from 'node:crypto';
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, cleanupM7Users, M7_EMAIL_PREFIX, m7Name } from '../support/m7m8-fixtures';
import { clientForCredentials, taipeiToday } from '../support/m7m8-po-fixtures';
import { REAL_ROLES, seedGa45Vendor, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// G46 零影響黃金快照（只在人工指定時執行，平常整支略過）：
//   GAUP_GOLDEN=capture GAUP_GOLDEN_FILE=<路徑>  在套用「水電請款」SQL 加掛之前，建立固定的採購、發票、請款測試資料，呼叫採購端的讀取函式並把輸出存檔，資料保留不清除；
//   GAUP_GOLDEN=compare GAUP_GOLDEN_FILE=<路徑>  套用之後，用同一批保留的資料再呼叫一次，去掉新增鍵（source、bill_month、auto_mark_paid 等）後必須和存檔逐位元相同，比完清除。
// 涵蓋函式：ga_ws_pay_request_list／get、ga_ws_pay_export、ga_ws_pay_po_summary、ga_ws_purchase_analysis、ga_ws_vendor_perf、ga_ws_home_summary／badges（只比對與本批資料無關的整體口徑）、ga_ws_po_list／get、ga_ws_pay_receipt_candidates。
// 測試資料：廠商名稱 QA-GA45- 標記、採購單備註 [自動測試]M7M8 標記、只用 DEV。
const MODE = process.env.GAUP_GOLDEN || '';
const FILE = process.env.GAUP_GOLDEN_FILE || '';
test.skip(!MODE, '只在 GAUP_GOLDEN=capture|compare 時執行');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant'];
let users: Record<string, Ga45User> = {};
const key = () => crypto.randomUUID();
const fn = (who: Ga45Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const ok = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const itemId = (po: any, line: number) => po.items.find((i: any) => i.line_no === line).id as string;
const ADDED_KEYS = new Set(['source', 'bill_month', 'auto_mark_paid', 'bills_masked', 'bill_count', 'bill_lines', 'auto_marked_count', 'auto_reverted_count']);

/** 去掉新增鍵與「人」的欄位（測試帳號每次重建，清除後建立者會變空），讓比對只看採購資料本身。 */
const PERSON_KEY = /(_by|_by_name|actor_id|actor_name)$/;
function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (k, v) => (ADDED_KEYS.has(k) || PERSON_KEY.test(k) ? undefined : v)));
}

async function mkPo(vendor: any, notes: string, qty = 10, price = 100) {
  const c = ok(await fn('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(notes), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 黃金品項', unit: '個', quantity: qty, unit_price: price }], p_create_key: key() }));
  const po = ok(await fn('clerk', 'ga_ws_po_action', { p_id: c.id, p_action: 'place_order', p_expected_updated_at: c.updated_at, p_note: null }));
  const receipt = ok(await fn('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, 1), delivered_qty: qty }], p_key: key() }));
  return { po, receipt };
}
const act = (who: Ga45Key, pr: any, action: string, payload: Record<string, unknown> = {}) =>
  fn(who, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: key(), p_expected_updated_at: pr.updated_at });

/** 測試帳號在兩次執行之間保留（資料引用它們，不能刪）：沒有就建立，有就重設密碼，並補回角色。 */
async function ensureUsers() {
  const db = adminDb();
  for (const k of KEYS) {
    const email = `${M7_EMAIL_PREFIX}ga45-${k}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    let id: string | undefined = (await db.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id;
    if (id) {
      const u = await db.auth.admin.updateUserById(id, { password });
      if (u.error) throw new Error(`重設密碼失敗：${u.error.message}`);
    } else {
      const c = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M7M8 GA45 ${k}` } });
      if (c.error) throw new Error(`建立帳號失敗：${c.error.message}`);
      id = c.data.user.id as string;
      await db.from('profiles').update({ role: 'member', job_title: '測試', department: null }).eq('id', id);
    }
    const role = (await db.from('roles').select('id').eq('code', REAL_ROLES[k as 'clerk' | 'accountant']).single()).data as { id: string };
    await db.from('user_roles').delete().eq('user_id', id);
    const ur = await db.from('user_roles').insert({ user_id: id, role_id: role.id, is_active: true });
    if (ur.error) throw new Error(`user_roles：${ur.error.message}`);
    users[k] = { key: k, id: id as string, email, password, client: await clientForCredentials(email, password) };
  }
}
test.beforeAll(async () => {
  await assertGaBaseline();
  if (MODE === 'capture') {
    const left = await cleanupM7M8();
    if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  }
  await ensureUsers();
});
test.afterAll(async () => {
  if (MODE === 'compare') {
    expect(await cleanupM7M8(), '清除黃金快照測試資料').toEqual([]);
    expect(await cleanupM7Users(), '清除測試帳號').toEqual([]);
  }
});

function diffPaths(a: any, b: any, path = '', out: string[] = []): string[] {
  if (out.length >= 8) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], `${path}.${k}`, out);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  return out;
}
async function snapshot(ids: { vendor: string; pos: string[]; prs: string[]; month: string }) {
  const out: Record<string, unknown> = {};
  out.list_all = ok(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { vendor_id: ids.vendor }, p_page: 1, p_page_size: 100 }));
  for (const st of ['DRAFT', 'SUBMITTED', 'PAID', 'VOID']) out[`list_${st}`] = ok(await fn('accountant', 'ga_ws_pay_request_list', { p_filters: { vendor_id: ids.vendor, status: st }, p_page: 1, p_page_size: 100 }));
  out.list_search = ok(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { vendor_id: ids.vendor, search: 'PY-' }, p_page: 1, p_page_size: 2 }));
  out.list_by_po = ok(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { po_id: ids.pos[0] }, p_page: 1, p_page_size: 20 }));
  for (const [i, id] of ids.prs.entries()) out[`get_${i}`] = ok(await fn('accountant', 'ga_ws_pay_request_get', { p_id: id }));
  for (const st of ['DRAFT', 'SUBMITTED', 'PAID', 'VOID']) out[`export_${st}`] = ok(await fn('accountant', 'ga_ws_pay_export', { p_filters: { month: ids.month, vendor_id: ids.vendor, status: st } }));
  for (const [i, id] of ids.pos.entries()) {
    out[`po_summary_${i}`] = ok(await fn('clerk', 'ga_ws_pay_po_summary', { p_po_id: id }));
    out[`po_get_${i}`] = ok(await fn('clerk', 'ga_ws_po_get', { p_id: id }));
  }
  out.po_list = ok(await fn('clerk', 'ga_ws_po_list', { p_filters: { vendor_id: ids.vendor }, p_page: 1, p_page_size: 50 }));
  out.receipt_candidates = ok(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: ids.vendor }, p_page: 1, p_page_size: 50 }));
  // 整體口徑：分析與績效只留本批廠商那一列（別人的資料會讓整體數字變動）；首頁摘要與徽章是全域數字，只列為資訊
  const vname = (await adminDb().from('ga_vendors').select('name').eq('id', ids.vendor).single()).data!.name as string;
  const analysis = await fn('clerk', 'ga_ws_purchase_analysis', { p_year_month: ids.month, p_page: 1, p_page_size: 100 });
  out.analysis = analysis.ok ? { orders: (analysis.data.orders || []).filter((o: any) => o.vendor_label === vname), by_vendor: (analysis.data.by_vendor || []).filter((v: any) => v.label === vname) } : analysis;
  const perf = await fn('accountant', 'ga_ws_vendor_perf', { p_from: `${ids.month}-01`, p_to: `${ids.month}-28` });
  out.perf = perf.ok ? { rows: JSON.parse(JSON.stringify(perf.data)) } : { error: perf.code };
  out.home_summary = await fn('clerk', 'ga_ws_home_summary', {});
  out.home_badges = await fn('clerk', 'ga_ws_home_badges', {});
  return out;
}


test('G46 黃金快照：採購端讀取函式的輸出', async () => {
  const d = taipeiToday();
  const month = `${d.slice(0, 4)}-${d.slice(4, 6)}`;
  let ids: { vendor: string; pos: string[]; prs: string[]; month: string };
  if (MODE === 'capture') {
    const vendor = await seedGa45Vendor('GOLD', { name: `QA-GA45-GOLD-${Date.now()}` });
    const a = await mkPo(vendor, 'GOLD-A');
    const b = await mkPo(vendor, 'GOLD-B', 5, 200);
    const c = await mkPo(vendor, 'GOLD-C', 20, 50);
    const pr = async (who: Ga45Key, rc: any, extra: Record<string, unknown> = {}) =>
      ok(await fn(who, 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }], ...extra }, p_key: key() }));
    const draft = await pr('clerk', a.receipt, { notes: '黃金草稿' });
    const submitted0 = await pr('clerk', b.receipt);
    const submitted = ok(await act('clerk', submitted0, 'submit'));
    const paid0 = ok(await act('clerk', ok(await fn('clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: c.receipt.id, claim_untaxed: 500 }] }, p_key: key() })), 'submit'));
    const paid = ok(await act('accountant', paid0, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'GOLD-REF' }));
    const void0 = await pr('clerk', (await mkPo(vendor, 'GOLD-D')).receipt);
    const voided = ok(await act('clerk', void0, 'void', { reason: '黃金作廢' }));
    ids = { vendor: vendor.id, pos: [a.po.id, b.po.id, c.po.id], prs: [draft.id, submitted.id, paid.id, voided.id], month };
    const snap = normalize(await snapshot(ids));
    fs.writeFileSync(FILE, JSON.stringify({ ids, snap }, null, 1));
    console.log(`黃金快照已寫入 ${FILE}（${Object.keys(snap as object).length} 組輸出）`);
  } else {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    ids = saved.ids;
    const now = normalize(await snapshot(ids)) as Record<string, unknown>;
    const diff: string[] = [];
    for (const k of Object.keys(saved.snap)) {
      const a = JSON.stringify(saved.snap[k]);
      const b = JSON.stringify(now[k]);
      if (a !== b) diff.push(k);
    }
    // 整體口徑（分析、績效）可能被別人同時操作的資料影響：只比對含本批廠商的部分，其餘列為資訊
    const INFO = ['perf', 'home_summary', 'home_badges'];
    const hard = diff.filter((k) => !INFO.includes(k));
    expect(hard, `輸出與套用前不同的項目：${diff.join(', ')}`).toEqual([]);
    for (const k of diff) if (INFO.includes(k)) console.log(`資訊：${k} 與套用前不同（全域數字，可能是別人的資料）：${diffPaths(saved.snap[k], now[k]).join(' | ')}`);
    console.log(`黃金快照比對通過：${Object.keys(saved.snap).length} 組輸出，差異項目 ${diff.length}（${diff.join(', ') || '無'}）`);
  }
});
