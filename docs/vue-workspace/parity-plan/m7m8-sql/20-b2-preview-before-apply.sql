-- 20-b2-preview-before-apply.sql
-- M7/M8 第 2 批（G06-G10）套用 21、22、23 之前先看的現況檢查。唯讀（只有 SELECT），整份可直接貼上執行，不會改任何資料。
-- 每列有 section（區）、item（項目）、value（數字或內容）、status（OK＝正常；MISSING＝缺東西，不要套用；ALREADY＝已經有了（重複套用沒問題，但請確認是不是上次套的）；INFO＝只是現況；WARN＝需要你看一下）。
-- 只需要看 status 是 MISSING、WARN、ALREADY 的列；INFO 是現況數字，給你決定上線貼標怎麼安排。
WITH
req_tables AS (
  SELECT t AS name FROM unnest(ARRAY['ga_equipment', 'ga_facilities', 'ga_resource_attachments', 'ga_service_requests', 'maintenance_requests',
                                      'store_managers', 'stores', 'profiles', 'ga_equipment_categories', 'ga_facility_categories', 'ga_asset_code_sequences']) t
),
req_fns AS (
  SELECT f AS name FROM unnest(ARRAY['has_permission', 'current_user_has_permission', 'ga_is_store_active', 'ga_soft_delete_equipment', 'ga_soft_delete_facility',
                                      'ga_sync_equipment_onboarding_status', 'ga_calculate_equipment_onboarding_status', 'ga_resource_attachment_can_manage',
                                      'ga_revoke_asset_qr_on_terminal_status', 'ga_next_equipment_asset_code']) f
),
new_objs AS (
  SELECT o AS name FROM unnest(ARRAY['ga_asset_transfers', 'ga_asset_transfer_photos', 'ga_asset_events', 'ga_asset_import_batches', 'ga_m7m8_function_backups']) o
),
cm AS (
  SELECT md5(pg_get_functiondef(p.oid)) AS md5_now
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ga_resource_attachment_can_manage' AND pg_get_function_identity_arguments(p.oid) = 'p_resource_type text, p_resource_id uuid'
)
SELECT '1 先決條件' AS section, '資料表 ' || r.name AS item, to_regclass('public.' || r.name)::text AS value,
       CASE WHEN to_regclass('public.' || r.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS status
  FROM req_tables r
UNION ALL
SELECT '1 先決條件', '函式 ' || r.name, (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.name),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.name) THEN 'OK' ELSE 'MISSING' END
  FROM req_fns r
UNION ALL
SELECT '1 先決條件', '設備貼標欄位 onboarding_requires_label_photo',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_equipment' AND column_name = 'onboarding_requires_label_photo'),
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_equipment' AND column_name = 'onboarding_requires_label_photo') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '1 先決條件', '設施 QR 欄位 qr_token / qr_token_revoked_at',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_facilities' AND column_name IN ('qr_token', 'qr_token_revoked_at')),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_facilities' AND column_name IN ('qr_token', 'qr_token_revoked_at')) = 2 THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '1 先決條件', '報廢自動作廢 QR 觸發器（設備、設施各一）',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('trg_ga_equipment_qr_auto_revoke', 'trg_ga_facilities_qr_auto_revoke') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_ga_equipment_qr_auto_revoke', 'trg_ga_facilities_qr_auto_revoke') AND NOT tgisinternal) = 2 THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '1 先決條件', '附件儲存空間 general-affairs-attachments（私有）',
       (SELECT COALESCE(max(public::text), 'none') FROM storage.buckets WHERE id = 'general-affairs-attachments'),
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'general-affairs-attachments' AND NOT public) THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- 2 新增物件現況：預期都還不存在
SELECT '2 新增物件現況', n.name, to_regclass('public.' || n.name)::text, CASE WHEN to_regclass('public.' || n.name) IS NULL THEN 'OK' ELSE 'ALREADY' END
  FROM new_objs n
UNION ALL
SELECT '2 新增物件現況', 'ga_facilities.onboarding_* 欄位數（尚未套用應為 0）',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_facilities' AND column_name LIKE 'onboarding_%'),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_facilities' AND column_name LIKE 'onboarding_%') = 0 THEN 'OK' ELSE 'ALREADY' END
UNION ALL
SELECT '2 新增物件現況', 'ga_ws_ 第 2 批函式數（尚未套用應為 0）',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
          AND p.proname IN ('ga_ws_asset_open_orders', 'ga_ws_correct_asset_store', 'ga_ws_delete_asset', 'ga_ws_restore_asset', 'ga_ws_transfer_create', 'ga_ws_transfer_confirm_handover',
                            'ga_ws_transfer_confirm_receive', 'ga_ws_transfer_cancel', 'ga_ws_onboarding_list', 'ga_ws_submit_onboarding_photo', 'ga_ws_review_onboarding',
                            'ga_ws_onboarding_progress', 'ga_ws_import_assets', 'ga_ws_asset_maintenance_history', 'ga_ws_asset_repair_summary')),
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
          AND p.proname IN ('ga_ws_asset_open_orders', 'ga_ws_correct_asset_store', 'ga_ws_delete_asset', 'ga_ws_restore_asset', 'ga_ws_transfer_create', 'ga_ws_transfer_confirm_handover',
                            'ga_ws_transfer_confirm_receive', 'ga_ws_transfer_cancel', 'ga_ws_onboarding_list', 'ga_ws_submit_onboarding_photo', 'ga_ws_review_onboarding',
                            'ga_ws_onboarding_progress', 'ga_ws_import_assets', 'ga_ws_asset_maintenance_history', 'ga_ws_asset_repair_summary')) = 0 THEN 'OK' ELSE 'ALREADY' END
UNION ALL
-- 3 附件管理判斷函式：22 會重新定義它，套用前內容必須與 DEV 驗證時的原始內容相同（md5 = 41a29efc4e62b01a7ce8f7d0fce9eead）。不同的話 22 會自己中止。
SELECT '3 附件管理判斷', 'ga_resource_attachment_can_manage 目前 md5（預期 41a29efc4e62b01a7ce8f7d0fce9eead，或 22 套用後的新值）', cm.md5_now,
       CASE WHEN cm.md5_now = '41a29efc4e62b01a7ce8f7d0fce9eead' THEN 'OK' ELSE 'WARN' END
  FROM cm
UNION ALL
SELECT '3 附件管理判斷', 'ga_resource_attachment_can_manage 是否已含設施店長分支（22 套用後應為 true）',
       (SELECT (pg_get_functiondef(p.oid) LIKE '%f.onboarding_status IN%')::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'ga_resource_attachment_can_manage' LIMIT 1), 'INFO'
UNION ALL
-- 4 現況數字
SELECT '4 設備現況', '未刪除設備', count(*)::text, 'INFO' FROM ga_equipment WHERE deleted_at IS NULL
UNION ALL
SELECT '4 設備現況', '已刪除設備', count(*)::text, 'INFO' FROM ga_equipment WHERE deleted_at IS NOT NULL
UNION ALL
SELECT '4 設備現況', '狀態 ' || status || '（未刪除）', count(*)::text, 'INFO' FROM ga_equipment WHERE deleted_at IS NULL GROUP BY status
UNION ALL
SELECT '4 設備現況', '貼標進度 ' || onboarding_status || '（未刪除）', count(*)::text, 'INFO' FROM ga_equipment WHERE deleted_at IS NULL GROUP BY onboarding_status
UNION ALL
SELECT '4 設備現況', '沒有設備編號（標籤會印不出編號，新版會警告）', count(*)::text, CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END FROM ga_equipment WHERE deleted_at IS NULL AND asset_code IS NULL
UNION ALL
SELECT '4 設備現況', '未刪除但沒有 QR token（必須為 0，已貼的標籤不能重發）', count(*)::text, CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END FROM ga_equipment WHERE deleted_at IS NULL AND qr_token IS NULL
UNION ALL
SELECT '4 設備現況', '已報廢但 QR 未作廢（應為 0）', count(*)::text, CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END FROM ga_equipment WHERE deleted_at IS NULL AND status = 'SCRAPPED' AND qr_token_revoked_at IS NULL
UNION ALL
SELECT '5 設施現況', '未刪除設施', count(*)::text, 'INFO' FROM ga_facilities WHERE deleted_at IS NULL
UNION ALL
SELECT '5 設施現況', '狀態 ' || status || '（未刪除）', count(*)::text, 'INFO' FROM ga_facilities WHERE deleted_at IS NULL GROUP BY status
UNION ALL
SELECT '5 設施現況', '未刪除但沒有 QR token（必須為 0）', count(*)::text, CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END FROM ga_facilities WHERE deleted_at IS NULL AND qr_token IS NULL
UNION ALL
SELECT '5 設施現況', '已有設施照片（PRIMARY_IMAGE）的設施（22 回填時不會再要求這些設施重傳設施照片）', count(DISTINCT resource_id)::text, 'INFO'
  FROM ga_resource_attachments WHERE resource_type = 'FACILITY' AND purpose = 'PRIMARY_IMAGE' AND deleted_at IS NULL AND content_type LIKE 'image/%'
UNION ALL
SELECT '5 設施現況', '已有貼標位置照片（LABEL_POSITION_IMAGE）的設施', count(DISTINCT resource_id)::text, 'INFO'
  FROM ga_resource_attachments WHERE resource_type = 'FACILITY' AND purpose = 'LABEL_POSITION_IMAGE' AND deleted_at IS NULL AND content_type LIKE 'image/%'
UNION ALL
-- 6 新規則影響：有未結案單的資產（新版禁止刪除，只能報廢）
SELECT '6 新規則影響', '有未結案報修單的設備數（新版不能刪除，只能報廢）', count(DISTINCT equipment_id)::text, 'INFO'
  FROM ga_service_requests WHERE deleted_at IS NULL AND equipment_id IS NOT NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')
UNION ALL
SELECT '6 新規則影響', '有未結案報修單的設施數', count(DISTINCT facility_id)::text, 'INFO'
  FROM ga_service_requests WHERE deleted_at IS NULL AND facility_id IS NOT NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')
UNION ALL
SELECT '6 新規則影響', '報修單指向「已刪除」設備的筆數（舊版刪除不檢查未結案單留下的）', count(*)::text, CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END
  FROM ga_service_requests sr JOIN ga_equipment e ON e.id = sr.equipment_id
 WHERE sr.deleted_at IS NULL AND e.deleted_at IS NOT NULL AND sr.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')
UNION ALL
SELECT '6 新規則影響', '有設備或設施、但沒有「店長」名單身分（store_managers.role_type = store_manager）的門市數（這些門市無法確認轉移單；貼標待辦則名單內任何身分都能處理）', count(*)::text,
       CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END
  FROM (SELECT store_id FROM ga_equipment WHERE deleted_at IS NULL UNION SELECT store_id FROM ga_facilities WHERE deleted_at IS NULL) s
 WHERE NOT EXISTS (SELECT 1 FROM store_managers sm WHERE sm.store_id = s.store_id AND sm.role_type = 'store_manager')
ORDER BY 1, 2;
