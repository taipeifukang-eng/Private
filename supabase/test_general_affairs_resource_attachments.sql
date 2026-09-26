-- Catalog verification for General Affairs Resource Attachments Foundation.
-- This file is read-only catalog validation. It does not upload files or insert test rows.

WITH required_tables(table_name) AS (
  VALUES ('ga_resource_attachments')
)
SELECT
  'tables' AS check_name,
  table_name,
  to_regclass('public.' || table_name) IS NOT NULL AS passed
FROM required_tables
ORDER BY table_name;

SELECT
  'bucket' AS check_name,
  id,
  public = false AS private_bucket,
  file_size_limit = 20971520 AS file_size_limit_ok
FROM storage.buckets
WHERE id = 'general-affairs-attachments';

WITH required_functions(proname) AS (
  VALUES
    ('ga_resource_attachment_can_read'),
    ('ga_resource_attachment_can_manage'),
    ('ga_validate_resource_attachment'),
    ('ga_soft_delete_resource_attachment')
)
SELECT
  'functions' AS check_name,
  rf.proname,
  p.prosecdef AS security_definer,
  p.proconfig::text LIKE '%search_path=public, pg_temp%' AS search_path_ok
FROM required_functions rf
LEFT JOIN pg_proc p ON p.proname = rf.proname
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
ORDER BY rf.proname;

SELECT
  'rls' AS check_name,
  relname,
  relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname = 'ga_resource_attachments';

SELECT
  'policies' AS check_name,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'ga_resource_attachments'
ORDER BY policyname;

SELECT
  'delete_policy_count' AS check_name,
  count(*) AS count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'ga_resource_attachments'
  AND cmd = 'DELETE';

SELECT
  'table_grants' AS check_name,
  grantee,
  privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name = 'ga_resource_attachments'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

SELECT
  'soft_delete_rpc_grants' AS check_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'ga_soft_delete_resource_attachment'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY grantee, privilege_type;

SELECT
  'visibility_helper_grants' AS check_name,
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'ga_resource_attachment_can_read',
    'ga_resource_attachment_can_manage'
  )
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY routine_name, grantee, privilege_type;

SELECT
  'unsafe_visibility_helper_grant_count' AS check_name,
  count(*) AS count
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'ga_resource_attachment_can_read',
    'ga_resource_attachment_can_manage'
  )
  AND grantee IN ('anon', 'PUBLIC');

SELECT
  'storage_policy' AS check_name,
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname = 'ga_resource_attachments_storage_service_role_all';
