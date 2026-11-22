-- 撤回 20261118140000：移除統編唯一索引（不改資料）。
BEGIN;
DROP INDEX IF EXISTS public.ga_vendors_tax_id_norm_uidx;
REVOKE EXECUTE ON FUNCTION public.ga_vd_norm_tax(text) FROM authenticated; -- 還原 44 原本的狀態（只有函式內部呼叫）
COMMIT;
