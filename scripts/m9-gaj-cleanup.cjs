'use strict';
/**
 * M9-GAJ（總務印表機採購到配發 e2e 劇本）測試資料清除。
 *
 * 只刪 ZTJ- 前綴的資料與本劇本上傳的 storage 照片：
 *   - 廠商（名稱 ZTJ-）與其採購單、進貨、配發、發票、請款單、由這些採購單建立的設備
 *   - 採購單備註、需求單標題、料件、設備型號、庫存位置的名稱帶 ZTJ-
 *   - 測試帳號 ztj-*@example.test 與臨時角色 ztj_*，以及這些帳號動過的請款設定（買受人抬頭與統編）
 * 事件、流水、請款事件有「不可改刪」觸發器，與 ga_dev_cleanup_m7m8_* 的作法一致：在單一交易內只對該表暫停觸發器、立刻恢復，任何錯誤整個回復。
 * 只連 DEV：只讀 .env.development.local，並確認 supabase/.temp/project-ref 與環境的專案 ref 都以 mjpd 開頭。
 *
 * 用法：node scripts/m9-gaj-cleanup.cjs            清除
 *       node scripts/m9-gaj-cleanup.cjs --scan     只列出目前還在的 ZTJ- 資料，不刪
 * 模組：const { cleanupGaj, scanGaj } = require('./m9-gaj-cleanup.cjs')
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'ZTJ-';
const EMAIL_LIKE = 'ztj-%@example.test';
const ROLE_LIKE = 'ztj\\_%';
const BUCKET = 'general-affairs-attachments';

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

async function ids(db, table, col, like) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from(table).select('id').like(col, like).order('id').range(from, from + 999);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    out.push(...(r.data || []).map((x) => x.id));
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}

/** 目前還在的 ZTJ- 資料筆數（只讀）。 */
async function scanGaj(db = devClient()) {
  const out = {};
  for (const [table, col, like] of [
    ['ga_vendors', 'name', `${PREFIX}%`], ['ga_purchase_orders', 'notes', `${PREFIX}%`], ['ga_parts', 'name', `${PREFIX}%`],
    ['ga_equipment_templates', 'name', `${PREFIX}%`], ['ga_inventory_locations', 'name', `${PREFIX}%`], ['ga_service_requests', 'title', `${PREFIX}%`],
    ['ga_equipment', 'name', `${PREFIX}%`], ['profiles', 'email', EMAIL_LIKE],
  ]) out[`${table}.${col}`] = (await ids(db, table, col, like)).length;
  const roles = await db.from('roles').select('id').like('code', ROLE_LIKE);
  out['roles.code'] = (roles.data || []).length;
  return out;
}

const SQL = `
DO $gaj$
DECLARE
  v_marker text := '${PREFIX}%';
  v_users uuid[];
  v_vendors uuid[];
  v_po uuid[];
  v_items uuid[];
  v_rc uuid[];
  v_eq uuid[];
  v_req uuid[];
  v_pr uuid[];
  v_inv uuid[];
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
  SELECT COALESCE(array_agg(DISTINCT r.id), '{}') INTO v_pr FROM public.ga_payment_requests r
   WHERE r.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_payment_request_lines l WHERE l.pr_id = r.id AND (l.po_id = ANY (v_po) OR l.receipt_id = ANY (v_rc)));
  SELECT COALESCE(array_agg(DISTINCT i.id), '{}') INTO v_inv FROM public.ga_purchase_invoices i
   WHERE i.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id AND ir.receipt_id = ANY (v_rc));
  SELECT COALESCE(array_agg(id), '{}') INTO v_parts FROM public.ga_parts WHERE name LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_loc FROM public.ga_inventory_locations WHERE name LIKE v_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_tpl FROM public.ga_equipment_templates WHERE name LIKE v_marker;

  -- 請款單：事件、明細有不可改刪觸發器
  IF COALESCE(array_length(v_pr, 1), 0) > 0 THEN
    ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
    ALTER TABLE public.ga_payment_request_lines DISABLE TRIGGER trg_ga_payment_request_lines_guard;
    ALTER TABLE public.ga_payment_requests DISABLE TRIGGER trg_ga_payment_requests_guard;
    DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_pr);
    DELETE FROM public.ga_payment_request_lines WHERE pr_id = ANY (v_pr);
    DELETE FROM public.ga_payment_requests WHERE id = ANY (v_pr);
    ALTER TABLE public.ga_payment_requests ENABLE TRIGGER trg_ga_payment_requests_guard;
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

  -- 配發、進貨、採購單（採購單事件有不可改刪觸發器）
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

  -- 測試帳號動過的請款設定（買受人抬頭、統編）：本劇本新建的設定列直接刪回預設，並清除變更紀錄
  DELETE FROM public.ga_workflow_settings WHERE key IN ('pay_buyer_title', 'pay_buyer_tax_id') AND updated_by = ANY (v_users);
  DELETE FROM public.ga_workflow_setting_events WHERE actor_id = ANY (v_users);
END
$gaj$;
`;

function runSql(sql) {
  const file = path.join(os.tmpdir(), `m9-gaj-cleanup-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status) return `SQL 清除失敗：${String(r.stderr || r.stdout).slice(0, 600)}`;
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 清除全部 ZTJ- 資料。回傳殘留或錯誤說明（空陣列代表乾淨）。 */
async function cleanupGaj(log = () => {}) {
  const db = devClient();
  const problems = [];

  // 1. 先查出要刪的 storage 檔（紀錄刪掉後就找不到路徑了）
  const vendors = await ids(db, 'ga_vendors', 'name', `${PREFIX}%`);
  const orders = [];
  for (const [col, like] of [['notes', `${PREFIX}%`]]) orders.push(...(await ids(db, 'ga_purchase_orders', col, like)));
  if (vendors.length) {
    const r = await db.from('ga_purchase_orders').select('id').in('vendor_id', vendors);
    orders.push(...(r.data || []).map((x) => x.id));
  }
  const poIds = [...new Set(orders)];
  const resourceIds = [...(await ids(db, 'ga_service_requests', 'title', `${PREFIX}%`))];
  if (poIds.length) {
    const eq = await db.from('ga_equipment').select('id').in('source_purchase_order_id', poIds);
    resourceIds.push(...(eq.data || []).map((x) => x.id));
    const rc = await db.from('ga_purchase_receipts').select('id').in('po_id', poIds);
    resourceIds.push(...(rc.data || []).map((x) => x.id));
  }
  resourceIds.push(...(await ids(db, 'ga_equipment', 'name', `${PREFIX}%`)));
  if (vendors.length) {
    const inv = await db.from('ga_purchase_invoices').select('id').in('vendor_id', vendors);
    resourceIds.push(...(inv.data || []).map((x) => x.id));
  }
  const paths = [];
  for (let i = 0; i < resourceIds.length; i += 100) {
    const r = await db.from('ga_resource_attachments').select('storage_path,storage_bucket').in('resource_id', resourceIds.slice(i, i + 100));
    if (r.error) problems.push(`讀取附件失敗：${r.error.message}`);
    else for (const x of r.data || []) paths.push({ bucket: x.storage_bucket || BUCKET, path: x.storage_path });
  }
  log(`待刪 storage 檔 ${paths.length} 個`);

  // 2. 單一交易刪資料
  const sqlErr = runSql(SQL);
  if (sqlErr) problems.push(sqlErr);
  else log('資料庫 ZTJ- 資料已刪除');

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
      if (u.email && /^ztj-.+@example\.test$/.test(u.email)) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) problems.push(`deleteUser ${u.email}: ${d.error.message}`);
      }
    }
    if (list.length < 200) break;
  }

  // 5. 驗證沒有殘留
  const left = await scanGaj(db);
  for (const [k, n] of Object.entries(left)) if (n) problems.push(`${k} 殘留 ${n} 筆`);
  return problems;
}

module.exports = { cleanupGaj, scanGaj, PREFIX };

if (require.main === module) {
  (async () => {
    if (process.argv.includes('--scan')) {
      console.log(JSON.stringify(await scanGaj(), null, 2));
      return;
    }
    const problems = await cleanupGaj((m) => console.log(`[m9-gaj-cleanup] ${m}`));
    if (problems.length) {
      console.error(`[m9-gaj-cleanup] 清除未完成：\n${problems.join('\n')}`);
      process.exit(1);
    }
    console.log('[m9-gaj-cleanup] 完成：沒有 ZTJ- 殘留');
  })().catch((e) => {
    console.error(`[m9-gaj-cleanup] 失敗：${e.message}`);
    process.exit(2);
  });
}
