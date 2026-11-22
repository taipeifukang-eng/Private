-- Rollback of 20261107160000_m4_grade_snapshot.sql (DEV only).
BEGIN;
DROP TRIGGER IF EXISTS workspace_01_grade_snapshot ON public.inspection_masters;
DROP TRIGGER IF EXISTS workspace_grade_from_settings ON public.inspection_masters;
CREATE OR REPLACE FUNCTION public.workspace_grade_from_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN SELECT g.grade::text INTO NEW.grade FROM inspection_grade_mapping g WHERE g.min_score<=NEW.total_score ORDER BY g.grade DESC LIMIT 1; NEW.grade:=coalesce(NEW.grade,'0'); RETURN NEW; END; $$;
CREATE TRIGGER workspace_grade_from_settings BEFORE INSERT OR UPDATE OF total_score ON public.inspection_masters FOR EACH ROW EXECUTE FUNCTION public.workspace_grade_from_settings();
CREATE OR REPLACE FUNCTION public.update_inspection_bonus_total()
RETURNS TRIGGER AS $$
DECLARE
  v_new_bonus DECIMAL(5,1);
  v_old_bonus DECIMAL(5,1);
  v_base_score NUMERIC;
  v_new_total NUMERIC;
  v_new_grade TEXT;
BEGIN
  PERFORM 1 FROM inspection_masters WHERE id = NEW.inspection_id FOR UPDATE;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP FUNCTION IF EXISTS public.workspace_snapshot_grade_thresholds();
DROP FUNCTION IF EXISTS public.workspace_grade_for_score(numeric,jsonb);
ALTER TABLE public.inspection_masters DROP COLUMN IF EXISTS grade_thresholds;
NOTIFY pgrst,'reload schema';
COMMIT;
