/* eslint-disable */
/**
 * 00d 的標記清單（人工逐支讀過 supabase/migrations 內容後寫成，不是自動猜的）。
 *
 * 對象：00c 查不出有沒有套用的 32 支舊版 migration（只改函式本文、授權、約束、資料，沒有新建物件）。
 * 每支挑 1～3 個「套用後才會成立」的唯讀標記；判斷以「舊版全部套用後的最終狀態」為準，
 * 也就是後面還有別支舊版 migration 覆蓋的函式，只挑最後一版仍保留的字串。
 *
 * 標記種類（kind）與參數：
 *   fn_has / fn_lacks      fn（含參數簽章）、needle        函式定義（pg_get_functiondef）含／不含某段字串
 *   fn_exists / fn_absent  fn                              函式存在／已不存在
 *   fn_exec                fn、grants {角色: true|false}   某角色對函式有／沒有 EXECUTE（含 PUBLIC 繼承）
 *   seq_priv               seq、grants                     某角色對序列有／沒有 USAGE
 *   col_exists             table、column
 *   col_type               table、column、type             format_type 結果，例如 numeric(4,1)
 *   col_default_has        table、column、needle           欄位預設值運算式含某字串
 *   col_comment_has        table、column、needle           欄位註解（COMMENT ON COLUMN）含某字串
 *   constraint_has         table、name、needle             約束定義含某字串
 *   constraint_exists / constraint_absent  table、name
 *   constraint_comment_has table、name、needle             約束註解含某字串
 *   index_has / index_exists  index、needle
 *   policy_has / policy_lacks table、name、needle、part('qual'|'with_check'|'any')
 *   trigger_exists / trigger_absent  table、name
 *   perm_active            codes[]                         權限碼都存在且 is_active
 *   role_perms_all         role、codes[]                   某角色對這些權限碼都有 is_allowed 授權
 *   seed_codes             table、codes[]                  種子資料的 code 都存在且啟用
 *   no_null                table、column                   該欄位沒有 NULL 的列（欄位不存在視為不成立）
 *   all                    parts[]                         多個條件同時成立
 *
 * 每個標記：meaning 白話說明「成立代表什麼」；superseded_by（可省略）= {file, note}，
 *   file 是 m9-sql/README.md 總表裡的檔案，產生器會換成「步驟 N（檔名）：note」；沒有 file 就只寫 note。
 *   有 superseded_by 的標記，缺了無妨（後面的步驟會蓋掉它），或重跑時會變成「缺」而那是預期的。
 */

const SUP = {
  s07: { file: 'm9-sql/07_legacy_supervisor_management.sql', note: '會建立督導管理日誌的最終版（含這項），這項缺了無妨' },
  s33: { file: 'm9-sql/80_movement_batch_monthly_roster.sql', note: '會重建 valid_movement_type（一樣含 acting_manager），這項缺了無妨' },
  grants: { note: '授權之後由權限勾選頁（授權步驟）決定；老闆改過授權就會缺，不一定代表舊版沒套用' },
  rrp: { note: '舊版 20260926163000 已把 3 參數版 DROP 後改成 4 參數版；這支的最終效果就是這兩項，其中一項缺代表 20260926163000 或本支沒套用（00c 會顯示 163000 的函式在不在）' },
};

const ATTACH = 'public.ga_resource_attachments';
const CAN_READ = 'public.ga_resource_attachment_can_read(text,uuid)';
const CAN_MANAGE = 'public.ga_resource_attachment_can_manage(text,uuid)';
const POST_TX = 'public.ga_post_inventory_transaction(text,uuid,uuid,numeric,text,text,text,text,uuid,text,timestamptz,jsonb)';
const GA_CODES_15 = [
  'general_affairs.maintenance_request.create', 'general_affairs.maintenance_request.view_own_store', 'general_affairs.maintenance_request.view_all', 'general_affairs.maintenance_request.update',
  'general_affairs.work_order.view_own_store', 'general_affairs.work_order.view_all', 'general_affairs.work_order.update', 'general_affairs.work_order.manage',
  'general_affairs.vendor.view', 'general_affairs.vendor.manage', 'general_affairs.service_category.view', 'general_affairs.service_category.manage',
  'general_affairs.service_region.view', 'general_affairs.service_region.manage', 'general_affairs.cooperation_record.view',
];

const migrations = [
  { migration: '20260722055852_fix_inventory_location_cascade_deletion_reason', markers: [
    { kind: 'fn_lacks', fn: 'public.ga_soft_delete_inventory_location(uuid,text)', needle: '父庫存位置刪除衍生',
      meaning: '刪除庫存位置時，連帶刪除的下層明細，原因與上層相同（修正前的版本會在原因前面多加「父庫存位置刪除衍生：」）。成立代表已是修正後的版本。' },
  ] },
  { migration: '20260722091526_revoke_inventory_transaction_sequence_grants', markers: [
    { kind: 'seq_priv', seq: 'public.ga_inventory_transaction_no_seq', grants: { authenticated: false, anon: false },
      meaning: '庫存交易編號的序列，已收回登入使用者與匿名的使用權（只能由資料庫函式取號）。成立代表這支已套用。' },
  ] },
  { migration: '20260722092849_restrict_inventory_transaction_function_execute_grants', markers: [
    { kind: 'fn_exec', fn: 'public.ga_next_inventory_transaction_no()', grants: { authenticated: false, anon: false },
      meaning: '取庫存交易編號的函式，登入使用者與匿名都不能直接執行。成立代表已收回授權。' },
    { kind: 'fn_exec', fn: POST_TX, grants: { authenticated: true, anon: false },
      meaning: '庫存過帳函式只開放給登入使用者、不開放匿名。成立代表授權已整理成預期狀態。' },
  ] },
  { migration: '20260722094917_fix_inventory_balance_upsert_conflict_ambiguity', markers: [
    { kind: 'fn_has', fn: POST_TX, needle: 'ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING;',
      meaning: '庫存過帳函式改用「指定約束名稱」的 ON CONFLICT 寫法，避免欄位名稱不明確的錯誤。成立代表已套用。' },
    { kind: 'fn_lacks', fn: POST_TX, needle: 'ON CONFLICT (location_id, part_id) DO NOTHING;',
      meaning: '舊的有歧義寫法 ON CONFLICT (location_id, part_id) 已不在函式裡。成立代表已替換。' },
  ] },
  { migration: '20260727021000_general_affairs_maintenance_work_order_permission_split', markers: [
    { kind: 'perm_active', codes: ['general_affairs.maintenance_request.create', 'general_affairs.maintenance_request.view_own_store', 'general_affairs.maintenance_request.view_all', 'general_affairs.maintenance_request.update', 'general_affairs.work_order.view_own_store', 'general_affairs.work_order.view_all', 'general_affairs.work_order.update', 'general_affairs.work_order.manage'],
      meaning: '總務維修回報與工單的 8 個權限碼都存在且啟用。成立代表維修／工單權限已從跨部門維修拆出。' },
    { kind: 'policy_has', table: 'maintenance_requests', name: 'p1e_maintenance_requests_read', needle: 'general_affairs.work_order.manage', part: 'qual',
      meaning: '維修回報的讀取政策認得總務工單管理權限。成立代表政策已改成同時接受總務與跨部門兩組權限。' },
  ] },
  { migration: '20260730010048_grant_resource_attachment_visibility_helpers', markers: [
    { kind: 'fn_exec', fn: CAN_READ, grants: { authenticated: true, anon: false },
      meaning: '附件「能不能讀」的判斷函式已開放給登入使用者、沒開給匿名；沒開的話附件清單會報 permission denied for function。' },
    { kind: 'fn_exec', fn: CAN_MANAGE, grants: { authenticated: true, anon: false },
      meaning: '附件「能不能管理」的判斷函式已開放給登入使用者、沒開給匿名；沒開的話上傳附件會報 permission denied。' },
  ] },
  { migration: '20260810090000_allow_part_resource_attachments', markers: [
    { kind: 'constraint_has', table: ATTACH, name: 'ga_resource_attachments_resource_type_check', needle: "'PART'",
      meaning: '附件的資源類型白名單含 PART（料件）。後面別支舊版與 m7m8 步驟都保留 PART，所以最終狀態也成立。' },
    { kind: 'fn_has', fn: CAN_READ, needle: 'FROM public.ga_parts p',
      meaning: '附件讀取判斷函式有料件（PART）分支。後面別支舊版與 m7m8 步驟都保留這個分支。' },
  ] },
  { migration: '20260812153524_grant_supervisor_management_rls_helper_execute', markers: [
    { kind: 'fn_exec', fn: 'public.supervisor_management_case_is_visible(uuid)', grants: { authenticated: true, anon: false },
      superseded_by: SUP.s07, meaning: '督導日誌案件可見性函式（RLS 政策會呼叫）已開放給登入使用者、沒開給匿名。' },
    { kind: 'fn_exec', fn: 'public.supervisor_management_case_is_manageable(uuid)', grants: { authenticated: true, anon: false },
      superseded_by: SUP.s07, meaning: '督導日誌案件可管理函式已開放給登入使用者、沒開給匿名。' },
    { kind: 'fn_exec', fn: 'public.supervisor_management_current_user_manages_store(uuid)', grants: { authenticated: true, anon: false },
      superseded_by: SUP.s07, meaning: '督導日誌「目前使用者是否管理該門市」函式已開放給登入使用者、沒開給匿名。' },
  ] },
  { migration: '20260812155612_fix_supervisor_management_case_insert_visibility', markers: [
    { kind: 'fn_has', fn: 'public.supervisor_management_validate_case()', needle: 'SUPERVISOR_CASE_OWNER_MISMATCH',
      superseded_by: SUP.s07, meaning: '督導日誌案件驗證觸發函式，建立案件時要求負責人必須是目前登入者（除非有管理權限）。' },
    { kind: 'policy_has', table: 'supervisor_management_cases', name: 'supervisor_management_cases_insert', needle: 'owner_user_id = auth.uid()', part: 'with_check',
      superseded_by: SUP.s07, meaning: '督導日誌案件的新增政策，有建立權限者只能新增負責人是自己的案件。' },
    { kind: 'fn_has', fn: 'public.supervisor_management_case_is_visible(uuid)', needle: 'supervisor.management_log.create',
      superseded_by: SUP.s07, meaning: '案件可見性函式讓「只有建立權限」的人也看得到自己的案件（否則新增後讀回會被擋）。' },
  ] },
  { migration: '20260820093000_grant_organization_permissions_to_admin_roles', markers: [
    { kind: 'role_perms_all', role: 'admin', codes: ['organization.organization.view', 'organization.department.view', 'organization.department.create', 'organization.department.edit', 'organization.member.view', 'organization.member.manage', 'organization.manager.view', 'organization.manager.manage'],
      superseded_by: SUP.grants, meaning: '組織管理的 8 個權限碼存在，且系統管理員（admin 角色）都有授權。成立代表組織管理選單對管理員已開。' },
  ] },
  { migration: '20260826004500_general_affairs_service_request_comment_attachments', markers: [
    { kind: 'constraint_has', table: ATTACH, name: 'ga_resource_attachments_resource_type_check', needle: "'SERVICE_REQUEST_COMMENT'",
      meaning: '附件資源類型白名單含需求單留言（SERVICE_REQUEST_COMMENT）。後面的版本都保留。' },
    { kind: 'fn_has', fn: CAN_READ, needle: "p_resource_type = 'SERVICE_REQUEST_COMMENT'",
      meaning: '附件讀取判斷函式有需求單留言分支。後面的版本都保留。' },
    { kind: 'fn_has', fn: CAN_MANAGE, needle: "p_resource_type = 'SERVICE_REQUEST_COMMENT'",
      meaning: '附件管理判斷函式有需求單留言分支。後面的版本都保留。' },
  ] },
  { migration: '20260826023000_employee_movement_store_employee_rls_alignment', markers: [
    { kind: 'fn_has', fn: 'public.current_user_has_permission(character varying)', needle: 'public.has_permission(auth.uid(), p_permission_code)',
      meaning: 'current_user_has_permission 是包裝 has_permission 的版本（RLS 政策共用）。成立代表函式是這支 migration 的版本。' },
    { kind: 'policy_has', table: 'store_employees', name: 'p1c_store_employees_insert_manage', needle: 'employee.promotion.batch', part: 'with_check',
      meaning: '新增員工的 RLS 政策認得「批次升遷」權限，正式入職流程才寫得進 store_employees。' },
    { kind: 'policy_has', table: 'employee_movement_history', name: 'p1c_employee_movement_manage', needle: 'employee.promotion.batch', part: 'qual',
      meaning: '異動紀錄的管理政策認得「批次升遷」權限。' },
  ] },
  { migration: '20260826042500_general_affairs_store_onboarding_attachment_scope', markers: [
    { kind: 'fn_has', fn: CAN_MANAGE, needle: "e.onboarding_status IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO')",
      meaning: '店長可替自己門市、還在「待拍照」階段的設備上傳附件。後面的版本都保留這個分支。' },
    { kind: 'fn_has', fn: CAN_MANAGE, needle: 'OR sr.created_by = auth.uid()',
      meaning: '需求單附件：建立人本人可管理自己的需求單附件。後面的版本都保留。' },
  ] },
  { migration: '20260827103000_general_affairs_service_request_optional_repair_target', markers: [
    { kind: 'constraint_exists', table: 'public.ga_service_requests', name: 'ga_service_requests_repair_optional_resource_check',
      meaning: '維修需求單「可不綁設備／設施」的約束存在（最終內容由 20260827124500 更新，名稱不變）。' },
    { kind: 'constraint_absent', table: 'public.ga_service_requests', name: 'ga_service_requests_repair_bound_resource_check',
      meaning: '舊的「維修一定要綁設備或設施」約束已移除。成立代表維修回報可以先不綁標的。' },
  ] },
  { migration: '20260827124500_general_affairs_service_request_typed_unbound_repair_target', markers: [
    { kind: 'constraint_comment_has', table: 'public.ga_service_requests', name: 'ga_service_requests_repair_optional_resource_check', needle: '若知道大類可先標示設備或設施',
      meaning: '維修需求單約束是最新版（可先標示設備或設施大類、尚未綁主檔）。用約束註解判斷，註解是這支 migration 寫的。' },
  ] },
  { migration: '20260827131500_seed_maintenance_progress_stages', markers: [
    { kind: 'seed_codes', table: 'maintenance_progress_stages', codes: ['INITIAL_REVIEW', 'WAITING_STORE_INFO', 'INTERNAL_HANDLING', 'SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING', 'WAITING_PARTS', 'PARTS_IN_TRANSIT', 'WAITING_INTERNAL_APPROVAL', 'WAITING_STORE_CONFIRMATION', 'REOPENED', 'OTHER'],
      meaning: '維修進度的 16 個階段代碼都存在且啟用。成立代表種子資料已寫入（沒有的話進度下拉選單會是空的）。' },
  ] },
  { migration: '20260914095000_employee_purchase_employee_summary_rpc', markers: [
    { kind: 'fn_exec', fn: 'public.employee_purchase_employee_summary(text,text)', grants: { authenticated: true },
      meaning: '員工購買彙總函式存在，且登入使用者可執行。這支 migration 是補丁（補建這個函式與授權）。' },
  ] },
  { migration: '20260918153000_restrict_part_fulfillment_permissions', markers: [
    { kind: 'policy_lacks', table: 'ga_part_fulfillments', name: 'ga_part_fulfillments_read', needle: 'general_affairs.request.manage', part: 'any',
      meaning: '料件處理單的讀取政策已收窄成只認「料件處理」權限（不再讓需求單管理者讀取）。' },
    { kind: 'policy_lacks', table: 'ga_part_fulfillments', name: 'ga_part_fulfillments_manage', needle: 'general_affairs.request.manage', part: 'any',
      meaning: '料件處理單的管理政策已收窄成只認「料件處理管理」權限。' },
  ] },
  { migration: '20260920113000_general_affairs_equipment_template_compatibilities', markers: [
    { kind: 'constraint_has', table: 'public.ga_part_target_compatibilities', name: 'ga_part_target_compatibilities_target_type_check', needle: 'EQUIPMENT_TEMPLATE',
      meaning: '料件相容對象類型含「設備型號」（EQUIPMENT_TEMPLATE）。成立代表設備型號可以設相容料件。' },
    { kind: 'fn_has', fn: 'public.ga_validate_part_target_compatibility()', needle: 'ga_equipment_templates',
      meaning: '相容性驗證函式會檢查設備型號是否存在、啟用。' },
  ] },
  { migration: '20260925110000_general_affairs_utility_bill_electricity_usage', markers: [
    { kind: 'col_type', table: 'public.ga_utility_bills', column: 'electricity_kwh', type: 'numeric(12,2)',
      meaning: '水電帳單有用電度數欄位（numeric(12,2)）。' },
    { kind: 'constraint_exists', table: 'public.ga_utility_bills', name: 'ga_utility_bills_electricity_kwh_check',
      meaning: '用電度數只能出現在電費帳單、且不能是負數的約束存在。' },
  ] },
  { migration: '20260926090000_general_affairs_utility_bill_identifiers', markers: [
    { kind: 'all', parts: [
      { kind: 'col_exists', table: 'public.ga_utility_bills', column: 'service_identifier' },
      { kind: 'col_exists', table: 'public.ga_utility_bills', column: 'equipment_serial' },
    ], meaning: '水電帳單有「服務識別碼」與「設備序號」兩欄。' },
    { kind: 'index_has', index: 'uq_ga_utility_bills_identity', needle: 'service_identifier',
      meaning: '水電帳單防重複的唯一索引已納入服務識別碼（同月可有多條線路）。' },
  ] },
  { migration: '20260926093000_general_affairs_internet_multiple_lines', markers: [
    { kind: 'col_exists', table: 'public.ga_utility_bills', column: 'service_label',
      meaning: '水電帳單有「服務名稱／線路標示」欄位（網路多線路用）。' },
  ] },
  { migration: '20260926100000_general_affairs_utility_bill_attachments', markers: [
    { kind: 'constraint_has', table: ATTACH, name: 'ga_resource_attachments_resource_type_check', needle: "'UTILITY_BILL'",
      meaning: '附件資源類型白名單含水電帳單（UTILITY_BILL）。後面的 m7m8 步驟只會再加類型，不會拿掉。' },
  ] },
  { migration: '20260926153000_general_affairs_production_role_matrix', markers: [
    { kind: 'role_perms_all', role: 'admin', codes: GA_CODES_15, superseded_by: SUP.grants,
      meaning: '系統管理員（admin）對這 15 個總務權限碼都有授權（維修回報、工單、廠商、服務分類／區域、合作紀錄）。' },
    { kind: 'role_perms_all', role: 'general_affairs', codes: GA_CODES_15, superseded_by: SUP.grants,
      meaning: '總務角色（general_affairs）對這 15 個總務權限碼都有授權。' },
    { kind: 'role_perms_all', role: 'store_manager_role', codes: ['general_affairs.service_center.access', 'general_affairs.request.create', 'general_affairs.request.view_own_store', 'general_affairs.request.comment_own_store', 'general_affairs.request.confirm_own_store', 'general_affairs.maintenance_request.create', 'general_affairs.maintenance_request.view_own_store', 'general_affairs.work_order.view_own_store'], superseded_by: SUP.grants,
      meaning: '店長角色（store_manager_role）有 8 個自己門市的總務權限（進服務中心、建立／查看／留言／確認需求單與維修回報）。' },
  ] },
  { migration: '20260926160000_atomic_role_permission_updates', markers: [
    { kind: 'fn_exec', fn: 'public.replace_role_permissions(uuid,uuid[],uuid[],uuid)', grants: { service_role: true, authenticated: false, anon: false }, superseded_by: SUP.rrp,
      meaning: '角色權限整組替換函式（4 參數版）只有 service_role 能執行，登入使用者與匿名都不行。' },
    { kind: 'fn_absent', fn: 'public.replace_role_permissions(uuid,uuid[],uuid)', superseded_by: SUP.rrp,
      meaning: '舊的 3 參數版已不存在（被 4 參數版取代）。' },
  ] },
  { migration: '20260928110000_repair_equipment_onboarding_schema', markers: [
    { kind: 'col_default_has', table: 'public.ga_equipment', column: 'onboarding_status', needle: 'NEEDS_EQUIPMENT_PHOTO',
      meaning: '設備有 onboarding_status 欄位，預設「待拍設備照」。' },
    { kind: 'constraint_has', table: 'public.ga_equipment', name: 'ga_equipment_onboarding_status_check', needle: 'PENDING_GA_REVIEW',
      meaning: '設備上線進度的 4 種狀態約束存在（含待總務審核）。' },
    { kind: 'all', parts: [
      { kind: 'trigger_exists', table: ATTACH, name: 'trg_ga_resource_attachments_equipment_onboarding_sync' },
      { kind: 'fn_exists', fn: 'public.ga_calculate_equipment_onboarding_status(uuid)' },
    ], meaning: '設備附件變動時自動同步上線進度的觸發器，與計算上線進度的函式都存在。（這支 migration 另有一次性重算進度的 UPDATE，無法單獨判斷，但同一組結構齊了就視為已套用。）' },
  ] },
  { migration: '20260929090000_repair_general_affairs_asset_qr_schema', markers: [
    { kind: 'all', parts: [
      { kind: 'col_exists', table: 'public.ga_equipment', column: 'qr_token_revoked_at' },
      { kind: 'col_exists', table: 'public.ga_facilities', column: 'qr_token_revoked_at' },
      { kind: 'col_exists', table: 'public.ga_equipment', column: 'qr_token_issued_at' },
      { kind: 'col_exists', table: 'public.ga_facilities', column: 'qr_token_issued_at' },
    ], meaning: '設備與設施都有 QR 代碼的發行與作廢時間欄位。{{m9-sql/08_legacy_qr_revoke_trigger.sql}}（QR 作廢觸發器）的前置檢查要這幾欄，缺了它會停下來。' },
    { kind: 'all', parts: [
      { kind: 'constraint_exists', table: 'public.ga_equipment', name: 'ga_equipment_qr_token_format' },
      { kind: 'constraint_exists', table: 'public.ga_facilities', name: 'ga_facilities_qr_token_format' },
      { kind: 'index_exists', index: 'uq_ga_equipment_qr_token' },
      { kind: 'index_exists', index: 'uq_ga_facilities_qr_token' },
    ], meaning: 'QR 代碼的格式約束與唯一索引都在（設備、設施各一組）。' },
    { kind: 'all', parts: [
      { kind: 'col_default_has', table: 'public.ga_equipment', column: 'qr_token', needle: 'gen_random_uuid' },
      { kind: 'col_default_has', table: 'public.ga_facilities', column: 'qr_token', needle: 'gen_random_uuid' },
      { kind: 'no_null', table: 'ga_equipment', column: 'qr_token' },
      { kind: 'no_null', table: 'ga_facilities', column: 'qr_token' },
    ], meaning: 'QR 代碼有自動產生的預設值，且沒有任何設備或設施的 QR 代碼是空的（這支 migration 會替空的補上）。' },
  ] },
  { migration: '20261004100000_performance_business_days_half_day', markers: [
    { kind: 'col_type', table: 'public.store_performance', column: 'business_days', type: 'numeric(4,1)',
      meaning: '門市業績的營業天數欄位可放 0.5 天（numeric(4,1)，原本是整數）。' },
    { kind: 'col_comment_has', table: 'public.store_performance', column: 'business_days', needle: '支援以 0.5 天為單位',
      meaning: '營業天數欄位註解是這支 migration 寫的（補強上一項的判斷）。只缺這項、上一項成立，代表欄位型別是用別的方式改的，沒有影響使用。' },
  ] },
  { migration: '20261004110000_monthly_store_summary_business_days_half_day', markers: [
    { kind: 'col_type', table: 'public.monthly_store_summary', column: 'business_days', type: 'numeric(4,1)',
      meaning: '門市月統計的營業天數欄位可放 0.5 天（numeric(4,1)，原本是整數）。' },
    { kind: 'col_comment_has', table: 'public.monthly_store_summary', column: 'business_days', needle: '支援 0.5 天',
      meaning: '營業天數欄位註解是這支 migration 寫的。只缺這項、上一項成立，代表欄位型別是用別的方式改的，沒有影響使用。' },
  ] },
  { migration: '20261007120000_add_acting_manager_movement_type', markers: [
    { kind: 'constraint_has', table: 'public.employee_movement_history', name: 'valid_movement_type', needle: 'acting_manager', superseded_by: SUP.s33,
      meaning: '異動類型約束允許「代理店長（acting_manager）」。正式區若沒套用，異動登記代理店長會被資料庫擋下。' },
    { kind: 'col_comment_has', table: 'public.employee_movement_history', column: 'movement_type', needle: 'acting_manager(代理)',
      meaning: '異動類型欄位註解是這支 migration 寫的（補強上一項）。只缺這項、上一項成立，代表約束是用別的方式改的，沒有影響使用。' },
  ] },
  { migration: '20261019120000_allow_zero_bonus_import', markers: [
    { kind: 'trigger_absent', table: 'public.monthly_bonus_records', name: 'trg_preserve_monthly_bonus_nonzero_values',
      meaning: '舊的「非零獎金不可被 0 覆蓋」觸發器已不存在（成立也可能是從來沒建過，結果都正確）。{{m9-sql/05_legacy_covered_check.verify.sql}}（05）也查同一件事。' },
    { kind: 'fn_absent', fn: 'public.preserve_monthly_bonus_nonzero_values()',
      meaning: '該觸發器的函式也已刪除。' },
  ] },
];

const undeterminable = [
  {
    migration: '20261005120000_repair_newbie_promotion_timeline',
    reason: '純資料修補：一次性 UPDATE，替升遷成「新人」的異動備註補上「新人等級:」，並依升遷歷史重算每月人員狀態的職位與新人階級。改完之後資料庫不留下任何痕跡（沒有新欄位、約束或註解），無法用唯讀查詢判斷它有沒有跑過。'
      + '風險：沒補的話，{{m9-sql/80_movement_batch_monthly_roster.sql}}（80_movement_batch_monthly_roster）的名冊重算會讀異動備註的「新人等級」，重算出的新人階級可能是空的或錯的。'
      + '後續取代情形：{{m9-sql/80_movement_batch_monthly_roster.sql}} 的重算會覆蓋「草稿月份」的每月人員狀態職位與階級，但不會補異動備註，已送審／已確認月份也不動，所以這支不算被完整取代。'
      + '替代做法：結果裡 observations 的兩個筆數就是這支 migration 現在還會改幾筆；0 代表已無待修（已套用或本來就不需要），大於 0 代表資料還沒修。',
  },
];

// 一次性資料修補的「還會改幾筆」估算（只讀）。sql 必須是只回傳單一數字（欄位 c）的 SELECT，
// 產生器會用 query_to_xml 包起來，並先檢查 requires 列的表與欄位都存在（不存在就回 null，不會讓整份報錯）。
const observations = [
  {
    migration: '20261005120000_repair_newbie_promotion_timeline',
    label: '待補「新人等級」備註的升遷異動筆數（0 = 已補或本來就不需要）',
    requires: ['public.employee_movement_history.notes', 'public.monthly_staff_status.newbie_level'],
    sql: `SELECT count(*) AS c
FROM public.employee_movement_history AS movement
JOIN LATERAL (
  SELECT monthly.newbie_level
  FROM public.monthly_staff_status AS monthly
  WHERE monthly.employee_code = movement.employee_code
    AND monthly.position = '新人'
    AND monthly.newbie_level IN ('未過階新人', '一階新人', '二階新人')
    AND monthly.year_month >= to_char(movement.movement_date, 'YYYY-MM')
    AND monthly.year_month < COALESCE((
      SELECT min(to_char(next_movement.movement_date, 'YYYY-MM'))
      FROM public.employee_movement_history AS next_movement
      WHERE next_movement.employee_code = movement.employee_code
        AND next_movement.movement_type = 'promotion'
        AND next_movement.movement_date > movement.movement_date
        AND next_movement.new_value <> '代理店長'
    ), '9999-12')
  ORDER BY CASE WHEN monthly.store_id = movement.store_id THEN 0 ELSE 1 END, monthly.year_month, monthly.updated_at DESC
  LIMIT 1
) AS snapshot ON true
WHERE movement.movement_type = 'promotion'
  AND movement.new_value = '新人'
  AND COALESCE(movement.notes, '') !~ '新人等級[:：]'`,
  },
  {
    migration: '20261005120000_repair_newbie_promotion_timeline',
    label: '每月人員狀態中，職位或新人階級與升遷歷史不一致的列數（0 = 已重算或本來就一致）',
    requires: ['public.employee_movement_history.notes', 'public.monthly_staff_status.newbie_level'],
    sql: `WITH monthly_targets AS (
  SELECT monthly.id, monthly.employee_code, monthly.year_month,
    (to_date(monthly.year_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date AS month_end
  FROM public.monthly_staff_status AS monthly
  WHERE EXISTS (
    SELECT 1 FROM public.employee_movement_history AS movement
    WHERE movement.employee_code = monthly.employee_code
      AND movement.movement_type = 'promotion'
      AND movement.movement_date < (to_date(monthly.year_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date
  )
), resolved_positions AS (
  SELECT target.id,
    COALESCE(regular_position.new_value, latest_movement.old_value, m0.position) AS resolved_position,
    (regexp_match(regular_position.notes, '(新人等級|行政階級)[:：]([^；\\n]+)'))[2] AS history_level
  FROM monthly_targets AS target
  JOIN public.monthly_staff_status AS m0 ON m0.id = target.id
  LEFT JOIN LATERAL (
    SELECT movement.new_value, movement.notes FROM public.employee_movement_history AS movement
    WHERE movement.employee_code = target.employee_code AND movement.movement_type = 'promotion'
      AND movement.new_value <> '代理店長' AND movement.movement_date < target.month_end
    ORDER BY movement.movement_date DESC, movement.created_at DESC, movement.id DESC LIMIT 1
  ) AS regular_position ON true
  LEFT JOIN LATERAL (
    SELECT movement.new_value, movement.old_value FROM public.employee_movement_history AS movement
    WHERE movement.employee_code = target.employee_code AND movement.movement_type = 'promotion'
      AND movement.movement_date < target.month_end
    ORDER BY movement.movement_date DESC, movement.created_at DESC, movement.id DESC LIMIT 1
  ) AS latest_movement ON true
)
SELECT count(*) AS c
FROM public.monthly_staff_status AS monthly
JOIN resolved_positions AS resolved ON resolved.id = monthly.id
WHERE monthly.position IS DISTINCT FROM resolved.resolved_position
  OR monthly.newbie_level IS DISTINCT FROM CASE
    WHEN resolved.resolved_position IN ('新人', '行政') THEN COALESCE(
      resolved.history_level,
      CASE WHEN monthly.position = resolved.resolved_position THEN monthly.newbie_level ELSE NULL END)
    ELSE NULL
  END`,
  },
];

module.exports = { migrations, undeterminable, observations, SUP };
