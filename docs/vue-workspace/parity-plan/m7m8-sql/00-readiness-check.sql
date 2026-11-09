-- 00-readiness-check.sql
-- M7/M8 總務 上線前準備度檢查（P1 到 P3）。純唯讀：只有 SELECT，沒有任何 INSERT/UPDATE/DELETE/DDL。
-- 在正式區（Supabase SQL Editor）與 DEV 都可以直接整份執行。
-- 結果欄位：section（檢查區塊）、item（項目）、status（OK／MISSING／WARN／INFO）、detail（說明）。
-- 只需要看 status 為 MISSING 或 WARN 的列；INFO 是參考資訊。
-- 對應規格「上線前正式區要檢查或執行的 SQL」：
--   P1 = 已套用 migration 清單，對照總務相關 migration
--   P2 = 資料表、QR 欄位與唯一規則、報廢自動作廢觸發器、函式、儲存空間
--   P3 = 權限碼與角色對應
-- 註：supabase_migrations 清單只代表「用 CLI 套過」；有些環境是手動貼 SQL，
--     所以 migration 列為 MISSING 時，請再看 P2 的物件是否實際存在，以物件為準。
-- 註：maintenance-photos（工單照片）不在第 1 批範圍，但先一併列出，第 5 批會用到。

with
migs(version, name) as (
  values
      ('20260722032048', 'general_affairs_inventory_locations'),
      ('20260722055852', 'fix_inventory_location_cascade_deletion_reason'),
      ('20260722065952', 'general_affairs_inventory_transactions_foundation'),
      ('20260722091526', 'revoke_inventory_transaction_sequence_grants'),
      ('20260722092849', 'restrict_inventory_transaction_function_execute_grants'),
      ('20260724011554', 'production_legacy_general_affairs_maintenance_compatibility'),
      ('20260724025452', 'production_legacy_inventory_inspection_monthly_compatibility'),
      ('20260724035445', 'production_legacy_product_relationship_clinic_performance_compatibility'),
      ('20260724040838', 'production_legacy_campaign_pharmacist_remaining_compatibility'),
      ('20260724042430', 'production_legacy_rbac_rpc_compatibility'),
      ('20260724092830', 'general_affairs_vendor_form_sections'),
      ('20260727015132', 'dev_general_affairs_role_matrix_permissions'),
      ('20260727021000', 'general_affairs_maintenance_work_order_permission_split'),
      ('20260729125755', 'general_affairs_resource_attachments'),
      ('20260730002830', 'generate_equipment_asset_code_sequence'),
      ('20260824090000', 'general_affairs_vendor_permissions_rls'),
      ('20260824093000', 'general_affairs_service_requests_foundation'),
      ('20260825143000', 'general_affairs_service_request_work_order_link'),
      ('20260826004500', 'general_affairs_service_request_comment_attachments'),
      ('20260826013000', 'general_affairs_asset_qr_scan_tokens'),
      ('20260826030000', 'general_affairs_asset_qr_auto_revoke'),
      ('20260826033000', 'general_affairs_equipment_onboarding_status'),
      ('20260826034500', 'general_affairs_equipment_onboarding_photo_sync'),
      ('20260826041000', 'general_affairs_equipment_onboarding_review'),
      ('20260826042500', 'general_affairs_store_onboarding_attachment_scope'),
      ('20260827093000', 'general_affairs_equipment_onboarding_reject_scope'),
      ('20260827103000', 'general_affairs_service_request_optional_repair_target'),
      ('20260827124500', 'general_affairs_service_request_typed_unbound_repair_target'),
      ('20260904093000', 'general_affairs_inventory_transfers'),
      ('20260908093000', 'general_affairs_purchase_reviews'),
      ('20260916093000', 'general_affairs_part_target_compatibilities'),
      ('20260918143000', 'general_affairs_part_fulfillments'),
      ('20260918150000', 'general_affairs_part_fulfillment_events'),
      ('20260920093000', 'general_affairs_facility_templates'),
      ('20260920113000', 'general_affairs_equipment_template_compatibilities'),
      ('20260920133000', 'general_affairs_facility_purchase_fields'),
      ('20260925093000', 'general_affairs_part_holding_status'),
      ('20260925103000', 'general_affairs_utility_bills'),
      ('20260925110000', 'general_affairs_utility_bill_electricity_usage'),
      ('20260926090000', 'general_affairs_utility_bill_identifiers'),
      ('20260926093000', 'general_affairs_internet_multiple_lines'),
      ('20260926100000', 'general_affairs_utility_bill_attachments'),
      ('20260926153000', 'general_affairs_production_role_matrix'),
      ('20260929090000', 'repair_general_affairs_asset_qr_schema')
),
req_tables(name) as (values ('ga_equipment_categories'), ('ga_facility_categories'), ('ga_part_categories'), ('ga_equipment_templates'), ('ga_facility_templates'), ('ga_equipment'), ('ga_facilities'), ('ga_parts'), ('ga_part_target_compatibilities'), ('ga_part_compatibilities'), ('ga_resource_attachments'), ('ga_asset_code_sequences'), ('ga_inventory_locations'), ('ga_inventory_location_parts'), ('ga_inventory_balances'), ('ga_inventory_transactions'), ('ga_inventory_transfers'), ('ga_inventory_transfer_items'), ('ga_inventory_holding_allocations'), ('ga_inventory_holding_events'), ('ga_service_requests'), ('ga_service_request_comments'), ('ga_service_request_events'), ('ga_part_fulfillments'), ('ga_part_fulfillment_documents'), ('ga_part_fulfillment_events'), ('ga_purchase_reviews'), ('ga_purchase_review_quotes'), ('maintenance_categories'), ('maintenance_requests'), ('maintenance_updates'), ('maintenance_photos'), ('maintenance_update_photos'), ('maintenance_progress_stages'), ('maintenance_ticket_events'), ('ga_vendors'), ('ga_service_categories'), ('ga_service_regions'), ('ga_utility_bills')),
req_funcs(name) as (values ('current_user_has_permission'), ('has_permission'), ('ga_soft_delete_category'), ('ga_soft_delete_part'), ('ga_soft_delete_equipment'), ('ga_soft_delete_equipment_template'), ('ga_soft_delete_facility'), ('ga_soft_delete_part_compatibility'), ('ga_soft_delete_resource_attachment'), ('ga_validate_part'), ('ga_validate_equipment'), ('ga_validate_equipment_template'), ('ga_validate_facility'), ('ga_validate_category_tree'), ('ga_validate_part_target_compatibility'), ('ga_validate_resource_attachment'), ('ga_next_equipment_asset_code'), ('ga_resource_attachment_can_read'), ('ga_resource_attachment_can_manage'), ('ga_revoke_asset_qr_on_terminal_status'), ('ga_post_inventory_transaction'), ('ga_soft_delete_inventory_location'), ('ga_next_inventory_transfer_no')),
req_perms(code) as (values ('general_affairs.cooperation_record.view'), ('general_affairs.equipment.manage'), ('general_affairs.equipment.view'), ('general_affairs.equipment_category.manage'), ('general_affairs.equipment_category.view'), ('general_affairs.equipment_template.manage'), ('general_affairs.equipment_template.view'), ('general_affairs.facility.manage'), ('general_affairs.facility.view'), ('general_affairs.facility_category.manage'), ('general_affairs.facility_category.view'), ('general_affairs.inventory_balance.view'), ('general_affairs.inventory_location.manage'), ('general_affairs.inventory_location.view'), ('general_affairs.inventory_transaction.manage'), ('general_affairs.inventory_transaction.view'), ('general_affairs.inventory_transfer.manage'), ('general_affairs.inventory_transfer.view'), ('general_affairs.maintenance_request.create'), ('general_affairs.maintenance_request.update'), ('general_affairs.maintenance_request.view_all'), ('general_affairs.maintenance_request.view_own_store'), ('general_affairs.part.manage'), ('general_affairs.part.view'), ('general_affairs.part_category.manage'), ('general_affairs.part_category.view'), ('general_affairs.part_fulfillment.manage'), ('general_affairs.part_fulfillment.view'), ('general_affairs.purchase_review.manage'), ('general_affairs.purchase_review.view'), ('general_affairs.request.comment_all'), ('general_affairs.request.comment_own_store'), ('general_affairs.request.confirm_own_store'), ('general_affairs.request.create'), ('general_affairs.request.manage'), ('general_affairs.request.view_all'), ('general_affairs.request.view_own_store'), ('general_affairs.service_category.manage'), ('general_affairs.service_category.view'), ('general_affairs.service_center.access'), ('general_affairs.service_center.force_close'), ('general_affairs.service_region.manage'), ('general_affairs.service_region.view'), ('general_affairs.utility_bill.manage'), ('general_affairs.utility_bill.view'), ('general_affairs.vendor.manage'), ('general_affairs.vendor.view'), ('general_affairs.work_order.manage'), ('general_affairs.work_order.update'), ('general_affairs.work_order.view_all'), ('general_affairs.work_order.view_own_store')),
mig_applied as (
  select (xpath('/row/v/text()', query_to_xml(
           'select coalesce(string_agg(version, chr(44)), chr(32)) as v from supabase_migrations.schema_migrations',
           false, true, '')))[1]::text as versions
  where to_regclass('supabase_migrations.schema_migrations') is not null
),
p1 as (
  select 'P1 migration' as section, m.version || ' ' || m.name as item,
         case when a.versions is null then 'WARN'
              when position(m.version in a.versions) > 0 then 'OK' else 'MISSING' end as status,
         case when a.versions is null then '找不到 supabase_migrations.schema_migrations，無法對照'
              when position(m.version in a.versions) > 0 then '已記錄套用'
              else 'schema_migrations 沒有這一筆（可能是手動套用，請以 P2 物件檢查為準）' end as detail
  from migs m left join mig_applied a on true
),
p2_tables as (
  select 'P2 資料表', t.name,
         case when c.oid is null then 'MISSING' when not c.relrowsecurity and t.name <> 'ga_asset_code_sequences' then 'WARN' else 'OK' end,
         case when c.oid is null then '資料表不存在'
              when not c.relrowsecurity and t.name = 'ga_asset_code_sequences' then '存在；此表設計上不開 RLS，改以撤銷 anon／authenticated 權限保護'
              when not c.relrowsecurity then '資料表存在但未啟用 RLS'
              else '存在，RLS 啟用，policy 數量 ' || (select count(*) from pg_policy p where p.polrelid = c.oid) end
  from req_tables t
  left join pg_class c on c.relname = t.name and c.relkind = 'r'
       and c.relnamespace = (select oid from pg_namespace where nspname = 'public')
),
p2_qr_cols as (
  select 'P2 QR 欄位', t.tbl || '.' || t.col,
         case when exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = t.tbl and column_name = t.col) then 'OK' else 'MISSING' end,
         'QR 永久網址 token 欄位'
  from (values ('ga_equipment', 'qr_token'), ('ga_facilities', 'qr_token')) t(tbl, col)
),
p2_qr_unique as (
  select 'P2 QR 唯一規則', t.tbl,
         case when exists (select 1 from pg_indexes i
                           where i.schemaname = 'public' and i.tablename = t.tbl
                             and i.indexdef ilike '%unique%' and i.indexdef ilike '%qr_token%') then 'OK' else 'MISSING' end,
         'qr_token 唯一索引'
  from (values ('ga_equipment'), ('ga_facilities')) t(tbl)
),
p2_qr_null as (
  select 'P2 QR token 空值', t.tbl,
         case when (xpath('/row/n/text()', query_to_xml(
                     'select count(*) as n from public.' || t.tbl || ' where deleted_at is null and (qr_token is null or qr_token = chr(39) || chr(39))',
                     false, true, '')))[1]::text = '0' then 'OK' else 'WARN' end,
         '未刪除且 qr_token 為空值的筆數應為 0（已貼出去的標籤不能重發）'
  from (values ('ga_equipment'), ('ga_facilities')) t(tbl)
  where exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = t.tbl and c.column_name in ('qr_token'))
    and exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = t.tbl and c.column_name = 'deleted_at')
),
p2_trigger as (
  select 'P2 報廢自動作廢觸發器', 'ga_revoke_asset_qr_on_terminal_status',
         case when exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                           where not g.tgisinternal and p.proname = 'ga_revoke_asset_qr_on_terminal_status') then 'OK' else 'MISSING' end,
         '掛在設備與設施資料表上的觸發器'
),
p2_funcs as (
  select 'P2 函式', f.name,
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = f.name) then 'OK' else 'MISSING' end,
         '函式存在與否（內容是否與程式庫一致，請另用 pg_get_functiondef 比對）'
  from req_funcs f
),
p2_bucket as (
  select 'P2 儲存空間', b.name,
         case when s.id is null then 'MISSING'
              when s.public then 'WARN'
              when b.name = 'general-affairs-attachments'
                   and (s.file_size_limit is distinct from 20971520
                        or s.allowed_mime_types is null
                        or not (s.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']))
                   then 'WARN'
              else 'OK' end,
         case when s.id is null then '儲存空間不存在'
              else 'public=' || s.public || '，單檔上限=' || coalesce(s.file_size_limit::text, '無')
                   || '，mime=' || coalesce(array_to_string(s.allowed_mime_types, ','), '不限') end
  from (values ('general-affairs-attachments'), ('maintenance-photos')) b(name)
  left join storage.buckets s on s.id = b.name
),
p3_perms as (
  select 'P3 權限碼', r.code,
         case when p.id is null then 'MISSING' when not p.is_active then 'WARN' else 'OK' end,
         case when p.id is null then 'permissions 表沒有這個碼' when not p.is_active then '存在但 is_active = false' else '存在且啟用' end
  from req_perms r left join public.permissions p on p.code = r.code
),
p3_roles as (
  select 'P3 角色持有總務權限數', ro.code || '（' || ro.name || '）', 'INFO',
         '持有總務權限碼 ' || count(*) filter (where p.code like 'general_affairs.%') || ' 個；角色啟用=' || ro.is_active
         || '；有效持有人數=' || (select count(*) from public.user_roles ur where ur.role_id = ro.id and ur.is_active)
  from public.roles ro
  join public.role_permissions rp on rp.role_id = ro.id and rp.is_allowed
  join public.permissions p on p.id = rp.permission_id
  group by ro.id, ro.code, ro.name, ro.is_active
  having count(*) filter (where p.code like 'general_affairs.%') > 0
),
p3_store_role_leak as (
  select 'P3 店長角色不應有的權限', ro.code || ' / ' || p.code, 'WARN',
         '店長角色持有設備、設施、料件、廠商或水電費權限（規格要求店長只有入口與報修相關）'
  from public.roles ro
  join public.role_permissions rp on rp.role_id = ro.id and rp.is_allowed
  join public.permissions p on p.id = rp.permission_id
  where (ro.code ilike '%store_manager%' or ro.name like '%店長%')
    and ro.code not like 'vue\_workspace\_%'
    and p.code ~ '^general_affairs\.(equipment|facility|part|vendor|utility_bill|equipment_template|equipment_category|facility_category|part_category)\.'
)
select * from p1
union all select * from p2_tables
union all select * from p2_qr_cols
union all select * from p2_qr_unique
union all select * from p2_qr_null
union all select * from p2_trigger
union all select * from p2_funcs
union all select * from p2_bucket
union all select * from p3_perms
union all select * from p3_roles
union all select * from p3_store_role_leak
order by 1, 2;
