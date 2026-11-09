-- 還原：移除第 1 批新增的 ga_ws_* 函式（只有新版使用，舊版 /api/general-affairs 與既有資料表都沒用到，移除不影響舊功能）。
DROP FUNCTION IF EXISTS public.ga_ws_link_equipment_to_template(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_delete_template(text, uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_save_template(text, uuid, jsonb, uuid[], timestamptz, text);
DROP FUNCTION IF EXISTS public.ga_ws_replace_target_compat(text, uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.ga_ws_target_compat_version(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_delete_part(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_part_usage(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_delete_category(public.ga_category_kind, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_set_category_active(public.ga_category_kind, uuid, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_category_usage(public.ga_category_kind, uuid);
NOTIFY pgrst, 'reload schema';
