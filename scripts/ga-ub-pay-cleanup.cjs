'use strict';
/**
 * M9-GUP（水電話費請款 e2e 劇本）測試資料清除。
 *
 * 只刪 ZTU- 前綴的資料：
 *   - 繳費單位廠商（名稱 ZTU-）、供應商名稱帶 ZTU- 的水電帳單（含指向 ZTU- 廠商的帳單）、這些帳單的請款單、請款事件、請款明細、帳單附件紀錄與實體檔
 *   - 測試帳號 ztu-ga-*@example.test（只拿掉角色關聯並刪帳號；不動任何既有角色）
 * 請款事件、請款明細、帳單有「不可改刪」觸發器，作法與 DEV 專用函式 ga_dev_cleanup_ga_utility_payment 相同：
 * 在單一交易內只對這三張表暫停觸發器、立刻恢復，任何錯誤整個回復。不碰 QA-GAUP-、ZTJ- 或其他測試資料。
 * 只連 DEV：只讀 .env.development.local，並確認 supabase/.temp/project-ref 與環境的專案 ref 都以 mjpd 開頭。
 *
 * 用法：node scripts/ga-ub-pay-cleanup.cjs --scan        只列出目前還在的 ZTU- 資料筆數，不刪
 *       node scripts/ga-ub-pay-cleanup.cjs --dry-run     只列出「將會刪掉」的廠商、帳單、請款單明細，不刪
 *       node scripts/ga-ub-pay-cleanup.cjs --yes-delete  真的清除（沒加 --yes-delete 或打錯參數都不會刪）
 * 模組：const { cleanupGup, scanGup, detailGup } = require('./ga-ub-pay-cleanup.cjs')
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'ZTU-';
const LIKE = 'ZTU-%';
const EMAIL_LIKE = 'ztu-ga-%@example.test';
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

async function ids(db, table, col, like, select = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from(table).select(select).like(col, like).order('id').range(from, from + 999);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    out.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}

/** 目前還在的 ZTU- 資料筆數（只讀）。 */
async function scanGup(db = devClient()) {
  const vendors = await ids(db, 'ga_vendors', 'name', LIKE);
  const vids = vendors.map((v) => v.id);
  const out = {
    'ga_vendors.name': vendors.length,
    'ga_utility_bills.provider_name': (await ids(db, 'ga_utility_bills', 'provider_name', LIKE)).length,
    'profiles.email': (await ids(db, 'profiles', 'email', EMAIL_LIKE)).length,
  };
  if (vids.length) {
    const prs = await db.from('ga_payment_requests').select('id', { count: 'exact', head: true }).in('vendor_id', vids);
    out['ga_payment_requests（ZTU- 廠商）'] = prs.error ? `錯誤：${prs.error.message}` : prs.count || 0;
  } else out['ga_payment_requests（ZTU- 廠商）'] = 0;
  return out;
}

/** --dry-run 用：列出將會被刪掉的明細（只讀）。 */
async function detailGup(db = devClient()) {
  const out = { scan: await scanGup(db) };
  const vendors = await ids(db, 'ga_vendors', 'name', LIKE, 'id,name');
  const vids = vendors.map((v) => v.id);
  out.vendors = vendors.map((v) => v.name);
  const bills = await ids(db, 'ga_utility_bills', 'provider_name', LIKE, 'id,billing_month,expense_type,amount,paid_at,paid_by_pr_id,service_identifier,deleted_at');
  out.bills = bills.map((b) => `${String(b.billing_month).slice(0, 7)} ${b.expense_type} ${b.service_identifier} 金額 ${b.amount} ${b.paid_at ? `已繳 ${b.paid_at}` : '待繳'}${b.paid_by_pr_id ? '（請款單自動標記）' : ''}${b.deleted_at ? '（已刪除）' : ''}`);
  if (vids.length) {
    const prs = (await db.from('ga_payment_requests').select('id,pr_no,status,amount_total,bill_month,vendor_name_snapshot').in('vendor_id', vids)).data || [];
    out.payment_requests = prs.map((r) => `${r.pr_no} ${r.vendor_name_snapshot} ${String(r.bill_month || '').slice(0, 7)} ${r.status} 合計 ${r.amount_total}`);
  }
  out.accounts = (await ids(db, 'profiles', 'email', EMAIL_LIKE, 'id,email')).map((p) => p.email);
  return out;
}

const SQL = `
DO $gup$
DECLARE
  v_vendors uuid[];
  v_bills uuid[];
  v_prs uuid[];
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_vendors FROM public.ga_vendors WHERE name LIKE '${LIKE}';
  SELECT COALESCE(array_agg(id), '{}') INTO v_bills FROM public.ga_utility_bills WHERE provider_name LIKE '${LIKE}' OR payee_vendor_id = ANY (v_vendors);
  SELECT COALESCE(array_agg(DISTINCT r.id), '{}') INTO v_prs FROM public.ga_payment_requests r
   WHERE r.source = 'UTILITY' AND (r.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines l WHERE l.pr_id = r.id AND l.bill_id = ANY (v_bills)));

  ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
  ALTER TABLE public.ga_payment_request_bill_lines DISABLE TRIGGER trg_ga_pay_ub_lines_guard;
  ALTER TABLE public.ga_utility_bills DISABLE TRIGGER trg_ga_utility_bills_before_write;
  DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_prs);
  DELETE FROM public.ga_payment_request_bill_lines WHERE pr_id = ANY (v_prs) OR bill_id = ANY (v_bills);
  UPDATE public.ga_utility_bills SET paid_by_pr_id = NULL WHERE paid_by_pr_id = ANY (v_prs);
  DELETE FROM public.ga_payment_requests WHERE id = ANY (v_prs);
  DELETE FROM public.ga_resource_attachments WHERE resource_type = 'UTILITY_BILL' AND resource_id = ANY (v_bills);
  DELETE FROM public.ga_utility_bills WHERE id = ANY (v_bills);
  ALTER TABLE public.ga_utility_bills ENABLE TRIGGER trg_ga_utility_bills_before_write;
  ALTER TABLE public.ga_payment_request_bill_lines ENABLE TRIGGER trg_ga_pay_ub_lines_guard;
  ALTER TABLE public.ga_payment_request_events ENABLE TRIGGER trg_ga_payment_request_events_immutable;

  DELETE FROM public.ga_vendors v WHERE v.name LIKE '${LIKE}' AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.vendor_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests r WHERE r.vendor_id = v.id);
END
$gup$;
`;

function runSql(sql) {
  const file = path.join(os.tmpdir(), `ga-ub-pay-cleanup-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status) return `SQL 清除失敗：${String(r.stderr || r.stdout).slice(0, 600)}`;
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 清除全部 ZTU- 資料。回傳殘留或錯誤說明（空陣列代表乾淨）。 */
async function cleanupGup(log = () => {}) {
  const db = devClient();
  const problems = [];

  // 1. 先查出要刪的 storage 檔（紀錄刪掉後就找不到路徑了）
  const vendors = (await ids(db, 'ga_vendors', 'name', LIKE)).map((v) => v.id);
  const billIds = (await ids(db, 'ga_utility_bills', 'provider_name', LIKE)).map((b) => b.id);
  if (vendors.length) {
    const r = await db.from('ga_utility_bills').select('id').in('payee_vendor_id', vendors);
    billIds.push(...(r.data || []).map((x) => x.id));
  }
  const bills = [...new Set(billIds)];
  const paths = [];
  for (let i = 0; i < bills.length; i += 100) {
    const r = await db.from('ga_resource_attachments').select('storage_path,storage_bucket').eq('resource_type', 'UTILITY_BILL').in('resource_id', bills.slice(i, i + 100));
    if (r.error) problems.push(`讀取附件失敗：${r.error.message}`);
    else for (const x of r.data || []) paths.push({ bucket: x.storage_bucket || BUCKET, path: x.storage_path });
  }
  log(`待刪 storage 檔 ${paths.length} 個`);

  // 2. 單一交易刪資料
  const sqlErr = runSql(SQL);
  if (sqlErr) problems.push(sqlErr);
  else log('資料庫 ZTU- 資料已刪除');

  // 3. storage 實體檔（資料庫刪成功才刪檔，避免紀錄還在但檔案沒了）
  if (!sqlErr) {
    const byBucket = new Map();
    for (const p of paths) byBucket.set(p.bucket, [...(byBucket.get(p.bucket) || []), p.path]);
    for (const [bucket, list] of byBucket) {
      const rm = await db.storage.from(bucket).remove(list);
      if (rm.error) problems.push(`storage ${bucket}: ${rm.error.message}`);
    }
  }

  // 4. 測試帳號（只刪 ztu-ga-*@example.test）
  const profs = await ids(db, 'profiles', 'email', EMAIL_LIKE);
  const uids = profs.map((p) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) { problems.push(`listUsers: ${r.error.message}`); break; }
    const list = r.data.users || [];
    for (const u of list) {
      if (u.email && /^ztu-ga-.+@example\.test$/.test(u.email)) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) problems.push(`deleteUser ${u.email}: ${d.error.message}`);
      }
    }
    if (list.length < 200) break;
  }

  // 5. 驗證沒有殘留
  const left = await scanGup(db);
  for (const [k, n] of Object.entries(left)) if (n) problems.push(`${k} 殘留 ${n} 筆`);
  return problems;
}

module.exports = { cleanupGup, scanGup, detailGup, PREFIX };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const known = ['--scan', '--dry-run', '--yes-delete'];
    const bad = args.filter((a) => !known.includes(a));
    if (bad.length) throw new Error(`不認得的參數 ${bad.join(' ')}；只認 --scan、--dry-run（只看不刪），要清除請明確加 --yes-delete`);
    if (args.includes('--scan')) {
      console.log(JSON.stringify(await scanGup(), null, 2));
      return;
    }
    if (args.includes('--dry-run')) {
      console.log(JSON.stringify(await detailGup(), null, 2));
      return;
    }
    if (!args.includes('--yes-delete')) throw new Error('清除要明確加 --yes-delete；只想看請用 --dry-run 或 --scan');
    const problems = await cleanupGup((m) => console.log(`[ga-ub-pay-cleanup] ${m}`));
    if (problems.length) {
      console.error(`[ga-ub-pay-cleanup] 清除未完成：\n${problems.join('\n')}`);
      process.exit(1);
    }
    console.log('[ga-ub-pay-cleanup] 完成：沒有 ZTU- 殘留');
  })().catch((e) => {
    console.error(`[ga-ub-pay-cleanup] 失敗：${e.message}`);
    process.exit(2);
  });
}
