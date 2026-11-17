-- 42-b6-vendor-columns-rollback.sql
-- 撤回 42：移除縣市行政區固定資料（只刪沒被廠商使用、沒有下層、且 code 屬固定資料的）、code 唯一索引、合約到期索引，預設值還原為 true（舊 migration 的預設），移除三個 updated_by 欄位。
-- 不移除 13 個廠商擴充欄位（正式區若 42 之前不存在而由 42 新增，也不移除，避免丟資料；要移除請另行確認）；既有廠商 contract_required 的值不還原（一次性改 false 無法回推原值，要還原請用 42 套用前的備份）。
-- 先撤回 44、47（它們會讀 updated_by）；43 若已套用先撤回 43。撤回前先備份 ga_vendors、ga_service_categories、ga_service_regions。
BEGIN;
-- 固定資料：由下往上刪（行政區、縣市、大區、國家），跳過被廠商使用的；只依固定資料的 code 認定。
DO $$
DECLARE
  v_type text;
BEGIN
  FOREACH v_type IN ARRAY ARRAY['district', 'city', 'region', 'country'] LOOP
    DELETE FROM public.ga_service_regions r
     WHERE r.region_type = v_type
       AND (r.code IN ('TW', 'TW-N', 'TW-C', 'TW-S', 'TW-E', 'TW-O') OR r.code ~ '^(KEE|TPE|TPH|TYC|HSZ|HSQ|ILA|MIA|TXG|CHA|NAN|YUN|CYI|CYQ|TNN|KHH|PIF|HUA|TTT|PEN|KIN|LIE)(-[0-9]{2})?$')
       AND NOT EXISTS (SELECT 1 FROM public.ga_vendors v WHERE r.id = ANY (v.service_region_ids))
       AND NOT EXISTS (SELECT 1 FROM public.ga_service_regions c WHERE c.parent_id = r.id);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.idx_ga_vendors_contract_due;
DROP INDEX IF EXISTS public.uq_ga_service_regions_code;
DROP INDEX IF EXISTS public.uq_ga_service_categories_code;
ALTER TABLE public.ga_vendors ALTER COLUMN contract_required SET DEFAULT true;
ALTER TABLE public.ga_vendors ALTER COLUMN preferred_vendor SET DEFAULT true;
ALTER TABLE public.ga_vendors DROP COLUMN IF EXISTS updated_by;
ALTER TABLE public.ga_service_categories DROP COLUMN IF EXISTS updated_by;
ALTER TABLE public.ga_service_regions DROP COLUMN IF EXISTS updated_by;
NOTIFY pgrst, 'reload schema';
COMMIT;
