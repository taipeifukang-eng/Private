-- ============================================================================
-- M9 正式區草稿 90：巡店範本與評級設定（含評級門檻 snapshot）
-- 【草稿，尚未套用到正式區。由人確認、先備份、離峰時段執行。】
-- 對應 DEV 遷移：
--   20261028030000_vue_inspection_settings.sql
--   20261028040000_inspection_settings_guard.sql（只取「設定版本表」的部分，見下方說明）
--   20261107160000_m4_grade_snapshot.sql
--
-- 【套用順序重要】本檔必須在 50_inspection_write_core.sql 之前套用（50 號會讀本檔建立的
--   workspace_inspection_settings_revision，缺少就會中止）。檔名序號 90 是依 DEV 時間順序編的，
--   但實際套用順序請排成：... 本檔(90) -> 50。
--
-- 白話說明
--   1. 備份：先把正式區現行的 update_inspection_bonus_total 函式原文、評級對照表、加分設定
--      存進 public.m9_inspection_settings_backup（已有備份就不覆蓋，所以重複執行也安全）。
--   2. 設定版本機制：新增 workspace_inspection_settings_revision（版本號，單列）與
--      workspace_inspection_settings_writes（儲存收據，防重送）。巡店範本、改善加分設定、
--      評級對照表任何一張被新增／修改／刪除，版本號就 +1（trigger workspace_settings_changed）。
--      新版巡店單儲存時拿版本號比對，設定改了就要求重新整理，避免用舊設定算分。
--   3. 函式 workspace_bump_inspection_settings / workspace_save_inspection_settings：
--      後者讓管理頁以「版本 + 收據」方式儲存範本、加分、評級；只授權給 service_role。
--   4. 評級 snapshot：inspection_masters 新增 grade_thresholds（jsonb），巡店單「完成／結案」
--      當下記下評級門檻；之後改對照表不影響已完成的單。新增 workspace_grade_for_score、
--      workspace_snapshot_grade_thresholds、workspace_grade_from_settings 三個函式與
--      兩個 BEFORE 觸發器（workspace_01_grade_snapshot 先、workspace_grade_from_settings 後）。
--   5. 會替換正式區既有函式 update_inspection_bonus_total（改善加分後重算總分與評級）：
--      以正式區現行版本為基礎，只改：評級改讀該單 snapshot；總分計算由 INT 改 NUMERIC
--      並先鎖定該張巡店單；補 SET search_path。加分公式本身不動。原有 trigger_update_bonus_total
--      觸發器不動，函式既有的 GRANT 不動。
--   6. 回補：既有「已完成／已結案」且尚無 snapshot 的巡店單，補上「目前評級對照表」當門檻；
--      對照表空的時候才種入預設 11 級；加分設定空的時候才種入預設（3 天內 20%、4-5 天 10%、
--      6-7 天 5%，為回補扣分百分比，與正式區 calculate_improvement_bonus 的百分比語意一致）。
--
-- 與其他草稿的關係
--   * 取代 m4-sql/w18_B_apply.sql（評級門檻 snapshot，兩者擇一，請勿兩份都執行）。
--   * 必須排在 55_improvements_bonus.sql 之後（55 先換 update_inspection_bonus_total，本檔再把評級改讀 snapshot）；
--     若順序相反，55 會把評級蓋回寫死門檻。實際順序：55 -> 90 -> 50。
--   * 本檔不建立 workspace_save_inspection（屬 50 號「巡店寫入核心」，已內含 guard 的設定版本檢查）。
--   * 不新增權限碼、不授權給任何角色。管理頁權限由老闆之後用勾選頁決定；
--     儲存函式只授權 service_role（API 端驗證身分後呼叫），不依賴 has_permission。
--
-- 對正式區現有資料的影響
--   * inspection_masters 加 1 欄（短暫表鎖）；既有已完成單的 grade_thresholds 被回補。
--     回補不改 grade、total_score、status；但因表上既有 updated_at 觸發器，這些列的 updated_at
--     會變成執行當下時間。既有 trigger_generate_improvements 因 status 未變不會新增改善項目。
--   * 其餘既有欄位資料都不修改。
--   * 風險：評級觸發器上線後，「任何」寫入 inspection_masters.total_score／status 的路徑（含舊版網站）
--     評級都以資料庫對照表為準，不再以舊版前端寫死的門檻為準。若正式區對照表被改成與舊版寫死值
--     （220/215/191/181/171/161/151/141/131/121）不同，舊版新單的評級就會跟著對照表走。
--     執行前請先看 verify 檔第 6 項（目前對照表）。
-- 可重複執行：IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT / 只在缺值時種入。
-- 還原：90_inspection_settings_grade_snapshot.rollback.sql。驗證（唯讀）：.verify.sql。
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.inspection_templates') IS NULL
     OR to_regclass('public.inspection_masters') IS NULL
     OR to_regclass('public.inspection_bonus_config') IS NULL
     OR to_regclass('public.inspection_grade_mapping') IS NULL
     OR to_regclass('public.inspection_improvements') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 巡店相關舊版資料表不齊全（profiles / inspection_templates / inspection_masters / inspection_bonus_config / inspection_grade_mapping / inspection_improvements）';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 步驟 0：備份（已有備份就保留最早那份，不覆蓋）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m9_inspection_settings_backup (
  name         text PRIMARY KEY,
  definition   text,
  payload      jsonb,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.m9_inspection_settings_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_inspection_settings_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.m9_inspection_settings_backup TO service_role;

INSERT INTO public.m9_inspection_settings_backup (name, definition)
SELECT 'update_inspection_bonus_total', pg_get_functiondef(p.oid)
FROM pg_proc p
WHERE p.proname = 'update_inspection_bonus_total' AND p.pronamespace = 'public'::regnamespace
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.m9_inspection_settings_backup (name, payload)
SELECT 'inspection_grade_mapping', coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.grade), '[]'::jsonb)
FROM public.inspection_grade_mapping g
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.m9_inspection_settings_backup (name, payload)
SELECT 'inspection_bonus_config', coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.sort_order, b.day_from), '[]'::jsonb)
FROM public.inspection_bonus_config b
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 步驟 1：種入預設設定（只在表是空的時候；正式區已有設定就完全不動）
-- ---------------------------------------------------------------------------
INSERT INTO public.inspection_grade_mapping (grade, min_score)
SELECT * FROM (VALUES (10,220),(9,215),(8,191),(7,181),(6,171),(5,161),(4,151),(3,141),(2,131),(1,121),(0,0)) v(grade, min_score)
WHERE NOT EXISTS (SELECT 1 FROM public.inspection_grade_mapping);

INSERT INTO public.inspection_bonus_config (day_from, day_to, bonus_score, description, sort_order)
SELECT * FROM (VALUES (0,3,20,'3天內改善，回補扣分 20%',1),(4,5,10,'4-5天改善，回補扣分 10%',2),(6,7,5,'6-7天改善，回補扣分 5%',3)) v(day_from, day_to, bonus_score, description, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.inspection_bonus_config);

-- ---------------------------------------------------------------------------
-- 步驟 2：設定版本表與儲存收據（只給 service_role）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_inspection_settings_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version   bigint NOT NULL DEFAULT 1
);
INSERT INTO public.workspace_inspection_settings_revision VALUES (true, 1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.workspace_inspection_settings_writes (
  id         uuid PRIMARY KEY,
  actor      uuid NOT NULL,
  hash       text NOT NULL,
  result     jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.workspace_inspection_settings_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_inspection_settings_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_inspection_settings_revision, public.workspace_inspection_settings_writes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_inspection_settings_revision, public.workspace_inspection_settings_writes TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_bump_inspection_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.workspace_inspection_settings_revision SET version = version + 1 WHERE singleton;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS workspace_settings_changed ON public.inspection_templates;
CREATE TRIGGER workspace_settings_changed AFTER INSERT OR UPDATE OR DELETE ON public.inspection_templates
  FOR EACH STATEMENT EXECUTE FUNCTION public.workspace_bump_inspection_settings();
DROP TRIGGER IF EXISTS workspace_settings_changed ON public.inspection_bonus_config;
CREATE TRIGGER workspace_settings_changed AFTER INSERT OR UPDATE OR DELETE ON public.inspection_bonus_config
  FOR EACH STATEMENT EXECUTE FUNCTION public.workspace_bump_inspection_settings();
DROP TRIGGER IF EXISTS workspace_settings_changed ON public.inspection_grade_mapping;
CREATE TRIGGER workspace_settings_changed AFTER INSERT OR UPDATE OR DELETE ON public.inspection_grade_mapping
  FOR EACH STATEMENT EXECUTE FUNCTION public.workspace_bump_inspection_settings();

-- ---------------------------------------------------------------------------
-- 步驟 3：儲存函式（範本／加分／評級，版本 + 收據）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_save_inspection_settings(p_actor uuid, p_version bigint, p_write uuid, p_hash text, p_kind text, p_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint; receipt record; result jsonb; row_id uuid;
BEGIN
 SELECT version INTO v FROM workspace_inspection_settings_revision WHERE singleton FOR UPDATE;
 SELECT * INTO receipt FROM workspace_inspection_settings_writes WHERE id=p_write;
 IF FOUND THEN IF receipt.actor<>p_actor OR receipt.hash<>p_hash THEN RAISE EXCEPTION 'WRITE_REPLAY_MISMATCH'; END IF; RETURN receipt.result; END IF;
 IF v<>p_version THEN RAISE EXCEPTION 'SETTINGS_CONFLICT'; END IF;
 IF p_kind='template' THEN
  IF p_id IS NULL THEN
   INSERT INTO inspection_templates(section,section_name,section_order,item_name,item_description,item_order,max_score,scoring_type,checklist_items,is_active,created_by)
   VALUES(p_data->>'section',p_data->>'section_name',(p_data->>'section_order')::int,p_data->>'item_name',p_data->>'item_description',(p_data->>'item_order')::int,(p_data->>'max_score')::numeric,'checklist',p_data->'checklist_items',(p_data->>'is_active')::boolean,p_actor) RETURNING id INTO row_id;
  ELSE
   UPDATE inspection_templates SET section=p_data->>'section',section_name=p_data->>'section_name',section_order=(p_data->>'section_order')::int,item_name=p_data->>'item_name',item_description=p_data->>'item_description',item_order=(p_data->>'item_order')::int,max_score=(p_data->>'max_score')::numeric,scoring_type='checklist',checklist_items=p_data->'checklist_items',is_active=(p_data->>'is_active')::boolean,updated_at=now() WHERE id=p_id RETURNING id INTO row_id;
  END IF;
  IF row_id IS NULL THEN RAISE EXCEPTION 'SETTING_NOT_FOUND'; END IF;
 ELSIF p_kind='bonus' THEN
  IF (p_data->>'is_active')::boolean AND EXISTS(SELECT 1 FROM inspection_bonus_config WHERE is_active AND (p_id IS NULL OR id<>p_id) AND day_from <= (p_data->>'day_to')::int AND day_to >= (p_data->>'day_from')::int) THEN RAISE EXCEPTION 'BONUS_OVERLAP'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO inspection_bonus_config(day_from,day_to,bonus_score,description,sort_order,is_active,updated_by) VALUES((p_data->>'day_from')::int,(p_data->>'day_to')::int,(p_data->>'bonus_score')::numeric,p_data->>'description',(p_data->>'sort_order')::int,(p_data->>'is_active')::boolean,p_actor) RETURNING id INTO row_id;
  ELSE
   UPDATE inspection_bonus_config SET day_from=(p_data->>'day_from')::int,day_to=(p_data->>'day_to')::int,bonus_score=(p_data->>'bonus_score')::numeric,description=p_data->>'description',sort_order=(p_data->>'sort_order')::int,is_active=(p_data->>'is_active')::boolean,updated_by=p_actor,updated_at=now() WHERE id=p_id RETURNING id INTO row_id;
  END IF;
  IF row_id IS NULL THEN RAISE EXCEPTION 'SETTING_NOT_FOUND'; END IF;
 ELSIF p_kind='grades' THEN
  INSERT INTO inspection_grade_mapping(grade,min_score,updated_by,updated_at) SELECT (x->>'grade')::int,(x->>'min_score')::numeric,p_actor,now() FROM jsonb_array_elements(p_data) x ON CONFLICT(grade) DO UPDATE SET min_score=excluded.min_score,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 ELSE RAISE EXCEPTION 'INVALID_SETTING_KIND'; END IF;
 result:=jsonb_build_object('id',row_id,'version',(SELECT version FROM workspace_inspection_settings_revision WHERE singleton));
 INSERT INTO workspace_inspection_settings_writes(id,actor,hash,result) VALUES(p_write,p_actor,p_hash,result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.workspace_save_inspection_settings(uuid,bigint,uuid,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_inspection_settings(uuid,bigint,uuid,text,text,uuid,jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 步驟 4：評級 snapshot（欄位、函式、觸發器）
-- ---------------------------------------------------------------------------
ALTER TABLE public.inspection_masters ADD COLUMN IF NOT EXISTS grade_thresholds jsonb;
COMMENT ON COLUMN public.inspection_masters.grade_thresholds IS 'M4 Q5: grade thresholds snapshot [{grade,min_score}] taken when the inspection became completed/closed';

-- 依門檻（snapshot，缺值用目前對照表，再缺值用舊版寫死值）算評級。
CREATE OR REPLACE FUNCTION public.workspace_grade_for_score(p_score numeric, p_thresholds jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
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

-- 變成已完成／已結案時記下當時門檻；草稿與進行中不留 snapshot；已有 snapshot 不再改。
CREATE OR REPLACE FUNCTION public.workspace_snapshot_grade_thresholds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- 評級一律照 snapshot（草稿用目前對照表）。
CREATE OR REPLACE FUNCTION public.workspace_grade_from_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 NEW.grade := public.workspace_grade_for_score(coalesce(NEW.total_score,0), NEW.grade_thresholds);
 RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.workspace_grade_for_score(numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_grade_for_score(numeric,jsonb) TO service_role;

-- 觸發器名稱 workspace_01_ 開頭，確保在 workspace_grade_from_settings 之前執行（BEFORE 觸發器依名稱排序）。
DROP TRIGGER IF EXISTS workspace_01_grade_snapshot ON public.inspection_masters;
CREATE TRIGGER workspace_01_grade_snapshot BEFORE INSERT OR UPDATE OF status, total_score ON public.inspection_masters
  FOR EACH ROW EXECUTE FUNCTION public.workspace_snapshot_grade_thresholds();
DROP TRIGGER IF EXISTS workspace_grade_from_settings ON public.inspection_masters;
CREATE TRIGGER workspace_grade_from_settings BEFORE INSERT OR UPDATE OF total_score, status ON public.inspection_masters
  FOR EACH ROW EXECUTE FUNCTION public.workspace_grade_from_settings();

-- ---------------------------------------------------------------------------
-- 步驟 5：回補既有已完成／已結案單的 snapshot（用目前對照表）。
-- 只動 grade_thresholds 這一欄；不會觸發上面兩個觸發器（它們只監看 status、total_score）。
-- ---------------------------------------------------------------------------
UPDATE public.inspection_masters m
SET grade_thresholds = (SELECT jsonb_agg(jsonb_build_object('grade',grade,'min_score',min_score) ORDER BY grade) FROM public.inspection_grade_mapping)
WHERE m.status IN ('completed','closed') AND m.grade_thresholds IS NULL;

-- ---------------------------------------------------------------------------
-- 步驟 6：替換 update_inspection_bonus_total（以正式區現行版本為基礎）
-- 與正式區現行版差異：(a) v_base_score／v_new_total 由 INT 改 NUMERIC（避免小數分數被截斷）；
-- (b) 先鎖該張巡店單；(c) 評級改讀該單 snapshot；(d) 補 SET search_path。其餘邏輯不變。
-- CREATE OR REPLACE 不會動既有 GRANT 與 trigger_update_bonus_total 觸發器。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_inspection_bonus_total()
RETURNS trigger AS $$
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

NOTIFY pgrst, 'reload schema';
COMMIT;
