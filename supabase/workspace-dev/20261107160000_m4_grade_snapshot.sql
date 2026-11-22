-- DEV only (M4 Q5): 每張巡店單以「完成當時」的評級門檻為準（snapshot）。
-- 改善加分只加分數，評級仍用該單的 snapshot 門檻；之後改評級對照表不影響已完成的單。
BEGIN;
ALTER TABLE public.inspection_masters ADD COLUMN IF NOT EXISTS grade_thresholds jsonb;
COMMENT ON COLUMN public.inspection_masters.grade_thresholds IS 'M4 Q5: grade thresholds snapshot [{grade,min_score}] taken when the inspection became completed/closed';

-- 依門檻（snapshot，缺值時用目前設定表，再缺值用舊版寫死值）算評級。
CREATE OR REPLACE FUNCTION public.workspace_grade_for_score(p_score numeric, p_thresholds jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE t jsonb := p_thresholds; g text;
BEGIN
 IF t IS NULL OR jsonb_typeof(t)<>'array' OR jsonb_array_length(t)=0 THEN
  SELECT jsonb_agg(jsonb_build_object('grade',grade,'min_score',min_score) ORDER BY grade) INTO t FROM public.inspection_grade_mapping;
 END IF;
 IF t IS NULL OR jsonb_array_length(t)=0 THEN
  t := '[{"grade":0,"min_score":0},{"grade":1,"min_score":121},{"grade":2,"min_score":131},{"grade":3,"min_score":141},{"grade":4,"min_score":151},{"grade":5,"min_score":161},{"grade":6,"min_score":171},{"grade":7,"min_score":181},{"grade":8,"min_score":191},{"grade":9,"min_score":215},{"grade":10,"min_score":220}]'::jsonb;
 END IF;
 SELECT x->>'grade' INTO g FROM jsonb_array_elements(t) x WHERE (x->>'min_score')::numeric <= p_score ORDER BY (x->>'grade')::int DESC LIMIT 1;
 RETURN coalesce(g,'0');
END; $$;

-- 巡店單變成已完成／已結案時記下當時的門檻；草稿與進行中不留 snapshot。已有 snapshot 的單不再改。
-- 觸發器名稱以 workspace_01 開頭，確保在 workspace_grade_from_settings 之前執行（BEFORE 觸發器依名稱排序）。
CREATE OR REPLACE FUNCTION public.workspace_snapshot_grade_thresholds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('completed','closed') THEN
  IF NEW.grade_thresholds IS NULL THEN
   SELECT jsonb_agg(jsonb_build_object('grade',grade,'min_score',min_score) ORDER BY grade) INTO NEW.grade_thresholds FROM public.inspection_grade_mapping;
  END IF;
 ELSE
  NEW.grade_thresholds := NULL;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS workspace_01_grade_snapshot ON public.inspection_masters;
CREATE TRIGGER workspace_01_grade_snapshot BEFORE INSERT OR UPDATE OF status, total_score ON public.inspection_masters FOR EACH ROW EXECUTE FUNCTION public.workspace_snapshot_grade_thresholds();

-- 既有已完成／已結案的單：補上 snapshot（用目前設定表；DEV 預設值與舊版寫死值相同）。
UPDATE public.inspection_masters m SET grade_thresholds=(SELECT jsonb_agg(jsonb_build_object('grade',grade,'min_score',min_score) ORDER BY grade) FROM public.inspection_grade_mapping)
WHERE m.status IN ('completed','closed') AND m.grade_thresholds IS NULL;

-- 評級一律照 snapshot（草稿用目前設定）。
CREATE OR REPLACE FUNCTION public.workspace_grade_from_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 NEW.grade := public.workspace_grade_for_score(coalesce(NEW.total_score,0), NEW.grade_thresholds);
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS workspace_grade_from_settings ON public.inspection_masters;
CREATE TRIGGER workspace_grade_from_settings BEFORE INSERT OR UPDATE OF total_score, status ON public.inspection_masters FOR EACH ROW EXECUTE FUNCTION public.workspace_grade_from_settings();

-- 改善加分重算：不再寫死門檻，用該單 snapshot（加分只加分數）。
CREATE OR REPLACE FUNCTION public.update_inspection_bonus_total()
RETURNS TRIGGER AS $$
DECLARE
  v_new_bonus DECIMAL(5,1);
  v_old_bonus DECIMAL(5,1);
  v_base_score NUMERIC;
  v_new_total NUMERIC;
  v_new_grade TEXT;
  v_thresholds jsonb;
BEGIN
  PERFORM 1 FROM inspection_masters WHERE id = NEW.inspection_id FOR UPDATE;
  SELECT COALESCE(SUM(bonus_score), 0) INTO v_new_bonus
  FROM inspection_improvements
  WHERE inspection_id = NEW.inspection_id
    AND status = 'improved';
  SELECT COALESCE(improvement_bonus, 0), COALESCE(total_score, 0), grade_thresholds
  INTO v_old_bonus, v_base_score, v_thresholds
  FROM inspection_masters
  WHERE id = NEW.inspection_id;
  v_base_score := v_base_score - v_old_bonus;
  v_new_total := v_base_score + v_new_bonus;
  v_new_grade := public.workspace_grade_for_score(v_new_total, v_thresholds);
  UPDATE inspection_masters
  SET improvement_bonus = v_new_bonus,
      total_score = v_new_total,
      grade = v_new_grade
  WHERE id = NEW.inspection_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.workspace_grade_for_score(numeric,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_grade_for_score(numeric,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
