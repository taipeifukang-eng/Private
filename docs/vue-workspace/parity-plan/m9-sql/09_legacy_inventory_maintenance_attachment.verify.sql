-- 唯讀驗證 09_legacy_inventory_maintenance_attachment.sql（只有 SELECT）。套用後每列 ok 都應為 true；rollback 後第 1～11 列應為 false。
-- 第 10 列：剛做完 09 時 md5 應等於 41a29efc4e62b01a7ce8f7d0fce9eead（總務第 2 批 22 的守衛）；22 之後函式多了設施分支，md5 會變，那也算通過。
-- 最後一列 info 是參考資訊（維修回報政策不在 09 處理範圍），恆為 true。
WITH f AS (
  SELECT
    pg_get_functiondef(to_regprocedure('public.ga_soft_delete_inventory_location(uuid,text)')) AS soft_def,
    pg_get_functiondef(to_regprocedure('public.ga_post_inventory_transaction(text,uuid,uuid,numeric,text,text,text,text,uuid,text,timestamptz,jsonb)')) AS post_def,
    pg_get_functiondef(to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)')) AS manage_def
)
SELECT '01 ga_soft_delete_inventory_location 已是修正版（不含「父庫存位置刪除衍生」前綴）' AS item,
  COALESCE(f.soft_def IS NOT NULL AND position('父庫存位置刪除衍生' IN f.soft_def) = 0, false) AS ok
FROM f
UNION ALL
SELECT '02 ga_soft_delete_inventory_location authenticated 可執行',
  COALESCE(has_function_privilege('authenticated', to_regprocedure('public.ga_soft_delete_inventory_location(uuid,text)'), 'EXECUTE'), false)
UNION ALL
SELECT '03 ga_post_inventory_transaction 用 ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique', COALESCE(position('ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING;' IN f.post_def) > 0, false) FROM f
UNION ALL
SELECT '04 ga_post_inventory_transaction 不再含 ON CONFLICT (location_id, part_id) 舊寫法', COALESCE(position('ON CONFLICT (' || 'location_id, part_id' || ') DO NOTHING;' IN f.post_def) = 0, false) FROM f
UNION ALL
SELECT '05 序列 ga_inventory_transaction_no_seq：authenticated、anon 都沒有 USAGE，service_role 仍有',
  COALESCE(has_sequence_privilege('authenticated', to_regclass('public.ga_inventory_transaction_no_seq'), 'USAGE') = false
    AND has_sequence_privilege('anon', to_regclass('public.ga_inventory_transaction_no_seq'), 'USAGE') = false
    AND has_sequence_privilege('service_role', to_regclass('public.ga_inventory_transaction_no_seq'), 'USAGE') = true, false)
UNION ALL
SELECT '06 ga_next_inventory_transaction_no()：authenticated、anon 都不能執行，service_role 仍可',
  COALESCE(has_function_privilege('authenticated', to_regprocedure('public.ga_next_inventory_transaction_no()'), 'EXECUTE') = false
    AND has_function_privilege('anon', to_regprocedure('public.ga_next_inventory_transaction_no()'), 'EXECUTE') = false
    AND has_function_privilege('service_role', to_regprocedure('public.ga_next_inventory_transaction_no()'), 'EXECUTE') = true, false)
UNION ALL
SELECT '07 ga_post_inventory_transaction：authenticated、service_role 可執行，anon 不行',
  COALESCE(has_function_privilege('authenticated', to_regprocedure('public.ga_post_inventory_transaction(text,uuid,uuid,numeric,text,text,text,text,uuid,text,timestamptz,jsonb)'), 'EXECUTE') = true
    AND has_function_privilege('service_role', to_regprocedure('public.ga_post_inventory_transaction(text,uuid,uuid,numeric,text,text,text,text,uuid,text,timestamptz,jsonb)'), 'EXECUTE') = true
    AND has_function_privilege('anon', to_regprocedure('public.ga_post_inventory_transaction(text,uuid,uuid,numeric,text,text,text,text,uuid,text,timestamptz,jsonb)'), 'EXECUTE') = false, false)
UNION ALL
SELECT '08 ga_resource_attachment_can_manage 含設備待貼標分支（e.onboarding_status IN (NEEDS_EQUIPMENT_PHOTO…)）', COALESCE(position('e.onboarding_status IN (''NEEDS_EQUIPMENT_PHOTO''' IN f.manage_def) > 0, false) FROM f
UNION ALL
SELECT '09 ga_resource_attachment_can_manage 含需求單建立人分支（OR sr.created_by = auth.uid()）且不含舊的 comment_own_store 分支',
  COALESCE(position('OR sr.created_by = auth.uid()' IN f.manage_def) > 0 AND position('request.comment_own_store' IN f.manage_def) = 0, false) FROM f
UNION ALL
SELECT '10 ga_resource_attachment_can_manage 的 md5 = 41a29efc…（剛做完 09）；或已被總務第 2 批以後的步驟加上設施分支（md5 會變）',
  COALESCE(md5(f.manage_def) = '41a29efc4e62b01a7ce8f7d0fce9eead' OR position('f.onboarding_status IN (' IN f.manage_def) > 0, false) FROM f
UNION ALL
SELECT '11 ga_resource_attachment_can_manage：authenticated 可執行、anon 不可、函式本文沒有 CR 換行字元',
  COALESCE(has_function_privilege('authenticated', to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)'), 'EXECUTE') = true
    AND has_function_privilege('anon', to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)'), 'EXECUTE') = false
    AND position(chr(13) IN f.manage_def) = 0, false) FROM f
UNION ALL
SELECT 'info:維修回報 maintenance_requests 現有政策（不在 09 處理範圍；正式區預期是 maintenance_requests_read、maintenance_requests_write 兩條全開）='
    || COALESCE((SELECT string_agg(policyname, '、' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_requests'), '（無）'),
  true
ORDER BY 1;
