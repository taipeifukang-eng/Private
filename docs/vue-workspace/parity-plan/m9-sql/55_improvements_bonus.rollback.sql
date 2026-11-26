-- 還原 55_improvements_bonus.sql：依 public.m9_improvements_backup 把 5 個函式與 5 個觸發器還原成「套用前」的正式區版本。
-- 整份一次執行（本檔自己 BEGIN ... COMMIT；備份不完整就中止，什麼都不改）。可重複執行。
-- 順序提醒：若之後已套用「評級門檻 snapshot」（DEV 20261107160000_m4_grade_snapshot）的草稿，請先還原那份，再還原本檔，
--          否則本檔會把 update_inspection_bonus_total 還原回舊版寫死門檻，讓 snapshot 失效。
-- 不會動的東西：已回報改善的歷史資料（天數、回補分、巡店單總分/等第）、已產生的改善項目、
--              備份表本身（確認還原成功後可自行 DROP TABLE public.m9_improvements_backup;）。
-- 加分規則：只有「本檔當初因為整張表是空的而種入」的那幾列會被刪除（依備份記錄的 id）；
--          若那幾列之後已被人改過，仍會被刪除，請先確認。原本就有資料的情況下不會刪任何規則。
-- 套用後行為回到舊版：UTC 日期算天數、逾期仍依天數回補、基礎分用整數。
BEGIN;

DO $$
DECLARE
  d record;
  v_fn_count int;
  v_trg_count int;
BEGIN
  IF to_regclass('public.m9_improvements_backup') IS NULL THEN
    RAISE EXCEPTION '找不到備份表 public.m9_improvements_backup，請勿繼續';
  END IF;
  SELECT count(*) INTO v_fn_count FROM public.m9_improvements_backup WHERE kind = 'function';
  IF v_fn_count <> 5 THEN
    RAISE EXCEPTION '備份不完整：函式備份只有 % 筆（應為 5），請勿繼續', v_fn_count;
  END IF;

  -- 先移除目前的觸發器，再還原函式，最後依備份重建觸發器
  DROP TRIGGER IF EXISTS trigger_generate_improvements ON public.inspection_masters;
  DROP TRIGGER IF EXISTS trigger_generate_improvement_from_result ON public.inspection_results;
  DROP TRIGGER IF EXISTS trigger_calculate_bonus ON public.inspection_improvements;
  DROP TRIGGER IF EXISTS trigger_update_bonus_total ON public.inspection_improvements;
  DROP TRIGGER IF EXISTS trigger_cleanup_improvements ON public.inspection_results;

  FOR d IN SELECT definition FROM public.m9_improvements_backup WHERE kind = 'function' ORDER BY name LOOP
    EXECUTE d.definition;
  END LOOP;

  v_trg_count := 0;
  FOR d IN SELECT definition FROM public.m9_improvements_backup WHERE kind = 'trigger' ORDER BY name LOOP
    EXECUTE d.definition;
    v_trg_count := v_trg_count + 1;
  END LOOP;
  RAISE NOTICE '已還原 % 個函式、% 個觸發器', v_fn_count, v_trg_count;

  -- 刪除本檔當初種入的預設加分規則（若有）
  DELETE FROM public.inspection_bonus_config
  WHERE id::text IN (
    SELECT unnest(string_to_array(definition, ','))
    FROM public.m9_improvements_backup WHERE kind = 'seed' AND name = 'inspection_bonus_config'
  );
  DELETE FROM public.m9_improvements_backup WHERE kind = 'seed' AND name = 'inspection_bonus_config';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
