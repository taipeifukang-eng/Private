-- 還原 20261111110000_m7m8_b3_inventory_post.sql：移除第 3 批 B 新增的函式。不改任何資料（只有函式，沒有資料表變更）。
-- 還原後新版 G12 頁面無法過帳或載入餘額；舊版畫面與過帳核心 ga_post_inventory_transaction 完全不受影響。
DROP FUNCTION IF EXISTS public.ga_ws_inv_balance_page(uuid, uuid, text, boolean, boolean, text, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_inv_set_holding(uuid, numeric, numeric, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_inv_post(text, uuid, uuid, numeric, text, text, text, text, timestamptz, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_inv_map_error(text, text);
NOTIFY pgrst, 'reload schema';
