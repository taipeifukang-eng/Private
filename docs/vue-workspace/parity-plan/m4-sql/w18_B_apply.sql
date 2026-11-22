-- M4 W18 步驟 B：評級門檻 snapshot + 改善加分重算改讀 snapshot。
-- 【重要】請只單獨執行本檔，本檔以 BEGIN; 開頭，不會自動提交：
--   執行完看過回傳，再另外執行 COMMIT;（確認）或 ROLLBACK;（放棄）。忘了的話連線結束會自動回滾。
--   請先執行並看過 w18_A_preview.sql。若預覽 4 的 grade_differs_from_current_mapping 不是 0，請先回報再執行。
-- 內容：
--   1. 備份：把目前的 update_inspection_bonus_total 函式內容存進 public.m4_w18_backup（步驟 C 依此還原）。
--   2. inspection_masters 新增 grade_thresholds（jsonb）：記錄單子完成當時的評級門檻。
--   3. 觸發器：巡店單變成已完成／已結案時記下目前門檻（只記錄，不改評級；已有 snapshot 就不再改）。
--   4. 既有已完成／已結案的單補上 snapshot（用目前對照表；目前值與舊版寫死值相同時，不會有任何單的評級改變）。
--   5. update_inspection_bonus_total 改成依該單 snapshot 算評級（原本寫死 220/215/191...）。加分公式本身不動。
BEGIN;

CREATE TABLE IF NOT EXISTS public.m4_w18_backup (
  name text PRIMARY KEY,
  definition text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.m4_w18_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m4_w18_backup FROM anon, authenticated;
INSERT INTO public.m4_w18_backup (name, definition)
SELECT 'update_inspection_bonus_total', pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.proname = 'update_inspection_bonus_total'
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.inspection_masters ADD COLUMN IF NOT EXISTS grade_thresholds jsonb;

CREATE OR REPLACE FUNCTION public.workspace_grade_for_score(p_score numeric, p_thresholds jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE t jsonb := p_thresholds; g text;
BEGIN
  IF t IS NULL OR jsonb_typeof(t) <> 'array' OR jsonb_array_length(t) = 0 THEN
    SELECT jsonb_agg(jsonb_build_object('grade', grade, 'min_score', min_score) ORDER BY grade) INTO t FROM public.inspection_grade_mapping;
  END IF;
  IF t IS NULL OR jsonb_array_length(t) = 0 THEN
    t := '[{"grade":0,"min_score":0},{"grade":1,"min_score":121},{"grade":2,"min_score":131},{"grade":3,"min_score":141},{"grade":4,"min_score":151},{"grade":5,"min_score":161},{"grade":6,"min_score":171},{"grade":7,"min_score":181},{"grade":8,"min_score":191},{"grade":9,"min_score":215},{"grade":10,"min_score":220}]'::jsonb;
  END IF;
  SELECT x->>'grade' INTO g FROM jsonb_array_elements(t) x WHERE (x->>'min_score')::numeric <= p_score ORDER BY (x->>'grade')::int DESC LIMIT 1;
  RETURN coalesce(g, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.workspace_snapshot_grade_thresholds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('completed', 'closed') THEN
    IF NEW.grade_thresholds IS NULL THEN
      SELECT jsonb_agg(jsonb_build_object('grade', grade, 'min_score', min_score) ORDER BY grade) INTO NEW.grade_thresholds FROM public.inspection_grade_mapping;
    END IF;
  ELSE
    NEW.grade_thresholds := NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS workspace_01_grade_snapshot ON public.inspection_masters;
CREATE TRIGGER workspace_01_grade_snapshot BEFORE INSERT OR UPDATE OF status, total_score ON public.inspection_masters
  FOR EACH ROW EXECUTE FUNCTION public.workspace_snapshot_grade_thresholds();

-- 補既有已完成／已結案單的 snapshot（此 UPDATE 不動 total_score／status，只觸發 snapshot 以外的欄位更新，評級不變）。
UPDATE public.inspection_masters m
SET grade_thresholds = (SELECT jsonb_agg(jsonb_build_object('grade', grade, 'min_score', min_score) ORDER BY grade) FROM public.inspection_grade_mapping)
WHERE m.status IN ('completed', 'closed') AND m.grade_thresholds IS NULL;

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
  WHERE inspection_id = NEW.inspection_id AND status = 'improved';
  SELECT COALESCE(improvement_bonus, 0), COALESCE(total_score, 0), grade_thresholds
  INTO v_old_bonus, v_base_score, v_thresholds
  FROM inspection_masters WHERE id = NEW.inspection_id;
  v_base_score := v_base_score - v_old_bonus;
  v_new_total := v_base_score + v_new_bonus;
  v_new_grade := public.workspace_grade_for_score(v_new_total, v_thresholds);
  UPDATE inspection_masters
  SET improvement_bonus = v_new_bonus, total_score = v_new_total, grade = v_new_grade
  WHERE id = NEW.inspection_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.workspace_grade_for_score(numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_grade_for_score(numeric, jsonb) TO service_role;

-- 核對（請看回傳）：已補 snapshot 的單數、仍缺 snapshot 的已完成單數（應為 0）、函式不再含寫死 215。
SELECT count(*) FILTER (WHERE status IN ('completed', 'closed') AND grade_thresholds IS NOT NULL) AS snapshot_filled,
       count(*) FILTER (WHERE status IN ('completed', 'closed') AND grade_thresholds IS NULL) AS still_missing,
       (SELECT prosrc LIKE '%215%' FROM pg_proc WHERE proname = 'update_inspection_bonus_total') AS bonus_fn_still_hardcoded
FROM public.inspection_masters;
-- 看過沒問題後，另外執行 COMMIT;  有疑慮則執行 ROLLBACK;
