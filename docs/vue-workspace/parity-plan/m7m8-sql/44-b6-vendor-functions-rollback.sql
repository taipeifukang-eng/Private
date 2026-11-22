-- 44-b6-vendor-functions-rollback.sql
-- 撤回 44：移除第 6 批廠商、服務分類、服務區域函式與內部輔助函式（沒有資料表變更，不影響既有資料）。撤回後新版廠商、分類、區域頁與工單廠商下拉無法使用，
-- 需求單採購評估頁的廠商下拉也會失效（它改走 ga_ws_vendor_options）。43 若已套用要先撤回 43。撤回前不需要備份（只有函式）。
BEGIN;
DROP FUNCTION IF EXISTS public.ga_ws_vendor_list(jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_vendor_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_vendor_save(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_vendor_set_status(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_vendor_options(text, integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public.ga_ws_svc_category_list(jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_svc_category_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_svc_category_save(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_svc_region_list(jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_svc_region_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_svc_region_save(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_vd_json(public.ga_vendors, boolean);
DROP FUNCTION IF EXISTS public.ga_vd_tree_cycle(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_vd_contract_due(text, boolean, date);
DROP FUNCTION IF EXISTS public.ga_vd_int(jsonb, text, text);
DROP FUNCTION IF EXISTS public.ga_vd_bool(jsonb, text, text);
DROP FUNCTION IF EXISTS public.ga_vd_uuid_arr(jsonb, text, text);
DROP FUNCTION IF EXISTS public.ga_vd_txt_arr(jsonb, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.ga_vd_txt(jsonb, text, integer, text);
DROP FUNCTION IF EXISTS public.ga_vd_date(text, text);
DROP FUNCTION IF EXISTS public.ga_vd_norm_name(text);
DROP FUNCTION IF EXISTS public.ga_vd_tax_checksum_ok(text);
DROP FUNCTION IF EXISTS public.ga_vd_norm_tax(text);
DROP FUNCTION IF EXISTS public.ga_vd_can_options(uuid);
DROP FUNCTION IF EXISTS public.ga_vd_can_manage(uuid);
DROP FUNCTION IF EXISTS public.ga_vd_can_view(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
