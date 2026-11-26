'use strict';
/**
 * G46 水電話費請款：清除 DEV 測試資料（請款單、請款事件、水電明細、帳單、附件紀錄與實體檔、測試廠商）。
 *
 * 只處理標記 QA-GAUP- 的資料（廠商名稱與帳單供應商名稱）；請款事件有「不可改刪」觸發器，清除交給 DEV 專用函式 ga_dev_cleanup_ga_utility_payment
 * （單一交易內只對事件表、水電明細表、帳單表暫停觸發器、立刻恢復，任何錯誤整個回復）。只連 DEV：只讀 .env.development.local，
 * 並確認 supabase/.temp/project-ref 與環境的專案 ref 都以 mjpd 開頭。
 *
 * 用法：node scripts/cleanup-ga-utility-payment-dev.cjs            清除
 *       node scripts/cleanup-ga-utility-payment-dev.cjs --scan     只列出目前還在的 QA-GAUP- 資料筆數，不刪
 *       其他任何參數一律拒絕（避免打錯參數卻直接清除）
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'general-affairs-attachments';
const LIKE = 'QA-GAUP-%';

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

async function count(db, table, col) {
  const r = await db.from(table).select('id', { count: 'exact', head: true }).like(col, LIKE);
  if (r.error) throw new Error(`${table}: ${r.error.message}`);
  return r.count || 0;
}

async function scanGaup(db = devClient()) {
  const out = { vendors: await count(db, 'ga_vendors', 'name'), bills: await count(db, 'ga_utility_bills', 'provider_name') };
  const prs = await db.from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('source', 'UTILITY').like('vendor_name_snapshot', LIKE);
  out.paymentRequests = prs.error ? `錯誤：${prs.error.message}` : prs.count || 0;
  return out;
}

async function cleanupGaup(db = devClient()) {
  const r = await db.rpc('ga_dev_cleanup_ga_utility_payment');
  if (r.error) throw new Error(`ga_dev_cleanup_ga_utility_payment 失敗：${r.error.message}`);
  const paths = (r.data && r.data.storage_paths) || [];
  if (paths.length) {
    const rm = await db.storage.from(BUCKET).remove(paths);
    if (rm.error) throw new Error(`刪除附件實體檔失敗：${rm.error.message}`);
  }
  return { ...r.data, storage_paths: paths.length };
}

module.exports = { cleanupGaup, scanGaup };

if (require.main === module) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--scan');
  if (unknown.length) {
    console.error(`不認得的參數：${unknown.join(' ')}（只接受 --scan）`);
    process.exit(2);
  }
  const run = args.includes('--scan') ? scanGaup : cleanupGaup;
  run().then(
    (res) => console.log(JSON.stringify(res, null, 2)),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
