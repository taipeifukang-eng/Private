'use strict';
/**
 * ga-improve-b1（總務採購與請款改善第一批）多角色保留資料劇本 M9-GK1 的測試資料清除。
 *
 * 預設只「列清單」，不刪任何東西。要真的刪，必須明確加 --yes-delete。
 *
 * 只刪 ZTK- 前綴的資料與本劇本上傳的 storage 檔：
 *   - 廠商（名稱 ZTK-）與其採購單、進貨、發票、請款單（含預付款與預付核銷帳）、由這些採購單建立的設備
 *   - 採購單備註、需求單標題、料件、設備型號、庫存位置、買受人公司、水電帳單供應商的名稱帶 ZTK-
 *   - 測試帳號 ztk-ga-*@example.test、臨時角色 ztk_*、同仁匯款帳戶與其事件
 *   - 這些帳號動過的請款設定（買受人抬頭與統編）
 * 事件、流水、請款事件有「不可改刪」觸發器，作法與 ga_dev_cleanup_* 系列相同：在單一交易內只對該表暫停觸發器、立刻恢復，任何錯誤整個回復。
 * 不碰 ZTJ-（M9-GAJ）、ZTU-（M9-GUP）、QA-GAIB1- 或其他任何測試資料。
 * 只連 DEV：只讀 .env.development.local（透過 tests/support/env-guard.cjs），並確認 supabase/.temp/project-ref 與環境的專案 ref 都以 mjpd 開頭。
 *
 * 用法：node scripts/ga-improve-b1-cleanup.cjs                 列出「將會刪掉」的單據清單（預設，只看不刪）
 *       node scripts/ga-improve-b1-cleanup.cjs --dry-run       同上
 *       node scripts/ga-improve-b1-cleanup.cjs --scan          只列出各類 ZTK- 資料筆數
 *       node scripts/ga-improve-b1-cleanup.cjs --yes-delete    真的清除
 *       node scripts/ga-improve-b1-cleanup.cjs --help          說明（不連資料庫、不刪任何東西）
 *       其他任何參數一律拒絕（避免打錯參數卻直接清除）
 * 模組：const { cleanupGk1, scanGk1, detailGk1 } = require('./ga-improve-b1-cleanup.cjs')
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'ZTK-';
const LIKE = 'ZTK-%';
const EMAIL_LIKE = 'ztk-ga-%@example.test';
const ROLE_LIKE = 'ztk\\_%';
const BUCKET = 'general-affairs-attachments';

const HELP = `ga-improve-b1 多角色保留資料劇本（M9-GK1，資料前綴 ZTK-）清除工具

預設只列出「將會刪掉」的清單，不會刪任何東西。

  node scripts/ga-improve-b1-cleanup.cjs               列清單（預設，只看不刪）
  node scripts/ga-improve-b1-cleanup.cjs --dry-run     同上
  node scripts/ga-improve-b1-cleanup.cjs --scan        只列各類 ZTK- 資料筆數
  node scripts/ga-improve-b1-cleanup.cjs --yes-delete  真的清除（一定要明確加這個參數）
  node scripts/ga-improve-b1-cleanup.cjs --help        顯示這段說明（不連資料庫、不刪任何東西）

只會動 ZTK- 開頭的測試資料與 ztk-ga-*@example.test 測試帳號；只連 DEV 測試區（ref mjpd 開頭），遇到正式區會停止。`;

function devClient() {
  const { assertDevEnvironment } = require(path.join(ROOT, 'tests', 'support', 'env-guard.cjs'));
  const { env } = assertDevEnvironment({ root: ROOT });
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  if (!ref.startsWith('mjpd')) throw new Error('連線目標不是 DEV（ref 不是 mjpd 開頭），停止');
  const linked = fs.readFileSync(path.join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  if (!linked.startsWith('mjpd')) throw new Error('supabase CLI 連結的專案不是 DEV（project-ref 不是 mjpd 開頭），停止');
  const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rows(db, table, col, like, select = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from(table).select(select).like(col, like).order('id').range(from, from + 999);
    if (r.error) {
      if (r.error.code === '42P01' || r.error.code === 'PGRST205') return out; // 沒有該表（例如沒套 ga-improve-b1）
      throw new Error(`${table}: ${r.error.message}`);
    }
    out.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}

/** 目前還在的 ZTK- 資料筆數（只讀）。 */
async function scanGk1(db = devClient()) {
  const out = {};
  for (const [table, col, like] of [
    ['ga_vendors', 'name', LIKE], ['ga_purchase_orders', 'notes', LIKE], ['ga_parts', 'name', LIKE], ['ga_equipment_templates', 'name', LIKE],
    ['ga_inventory_locations', 'name', LIKE], ['ga_service_requests', 'title', LIKE], ['ga_utility_bills', 'provider_name', LIKE], ['ga_buyer_companies', 'name', LIKE],
    ['profiles', 'email', EMAIL_LIKE],
  ]) out[`${table}.${col}`] = (await rows(db, table, col, like)).length;
  const roles = await db.from('roles').select('id').like('code', ROLE_LIKE);
  out['roles.code'] = (roles.data || []).length;
  return out;
}

/** 預設與 --dry-run：列出將會被刪掉的單據明細（只讀）。 */
async function detailGk1(db = devClient()) {
  const out = { scan: await scanGk1(db) };
  const vendors = await rows(db, 'ga_vendors', 'name', LIKE, 'id,name');
  const vids = vendors.map((v) => v.id);
  out.vendors = vendors.map((v) => v.name);
  const pos = (await db.from('ga_purchase_orders').select('id,po_no,status,total_amount,vendor_id,notes,expected_delivery_date')).data || [];
  const myPos = pos.filter((p) => vids.includes(p.vendor_id) || String(p.notes || '').startsWith(PREFIX));
  out.purchase_orders = myPos.map((p) => `${p.po_no} ${p.status} 含稅 ${p.total_amount} 預計到貨 ${String(p.expected_delivery_date || '').slice(0, 10) || '—'}`);
  const pids = myPos.map((p) => p.id);
  if (pids.length) {
    out.receipts = ((await db.from('ga_purchase_receipts').select('receipt_no').in('po_id', pids)).data || []).map((r) => r.receipt_no);
  }
  const profs = await rows(db, 'profiles', 'email', EMAIL_LIKE, 'id,email');
  const uids = profs.map((p) => p.id);
  const prs = (await db.from('ga_payment_requests').select('pr_no,status,amount_total,pay_kind,payee_type,payee_profile_id,vendor_id,prepay_po_id,source')).data || [];
  const myPrs = prs.filter((r) => vids.includes(r.vendor_id) || uids.includes(r.payee_profile_id) || pids.includes(r.prepay_po_id));
  out.payment_requests = myPrs.map((r) => `${r.pr_no} ${r.pay_kind === 'PREPAY' ? '預付' : r.source === 'UTILITY' ? '水電' : '一般'} ${r.payee_type === 'EMPLOYEE' ? '同仁代墊' : '廠商'} ${r.status} ${r.amount_total}`);
  out.utility_bills = (await rows(db, 'ga_utility_bills', 'provider_name', LIKE, 'id,billing_month,expense_type,amount,service_identifier')).map((b) => `${String(b.billing_month).slice(0, 7)} ${b.expense_type} ${b.service_identifier} ${b.amount}`);
  out.buyer_companies = (await rows(db, 'ga_buyer_companies', 'name', LIKE, 'id,name,tax_id')).map((c) => `${c.name} ${c.tax_id}`);
  out.service_requests = (await rows(db, 'ga_service_requests', 'title', LIKE, 'id,request_no,main_status')).map((r) => `${r.request_no} ${r.main_status}`);
  out.accounts = profs.map((p) => p.email);
  return out;
}

const SQL = `
DO $gk1$
DECLARE
  v_marker text := '${LIKE}';
  v_users uuid[];
  v_vendors uuid[];
  v_po uuid[];
  v_items uuid[];
  v_rc uuid[];
  v_eq uuid[];
  v_req uuid[];
  v_pr uuid[];
  v_inv uuid[];
  v_bills uuid[];
  v_parts uuid[];
  v_loc uuid[];
  v_tpl uuid[];
  v_tx uuid[];
  v_codes jsonb := '[]'::jsonb;
  v_c jsonb;
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_users FROM public.profiles WHERE email LIKE '${EMAIL_LIKE}';
  SELECT COALESCE(array_agg(id), '{}') INTO v_vendors FROM public.ga_vendors WHERE name LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_po FROM public.ga_purchase_orders WHERE vendor_id = ANY (v_vendors) OR notes LIKE v_marker OR vendor_name_snapshot LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_items FROM public.ga_purchase_order_items WHERE po_id = ANY (v_po);
  SELECT COALESCE(array_agg(id), '{}') INTO v_rc FROM public.ga_purchase_receipts WHERE po_id = ANY (v_po);
  SELECT COALESCE(array_agg(id), '{}') INTO v_eq FROM public.ga_equipment WHERE source_purchase_order_id = ANY (v_po) OR name LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_req FROM public.ga_service_requests WHERE title LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_bills FROM public.ga_utility_bills WHERE provider_name LIKE v_marker OR payee_vendor_id = ANY (v_vendors);
  SELECT COALESCE(array_agg(DISTINCT r.id), '{}') INTO v_pr FROM public.ga_payment_requests r
   WHERE r.vendor_id = ANY (v_vendors) OR r.prepay_po_id = ANY (v_po) OR r.payee_profile_id = ANY (v_users)
      OR EXISTS (SELECT 1 FROM public.ga_payment_request_lines l WHERE l.pr_id = r.id AND (l.po_id = ANY (v_po) OR l.receipt_id = ANY (v_rc)))
      OR EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines bl WHERE bl.pr_id = r.id AND bl.bill_id = ANY (v_bills));
  SELECT COALESCE(array_agg(DISTINCT i.id), '{}') INTO v_inv FROM public.ga_purchase_invoices i
   WHERE i.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id AND ir.receipt_id = ANY (v_rc));
  SELECT COALESCE(array_agg(id), '{}') INTO v_parts FROM public.ga_parts WHERE name LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_loc FROM public.ga_inventory_locations WHERE name LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_tpl FROM public.ga_equipment_templates WHERE name LIKE v_marker;

  -- 預付核銷帳（先於請款單與採購單）
  DELETE FROM public.ga_payment_prepay_ledger WHERE prepay_pr_id = ANY (v_pr) OR po_id = ANY (v_po);

  -- 請款單：事件、明細、水電帳單明細有不可改刪觸發器
  IF COALESCE(array_length(v_pr, 1), 0) > 0 OR COALESCE(array_length(v_bills, 1), 0) > 0 THEN
    ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
    ALTER TABLE public.ga_payment_request_lines DISABLE TRIGGER trg_ga_payment_request_lines_guard;
    ALTER TABLE public.ga_payment_request_bill_lines DISABLE TRIGGER trg_ga_pay_ub_lines_guard;
    ALTER TABLE public.ga_payment_requests DISABLE TRIGGER trg_ga_payment_requests_guard;
    ALTER TABLE public.ga_utility_bills DISABLE TRIGGER trg_ga_utility_bills_before_write;
    DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_pr) OR actor_id = ANY (v_users);
    DELETE FROM public.ga_payment_request_lines WHERE pr_id = ANY (v_pr);
    DELETE FROM public.ga_payment_request_bill_lines WHERE pr_id = ANY (v_pr) OR bill_id = ANY (v_bills);
    UPDATE public.ga_utility_bills SET paid_by_pr_id = NULL WHERE paid_by_pr_id = ANY (v_pr);
    DELETE FROM public.ga_payment_requests WHERE id = ANY (v_pr);
    DELETE FROM public.ga_resource_attachments WHERE resource_type = 'UTILITY_BILL' AND resource_id = ANY (v_bills);
    DELETE FROM public.ga_utility_bills WHERE id = ANY (v_bills);
    ALTER TABLE public.ga_utility_bills ENABLE TRIGGER trg_ga_utility_bills_before_write;
    ALTER TABLE public.ga_payment_requests ENABLE TRIGGER trg_ga_payment_requests_guard;
    ALTER TABLE public.ga_payment_request_bill_lines ENABLE TRIGGER trg_ga_pay_ub_lines_guard;
    ALTER TABLE public.ga_payment_request_lines ENABLE TRIGGER trg_ga_payment_request_lines_guard;
    ALTER TABLE public.ga_payment_request_events ENABLE TRIGGER trg_ga_payment_request_events_immutable;
  END IF;

  -- 發票與附件紀錄（實體檔由呼叫端刪）
  DELETE FROM public.ga_resource_attachments
   WHERE resource_id = ANY (v_inv) OR resource_id = ANY (v_rc) OR resource_id = ANY (v_eq) OR resource_id = ANY (v_req);
  DELETE FROM public.ga_purchase_invoice_receipts WHERE invoice_id = ANY (v_inv) OR receipt_id = ANY (v_rc);
  DELETE FROM public.ga_purchase_invoices WHERE id = ANY (v_inv);

  -- 設備：異動紀錄有不可改刪觸發器；先記下資產編號流水
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('c', left(asset_code, 4), 'd', purchased_at)), '[]'::jsonb) INTO v_codes
    FROM public.ga_equipment WHERE id = ANY (v_eq) AND asset_code IS NOT NULL AND purchased_at IS NOT NULL;
  ALTER TABLE public.ga_asset_events DISABLE TRIGGER trg_ga_asset_events_immutable;
  DELETE FROM public.ga_asset_events WHERE asset_id = ANY (v_eq) OR asset_name LIKE v_marker;
  ALTER TABLE public.ga_asset_events ENABLE TRIGGER trg_ga_asset_events_immutable;
  DELETE FROM public.ga_equipment WHERE id = ANY (v_eq);
  FOR v_c IN SELECT value FROM jsonb_array_elements(v_codes) LOOP
    DELETE FROM public.ga_asset_code_sequences s WHERE s.resource_type = 'EQUIPMENT' AND s.level2_category_code = v_c->>'c' AND s.purchase_date = (v_c->>'d')::date
      AND NOT EXISTS (SELECT 1 FROM public.ga_equipment e WHERE e.deleted_at IS NULL AND e.asset_code LIKE (v_c->>'c') || to_char((v_c->>'d')::date, 'YYYYMMDD') || '%');
  END LOOP;

  -- 配發、進貨（進貨調整列承接隨進貨單刪）、採購單（調整列隨採購單刪；採購單事件有不可改刪觸發器）
  DELETE FROM public.ga_stock_dispatches WHERE po_item_id = ANY (v_items);
  DELETE FROM public.ga_purchase_receipt_items WHERE receipt_id = ANY (v_rc);
  DELETE FROM public.ga_purchase_receipts WHERE id = ANY (v_rc);
  ALTER TABLE public.ga_purchase_order_events DISABLE TRIGGER trg_ga_po_events_immutable;
  DELETE FROM public.ga_purchase_orders WHERE id = ANY (v_po);
  ALTER TABLE public.ga_purchase_order_events ENABLE TRIGGER trg_ga_po_events_immutable;

  -- 需求單（處理單、事件、留言連帶刪除）
  DELETE FROM public.ga_service_requests WHERE id = ANY (v_req);

  -- 庫存流水（不可改刪觸發器）、餘額、位置料件、位置、料件、型號
  SELECT COALESCE(array_agg(id), '{}') INTO v_tx FROM public.ga_inventory_transactions WHERE location_id = ANY (v_loc) OR part_id = ANY (v_parts);
  IF COALESCE(array_length(v_tx, 1), 0) > 0 THEN
    UPDATE public.ga_inventory_balances SET last_transaction_id = NULL, last_transaction_at = NULL WHERE last_transaction_id = ANY (v_tx);
    ALTER TABLE public.ga_inventory_transactions DISABLE TRIGGER trg_ga_inventory_transactions_immutable;
    DELETE FROM public.ga_inventory_transactions WHERE id = ANY (v_tx);
    ALTER TABLE public.ga_inventory_transactions ENABLE TRIGGER trg_ga_inventory_transactions_immutable;
  END IF;
  DELETE FROM public.ga_inventory_balances WHERE location_id = ANY (v_loc) OR part_id = ANY (v_parts);
  DELETE FROM public.ga_inventory_location_parts WHERE location_id = ANY (v_loc) OR part_id = ANY (v_parts);
  DELETE FROM public.ga_inventory_locations WHERE id = ANY (v_loc);
  DELETE FROM public.ga_parts WHERE id = ANY (v_parts);
  DELETE FROM public.ga_equipment_templates WHERE id = ANY (v_tpl);
  DELETE FROM public.ga_vendors WHERE id = ANY (v_vendors);

  -- 同仁匯款帳戶與事件（事件表不可改刪：單一交易內暫停後立刻恢復）
  ALTER TABLE public.ga_employee_payout_account_events DISABLE TRIGGER trg_ga_employee_payout_account_events_immutable;
  DELETE FROM public.ga_employee_payout_account_events WHERE profile_id = ANY (v_users) OR actor_id = ANY (v_users);
  ALTER TABLE public.ga_employee_payout_account_events ENABLE TRIGGER trg_ga_employee_payout_account_events_immutable;
  DELETE FROM public.ga_employee_payout_accounts WHERE profile_id = ANY (v_users);

  -- 買受人公司（名稱 ZTK- 或本劇本帳號建立；仍被其他單據參照的略過）與事件
  ALTER TABLE public.ga_buyer_company_events DISABLE TRIGGER trg_ga_buyer_company_events_immutable;
  DELETE FROM public.ga_buyer_company_events WHERE actor_id = ANY (v_users)
     OR company_id IN (SELECT c.id FROM public.ga_buyer_companies c WHERE (c.name LIKE v_marker OR c.created_by = ANY (v_users))
                        AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.buyer_company_id = c.id) AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests q WHERE q.buyer_company_id = c.id));
  ALTER TABLE public.ga_buyer_company_events ENABLE TRIGGER trg_ga_buyer_company_events_immutable;
  DELETE FROM public.ga_buyer_companies c WHERE (c.name LIKE v_marker OR c.created_by = ANY (v_users))
     AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.buyer_company_id = c.id) AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests q WHERE q.buyer_company_id = c.id);

  -- 測試帳號動過的請款設定（買受人抬頭、統編）：本劇本新建的設定列直接刪回預設，並清除變更紀錄
  DELETE FROM public.ga_workflow_settings WHERE key IN ('pay_buyer_title', 'pay_buyer_tax_id') AND updated_by = ANY (v_users);
  DELETE FROM public.ga_workflow_setting_events WHERE actor_id = ANY (v_users);
END
$gk1$;
`;

function runSql(sql) {
  const file = path.join(os.tmpdir(), `ga-improve-b1-cleanup-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status) return `SQL 清除失敗：${String(r.stderr || r.stdout).slice(0, 600)}`;
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 清除全部 ZTK- 資料。回傳殘留或錯誤說明（空陣列代表乾淨）。 */
async function cleanupGk1(log = () => {}) {
  const db = devClient();
  const problems = [];

  // 1. 先查出要刪的 storage 檔（紀錄刪掉後就找不到路徑了）
  const vendors = (await rows(db, 'ga_vendors', 'name', LIKE)).map((x) => x.id);
  const poIds = new Set((await rows(db, 'ga_purchase_orders', 'notes', LIKE)).map((x) => x.id));
  if (vendors.length) {
    const r = await db.from('ga_purchase_orders').select('id').in('vendor_id', vendors);
    for (const x of r.data || []) poIds.add(x.id);
  }
  const resourceIds = [...(await rows(db, 'ga_service_requests', 'title', LIKE)).map((x) => x.id)];
  if (poIds.size) {
    const eq = await db.from('ga_equipment').select('id').in('source_purchase_order_id', [...poIds]);
    resourceIds.push(...(eq.data || []).map((x) => x.id));
    const rc = await db.from('ga_purchase_receipts').select('id').in('po_id', [...poIds]);
    resourceIds.push(...(rc.data || []).map((x) => x.id));
  }
  resourceIds.push(...(await rows(db, 'ga_equipment', 'name', LIKE)).map((x) => x.id));
  resourceIds.push(...(await rows(db, 'ga_utility_bills', 'provider_name', LIKE)).map((x) => x.id));
  if (vendors.length) {
    const inv = await db.from('ga_purchase_invoices').select('id').in('vendor_id', vendors);
    resourceIds.push(...(inv.data || []).map((x) => x.id));
    const bills = await db.from('ga_utility_bills').select('id').in('payee_vendor_id', vendors);
    resourceIds.push(...(bills.data || []).map((x) => x.id));
  }
  const paths = [];
  const uniq = [...new Set(resourceIds)];
  for (let i = 0; i < uniq.length; i += 100) {
    const r = await db.from('ga_resource_attachments').select('storage_path,storage_bucket').in('resource_id', uniq.slice(i, i + 100));
    if (r.error) problems.push(`讀取附件失敗：${r.error.message}`);
    else for (const x of r.data || []) paths.push({ bucket: x.storage_bucket || BUCKET, path: x.storage_path });
  }
  log(`待刪 storage 檔 ${paths.length} 個`);

  // 2. 單一交易刪資料
  const sqlErr = runSql(SQL);
  if (sqlErr) problems.push(sqlErr);
  else log('資料庫 ZTK- 資料已刪除');

  // 3. storage 實體檔（資料庫刪成功才刪檔，避免紀錄還在但檔案沒了）
  if (!sqlErr) {
    const byBucket = new Map();
    for (const p of paths) byBucket.set(p.bucket, [...(byBucket.get(p.bucket) || []), p.path]);
    for (const [bucket, list] of byBucket) {
      const rm = await db.storage.from(bucket).remove(list);
      if (rm.error) problems.push(`storage ${bucket}: ${rm.error.message}`);
    }
  }

  // 4. 帳號與臨時角色
  const profs = await db.from('profiles').select('id').like('email', EMAIL_LIKE);
  const uids = (profs.data || []).map((p) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  const roles = await db.from('roles').select('id').like('code', ROLE_LIKE);
  const roleIds = (roles.data || []).map((r) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    const dr = await db.from('roles').delete().in('id', roleIds);
    if (dr.error) problems.push(`roles: ${dr.error.message}`);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) { problems.push(`listUsers: ${r.error.message}`); break; }
    const list = r.data.users || [];
    for (const u of list) {
      if (u.email && /^ztk-ga-.+@example\.test$/.test(u.email)) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) problems.push(`deleteUser ${u.email}: ${d.error.message}`);
      }
    }
    if (list.length < 200) break;
  }

  // 5. 驗證沒有殘留
  const left = await scanGk1(db);
  for (const [k, n] of Object.entries(left)) if (n) problems.push(`${k} 殘留 ${n} 筆`);
  return problems;
}

module.exports = { cleanupGk1, scanGk1, detailGk1, PREFIX };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
      console.log(HELP);
      return;
    }
    const known = ['--scan', '--dry-run', '--yes-delete'];
    const bad = args.filter((a) => !known.includes(a));
    if (bad.length) throw new Error(`不認得的參數 ${bad.join(' ')}；只認 --scan、--dry-run（只看不刪），要清除請明確加 --yes-delete`);
    if (args.includes('--yes-delete') && (args.includes('--scan') || args.includes('--dry-run'))) throw new Error('--yes-delete 不能和 --scan／--dry-run 同時使用');
    if (args.includes('--scan')) {
      console.log(JSON.stringify(await scanGk1(), null, 2));
      return;
    }
    if (!args.includes('--yes-delete')) {
      // 預設（沒有參數或 --dry-run）：只列清單，不刪
      console.log(JSON.stringify(await detailGk1(), null, 2));
      console.log('\n以上只是清單，沒有刪除任何資料。要真的清除請加 --yes-delete。');
      return;
    }
    const problems = await cleanupGk1((m) => console.log(`[ga-improve-b1-cleanup] ${m}`));
    if (problems.length) {
      console.error(`[ga-improve-b1-cleanup] 清除未完成：\n${problems.join('\n')}`);
      process.exit(1);
    }
    console.log('[ga-improve-b1-cleanup] 完成：沒有 ZTK- 殘留');
  })().catch((e) => {
    console.error(`[ga-improve-b1-cleanup] 失敗：${e.message}`);
    process.exit(2);
  });
}
