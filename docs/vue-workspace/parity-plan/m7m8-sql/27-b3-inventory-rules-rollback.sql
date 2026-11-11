-- 27-b3-inventory-rules-rollback.sql
-- 撤回 27：移除第 3 批 A 新增的觸發器與函式（不改任何資料）。撤回後位置有交易仍可改類型／門市／代碼、有進行中調撥仍可停用位置、有庫存的料件可被停用。
BEGIN;
DROP TRIGGER IF EXISTS trg_ga_parts_block_deactivate_with_stock ON public.ga_parts;
DROP TRIGGER IF EXISTS trg_ga_inventory_locations_guard ON public.ga_inventory_locations;
DROP FUNCTION IF EXISTS public.ga_parts_block_deactivate_with_stock();
DROP FUNCTION IF EXISTS public.ga_inventory_locations_guard();
DROP FUNCTION IF EXISTS public.ga_ws_inv_remove_location_part(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_inv_update_location_part(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_inv_add_location_parts(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_inv_delete_location(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_inv_save_location(uuid, jsonb, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_inv_location_counts(uuid[]);
DROP FUNCTION IF EXISTS public.ga_ws_inv_location_impact(uuid);
DROP FUNCTION IF EXISTS public.ga_inv_jsonb_key_count(jsonb);
DROP FUNCTION IF EXISTS public.ga_inv_setting_impact_json(uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_inv_location_impact_json(uuid);
DROP FUNCTION IF EXISTS public.ga_inv_location_has_history(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
