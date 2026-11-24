-- M9 正式區草稿 55：巡店改善追蹤與加分（對應 DEV：20261028020000_vue_improvements.sql ＋ 20261108100000_m4_w17_improvement_taipei_overdue.sql 的「最終狀態」）
-- 【尚未套用到正式區】請在確認後，於 Supabase SQL Editor 整份一次執行（本檔自己 BEGIN ... COMMIT，要嘛全成功要嘛全不變）。可重複執行。
-- 序號 55：依 DEV 時間順序排在 50（巡店寫入核心）與 60（任務）之間；為避開已被占用的號碼而用 55。
--
-- 這份做什麼（白話）
--   正式區已經有「巡店扣分 -> 自動產生改善項目 -> 回報改善 -> 依天數回補分數 -> 更新巡店單總分與等第」這套觸發器。
--   本檔以「正式區現行版本」為基礎，只改下面幾處行為，其餘邏輯（誰會產生改善項目、期限、回補公式）完全不動：
--     1. calculate_improvement_bonus（回報改善時算天數與回補分）
--          - 天數改按台灣日期算（正式區現在用 UTC 日期：台灣凌晨 0~8 點回報會差一天）。
--          - 回報當天（台灣日期）已超過改善期限 deadline 時，回補一律 0（含被補跑程式標成 overdue 的項目補報）。
--          - 公式（扣分乘回補比例、四捨五入到小數一位）與規則挑選（啟用中、依 sort_order 取第一條符合）不變。
--     2. update_inspection_bonus_total（改善完成後重算巡店單 improvement_bonus / total_score / grade）
--          - 先鎖住該巡店單那一列（FOR UPDATE），避免兩筆改善同時回報時互相覆蓋。
--          - 基礎分改用 NUMERIC（正式區用 INT，total_score 是 numeric(6,1)，小數分數會被進位成整數）。
--          - 評級門檻維持舊版寫死值（220/215/191/181/171/161/151/141/131/121）。
--            注意：DEV 另有「評級門檻 snapshot」（20261107160000_m4_grade_snapshot）會再改寫這個函式，屬於另一份草稿，必須排在本檔之後。
--     3. generate_inspection_improvements / generate_improvement_from_result / cleanup_improvements_on_result_delete
--          - 邏輯與正式區相同，只加上 SET search_path = public（安全強化），行為不變。
--     4. 5 個觸發器（trigger_generate_improvements、trigger_generate_improvement_from_result、trigger_calculate_bonus、
--        trigger_update_bonus_total、trigger_cleanup_improvements）：定義與正式區相同，本檔在同一交易內 DROP 後重建以確保一致。
--     5. inspection_bonus_config（加分規則表）：只有在「整張表是空的」時才種入 3 條預設規則（0-3 天回補 20%、4-5 天 10%、6-7 天 5%）；
--        表內已有任何資料（正式區預期已有）就一律不動。
--
-- 備份（執行前自動做，只在第一次執行時記錄，之後重跑不會覆蓋「最原始」的備份）
--   public.m9_improvements_backup：存 5 個函式的原始定義、5 個觸發器的原始定義，以及「本檔是否種入預設規則（及種了哪幾列）」。
--   還原請用 55_improvements_bonus.rollback.sql。
--
-- 不做的事
--   - 不回填、不重算任何歷史資料：已改善的紀錄維持原本的天數、回補分與巡店單總分/等第。只影響之後新產生/新回報的資料。
--   - 不新增任何權限碼、不授權給任何角色、不改 RLS 政策、不改既有函式的 EXECUTE 權限（CREATE OR REPLACE 會保留原本授權）。
--   - 不使用 has_permission，不涉及 roles.is_active 判斷。
--
-- 風險提醒
--   - 重建觸發器時會短暫鎖住 inspection_masters / inspection_results / inspection_improvements，建議在非巡店高峰時段執行。
--   - 逾期回補 0 是「新行為」：套用後，期限已過才回報的項目不再有回補分（舊版仍會依天數回補）。
--   - 本檔不處理 m4-sql/w17_B_apply.sql：該草稿（函式內容與本檔 calculate_improvement_bonus 相同）已被本檔取代，
--     兩者只需套用其一，請勿再執行 w17_B_apply.sql。
BEGIN;

-- 0. 前置檢查：必要的資料表、欄位、唯一限制都在，否則整份中止
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['inspection_masters','inspection_results','inspection_templates','inspection_improvements','inspection_bonus_config']) AS t
  WHERE to_regclass('public.' || t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisite tables: %', v_missing;
  END IF;

  SELECT string_agg(c.tbl || '.' || c.col, ', ') INTO v_missing
  FROM (VALUES
    ('inspection_improvements','improved_at'),('inspection_improvements','days_taken'),('inspection_improvements','bonus_score'),
    ('inspection_improvements','deadline'),('inspection_improvements','deduction_amount'),('inspection_improvements','status'),
    ('inspection_masters','improvement_bonus'),('inspection_masters','total_score'),('inspection_masters','grade'),
    ('inspection_masters','inspection_date'),('inspection_masters','inspection_type'),
    ('inspection_results','is_improvement'),('inspection_results','selected_items'),
    ('inspection_bonus_config','day_from'),('inspection_bonus_config','day_to'),('inspection_bonus_config','bonus_score'),
    ('inspection_bonus_config','sort_order'),('inspection_bonus_config','is_active')
  ) AS c(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_schema = 'public' AND ic.table_name = c.tbl AND ic.column_name = c.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisite columns: %', v_missing;
  END IF;

  -- generate_* 函式用 ON CONFLICT (inspection_id, template_id)，需要這組唯一限制
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid = 'public.inspection_improvements'::regclass AND con.contype IN ('u', 'p')
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
           WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)) = ARRAY['inspection_id','template_id']
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.inspection_improvements'::regclass AND i.indisunique AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
           WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['inspection_id','template_id']
  ) THEN
    RAISE EXCEPTION 'Missing prerequisite: unique (inspection_id, template_id) on inspection_improvements';
  END IF;
END $$;

-- 1. 備份：原始函式定義、原始觸發器定義（ON CONFLICT DO NOTHING：只保留第一次執行前的最原始版本）
CREATE TABLE IF NOT EXISTS public.m9_improvements_backup (
  kind          text NOT NULL CHECK (kind IN ('function', 'trigger', 'seed')),
  name          text NOT NULL,
  definition    text NOT NULL,
  backed_up_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, name)
);
ALTER TABLE public.m9_improvements_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_improvements_backup FROM PUBLIC, anon, authenticated;

INSERT INTO public.m9_improvements_backup (kind, name, definition)
SELECT 'function', p.proname, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.proname IN ('calculate_improvement_bonus', 'cleanup_improvements_on_result_delete',
                    'generate_improvement_from_result', 'generate_inspection_improvements',
                    'update_inspection_bonus_total')
  AND p.pronargs = 0
ON CONFLICT (kind, name) DO NOTHING;

INSERT INTO public.m9_improvements_backup (kind, name, definition)
SELECT 'trigger', t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE NOT t.tgisinternal
  AND t.tgname IN ('trigger_generate_improvements', 'trigger_generate_improvement_from_result',
                   'trigger_calculate_bonus', 'trigger_update_bonus_total', 'trigger_cleanup_improvements')
ON CONFLICT (kind, name) DO NOTHING;

-- 2. 加分規則預設值：只有整張表是空的才種入，並記下種入的列（rollback 只刪這幾列）
DO $$
DECLARE
  v_ids text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inspection_bonus_config) THEN
    WITH ins AS (
      INSERT INTO public.inspection_bonus_config (day_from, day_to, bonus_score, description, sort_order)
      VALUES (0, 3, 20, '3天內改善，回補扣分 20%', 1),
             (4, 5, 10, '4-5天改善，回補扣分 10%', 2),
             (6, 7,  5, '6-7天改善，回補扣分 5%', 3)
      RETURNING id
    )
    SELECT string_agg(id::text, ',') INTO v_ids FROM ins;
    INSERT INTO public.m9_improvements_backup (kind, name, definition)
    VALUES ('seed', 'inspection_bonus_config', v_ids)
    ON CONFLICT (kind, name) DO NOTHING;
  END IF;
END $$;

-- 3. 函式（以正式區現行版本為基礎；邏輯相同者只加 search_path）

-- 3a. 巡店單完成時，為每個扣分項目建立改善項目（僅督導巡店；經理巡店是複檢，不產生）
CREATE OR REPLACE FUNCTION public.generate_inspection_improvements()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  r RECORD;
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     AND (NEW.inspection_type IS NULL OR NEW.inspection_type = 'supervisor') THEN

    SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
    FROM inspection_bonus_config
    WHERE is_active = true;

    FOR r IN
      SELECT
        ir.id AS result_id,
        ir.template_id,
        it.section_name,
        it.item_name,
        ir.deduction_amount,
        ir.notes,
        ir.photo_urls,
        ir.selected_items
      FROM inspection_results ir
      JOIN inspection_templates it ON it.id = ir.template_id
      WHERE ir.inspection_id = NEW.id
        AND ir.is_improvement = true
    LOOP
      INSERT INTO inspection_improvements (
        inspection_id, inspection_result_id, template_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        deadline, status
      ) VALUES (
        NEW.id, r.result_id, r.template_id, NEW.store_id,
        r.section_name, r.item_name, r.deduction_amount,
        r.notes,
        COALESCE(r.photo_urls, '[]'::jsonb),
        COALESCE(r.selected_items, '[]'::jsonb),
        NEW.inspection_date + v_max_days,
        'pending'
      )
      ON CONFLICT (inspection_id, template_id) DO NOTHING;
    END LOOP;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3b. 扣分結果寫入時（單子已是 completed 的督導巡店），建立該項目的改善項目
CREATE OR REPLACE FUNCTION public.generate_improvement_from_result()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  v_master RECORD;
  v_template RECORD;
BEGIN
  IF NEW.is_improvement = true THEN

    SELECT id, store_id, inspection_date, status, inspection_type
    INTO v_master
    FROM inspection_masters
    WHERE id = NEW.inspection_id;

    IF v_master.status = 'completed' AND (v_master.inspection_type IS NULL OR v_master.inspection_type = 'supervisor') THEN

      SELECT section_name, item_name
      INTO v_template
      FROM inspection_templates
      WHERE id = NEW.template_id;

      SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
      FROM inspection_bonus_config
      WHERE is_active = true;

      INSERT INTO inspection_improvements (
        inspection_id, inspection_result_id, template_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        deadline, status
      ) VALUES (
        NEW.inspection_id, NEW.id, NEW.template_id, v_master.store_id,
        v_template.section_name, v_template.item_name, NEW.deduction_amount,
        NEW.notes,
        COALESCE(NEW.photo_urls, '[]'::jsonb),
        COALESCE(NEW.selected_items, '[]'::jsonb),
        v_master.inspection_date + v_max_days,
        'pending'
      )
      ON CONFLICT (inspection_id, template_id) DO NOTHING;

    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3c. 回報改善時算天數與回補分（台灣日期；回報日超過期限回補 0）
CREATE OR REPLACE FUNCTION public.calculate_improvement_bonus()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_date DATE;
  v_bonus_percent DECIMAL(5,2);
  v_deduction DECIMAL(10,2);
  v_report_date DATE;
BEGIN
  -- 只在狀態變為 improved 時計算（來源可以是 pending，也可以是補跑程式標成的 overdue）
  IF NEW.status = 'improved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'improved') THEN

    SELECT inspection_date INTO v_inspection_date
    FROM inspection_masters
    WHERE id = NEW.inspection_id;

    v_report_date := (NEW.improved_at AT TIME ZONE 'Asia/Taipei')::date;
    NEW.days_taken := GREATEST((v_report_date - v_inspection_date), 0);

    IF NEW.deadline IS NOT NULL AND v_report_date > NEW.deadline THEN
      v_bonus_percent := 0;
    ELSE
      SELECT COALESCE(bc.bonus_score, 0) INTO v_bonus_percent
      FROM inspection_bonus_config bc
      WHERE bc.is_active = true
        AND NEW.days_taken BETWEEN bc.day_from AND bc.day_to
      ORDER BY bc.sort_order
      LIMIT 1;
    END IF;

    v_deduction := COALESCE(NEW.deduction_amount, 0);
    NEW.bonus_score := ROUND((v_deduction * COALESCE(v_bonus_percent, 0) / 100.0)::numeric, 1);

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3d. 改善完成後，重算巡店單的加分、總分與等第（先鎖單、基礎分用 NUMERIC；門檻維持舊版寫死值）
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

-- 3e. 扣分結果被刪除時，連帶刪掉尚未改善（pending）的改善項目；已改善/逾期的保留
CREATE OR REPLACE FUNCTION public.cleanup_improvements_on_result_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM inspection_improvements
  WHERE inspection_id = OLD.inspection_id
    AND template_id = OLD.template_id
    AND status = 'pending';

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. 觸發器（定義與正式區現行相同；DROP 後重建在同一交易內，中間不會有空窗）
DROP TRIGGER IF EXISTS trigger_generate_improvements ON public.inspection_masters;
CREATE TRIGGER trigger_generate_improvements
  AFTER INSERT OR UPDATE ON public.inspection_masters
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_inspection_improvements();

DROP TRIGGER IF EXISTS trigger_generate_improvement_from_result ON public.inspection_results;
CREATE TRIGGER trigger_generate_improvement_from_result
  AFTER INSERT ON public.inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_improvement_from_result();

DROP TRIGGER IF EXISTS trigger_calculate_bonus ON public.inspection_improvements;
CREATE TRIGGER trigger_calculate_bonus
  BEFORE UPDATE ON public.inspection_improvements
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_improvement_bonus();

DROP TRIGGER IF EXISTS trigger_update_bonus_total ON public.inspection_improvements;
CREATE TRIGGER trigger_update_bonus_total
  AFTER UPDATE ON public.inspection_improvements
  FOR EACH ROW
  WHEN (NEW.status = 'improved' AND (OLD.status IS DISTINCT FROM 'improved'))
  EXECUTE FUNCTION public.update_inspection_bonus_total();

DROP TRIGGER IF EXISTS trigger_cleanup_improvements ON public.inspection_results;
CREATE TRIGGER trigger_cleanup_improvements
  AFTER DELETE ON public.inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_improvements_on_result_delete();

NOTIFY pgrst, 'reload schema';
COMMIT;
