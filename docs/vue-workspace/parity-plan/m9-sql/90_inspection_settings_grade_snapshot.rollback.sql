-- 還原 90_inspection_settings_grade_snapshot.sql（正式區草稿，尚未套用）。
-- 白話：移除新增的觸發器、函式、設定版本表與儲存收據表，把 update_inspection_bonus_total
-- 還原成正式區原本的版本（寫死 220/215/191... 門檻，INT 計算），並移除 grade_thresholds 欄位。
-- 注意
--   * 移除 grade_thresholds 欄位會丟掉所有「完成當時門檻」的 snapshot（各單評級仍保留，
--     但之後不再受 snapshot 保護）。要保留請先自行備份：
--       CREATE TABLE public.m9_grade_thresholds_backup AS SELECT id, grade_thresholds FROM public.inspection_masters WHERE grade_thresholds IS NOT NULL;
--   * 「種入預設評級對照／加分設定」只在表為空時執行，無法分辨，所以不刪任何設定資料。
--   * 備份表 public.m9_inspection_settings_backup 不刪除，留作對照。
--   * 若 50_inspection_write_core 已套用（它的 workspace_save_inspection 會讀 revision 表），
--     請先還原 50，否則巡店儲存會因 revision 表消失而失敗。
BEGIN;

DROP TRIGGER IF EXISTS workspace_01_grade_snapshot ON public.inspection_masters;
DROP TRIGGER IF EXISTS workspace_grade_from_settings ON public.inspection_masters;
DROP TRIGGER IF EXISTS workspace_settings_changed ON public.inspection_templates;
DROP TRIGGER IF EXISTS workspace_settings_changed ON public.inspection_bonus_config;
DROP TRIGGER IF EXISTS workspace_settings_changed ON public.inspection_grade_mapping;

-- 先還原 update_inspection_bonus_total（它引用 workspace_grade_for_score，必須先換掉才能移除）。
-- 優先用備份表 public.m9_inspection_settings_backup（name='update_inspection_bonus_total'）：那是「套用 90 之前」的版本，
--   如果已先套用 55，備份的就是 55 的版本（NUMERIC、先鎖單），還原後不會把 55 的改善一併洗掉。
-- 備份不存在時，才退回「正式區原本版本」（來自 schema-intake/production-public.schema-only.sql：寫死 220/215/191... 門檻、INT 計算）。
DO $restore$
DECLARE d text;
BEGIN
  IF to_regclass('public.m9_inspection_settings_backup') IS NOT NULL THEN
    SELECT definition INTO d FROM public.m9_inspection_settings_backup WHERE name = 'update_inspection_bonus_total';
  END IF;
  IF d IS NOT NULL THEN
    EXECUTE d;
    RAISE NOTICE 'update_inspection_bonus_total 已依備份還原為套用 90 之前的版本';
  ELSE
    RAISE NOTICE '找不到備份，退回正式區原本版本（若已套用 55，請再重跑 55_improvements_bonus.sql）';
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.update_inspection_bonus_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_new_bonus DECIMAL(5,1);
  v_old_bonus DECIMAL(5,1);
  v_base_score INT;
  v_new_total INT;
  v_new_grade TEXT;
BEGIN
  SELECT COALESCE(SUM(bonus_score), 0) INTO v_new_bonus
  FROM inspection_improvements
  WHERE inspection_id = NEW.inspection_id
    AND status = 'improved';

  SELECT COALESCE(improvement_bonus, 0), COALESCE(total_score, 0)
  INTO v_old_bonus, v_base_score
  FROM inspection_masters
  WHERE id = NEW.inspection_id;

  v_base_score := v_base_score - v_old_bonus;
  v_new_total := v_base_score + v_new_bonus;

  IF v_new_total >= 220 THEN v_new_grade := '10';
  ELSIF v_new_total >= 215 THEN v_new_grade := '9';
  ELSIF v_new_total >= 191 THEN v_new_grade := '8';
  ELSIF v_new_total >= 181 THEN v_new_grade := '7';
  ELSIF v_new_total >= 171 THEN v_new_grade := '6';
  ELSIF v_new_total >= 161 THEN v_new_grade := '5';
  ELSIF v_new_total >= 151 THEN v_new_grade := '4';
  ELSIF v_new_total >= 141 THEN v_new_grade := '3';
  ELSIF v_new_total >= 131 THEN v_new_grade := '2';
  ELSIF v_new_total >= 121 THEN v_new_grade := '1';
  ELSE v_new_grade := '0';
  END IF;

  UPDATE inspection_masters
  SET improvement_bonus = v_new_bonus,
      total_score = v_new_total,
      grade = v_new_grade
  WHERE id = NEW.inspection_id;

  RETURN NEW;
END;
$$;
$fn$;
  END IF;
END $restore$;

DROP FUNCTION IF EXISTS public.workspace_save_inspection_settings(uuid,bigint,uuid,text,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.workspace_bump_inspection_settings();
DROP FUNCTION IF EXISTS public.workspace_grade_from_settings();
DROP FUNCTION IF EXISTS public.workspace_snapshot_grade_thresholds();
DROP FUNCTION IF EXISTS public.workspace_grade_for_score(numeric,jsonb);
DROP TABLE IF EXISTS public.workspace_inspection_settings_writes;
DROP TABLE IF EXISTS public.workspace_inspection_settings_revision;
ALTER TABLE public.inspection_masters DROP COLUMN IF EXISTS grade_thresholds;

NOTIFY pgrst, 'reload schema';
COMMIT;
