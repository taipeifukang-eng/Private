#!/usr/bin/env node
'use strict';
/**
 * 驗證 docs/perf/pharm_onboard_B_apply.sql 與 C_rollback.sql 在 DEV 可執行且結果正確。
 * 全程在 BEGIN ... ROLLBACK 內（測試資料也在交易內建立），結束後 DEV 不留任何東西。
 * 月份範圍改成保留的 2098-01 ~ 2098-04；只斷言自己建立的 FKF9998x 測試員編。
 * 需要 supabase CLI 已 link 到 DEV（supabase/.temp/project-ref = mjpdfpxqttbhzeimmtqr）。
 *
 * 用法：node scripts/test-pharm-onboard-sql-dev.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadDevEnv, ROOT, DEV_REF } = require('./perf/dev-env.cjs');

loadDevEnv();
const linked = fs.readFileSync(path.join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
if (linked !== DEV_REF || linked.startsWith('odvk')) throw new Error('supabase CLI 沒有 link 到 DEV，拒絕執行');

const read = (f) => fs.readFileSync(path.join(ROOT, 'docs', 'perf', f), 'utf8').replace(/\r\n/g, '\n');
let B = read('pharm_onboard_B_apply.sql');
let C = read('pharm_onboard_C_rollback.sql');
const A = read('pharm_onboard_A_preview.sql');

// 靜態檢查：只能有 BEGIN，不能有可執行的 COMMIT；備份表要 RLS + REVOKE
const stripComments = (s) => s.replace(/--.*$/gm, '');
for (const [name, sql] of [['A', A], ['B', B], ['C', C]]) {
  if (/^\s*COMMIT\s*;/im.test(stripComments(sql))) throw new Error(`${name} 含有 COMMIT`);
}
if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(stripComments(A))) throw new Error('A 必須是唯讀');
if (!/ENABLE ROW LEVEL SECURITY/.test(B) || !/REVOKE ALL ON pharm_onboard_bak_store_employees FROM anon, authenticated/.test(B)) throw new Error('B 備份表缺 RLS/REVOKE');
if (/FK\d{4}/.test(stripComments(B + C + A))) throw new Error('SQL 不得寫死員編');

B = B.replace("SELECT '2026-05'::text AS from_ym, '2026-11'::text AS to_ym", "SELECT '2098-01'::text AS from_ym, '2098-04'::text AS to_ym");
if (!B.includes("'2098-01'")) throw new Error('範圍替換失敗');
const bodyOf = (s) => s.replace(/^BEGIN;\s*$/m, '');

const ST = "(SELECT id FROM stores WHERE store_code = 'ZT01')";
const emp = (code, extra) =>
  `INSERT INTO store_employees (employee_code, employee_name, store_id, is_active, is_pharmacist, position, current_position, employment_type${extra.cols || ''}) VALUES ('${code}', 'sqltest-${code}', ${ST}, ${extra.active ?? true}, ${extra.pharm ?? false}, '專員', '新人', 'full_time'${extra.vals || ''});`;
const onb = (code, date, flag) =>
  `INSERT INTO employee_movement_history (employee_code, employee_name, store_id, movement_type, movement_date, onboarding_is_pharmacist) VALUES ('${code}', 'sqltest-${code}', ${ST}, 'onboarding', '${date}', ${flag});`;

const fixtures = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot WHERE year_month LIKE '2098-%')
     OR EXISTS (SELECT 1 FROM pharmacist_snapshot_locks WHERE year_month LIKE '2098-%')
     OR EXISTS (SELECT 1 FROM store_employees WHERE employee_code LIKE 'FKF9998%')
     OR EXISTS (SELECT 1 FROM employee_movement_history WHERE employee_code LIKE 'FKF9998%') THEN
    RAISE EXCEPTION 'reserved test data not empty';
  END IF;
END $$;
${emp('FKF99981', {})} ${onb('FKF99981', '2098-01-10', true)}
${emp('FKF99982', {})} ${onb('FKF99982', '2098-01-12', false)}
${emp('FKF99983', {})} ${onb('FKF99983', '2098-03-05', true)}
${emp('FKF99984', {})} ${onb('FKF99984', '2098-01-10', true)}
INSERT INTO pharmacist_monthly_snapshot (year_month, store_id, employee_code, employee_name, is_active, source) VALUES ('2098-01', ${ST}, 'FKF99984', 'sqltest', true, 'manual');
${emp('FKF99985', { active: false })} ${onb('FKF99985', '2098-01-10', true)}
${emp('FKF99986', { pharm: true })} ${onb('FKF99986', '2098-01-10', true)}
INSERT INTO pharmacist_snapshot_locks (year_month, locked_by) VALUES ('2098-02', 'sqltest');
`;

const asserts = `
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pharm_onboard_bak_snapshot_inserted WHERE employee_code LIKE 'FKF9998%';
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 inserted rows, got %', n; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code = 'FKF99981' AND year_month IN ('2098-01','2098-03','2098-04') AND notes = 'backfilled: onboarding not synced' AND is_active AND source = 'movement';
  IF n <> 3 THEN RAISE EXCEPTION 'FKF99981 expected 3 months (locked 2098-02 skipped), got %', n; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code = 'FKF99981' AND year_month = '2098-02';
  IF n <> 0 THEN RAISE EXCEPTION 'locked month got a row'; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code = 'FKF99983' AND year_month IN ('2098-03','2098-04');
  IF n <> 2 THEN RAISE EXCEPTION 'FKF99983 expected months 03,04, got %', n; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code = 'FKF99983' AND year_month < '2098-03';
  IF n <> 0 THEN RAISE EXCEPTION 'FKF99983 backfilled before onboarding'; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code IN ('FKF99982','FKF99985','FKF99986');
  IF n <> 0 THEN RAISE EXCEPTION 'non-targets got rows: %', n; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code = 'FKF99984';
  IF n <> 1 THEN RAISE EXCEPTION 'already-in-snapshot person changed: %', n; END IF;
  SELECT count(*) INTO n FROM store_employees WHERE employee_code IN ('FKF99981','FKF99983') AND is_pharmacist AND position = '專員' AND current_position = '新人';
  IF n <> 2 THEN RAISE EXCEPTION 'master not updated / position changed: %', n; END IF;
  SELECT count(*) INTO n FROM store_employees WHERE employee_code IN ('FKF99982','FKF99984','FKF99985') AND is_pharmacist;
  IF n <> 0 THEN RAISE EXCEPTION 'non-targets master changed: %', n; END IF;
  SELECT count(*) INTO n FROM pharm_onboard_bak_store_employees WHERE employee_code LIKE 'FKF9998%';
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 backed up employees, got %', n; END IF;
  SELECT count(*) INTO n FROM pg_class WHERE relname IN ('pharm_onboard_bak_store_employees','pharm_onboard_bak_snapshot_inserted') AND relrowsecurity;
  IF n <> 2 THEN RAISE EXCEPTION 'backup tables must have RLS'; END IF;
  IF has_table_privilege('anon', 'pharm_onboard_bak_store_employees', 'SELECT') OR has_table_privilege('authenticated', 'pharm_onboard_bak_snapshot_inserted', 'SELECT') THEN
    RAISE EXCEPTION 'anon/authenticated must not read backups';
  END IF;
END $$;
`;

const afterRollback = `
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM store_employees WHERE employee_code IN ('FKF99981','FKF99983') AND is_pharmacist;
  IF n <> 0 THEN RAISE EXCEPTION 'C did not restore master: %', n; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code IN ('FKF99981','FKF99983');
  IF n <> 0 THEN RAISE EXCEPTION 'C did not remove backfilled rows: %', n; END IF;
  SELECT count(*) INTO n FROM pharmacist_monthly_snapshot WHERE employee_code = 'FKF99984';
  IF n <> 1 THEN RAISE EXCEPTION 'C touched unrelated rows'; END IF;
END $$;
`;

// 同一交易再跑一次 B 結果（冪等：第二次不會再有目標，因為主檔已是藥師）在 C 之前檢查不需要；這裡只驗證 B -> C。
const full = ['BEGIN;', fixtures, bodyOf(B), asserts, bodyOf(C), afterRollback, 'ROLLBACK;'].join('\n');
const tmp = path.join(os.tmpdir(), `pharm_onboard_dev_${Date.now()}.sql`);
fs.writeFileSync(tmp, full);
try {
  const out = execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', '--linked', '-f', tmp, '-o', 'json'], {
    cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('  ok  B + C executed on DEV inside BEGIN..ROLLBACK, all assertions passed');
  if (process.env.SHOW_SQL_OUT) console.log(out.slice(0, 3000));
} catch (e) {
  console.error('  FAIL ' + String(e.stderr || e.message).slice(0, 3000));
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { force: true });
}

// 殘留檢查
const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
const ENV = loadDevEnv();
const db = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const q = async (t, col, like) => (await db.from(t).select('*', { count: 'exact', head: true }).like(col, like)).count;
  const left = [
    await q('store_employees', 'employee_code', 'FKF9998%'), await q('employee_movement_history', 'employee_code', 'FKF9998%'),
    await q('pharmacist_monthly_snapshot', 'year_month', '2098-%'), await q('pharmacist_snapshot_locks', 'year_month', '2098-%'),
  ];
  const bak = await db.from('pharm_onboard_bak_store_employees').select('*').limit(1);
  console.log('  residue (employees, movements, snapshots, locks): ' + left.join(', ') + ' | backup table exists after rollback: ' + (bak.error ? 'no' : 'YES'));
  if (left.some(Boolean) || !bak.error) process.exitCode = 1;
  console.log(process.exitCode ? 'FAILED' : 'ALL PASSED');
})();
