-- 還原 20261111130000_m7m8_b3_category_keep_inactive.sql：依備份把 ga_validate_equipment、ga_validate_facility 還原成套用前的內容。
-- 還原後：分類被停用的設備與設施，修改任何欄位又會被擋（回到舊行為）。備份表保留，確認一切正常後可自行 DROP TABLE ga_m7m8_function_backups。
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT definition INTO v_def FROM public.ga_m7m8_function_backups WHERE name = 'ga_validate_equipment()';
  IF v_def IS NULL THEN RAISE EXCEPTION '找不到 ga_validate_equipment 的備份（ga_m7m8_function_backups），不要還原，請先回報'; END IF;
  EXECUTE v_def;
  SELECT definition INTO v_def FROM public.ga_m7m8_function_backups WHERE name = 'ga_validate_facility()';
  IF v_def IS NULL THEN RAISE EXCEPTION '找不到 ga_validate_facility 的備份（ga_m7m8_function_backups），不要還原，請先回報'; END IF;
  EXECUTE v_def;
END $$;
NOTIFY pgrst, 'reload schema';
