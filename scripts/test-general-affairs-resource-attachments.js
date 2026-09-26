const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const standardMigrationPath = 'supabase/migrations/20260729125755_general_affairs_resource_attachments.sql';
const sourceMigrationPath = 'supabase/migration_general_affairs_resource_attachments.sql';
const rollbackPath = 'supabase/rollback_general_affairs_resource_attachments.sql';
const catalogTestPath = 'supabase/test_general_affairs_resource_attachments.sql';
const attachmentsApiPath = 'app/api/general-affairs/attachments/route.ts';
const attachmentDeleteApiPath = 'app/api/general-affairs/attachments/[id]/route.ts';
const attachmentPanelPath = 'components/general-affairs/attachments/ResourceAttachmentPanel.tsx';
const helperGrantFixPath = 'supabase/migrations/20260730010048_grant_resource_attachment_visibility_helpers.sql';
const partAttachmentFixPath = 'supabase/migrations/20260810090000_allow_part_resource_attachments.sql';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function normalizeSql(content) {
  return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function sha256(content) {
  return crypto.createHash('sha256').update(normalizeSql(content)).digest('hex').toUpperCase();
}

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`${label}: missing "${needle}"`);
}

function assertNotIncludes(content, needle, label) {
  if (content.includes(needle)) throw new Error(`${label}: must not include "${needle}"`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertMatch(content, regex, label) {
  if (!regex.test(content)) throw new Error(`${label}: pattern not found ${regex}`);
}

function pass(label) {
  console.log(`PASS ${label}`);
}

for (const file of [
  standardMigrationPath,
  sourceMigrationPath,
  rollbackPath,
  catalogTestPath,
  attachmentsApiPath,
  attachmentDeleteApiPath,
  attachmentPanelPath,
  helperGrantFixPath,
  partAttachmentFixPath,
]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`missing file ${file}`);
}
pass('attachment foundation files exist');

const standardMigration = read(standardMigrationPath);
const sourceMigration = read(sourceMigrationPath);
const rollback = read(rollbackPath);
const catalogTest = read(catalogTestPath);
const attachmentsApi = read(attachmentsApiPath);
const attachmentDeleteApi = read(attachmentDeleteApiPath);
const attachmentPanel = read(attachmentPanelPath);
const helperGrantFix = read(helperGrantFixPath);
const partAttachmentFix = read(partAttachmentFixPath);

assertIncludes(standardMigration, 'REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon, authenticated', 'applied migration keeps original helper revoke');
assertNotIncludes(standardMigration, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated', 'already-applied attachment migration must remain immutable');
assert(sha256(sourceMigration) !== sha256(standardMigration), 'flat source should differ from already-applied migration after forward fix sync');
pass('applied migration is immutable and flat source is forward-fixed');

assertIncludes(standardMigration, "INSERT INTO storage.buckets", 'storage bucket creation');
assertIncludes(standardMigration, "'general-affairs-attachments'", 'storage bucket name');
assertIncludes(standardMigration, 'CREATE TABLE IF NOT EXISTS public.ga_resource_attachments', 'attachment table');
assertIncludes(standardMigration, "to_regprocedure('public.current_user_has_permission(character varying)')", 'RBAC prerequisite signature');
assertNotIncludes(standardMigration, "to_regprocedure('public.current_user_has_permission(text)')", 'RBAC prerequisite must not use text signature');
assertIncludes(standardMigration, "resource_type IN ('EQUIPMENT', 'FACILITY', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE')", 'resource types');
assertIncludes(standardMigration, 'storage_path !~*', 'safe relative storage path');
assertIncludes(standardMigration, "storage_path LIKE lower(resource_type) || '/%'", 'resource path scope');
assertIncludes(standardMigration, 'size_bytes > 0 AND size_bytes <= 20971520', 'file size constraint');
assertIncludes(standardMigration, "content_type IN", 'content type constraint');
assertIncludes(standardMigration, 'jsonb_typeof(metadata) = \'object\'', 'metadata object constraint');
pass('table and storage path constraints');

for (const fn of [
  'public.ga_resource_attachment_can_read',
  'public.ga_resource_attachment_can_manage',
  'public.ga_validate_resource_attachment',
  'public.ga_soft_delete_resource_attachment',
]) {
  assertIncludes(standardMigration, `CREATE OR REPLACE FUNCTION ${fn}`, `${fn} definition`);
}
assertMatch(standardMigration, /SECURITY DEFINER\s+SET search_path = public, pg_temp/g, 'security definer search_path');
assertIncludes(standardMigration, "public.current_user_has_permission('general_affairs.equipment.manage')", 'equipment manage permission');
assertIncludes(standardMigration, "public.current_user_has_permission('general_affairs.facility.manage')", 'facility manage permission');
assertIncludes(standardMigration, "public.current_user_has_permission('general_affairs.maintenance_request.create')", 'maintenance create permission');
assertIncludes(standardMigration, 'mr.reported_by = auth.uid()', 'maintenance requester ownership');
assertIncludes(standardMigration, 'sm.user_id = auth.uid()', 'store manager scope');
pass('helper and RPC security');

assertIncludes(standardMigration, 'ALTER TABLE public.ga_resource_attachments ENABLE ROW LEVEL SECURITY', 'RLS enabled');
assertIncludes(standardMigration, 'CREATE POLICY ga_resource_attachments_read', 'read policy');
assertIncludes(standardMigration, 'CREATE POLICY ga_resource_attachments_insert', 'insert policy');
assertNotIncludes(standardMigration, 'FOR DELETE TO authenticated', 'no delete policy');
assertIncludes(standardMigration, 'GRANT SELECT, INSERT ON TABLE public.ga_resource_attachments TO authenticated', 'authenticated table grants');
assertIncludes(standardMigration, 'GRANT EXECUTE ON FUNCTION public.ga_soft_delete_resource_attachment(UUID, TEXT) TO authenticated', 'soft delete RPC grant');
assertIncludes(standardMigration, 'CREATE POLICY ga_resource_attachments_storage_service_role_all', 'storage service role policy');
assertNotIncludes(standardMigration, 'TO anon', 'no explicit anon table/function grant');
pass('RLS policies and grants');

assertIncludes(sourceMigration, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) TO authenticated', 'flat source grants read helper to authenticated');
assertIncludes(sourceMigration, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated', 'flat source grants manage helper to authenticated');
assertIncludes(helperGrantFix, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) TO authenticated', 'forward fix grants read helper to authenticated');
assertIncludes(helperGrantFix, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated', 'forward fix grants manage helper to authenticated');
assertIncludes(helperGrantFix, 'REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) FROM PUBLIC, anon', 'forward fix keeps read helper closed to anon');
assertIncludes(helperGrantFix, 'REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon', 'forward fix keeps manage helper closed to anon');
assertIncludes(partAttachmentFix, "CHECK (resource_type IN ('EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE'))", 'part attachment forward fix allows PART');
assertIncludes(partAttachmentFix, 'ALTER TABLE public.ga_resource_attachments', 'part attachment forward fix updates constraint');
assertIncludes(partAttachmentFix, 'DROP CONSTRAINT IF EXISTS ga_resource_attachments_resource_type_check', 'part attachment forward fix replaces resource type constraint safely');
assertIncludes(partAttachmentFix, 'CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_read', 'part attachment forward fix updates read helper');
assertIncludes(partAttachmentFix, 'CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage', 'part attachment forward fix updates manage helper');
assertIncludes(partAttachmentFix, "public.current_user_has_permission('general_affairs.part.view')", 'part attachment forward fix includes part view read permission');
assertIncludes(partAttachmentFix, "public.current_user_has_permission('general_affairs.part.manage')", 'part attachment forward fix includes part manage permission');
assertIncludes(partAttachmentFix, 'FROM public.ga_parts p', 'part attachment forward fix checks ga_parts existence');
assertIncludes(partAttachmentFix, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated', 'part attachment forward fix keeps authenticated helper grant');
assertNotIncludes(partAttachmentFix, 'CREATE TABLE', 'part attachment forward fix must not create tables');
assertNotIncludes(partAttachmentFix, 'CREATE POLICY', 'part attachment forward fix must not change RLS policies');
assertNotIncludes(partAttachmentFix, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO anon', 'part attachment forward fix must not grant anon');
assertNotIncludes(helperGrantFix, 'CREATE TABLE', 'forward fix must not create tables');
assertNotIncludes(helperGrantFix, 'CREATE POLICY', 'forward fix must not change RLS policies');
assertNotIncludes(helperGrantFix, 'GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO anon', 'forward fix must not grant anon');
pass('attachment visibility helper grant forward fix');

[
  'EQUIPMENT',
  'FACILITY',
  'PART',
  'MAINTENANCE_REQUEST',
  'MAINTENANCE_UPDATE',
  'SERVICE_REQUEST',
  'SERVICE_REQUEST_COMMENT',
].forEach((resourceType) => {
  assertIncludes(attachmentsApi, `'${resourceType}'`, `upload API accepts ${resourceType} attachment resource type`);
  assertIncludes(attachmentPanel, `'${resourceType}'`, `attachment panel accepts ${resourceType} attachment resource type`);
});
assertIncludes(attachmentsApi, 'createAdminClient', 'upload API uses admin storage client');
assertIncludes(attachmentsApi, 'await supabase.auth.getUser()', 'upload API requires auth');
assertIncludes(attachmentsApi, ".from('ga_resource_attachments')", 'upload API writes metadata through authenticated client');
assertIncludes(attachmentsApi, 'createSignedUrls', 'download signed URL API');
assertIncludes(attachmentsApi, 'MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024', 'API size validation');
assertIncludes(attachmentsApi, 'ALLOWED_CONTENT_TYPES', 'API mime validation');
assertIncludes(attachmentsApi, '總務附件儲存空間尚未建置到目前環境', 'upload API masks missing bucket');
assertIncludes(attachmentsApi, 'return 503', 'upload API returns unavailable status for missing bucket');
assertIncludes(attachmentsApi, 'function safeErrorMessage', 'upload API formats plain object errors safely');
assertNotIncludes(attachmentsApi, "String(error || '附件操作失敗')", 'upload API must not stringify plain object errors');
assertIncludes(attachmentDeleteApi, "supabase.rpc('ga_soft_delete_resource_attachment'", 'delete API uses soft delete RPC');
assertIncludes(attachmentDeleteApi, '.remove([storagePath])', 'delete API cleans storage after soft delete');
assertIncludes(attachmentDeleteApi, '總務附件儲存空間尚未建置到目前環境', 'delete API masks missing bucket');
pass('attachment APIs');

assertIncludes(attachmentPanel, 'signed_url', 'UI preview uses signed URL');
assertIncludes(attachmentPanel, 'type="file"', 'UI upload input');
assertIncludes(attachmentPanel, 'deleteAttachment', 'UI delete action');
assertIncludes(attachmentPanel, 'window.prompt', 'UI deletion reason prompt');
assertIncludes(attachmentPanel, 'JSON.parse(text)', 'UI safely parses attachment API response');
assertIncludes(attachmentPanel, 'function safeErrorMessage', 'attachment panel formats plain object errors safely');
assertNotIncludes(attachmentPanel, 'throw new Error(json.error || `附件操作失敗', 'attachment panel must not throw plain object errors directly');
assertIncludes(attachmentPanel, '檔案格式不支援', 'UI format error');
assertIncludes(attachmentPanel, '超過 20MB 限制', 'UI size error');
pass('attachment UI upload preview delete');

assertIncludes(rollback, 'DROP TABLE IF EXISTS public.ga_resource_attachments', 'rollback drops table');
assertIncludes(rollback, "DELETE FROM storage.buckets", 'rollback removes empty bucket');
assertIncludes(catalogTest, 'delete_policy_count', 'catalog test no delete policy');
assertIncludes(catalogTest, "'bucket' AS check_name", 'catalog test storage bucket');
assertIncludes(catalogTest, 'ga_resource_attachments_storage_service_role_all', 'catalog test storage policy');
assertIncludes(catalogTest, 'visibility_helper_grants', 'catalog test helper grants');
assertIncludes(catalogTest, 'unsafe_visibility_helper_grant_count', 'catalog test unsafe helper grants');
pass('rollback and catalog test');

for (const forbidden of [
  'service_role key',
  'SUPABASE_DB_PASSWORD',
  'odvksgucvfoaqrumpran',
  'mjpdfpxqttbhzeimmtqr',
  'db push',
  'migration repair',
  'CREATE TABLE public.ga_inventory_transactions',
]) {
  assertNotIncludes([standardMigration, attachmentsApi, attachmentDeleteApi, attachmentPanel].join('\n'), forbidden, `forbidden marker ${forbidden}`);
}
pass('no secrets or unrelated DB operations');

console.log('General Affairs resource attachments static tests passed');
