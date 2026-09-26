const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function findMigration(suffix) {
  const dir = path.join(root, 'supabase', 'migrations');
  return fs.readdirSync(dir).find((file) => file.endsWith(suffix));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read('supabase/migration_general_affairs_equipment_master.sql');
const rollback = read('supabase/rollback_general_affairs_equipment_master.sql');
const testSql = read('supabase/test_general_affairs_equipment_master.sql');
const assetCodeTestSql = read('supabase/test_general_affairs_equipment_asset_code_sequence.sql');
const validation = read('lib/general-affairs/equipment/validation.ts');
const access = read('lib/general-affairs/equipment/access.ts');
const equipmentListRoute = read('app/api/general-affairs/equipment/route.ts');
const equipmentItemRoute = read('app/api/general-affairs/equipment/[id]/route.ts');
const templateListRoute = read('app/api/general-affairs/equipment/templates/route.ts');
const templateItemRoute = read('app/api/general-affairs/equipment/templates/[id]/route.ts');
const templateLinkAssetsRoute = read('app/api/general-affairs/equipment/templates/[id]/link-assets/route.ts');
const catalogIdentity = read('lib/general-affairs/catalog-identity.ts');
const equipmentClient = read('components/general-affairs/equipment/EquipmentManagementClient.tsx');
const templateClient = read('components/general-affairs/equipment/EquipmentTemplatesClient.tsx');
const appliedEquipmentMigration = read('supabase/migrations/20260722030244_dev_schema_baseline.sql');
const assetCodeMigrationName = findMigration('_generate_equipment_asset_code_sequence.sql');
assert(assetCodeMigrationName, 'asset code forward migration missing');
const assetCodeMigration = read(`supabase/migrations/${assetCodeMigrationName}`);
const qrMigrationName = findMigration('_general_affairs_asset_qr_scan_tokens.sql');
assert(qrMigrationName, 'asset QR scan token migration missing');
const qrMigration = read(`supabase/migrations/${qrMigrationName}`);
const qrAutoRevokeMigrationName = findMigration('_general_affairs_asset_qr_auto_revoke.sql');
assert(qrAutoRevokeMigrationName, 'asset QR auto revoke migration missing');
const qrAutoRevokeMigration = read(`supabase/migrations/${qrAutoRevokeMigrationName}`);
const onboardingMigrationName = findMigration('_general_affairs_equipment_onboarding_status.sql');
assert(onboardingMigrationName, 'equipment onboarding status migration missing');
const onboardingMigration = read(`supabase/migrations/${onboardingMigrationName}`);
const onboardingPhotoSyncMigrationName = findMigration('_general_affairs_equipment_onboarding_photo_sync.sql');
assert(onboardingPhotoSyncMigrationName, 'equipment onboarding photo sync migration missing');
const onboardingPhotoSyncMigration = read(`supabase/migrations/${onboardingPhotoSyncMigrationName}`);
const onboardingReviewMigrationName = findMigration('_general_affairs_equipment_onboarding_review.sql');
assert(onboardingReviewMigrationName, 'equipment onboarding review migration missing');
const onboardingReviewMigration = read(`supabase/migrations/${onboardingReviewMigrationName}`);
const storeOnboardingAttachmentScopeMigrationName = findMigration('_general_affairs_store_onboarding_attachment_scope.sql');
assert(storeOnboardingAttachmentScopeMigrationName, 'store onboarding attachment scope migration missing');
const storeOnboardingAttachmentScopeMigration = read(`supabase/migrations/${storeOnboardingAttachmentScopeMigrationName}`);
const onboardingRejectScopeMigrationName = findMigration('_general_affairs_equipment_onboarding_reject_scope.sql');
assert(onboardingRejectScopeMigrationName, 'equipment onboarding reject scope migration missing');
const onboardingRejectScopeMigration = read(`supabase/migrations/${onboardingRejectScopeMigrationName}`);
const scanApiRoute = read('app/api/general-affairs/assets/scan/[token]/route.ts');
const scanPage = read('app/general-affairs/assets/scan/[token]/page.tsx');
const onboardingReviewRoute = read('app/api/general-affairs/equipment/[id]/onboarding-review/route.ts');
const equipmentCreateClient = read('components/general-affairs/equipment/EquipmentCreatePageClient.tsx');
const equipmentTypes = read('lib/general-affairs/equipment/types.ts');
const attachmentPanel = read('components/general-affairs/attachments/ResourceAttachmentPanel.tsx');
const attachmentRoute = read('app/api/general-affairs/attachments/route.ts');

[
  'findDuplicateEquipmentTemplate',
  'findDuplicateFacilityTemplate',
  "replace(/[\\s\\-_./]+/g, '')",
].forEach((needle) => assert(catalogIdentity.includes(needle), `catalog duplicate protection missing ${needle}`));
assert(templateListRoute.includes('findDuplicateEquipmentTemplate'), 'equipment template create must reject duplicate catalog entries');
assert(templateItemRoute.includes('findDuplicateEquipmentTemplate'), 'equipment template edit must reject duplicate catalog entries');

[
  'general_affairs.equipment_template.view',
  'general_affairs.equipment_template.manage',
  'general_affairs.equipment.view',
  'general_affairs.equipment.manage',
  'ga_equipment_templates',
  'ga_equipment',
  'ga_asset_code_sequences',
  'ga_equipment_level2_category_code',
  'ga_next_equipment_asset_code',
  'ga_validate_equipment_template',
  'ga_validate_equipment',
  'ga_soft_delete_equipment_template',
  'ga_soft_delete_equipment',
  'ga_equipment_status',
  'SET search_path = public, pg_temp',
].forEach((needle) => assert(migration.includes(needle), `migration missing ${needle}`));

[
  'ACTIVE',
  'TEMPORARILY_STOPPED',
  'SPARE',
  'RETIRED',
  'SCRAPPED',
].forEach((status) => assert(migration.includes(status), `equipment status missing ${status}`));

[
  "jsonb_typeof(specs) = 'object'",
  "jsonb_typeof(default_fields) = 'object'",
  'CHECK (purchase_amount IS NULL OR purchase_amount >= 0)',
  'CHECK (has_warranty = true OR warranty_end_date IS NULL)',
  'uq_ga_equipment_asset_code_active',
  "CHECK (level2_category_code ~ '^[A-Z]{2}[0-9]{2}$')",
  'PRIMARY KEY (resource_type, level2_category_code, purchase_date)',
  'ON CONFLICT (resource_type, level2_category_code, purchase_date)',
  'GREATEST(ga_asset_code_sequences.last_value + 1, v_existing_max + 1)',
  "RETURN v_prefix || lpad(v_next_value::TEXT, 3, '0')",
  'NEW.asset_code := ga_next_equipment_asset_code(NEW.category_id, NEW.purchased_at)',
  'REVOKE ALL ON TABLE ga_asset_code_sequences FROM authenticated',
  'REVOKE ALL ON FUNCTION ga_next_equipment_asset_code(UUID, DATE) FROM authenticated',
  'uq_ga_equipment_barcode_active',
  'ga_equipment_templates_general_read',
  'ga_equipment_templates_manage_read',
  'ga_equipment_scope_read',
  'ga_equipment_insert',
  'ga_equipment_update',
].forEach((needle) => assert(migration.includes(needle), `migration missing safety rule ${needle}`));

assert(!/CREATE\s+TABLE[^;]+ga_facilities/i.test(migration), 'Task 1B-1 must not create facilities');
assert(!/CREATE\s+TABLE[^;]+ga_parts/i.test(migration), 'Task 1B-1 must not create parts');
assert(!/CREATE\s+TABLE[^;]+inventory/i.test(migration), 'Task 1B-1 must not create inventory');
assert(!/resource_snapshot\s+(JSONB|TEXT|UUID|VARCHAR)/i.test(migration), 'Task 1B-1 must not create resource_snapshot');
assert(!/ALTER\s+TABLE[^;]+work_orders?/i.test(migration), 'Task 1B-1 must not alter work orders');
assert(!migration.includes('FOR DELETE TO authenticated'), 'equipment tables must not expose hard delete policies');
assert(migration.includes('store_managers') && migration.includes('auth.uid()'), 'equipment read scope must include store manager access');
assert(migration.includes('NEW.created_by := auth.uid()'), 'DB trigger must own created_by');
assert(migration.includes('NEW.updated_by := auth.uid()'), 'DB trigger must own updated_by');
assert(migration.includes('NEW.created_by := OLD.created_by'), 'DB trigger must preserve created_by on update');
assert(migration.includes("image_path !~* '^[a-z][a-z0-9+.-]*:'"), 'DB must reject URI scheme image paths');
assert(migration.includes("image_path !~ E'\\\\\\\\'"), 'DB must reject backslash image paths');
assert(migration.includes("image_path !~ '(^|/)\\.\\.(/|$)'"), 'DB must reject image path traversal');
assert(!appliedEquipmentMigration.includes('ga_asset_code_sequences'), 'already-applied baseline migration must remain unchanged for asset code sequence');

[
  'CREATE TABLE IF NOT EXISTS public.ga_asset_code_sequences',
  "CHECK (resource_type IN ('EQUIPMENT'))",
  "CHECK (level2_category_code ~ '^[A-Z]{2}[0-9]{2}$')",
  'CREATE OR REPLACE FUNCTION public.ga_equipment_level2_category_code',
  'CREATE OR REPLACE FUNCTION public.ga_next_equipment_asset_code',
  "v_prefix := v_level2_code || to_char(p_purchased_at, 'YYYYMMDD')",
  'ON CONFLICT (resource_type, level2_category_code, purchase_date)',
  'NEW.asset_code := ga_next_equipment_asset_code(NEW.category_id, NEW.purchased_at)',
  'REVOKE ALL ON TABLE public.ga_asset_code_sequences FROM authenticated',
  'REVOKE ALL ON FUNCTION public.ga_next_equipment_asset_code(UUID, DATE) FROM authenticated',
].forEach((needle) => assert(assetCodeMigration.includes(needle), `asset code forward migration missing ${needle}`));

assert(!assetCodeMigration.includes('ga_facilities'), 'asset code forward migration must not modify facilities');
assert(!assetCodeMigration.includes('CREATE POLICY'), 'asset code forward migration must not create policies');
assert(!assetCodeMigration.includes('FOR DELETE TO authenticated'), 'asset code forward migration must not expose hard delete policies');

[
  'ALTER TABLE public.ga_equipment',
  'qr_token TEXT',
  'qr_token_issued_at TIMESTAMPTZ',
  'qr_token_revoked_at TIMESTAMPTZ',
  'lower(replace(gen_random_uuid()::TEXT',
  'uq_ga_equipment_qr_token',
  'idx_ga_equipment_qr_token_active',
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(qrMigration.includes(needle), `asset QR migration missing equipment rule ${needle}`));
assert(qrMigration.includes('ALTER TABLE public.ga_facilities'), 'asset QR migration must cover facilities too');

[
  'ga_revoke_asset_qr_on_terminal_status',
  'trg_ga_equipment_qr_auto_revoke',
  'trg_ga_facilities_qr_auto_revoke',
  "NEW.status::text = 'SCRAPPED'",
  "NEW.status::text = 'RETIRED'",
  'NEW.deleted_at IS NOT NULL',
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(qrAutoRevokeMigration.includes(needle), `asset QR auto revoke migration missing ${needle}`));

[
  "onboarding_status TEXT NOT NULL DEFAULT 'NEEDS_EQUIPMENT_PHOTO'",
  'ga_equipment_onboarding_status_check',
  "'NEEDS_EQUIPMENT_PHOTO'",
  "'NEEDS_LABEL_PHOTO'",
  "'PENDING_GA_REVIEW'",
  "'COMPLETED'",
  'idx_ga_equipment_onboarding_status',
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(onboardingMigration.includes(needle), `equipment onboarding migration missing ${needle}`));

[
  'ga_calculate_equipment_onboarding_status',
  'ga_sync_equipment_onboarding_status',
  'ga_resource_attachment_sync_equipment_onboarding',
  'trg_ga_resource_attachments_equipment_onboarding_sync',
  "purpose = 'PRIMARY_IMAGE'",
  "purpose = 'LABEL_POSITION_IMAGE'",
  "RETURN 'NEEDS_EQUIPMENT_PHOTO'",
  "RETURN 'NEEDS_LABEL_PHOTO'",
  "RETURN 'PENDING_GA_REVIEW'",
  "v_current_status = 'COMPLETED'",
  'UPDATE public.ga_equipment equipment',
  'DISABLE TRIGGER trg_ga_equipment_before_write',
  'ENABLE TRIGGER trg_ga_equipment_before_write',
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(onboardingPhotoSyncMigration.includes(needle), `equipment onboarding photo sync migration missing ${needle}`));

[
  'onboarding_review_note TEXT',
  'onboarding_reviewed_at TIMESTAMPTZ',
  'onboarding_reviewed_by UUID REFERENCES public.profiles',
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(onboardingReviewMigration.includes(needle), `equipment onboarding review migration missing ${needle}`));

[
  'CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage',
  "e.onboarding_status IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO')",
  'FROM public.store_managers sm',
  'sm.user_id = auth.uid()',
  "p_resource_type = 'SERVICE_REQUEST_COMMENT'",
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(storeOnboardingAttachmentScopeMigration.includes(needle), `store onboarding attachment scope migration missing ${needle}`));

assert(rollback.includes('DROP TABLE IF EXISTS ga_equipment'), 'rollback must drop equipment table');
assert(rollback.includes('DROP TABLE IF EXISTS ga_equipment_templates'), 'rollback must drop equipment templates table');
assert(rollback.includes('DROP TABLE IF EXISTS ga_asset_code_sequences'), 'rollback must drop asset code sequence table');
assert(rollback.includes('DROP FUNCTION IF EXISTS ga_next_equipment_asset_code(UUID, DATE)'), 'rollback must drop asset code helper');
assert(testSql.includes('ga_equipment_templates') && testSql.includes('ga_equipment'), 'manual test SQL must validate equipment tables');
assert(assetCodeTestSql.includes('ga_next_equipment_asset_code(uuid, date)'), 'asset code test SQL must validate helper');
assert(assetCodeTestSql.includes("v_first_code !~ ('^' || v_l2_code || '20260730[0-9]{3}$')"), 'asset code test SQL must validate level-2 prefix and date');
assert(assetCodeTestSql.includes('substring(v_second_code from 13 for 3)::INTEGER <> substring(v_first_code from 13 for 3)::INTEGER + 1'), 'asset code test SQL must validate increment');
assert(assetCodeTestSql.includes('DEV asset code sequence test cleanup'), 'asset code test SQL must soft cleanup fixtures');

assert(validation.includes('圖片路徑僅可保存相對 Storage Path'), 'validation must reject external image URLs');
assert(validation.includes("text.includes('\\\\')"), 'validation must reject backslash image paths');
assert(validation.includes("text.split('/').includes('..')"), 'validation must reject image path traversal');
assert(validation.includes('無保固時不可填寫保固到期日'), 'validation must enforce warranty summary rule');
assert(validation.includes('建檔貼標狀態錯誤'), 'validation must validate onboarding status');
assert(equipmentTypes.includes('EQUIPMENT_ONBOARDING_STATUSES'), 'equipment types must expose onboarding statuses');
assert(access.includes("EQUIPMENT_MANAGE_PERMISSION = 'general_affairs.equipment.manage'"), 'access must use RBAC manage permission');
assert(!access.includes('profiles.role'), 'access must not use profiles.role');

assert(!equipmentItemRoute.includes('.delete()'), 'equipment DELETE route must not hard delete');
assert(equipmentItemRoute.includes("rpc('ga_soft_delete_equipment'"), 'equipment DELETE route must call soft delete RPC');
assert(!templateItemRoute.includes('.delete()'), 'template DELETE route must not hard delete');
assert(templateItemRoute.includes("rpc('ga_soft_delete_equipment_template'"), 'template DELETE route must call soft delete RPC');
assert(equipmentListRoute.includes('warnings'), 'equipment API must return warnings');
assert(equipmentListRoute.includes('serial_number'), 'equipment API must check duplicate serial numbers');
assert(equipmentListRoute.includes('qr_token'), 'equipment API must select QR token');
assert(equipmentListRoute.includes('qr_token_issued_at'), 'equipment API must select QR issue timestamp');
assert(equipmentListRoute.includes('qr_scan_path'), 'equipment API must return stable QR scan path');
assert(equipmentListRoute.includes('/general-affairs/assets/scan/'), 'equipment API must use stable asset scan route');
assert(equipmentListRoute.includes('onboarding_status'), 'equipment API must select onboarding status');
assert(equipmentListRoute.includes('onboarding_review_note'), 'equipment API must select onboarding review note');
assert(equipmentListRoute.includes('onboardingStatus'), 'equipment API must support onboarding status filter');
assert(templateListRoute.includes('canManageEquipmentTemplates'), 'template API must check template manage permission');

assert(scanApiRoute.includes("from('ga_equipment')"), 'scan API must resolve equipment by QR token');
assert(scanApiRoute.includes("from('ga_facilities')"), 'scan API must resolve facilities by QR token');
assert(scanApiRoute.includes('qr_token_revoked_at'), 'scan API must ignore revoked QR tokens');
assert(scanApiRoute.includes('FULL_SCAN_PERMISSIONS'), 'scan API must define full access permissions');
assert(scanApiRoute.includes('VIEW_ALL_SCAN_PERMISSIONS'), 'scan API must define view-all access permissions');
assert(scanApiRoute.includes('isStoreManagerForStore'), 'scan API must support own-store asset visibility');
assert(scanApiRoute.includes('沒有查看此資產 QR Code 的權限'), 'scan API must explain out-of-scope QR permission denial');
assert(scanApiRoute.includes('請聯絡總務或系統管理員確認門市指派與權限設定'), 'scan API must guide users to resolve QR permission denial');
assert(scanApiRoute.includes('repair_request_path'), 'scan API must return dynamic repair request path');
assert(scanApiRoute.includes('management_path'), 'scan API must return management path only by permission');
assert(scanApiRoute.includes('maintenance_records'), 'scan API must return maintenance records');
assert(scanApiRoute.includes('warrantyStatus'), 'scan API must return warranty status');
assert(equipmentItemRoute.includes("normalized.status === 'SCRAPPED'"), 'equipment update must revoke QR when scrapped');
assert(equipmentItemRoute.includes('qr_token_revoked_at: new Date().toISOString()'), 'equipment update must set QR revoked timestamp');
assert(onboardingReviewRoute.includes('canManageEquipment'), 'onboarding review API must require equipment manage permission');
assert(onboardingReviewRoute.includes("equipment.onboarding_status !== 'PENDING_GA_REVIEW'"), 'onboarding review API must only act on pending GA review');
assert(onboardingReviewRoute.includes('reject_required_primary_photo'), 'onboarding review API must support rejecting equipment photo only');
assert(onboardingReviewRoute.includes('reject_required_label_photo'), 'onboarding review API must support rejecting label photo only');
assert(onboardingReviewRoute.includes("nextStatus = action === 'approve'"), 'onboarding review API must approve or branch by rejected photo scope');
assert(onboardingReviewRoute.includes('退回重拍時必須填寫原因'), 'onboarding review API must require reject reason');
assert(onboardingReviewRoute.includes('退回重拍時必須選擇要重補的照片'), 'onboarding review API must require reject photo scope');
assert(onboardingReviewRoute.includes('onboarding_review_note'), 'onboarding review API must store review note');
assert(onboardingRejectScopeMigration.includes('onboarding_requires_primary_photo'), 'reject scope migration must add primary photo requirement flag');
assert(onboardingRejectScopeMigration.includes('onboarding_requires_label_photo'), 'reject scope migration must add label photo requirement flag');
assert(onboardingRejectScopeMigration.includes('v_requires_primary_photo'), 'reject scope migration must prioritize primary photo requirement');
assert(onboardingRejectScopeMigration.includes('v_requires_label_photo'), 'reject scope migration must prioritize label photo requirement');
assert(scanPage.includes('QR Code 穩定掃描入口'), 'scan page must describe stable QR entry');
assert(scanPage.includes("status === 403 ? '沒有查看權限'"), 'scan page must distinguish permission denial from invalid QR');
assert(scanPage.includes('維修回報'), 'scan page must expose repair request entry');
assert(scanPage.includes('查看完整主檔'), 'scan page must expose management entry for authorized users');
assert(scanPage.includes('目前使用門市'), 'scan page must show current store');
assert(scanPage.includes('保固狀態'), 'scan page must show warranty status');
assert(equipmentCreateClient.includes('createdQrScanPath'), 'equipment create flow must track created QR scan path');
assert(equipmentCreateClient.includes('QR Code 掃描入口'), 'equipment create flow must explain QR scan entry');
assert(equipmentCreateClient.includes('不需要重印既有貼紙'), 'equipment create flow must explain stable QR labels');
assert(equipmentCreateClient.includes('開啟 QR 掃描入口'), 'equipment create flow must link to scan entry after create');
assert(equipmentCreateClient.includes('LABEL_POSITION_IMAGE'), 'equipment create flow must support label position photo upload');
assert(equipmentCreateClient.includes('ONBOARDING_STATUS_LABELS[onboardingStatus]'), 'equipment create flow must preview onboarding status');
assert(equipmentCreateClient.includes('onboarding_status: onboardingStatus'), 'equipment create flow must submit onboarding status');
assert(equipmentClient.includes('ONBOARDING_STATUS_LABELS'), 'equipment list UI must label onboarding statuses');
assert(equipmentClient.includes('function OnboardingProgress'), 'equipment list UI must render onboarding progress bar');
assert(equipmentClient.includes('ONBOARDING_PROGRESS_PERCENT'), 'equipment list UI must map onboarding status to progress percent');
assert(equipmentClient.includes("label: '設備照片'"), 'equipment progress bar must include equipment photo step');
assert(equipmentClient.includes("label: '貼標照片'"), 'equipment progress bar must include label photo step');
assert(equipmentClient.includes("label: '總務複核'"), 'equipment progress bar must include GA review step');
assert(equipmentClient.includes("label: '完成'"), 'equipment progress bar must include completed step');
assert(equipmentClient.includes('全部建檔進度'), 'equipment list UI must filter onboarding statuses');
assert(equipmentClient.includes('標籤貼附位置照片'), 'equipment list UI must show label position photo section');
assert(equipmentClient.includes('submitOnboardingReview'), 'equipment list UI must support onboarding review action');
assert(equipmentClient.includes('照片正確，完成建檔'), 'equipment list UI must expose onboarding approve action');
assert(equipmentClient.includes('退回重拍'), 'equipment list UI must expose onboarding reject action');
assert(equipmentClient.includes('最近複核說明'), 'equipment list UI must show review note');
assert(attachmentPanel.includes("purpose = 'GENERAL'"), 'attachment panel must support default general purpose');
assert(attachmentPanel.includes('accept ='), 'attachment panel must support purpose-specific accept filters');
assert(attachmentPanel.includes('[purpose, resourceId, resourceType]'), 'attachment panel must reload when purpose changes');
assert(attachmentRoute.includes("searchParams.get('purpose')"), 'attachment API must support purpose filtering');

assert(exists('app/general-affairs/equipment/page.tsx'), 'equipment page missing');
assert(exists('app/general-affairs/equipment/templates/page.tsx'), 'template page missing');
assert(equipmentClient.includes('未儲存') && templateClient.includes('未儲存'), 'UI must include unsaved-change warnings');
assert(equipmentClient.includes('PermissionDenied') && templateClient.includes('PermissionDenied'), 'UI must include permission denied state');
assert(equipmentClient.includes('Loader2') && templateClient.includes('Loader2'), 'UI must include loading state');
assert(equipmentClient.includes('href="/general-affairs/equipment/new"') && templateClient.includes('openCreate'), 'UI must include create flow');
assert(equipmentClient.includes('async function softDelete') && templateClient.includes('async function softDelete'), 'UI must include soft delete flow');
assert(templateClient.includes("import CategoryCascadePicker from '@/components/general-affairs/assets/AssetCategoryPicker'"), 'equipment template form must reuse the shared category hierarchy');
assert(templateClient.includes('label="設備分類"') && templateClient.includes('categoriesById'), 'equipment template form must show the configured equipment category path');
assert(!templateClient.includes('<option value="">請選擇分類</option>'), 'equipment template form must not fall back to a flat category select');
assert(equipmentListRoute.includes("searchParams.get('templateStatus') === 'unlinked'"), 'equipment list API must support legacy unlinked equipment filtering');
assert(templateClient.includes('歸戶既有設備') && templateClient.includes('templateStatus=unlinked'), 'equipment template UI must support legacy equipment reconciliation');
assert(templateClient.includes('可能相符') && templateClient.includes('selectedEquipmentIds'), 'legacy reconciliation must suggest matches but require explicit selection');
assert(templateClient.includes('選取型號相同') && templateClient.includes('score >= 4'), 'legacy reconciliation may bulk-select exact model matches');
assert(templateClient.includes('className="mt-1 text-xs font-bold text-blue-700'), 'legacy reconciliation action must be visible beside model usage');
assert(templateClient.includes('unlinkedEquipmentTotal') && templateClient.includes('`\u5f85歸戶 ${unlinkedEquipmentTotal} 台`'), 'equipment template page must show the remaining legacy reconciliation count');
assert(templateClient.includes('既有設備已歸戶'), 'equipment template page must show a completed reconciliation state');
assert(templateClient.includes('本次先顯示前 {unlinkedEquipment.length} 台'), 'legacy reconciliation must explain when remaining equipment exceeds the current batch');
assert(templateLinkAssetsRoute.includes('canManageEquipmentTemplates()') && templateLinkAssetsRoute.includes('canManageEquipment()'), 'legacy reconciliation must require both template and equipment management permissions');
assert(templateLinkAssetsRoute.includes(".is('template_id', null)"), 'legacy reconciliation must not replace an existing template relationship');
assert(templateLinkAssetsRoute.includes('serial_number') === false, 'legacy reconciliation must preserve equipment serial numbers');

console.log('General affairs equipment master static checks passed.');
