-- ============================================================
-- Task 1C-2B Catalog Verification SQL
-- Read-only. DEV/STAGING only unless explicitly approved.
-- ============================================================

-- A. Permission codes
SELECT code, module, feature, action, is_active
FROM public.permissions
WHERE code IN (
  'general_affairs.inventory_balance.view',
  'general_affairs.inventory_transaction.view',
  'general_affairs.inventory_transaction.manage'
)
ORDER BY code;

-- B. Tables and RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
ORDER BY tablename;

-- C. Sequence / functions
SELECT sequence_schema, sequence_name
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name = 'ga_inventory_transaction_no_seq';

SELECT
  p.proname,
  p.prosecdef,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ga_next_inventory_transaction_no',
    'ga_post_inventory_transaction',
    'ga_prevent_inventory_transaction_mutation',
    'ga_inventory_balance_is_visible',
    'ga_inventory_transaction_is_visible'
  )
ORDER BY p.proname;

-- D. Triggers
SELECT
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'ga_inventory_transactions'
ORDER BY trigger_name, event_manipulation;

-- E. Constraints / indexes
SELECT conrelid::regclass AS table_name, conname, contype
FROM pg_constraint
WHERE conrelid IN (
  'public.ga_inventory_balances'::regclass,
  'public.ga_inventory_transactions'::regclass
)
ORDER BY 1, conname;

SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
ORDER BY tablename, indexname;

-- F. RLS policies: should be SELECT only
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
ORDER BY tablename, policyname;

SELECT count(*) AS direct_write_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

-- G. Grants
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('ga_inventory_balances', 'ga_inventory_transactions')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'ga_next_inventory_transaction_no',
    'ga_post_inventory_transaction',
    'ga_inventory_balance_is_visible',
    'ga_inventory_transaction_is_visible'
  )
  AND grantee IN ('anon', 'authenticated')
ORDER BY routine_name, grantee, privilege_type;

SELECT grantee, object_name, privilege_type
FROM information_schema.usage_privileges
WHERE object_schema = 'public'
  AND object_name = 'ga_inventory_transaction_no_seq'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

SELECT count(*) AS unsafe_sequence_usage_grant_count
FROM information_schema.usage_privileges
WHERE object_schema = 'public'
  AND object_name = 'ga_inventory_transaction_no_seq'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated');

-- H. Exact function EXECUTE grants.
-- Expected:
-- - helper: PUBLIC / anon / authenticated have no EXECUTE
-- - post RPC: PUBLIC / anon have no EXECUTE; authenticated has EXECUTE
WITH target_functions AS (
  SELECT 'helper' AS function_key, p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ga_next_inventory_transaction_no'
    AND pg_get_function_identity_arguments(p.oid) = ''

  UNION ALL

  SELECT 'post_rpc' AS function_key, p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ga_post_inventory_transaction'
    AND pg_get_function_identity_arguments(p.oid) = 'p_transaction_type text, p_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text, p_reason text, p_notes text, p_reference_type text, p_reference_id uuid, p_idempotency_key text, p_occurred_at timestamp with time zone, p_metadata jsonb'
),
function_execute_grants AS (
  SELECT
    tf.function_key,
    COALESCE(r.rolname, 'PUBLIC') AS grantee,
    acl.privilege_type
  FROM target_functions tf
  JOIN pg_proc p ON p.oid = tf.oid
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  LEFT JOIN pg_roles r ON r.oid = acl.grantee
  WHERE acl.privilege_type = 'EXECUTE'
)
SELECT function_key, grantee, privilege_type
FROM function_execute_grants
WHERE grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY function_key, grantee, privilege_type;

WITH target_functions AS (
  SELECT 'helper' AS function_key, p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ga_next_inventory_transaction_no'
    AND pg_get_function_identity_arguments(p.oid) = ''

  UNION ALL

  SELECT 'post_rpc' AS function_key, p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ga_post_inventory_transaction'
    AND pg_get_function_identity_arguments(p.oid) = 'p_transaction_type text, p_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text, p_reason text, p_notes text, p_reference_type text, p_reference_id uuid, p_idempotency_key text, p_occurred_at timestamp with time zone, p_metadata jsonb'
),
function_execute_grants AS (
  SELECT
    tf.function_key,
    COALESCE(r.rolname, 'PUBLIC') AS grantee,
    acl.privilege_type
  FROM target_functions tf
  JOIN pg_proc p ON p.oid = tf.oid
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  LEFT JOIN pg_roles r ON r.oid = acl.grantee
  WHERE acl.privilege_type = 'EXECUTE'
)
SELECT
  count(*) FILTER (
    WHERE function_key = 'helper'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) AS unsafe_helper_execute_grant_count,
  count(*) FILTER (
    WHERE function_key = 'post_rpc'
      AND grantee IN ('PUBLIC', 'anon')
  ) AS unsafe_post_rpc_execute_grant_count,
  count(*) FILTER (
    WHERE function_key = 'post_rpc'
      AND grantee = 'authenticated'
  ) AS authenticated_post_rpc_execute_grant_count
FROM function_execute_grants;
