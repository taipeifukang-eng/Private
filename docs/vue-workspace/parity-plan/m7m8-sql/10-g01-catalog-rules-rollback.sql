-- 10-g01-catalog-rules-rollback.sql
-- 撤回 10-g01-catalog-rules.sql：移除 11 個 ga_ws_ 函式。只有新版（Vue 工作台）用到它們，舊版 /api/general-affairs 沒有用，移除不影響舊功能；但新版的分類停用／刪除、料件刪除、型號儲存、適用料件、設備歸戶會因此無法使用。
-- 這份只刪函式，不動任何資料。用法：整份貼上、一次 Run（檔案自己 BEGIN ... COMMIT，不需要另外執行 COMMIT;）。
BEGIN;
DROP FUNCTION IF EXISTS public.ga_ws_link_equipment_to_template(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_link_equipment_to_template(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_update_part_guarded(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_delete_template(text, uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_save_template(text, uuid, jsonb, uuid[], timestamptz, text);
DROP FUNCTION IF EXISTS public.ga_ws_replace_target_compat(text, uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.ga_ws_target_compat_version(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_delete_part(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_part_usage(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_delete_category(public.ga_category_kind, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_set_category_active(public.ga_category_kind, uuid, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_category_usage(public.ga_category_kind, uuid);
COMMIT;

-- 核對（COMMIT 之後）：應回 0 列
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'ga_ws_%';
