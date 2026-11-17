-- 48-b6-vendor-tax-unique-rollback.sql
-- 撤回 48：只移除統編唯一索引 ga_vendors_tax_id_norm_uidx（不改資料）。撤回後統編唯一只剩 ga_ws_vendor_save 的檢查（舊頁與直接寫入不受限）。
BEGIN;
DROP INDEX IF EXISTS public.ga_vendors_tax_id_norm_uidx;
REVOKE EXECUTE ON FUNCTION public.ga_vd_norm_tax(text) FROM authenticated; -- 還原 44 原本的狀態（只有函式內部呼叫）
COMMIT;
