const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function findMigrationBySuffix(suffix) {
  const migrationDir = path.join(root, 'supabase', 'migrations');
  if (!fs.existsSync(migrationDir)) return null;
  const match = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(suffix))
    .sort()
    .at(-1);
  return match ? path.join('supabase', 'migrations', match) : null;
}

function normalizeSql(value) {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourcePath = 'supabase/migration_general_affairs_inventory_transactions_foundation.sql';
const migrationPath = findMigrationBySuffix('_general_affairs_inventory_transactions_foundation.sql');
const rollbackPath = 'supabase/rollback_general_affairs_inventory_transactions_foundation.sql';
const testSqlPath = 'supabase/test_general_affairs_inventory_transactions_foundation.sql';
const catalogSqlPath = 'supabase/verify_general_affairs_inventory_transactions_catalog.sql';
const appliedMigrationPath = 'supabase/migrations/20260722065952_general_affairs_inventory_transactions_foundation.sql';
const appliedSequenceGrantFixPath = 'supabase/migrations/20260722091526_revoke_inventory_transaction_sequence_grants.sql';
const appliedFunctionGrantFixPath = 'supabase/migrations/20260722092849_restrict_inventory_transaction_function_execute_grants.sql';
const sequenceGrantFixPath = findMigrationBySuffix('_revoke_inventory_transaction_sequence_grants.sql');
const functionGrantFixPath = findMigrationBySuffix('_restrict_inventory_transaction_function_execute_grants.sql');
const conflictAmbiguityFixPath = findMigrationBySuffix('_fix_inventory_balance_upsert_conflict_ambiguity.sql');

const postTransactionSignature = 'public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB)';
const balanceUniqueConstraint = 'ga_inventory_balances_location_part_unique';

assert(exists(sourcePath), 'source migration missing');
assert(migrationPath, 'standard migration missing');
assert(exists(rollbackPath), 'rollback SQL missing');
assert(exists(testSqlPath), 'test SQL missing');
assert(exists(catalogSqlPath), 'catalog verification SQL missing');
assert(exists(appliedMigrationPath), 'applied Task 1C-2B migration missing');
assert(exists(appliedSequenceGrantFixPath), 'applied sequence grant fix migration missing');
assert(exists(appliedFunctionGrantFixPath), 'applied function grant fix migration missing');
assert(sequenceGrantFixPath, 'sequence grant forward fix migration missing');
assert(functionGrantFixPath, 'function grant forward fix migration missing');
assert(conflictAmbiguityFixPath, 'balance upsert conflict ambiguity forward fix migration missing');

const source = read(sourcePath);
const migration = read(migrationPath);
const rollback = read(rollbackPath);
const testSql = read(testSqlPath);
const catalogSql = read(catalogSqlPath);
const appliedMigration = read(appliedMigrationPath);
const appliedSequenceGrantFix = read(appliedSequenceGrantFixPath);
const appliedFunctionGrantFix = read(appliedFunctionGrantFixPath);
const sequenceGrantFix = read(sequenceGrantFixPath);
const functionGrantFix = read(functionGrantFixPath);
const conflictAmbiguityFix = read(conflictAmbiguityFixPath);
const normalizedSource = normalizeSql(source);
const normalizedMigration = normalizeSql(migration);

assert(normalizedMigration === normalizeSql(appliedMigration), 'standard applied migration file must remain unchanged');
assert(!appliedMigration.includes('REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM anon'), 'applied migration must not be edited with forward-fix anon revoke');
assert(!appliedMigration.includes('REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM authenticated'), 'applied migration must not be edited with forward-fix authenticated revoke');
assert(!appliedMigration.includes('REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM anon'), 'applied migration must not be edited with forward-fix helper anon revoke');
assert(!appliedMigration.includes('REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM authenticated'), 'applied migration must not be edited with forward-fix helper authenticated revoke');
assert(!appliedSequenceGrantFix.includes('ga_next_inventory_transaction_no'), 'applied sequence grant fix must not be edited with function grant changes');
assert(appliedMigration.includes('ON CONFLICT (location_id, part_id) DO NOTHING;'), 'applied base migration should remain unchanged before ambiguity forward fix');
assert(!appliedFunctionGrantFix.includes(balanceUniqueConstraint), 'applied function grant fix must not be edited with ambiguity fix');

[
  'general_affairs.inventory_balance.view',
  'general_affairs.inventory_transaction.view',
  'general_affairs.inventory_transaction.manage',
  'ga_inventory_balances',
  'ga_inventory_transactions',
  'ga_inventory_transaction_no_seq',
  'ga_next_inventory_transaction_no',
  'ga_inventory_balance_is_visible',
  'ga_inventory_transaction_is_visible',
  'ga_prevent_inventory_transaction_mutation',
  'ga_post_inventory_transaction',
  'Task 1C-2B inventory transaction migration prerequisites missing',
  'public.ga_inventory_locations from Task 1C-1',
  'public.ga_inventory_location_parts from Task 1C-1',
  'public.ga_parts from Task 1B-3',
  'SET search_path = public, pg_temp',
  'SECURITY DEFINER',
  'auth.uid()',
  'current_user_has_permission',
].forEach((needle) => assert(migration.includes(needle), `migration missing ${needle}`));

[
  'quantity_base NUMERIC(18,4)',
  'last_transaction_id UUID',
  'last_transaction_at TIMESTAMPTZ',
  'version BIGINT NOT NULL DEFAULT 0',
  'ga_inventory_balances_location_part_unique',
  'ga_inventory_balances_last_transaction_pair',
  'fk_ga_inventory_balances_last_transaction',
  'transaction_no TEXT NOT NULL',
  'transaction_type TEXT NOT NULL',
  'quantity_input NUMERIC(18,4) NOT NULL',
  'unit_conversion_rate NUMERIC(18,6) NOT NULL',
  'idempotency_key TEXT',
  'idempotency_payload_hash TEXT',
  'metadata JSONB NOT NULL DEFAULT',
  'ga_inventory_transactions_balance_math',
  'ga_inventory_transactions_idempotency_pair',
].forEach((needle) => assert(migration.includes(needle), `schema missing ${needle}`));

[
  'RECEIPT',
  'ISSUE',
  'ADJUST_IN',
  'ADJUST_OUT',
  'BASE',
  'PURCHASE',
  "quantity_input > 0",
  "unit_conversion_rate > 0",
  "quantity_base <> 0",
  "jsonb_typeof(metadata) = 'object'",
].forEach((needle) => assert(migration.includes(needle), `constraint missing ${needle}`));

[
  'uq_ga_inventory_transactions_idempotency_active',
  'idx_ga_inventory_balances_location',
  'idx_ga_inventory_balances_part',
  'idx_ga_inventory_transactions_occurred_at',
  'idx_ga_inventory_transactions_location_occurred',
  'idx_ga_inventory_transactions_part_occurred',
  'idx_ga_inventory_transactions_reference',
].forEach((needle) => assert(migration.includes(needle), `index missing ${needle}`));

assert(migration.includes("RETURN 'INV-' || lpad(v_next::TEXT, 12, '0')"), 'transaction number format must be fixed and sortable');
assert(!/MAX\s*\(\s*transaction_no\s*\)/i.test(migration), 'transaction number must not use MAX(transaction_no)');
assert(migration.includes('CREATE SEQUENCE IF NOT EXISTS public.ga_inventory_transaction_no_seq'), 'transaction sequence missing');
assert(migration.includes('REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM PUBLIC'), 'sequence must not be directly granted');
assert(source.includes('REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM PUBLIC'), 'source must revoke sequence grants from PUBLIC');
assert(source.includes('REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM anon'), 'source must revoke sequence grants from anon');
assert(source.includes('REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM authenticated'), 'source must revoke sequence grants from authenticated');
assert(!/GRANT\s+.*\s+ON\s+SEQUENCE\s+public\.ga_inventory_transaction_no_seq\s+TO\s+(anon|authenticated)/i.test(source), 'source must not grant sequence usage to anon/authenticated');
assert(!source.includes('ON CONFLICT (location_id, part_id) DO NOTHING;'), 'source must not contain ambiguous balance ON CONFLICT target');
assert(source.includes(`ON CONFLICT ON CONSTRAINT ${balanceUniqueConstraint} DO NOTHING;`), 'source must use balance unique constraint for ON CONFLICT');

const normalizedFix = normalizeSql(sequenceGrantFix);
assert(
  normalizedFix === [
    'REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM PUBLIC;',
    'REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM anon;',
    'REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM authenticated;',
  ].join('\n'),
  'forward fix migration must only revoke sequence grants',
);
assert(!/CREATE\s+|ALTER\s+|DROP\s+|GRANT\s+/i.test(sequenceGrantFix), 'forward fix migration must not contain schema changes or grants');

const normalizedFunctionFix = normalizeSql(functionGrantFix);
assert(
  normalizedFunctionFix === [
    'REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM PUBLIC;',
    'REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM anon;',
    'REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM authenticated;',
    '',
    `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM PUBLIC;`,
    `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM anon;`,
    `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM authenticated;`,
    `GRANT EXECUTE ON FUNCTION ${postTransactionSignature} TO authenticated;`,
  ].join('\n'),
  'function grant forward fix migration must only contain exact function revoke/grant statements',
);
assert(!/CREATE\s+|ALTER\s+|DROP\s+|ON\s+TABLE|ON\s+SEQUENCE|CREATE\s+POLICY|DROP\s+POLICY/i.test(functionGrantFix), 'function grant forward fix must not contain schema/table/RLS/sequence changes');

const normalizedConflictFix = normalizeSql(conflictAmbiguityFix);
[
  "to_regprocedure(\n    'public.ga_post_inventory_transaction(text, uuid, uuid, numeric, text, text, text, text, uuid, text, timestamp with time zone, jsonb)'",
  'pg_get_functiondef(v_function_oid)',
  "v_ambiguous_clause TEXT := 'ON CONFLICT (' || 'location_id, part_id' || ') DO NOTHING;'",
  `'ON CONFLICT ON CONSTRAINT ${balanceUniqueConstraint} DO NOTHING;'`,
  'EXECUTE v_updated_sql;',
  `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM anon;`,
  `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM authenticated;`,
  `GRANT EXECUTE ON FUNCTION ${postTransactionSignature} TO authenticated;`,
].forEach((needle) => assert(conflictAmbiguityFix.includes(needle), `ambiguity forward fix missing ${needle}`));
assert(!conflictAmbiguityFix.includes('ON CONFLICT (location_id, part_id) DO NOTHING;'), 'ambiguity forward fix must not contain the raw ambiguous conflict clause');
assert(!/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX|CREATE\s+POLICY|DROP\s+POLICY|ON\s+SEQUENCE|ga_next_inventory_transaction_no/i.test(conflictAmbiguityFix), 'ambiguity forward fix must not contain table/index/RLS/sequence/helper changes');
assert(!normalizedConflictFix.includes('CREATE OR REPLACE FUNCTION public.ga_next_inventory_transaction_no'), 'ambiguity forward fix must not redefine helper');

[
  'REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM PUBLIC',
  'REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM anon',
  'REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM authenticated',
  `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM anon`,
  `REVOKE ALL ON FUNCTION ${postTransactionSignature} FROM authenticated`,
  `GRANT EXECUTE ON FUNCTION ${postTransactionSignature} TO authenticated`,
].forEach((needle) => assert(source.includes(needle), `source must include function grant control: ${needle}`));
assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.ga_next_inventory_transaction_no\(\)\s+TO\s+(anon|authenticated)/i.test(source), 'source must not grant helper execute to anon/authenticated');
assert(!new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${postTransactionSignature.replace(/[().]/g, '\\$&').replace(/ /g, '\\s+')}\\s+TO\\s+anon`, 'i').test(source), 'source must not grant post RPC execute to anon');

[
  'p_transaction_type TEXT',
  'p_location_id UUID',
  'p_part_id UUID',
  'p_quantity NUMERIC',
  'p_input_unit_type TEXT',
  'p_reason TEXT',
  'p_idempotency_key TEXT DEFAULT NULL',
  'p_occurred_at TIMESTAMPTZ DEFAULT NULL',
  'p_metadata JSONB DEFAULT',
  'idempotent_replay BOOLEAN',
].forEach((needle) => assert(migration.includes(needle), `RPC signature/return missing ${needle}`));

[
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'PART_VIEW_REQUIRED',
  'LOCATION_NOT_FOUND',
  'LOCATION_INACTIVE',
  'PART_NOT_FOUND',
  'PART_INACTIVE',
  'LOCATION_PART_NOT_CONFIGURED',
  'INVALID_TRANSACTION_TYPE',
  'INVALID_UNIT_TYPE',
  'INVALID_PURCHASE_UNIT',
  'INVALID_QUANTITY',
  'FRACTIONAL_NOT_ALLOWED',
  'MINIMUM_ISSUE_NOT_MET',
  'UNPACKING_NOT_ALLOWED',
  'INSUFFICIENT_STOCK',
  'IDEMPOTENCY_CONFLICT',
].forEach((needle) => assert(migration.includes(needle), `RPC error code missing ${needle}`));

assert(migration.includes("current_user_has_permission('general_affairs.inventory_transaction.manage')"), 'RPC must require transaction.manage');
assert(migration.includes("current_user_has_permission('general_affairs.part.view')"), 'RPC must require part.view/manage');
assert(migration.includes('FROM public.ga_inventory_location_parts lp'), 'RPC must check location part setting');
assert(migration.includes('lp.is_active = true'), 'RPC must require active location part setting');
assert(migration.includes('lp.deleted_at IS NULL'), 'RPC must require undeleted location part setting');
assert(migration.includes('v_rate := 1'), 'BASE unit must use rate 1');
assert(migration.includes('v_part.purchase_to_base_rate'), 'PURCHASE unit must use part purchase_to_base_rate');
assert(migration.includes('round(v_abs_base_unrounded, 4)'), 'RPC must define 4 decimal conversion behavior');
assert(migration.includes('v_abs_base <> v_abs_base_unrounded'), 'RPC must reject conversion precision overflow');
assert(migration.includes('v_abs_base <> trunc(v_abs_base)'), 'RPC must enforce fractional restriction');
assert(migration.includes('v_part.minimum_issue_qty'), 'RPC must enforce minimum issue quantity');
assert(migration.includes('mod(v_abs_base, v_part.purchase_to_base_rate) <> 0'), 'RPC must enforce no-unpacking package multiple');
assert(migration.includes('v_location.allow_negative_stock'), 'RPC must check negative stock policy');
assert(migration.includes('pg_advisory_xact_lock'), 'RPC must use advisory lock');
assert(migration.includes('hashtextextended'), 'RPC must document stable advisory lock key strategy');
assert(migration.includes('FOR UPDATE'), 'RPC must lock balance row FOR UPDATE');
assert(migration.includes('ON CONFLICT (location_id, part_id) DO NOTHING'), 'RPC must create balance safely');
assert(migration.includes('md5(v_payload::TEXT)'), 'RPC must compute DB-side idempotency payload hash');
assert(migration.includes("'occurred_at', p_occurred_at"), 'idempotency hash must use input occurred_at, preserving NULL retry semantics');
assert(migration.includes('COALESCE(p_metadata'), 'idempotency hash must normalize metadata');
assert(migration.includes('RETURN QUERY'), 'RPC must return transaction and balance data');

assert(migration.includes('BEFORE UPDATE OR DELETE ON public.ga_inventory_transactions'), 'append-only trigger must block UPDATE and DELETE');
assert(migration.includes('INVENTORY_TRANSACTION_IMMUTABLE'), 'append-only error code missing');
assert(!migration.includes('FOR INSERT TO authenticated'), 'must not create direct insert policies');
assert(!migration.includes('FOR UPDATE TO authenticated'), 'must not create direct update policies');
assert(!migration.includes('FOR DELETE TO authenticated'), 'must not create direct delete policies');
assert(migration.includes('GRANT SELECT ON TABLE public.ga_inventory_balances TO authenticated'), 'authenticated needs balance SELECT only');
assert(migration.includes('GRANT SELECT ON TABLE public.ga_inventory_transactions TO authenticated'), 'authenticated needs transaction SELECT only');
assert(migration.includes('GRANT EXECUTE ON FUNCTION public.ga_post_inventory_transaction'), 'authenticated needs RPC execute');
assert(migration.includes('SECURITY DEFINER'), 'helper/RPC SECURITY DEFINER settings must remain');
assert(migration.includes('SET search_path = public, pg_temp'), 'helper/RPC search_path settings must remain');

assert(migration.includes('ALTER TABLE public.ga_inventory_balances ENABLE ROW LEVEL SECURITY'), 'balances RLS missing');
assert(migration.includes('ALTER TABLE public.ga_inventory_transactions ENABLE ROW LEVEL SECURITY'), 'transactions RLS missing');
assert(migration.includes('ga_inventory_balance_is_visible(location_id)'), 'balance RLS must use visibility helper');
assert(migration.includes('ga_inventory_transaction_is_visible(location_id)'), 'transaction RLS must use visibility helper');
assert(migration.includes("current_user_has_permission('general_affairs.inventory_balance.view')"), 'balance RLS must use balance.view');
assert(migration.includes("current_user_has_permission('general_affairs.inventory_transaction.view')"), 'transaction RLS must use transaction.view');
assert(migration.includes('current_user_manages_store(l.store_id)'), 'store_manager visibility must be scoped by store');

[
  'ga_inventory_transactions',
  'ga_inventory_balances',
  'ga_inventory_transaction_no_seq',
  'ga_post_inventory_transaction',
  'fk_ga_inventory_balances_last_transaction',
  'DELETE FROM role_permissions',
  'DELETE FROM permissions',
].forEach((needle) => assert(rollback.includes(needle), `rollback missing ${needle}`));
assert(rollback.indexOf('DROP POLICY') < rollback.indexOf('DROP TRIGGER'), 'rollback should drop policies before triggers');
assert(rollback.indexOf('fk_ga_inventory_balances_last_transaction') < rollback.indexOf('DROP TABLE IF EXISTS public.ga_inventory_transactions'), 'rollback must drop circular FK before tables');
assert(!rollback.includes('DROP TABLE IF EXISTS public.ga_inventory_locations'), 'rollback must not drop Task 1C-1 locations');
assert(!rollback.includes('DROP TABLE IF EXISTS public.ga_inventory_location_parts'), 'rollback must not drop Task 1C-1 location parts');
assert(!rollback.includes('DROP TABLE IF EXISTS public.ga_parts'), 'rollback must not drop parts');
assert(!rollback.includes('DROP TABLE IF EXISTS public.stores'), 'rollback must not drop stores');

[
  '權限碼確認',
  'direct_write_policy_count',
  'ga_next_inventory_transaction_no',
  'ga_post_inventory_transaction',
  '入庫首次建立 balance/version',
  '第二次入庫更新 balance/version',
  'ISSUE 扣減',
  'ADJUST_IN',
  'ADJUST_OUT',
  'purchase receipt converts to base',
  'purchase without unit rejected',
  'fractional issue false rejected',
  'minimum issue below threshold rejected',
  'allow unpacking false partial package rejected',
  'purchase rate without unit rejected by constraints',
  '不允許負庫存',
  'allow_negative_stock=true',
  'idempotency 同 key 同 payload',
  'idempotency 不同 payload',
  'invalid transaction type',
  'invalid input unit',
  'invalid quantity',
  'negative quantity rejected',
  'null reason rejected',
  'blank reason',
  'metadata 非 object',
  'metadata string rejected',
  'metadata number rejected',
  'reference id without type rejected',
  'blank idempotency key normalized',
  'notes and reference type blank normalized',
  'inactive location',
  'deleted location rejected',
  'inactive part rejected',
  'deleted part rejected',
  'missing location part rejected',
  'deleted location part rejected',
  'inactive location part',
  'transaction UPDATE',
  'transaction DELETE',
  'direct write policies absent',
  'anon authenticated write grants absent',
  'rpc signature rejects system fields',
  'numeric precision overflow rejected',
  'balance last_transaction_id',
  'DEV 測試資料清理',
  '併發驗收需以獨立動態測試',
].forEach((needle) => assert(testSql.includes(needle), `test SQL missing coverage ${needle}`));

[
  'unsafe_sequence_usage_grant_count',
  'unsafe_helper_execute_grant_count',
  'unsafe_post_rpc_execute_grant_count',
  'authenticated_post_rpc_execute_grant_count',
  "pg_get_function_identity_arguments(p.oid) = ''",
  "pg_get_function_identity_arguments(p.oid) = 'p_transaction_type text, p_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text, p_reason text, p_notes text, p_reference_type text, p_reference_id uuid, p_idempotency_key text, p_occurred_at timestamp with time zone, p_metadata jsonb'",
  'aclexplode',
].forEach((needle) => assert(catalogSql.includes(needle), `catalog SQL missing exact grant verification ${needle}`));

assert(!/ga_inventory_transactions_foundation[\s\S]*Task 1C-3/i.test(migration), 'migration must not include Task 1C-3');
[
  /CREATE\s+TABLE[\s\S]+ga_inventory_transfers/i,
  /CREATE\s+TABLE[\s\S]+ga_inventory_stocktakes/i,
  /CREATE\s+TABLE[\s\S]+ga_.*purchase/i,
  /ALTER\s+TABLE[\s\S]+work_orders?/i,
  /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[\s\S]+reversal/i,
  /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[\s\S]+repair_balance/i,
].forEach((forbiddenPattern) => {
  assert(!forbiddenPattern.test(migration), `migration must not include forbidden future scope: ${forbiddenPattern}`);
});

console.log('General affairs inventory transactions foundation static checks passed.');
console.log(`Source SHA-256: ${sha256(normalizedSource)}`);
console.log(`Migration SHA-256: ${sha256(normalizedMigration)}`);
console.log(`Migration file: ${migrationPath}`);
