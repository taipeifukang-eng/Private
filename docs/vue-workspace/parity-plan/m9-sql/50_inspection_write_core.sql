-- M9 正式區草稿 50：巡店寫入核心（新版巡店編輯器的「原子寫入」）。尚未套用到正式區。
-- 合併自 DEV：20261028010000_vue_inspection_write.sql + 20261105190000_inspection_save_gps.sql（含 20261028040000 的設定版本檢查）。
-- 白話說明：
--   1. inspection_masters 新增 3 欄：workspace_version（樂觀鎖版本，既有資料預設 1）、workspace_write_id、workspace_write_hash（重送防重複）。
--   2. inspection_results 新增 workspace_quantities（jsonb，存數量型項目的填寫內容）。
--   3. 觸發器 trg_workspace_inspection_version：任何 UPDATE 都把 workspace_version 加 1（舊版頁面編輯也會讓新版畫面偵測到衝突，這是預期行為）。
--   4. workspace_save_inspection(...)：新增／編輯巡店、成績、當班人員在同一交易完成；
--      以 client_request_id 與 hash 做冪等重送、同店同日同類型防重複（DUPLICATE_DAY）、版本衝突（WRITE_CONFLICT）、設定版本不符（SETTINGS_CONFLICT）。
--      新增時寫入 gps_*（由正式區既有 trg_inspection_masters_require_gps 驗證）；編輯時不改 gps_* 與 inspection_date。
--      這是 DEV 最終狀態（save_gps 取代 inspection_write 內的函式），正式區原本沒有此函式，所以直接建立。
--   只授權 service_role；不授權任何角色、不新增權限碼。此檔無權限判斷（正式區 has_permission 語意不涉及）。
-- 前置（缺任一個會中止，不會半套用）：
--   * 20260911093000_inspection_request_identity（inspection_masters.client_request_id、inspection_no）
--   * 20261105180000_inspection_require_gps（定位 trigger）
--   * 「巡店設定」草稿組：workspace_inspection_settings_revision 資料表。本檔函式會讀它，所以套用順序必須在巡店設定組之後。
-- 不改動既有資料列內容；ADD COLUMN 帶常數預設，短暫鎖表但不重寫資料。不強制備份（若要保險可先做下面的選用備份）。
-- 可重複執行。還原：50_inspection_write_core.rollback.sql。驗證：50_inspection_write_core.verify.sql（只有 SELECT）。
-- 選用備份：
--   CREATE TABLE IF NOT EXISTS public.bak_inspection_masters_20261124 AS SELECT * FROM public.inspection_masters;
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.inspection_masters') IS NULL
     OR to_regclass('public.inspection_results') IS NULL
     OR to_regclass('public.inspection_on_duty_staff') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 巡店三張資料表不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_masters' AND column_name='client_request_id') THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20260911093000_inspection_request_identity.sql';
  END IF;
  IF to_regprocedure('public.enforce_inspection_gps_on_insert()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261105180000_inspection_require_gps.sql';
  END IF;
  IF to_regclass('public.workspace_inspection_settings_revision') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用「巡店設定」草稿組（workspace_inspection_settings_revision）';
  END IF;
END $$;

ALTER TABLE public.inspection_masters
  ADD COLUMN IF NOT EXISTS workspace_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS workspace_write_id uuid,
  ADD COLUMN IF NOT EXISTS workspace_write_hash text;
ALTER TABLE public.inspection_results ADD COLUMN IF NOT EXISTS workspace_quantities jsonb;

CREATE OR REPLACE FUNCTION public.workspace_inspection_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN NEW.workspace_version=OLD.workspace_version+1; RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.workspace_inspection_version() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_workspace_inspection_version ON public.inspection_masters;
CREATE TRIGGER trg_workspace_inspection_version BEFORE UPDATE ON public.inspection_masters FOR EACH ROW EXECUTE FUNCTION public.workspace_inspection_version();

CREATE OR REPLACE FUNCTION public.workspace_save_inspection(p_actor uuid,p_id uuid,p_version bigint,p_write uuid,p_hash text,p_master jsonb,p_results jsonb,p_staff jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing public.inspection_masters; saved public.inspection_masters; rid uuid; item jsonb; target_status text; settings_version bigint;
BEGIN
 SELECT version INTO settings_version FROM public.workspace_inspection_settings_revision WHERE singleton FOR SHARE;
 IF settings_version IS NULL OR (p_master->>'settings_version')::bigint IS DISTINCT FROM settings_version THEN RAISE EXCEPTION 'SETTINGS_CONFLICT'; END IF;
 IF p_actor IS NULL OR p_write IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || (p_master->>'store_id') || ':' || (p_master->>'inspection_date') || ':' || (p_master->>'inspection_type'),0));
 IF p_id IS NULL THEN
  SELECT * INTO existing FROM public.inspection_masters WHERE client_request_id=p_write FOR UPDATE;
  IF FOUND THEN
   IF existing.inspector_id=p_actor AND existing.workspace_write_hash=p_hash THEN RETURN to_jsonb(existing); END IF;
   RAISE EXCEPTION 'WRITE_CONFLICT';
  END IF;
  IF EXISTS(SELECT 1 FROM public.inspection_masters WHERE inspector_id=p_actor AND store_id=(p_master->>'store_id')::uuid AND inspection_date=(p_master->>'inspection_date')::date AND COALESCE(inspection_type,'supervisor')=p_master->>'inspection_type') THEN RAISE EXCEPTION 'DUPLICATE_DAY'; END IF;
  rid=gen_random_uuid();
  INSERT INTO public.inspection_masters(id,store_id,inspector_id,created_by,inspection_date,inspection_type,inspection_no,client_request_id,status,gps_latitude,gps_longitude,gps_accuracy,gps_timestamp)
  VALUES(rid,(p_master->>'store_id')::uuid,p_actor,p_actor,(p_master->>'inspection_date')::date,p_master->>'inspection_type','VW-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||replace(rid::text,'-',''),p_write,'draft',(p_master->>'gps_latitude')::numeric,(p_master->>'gps_longitude')::numeric,(p_master->>'gps_accuracy')::numeric,(p_master->>'gps_timestamp')::timestamptz);
 ELSE
  SELECT * INTO existing FROM public.inspection_masters WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR existing.inspector_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'NOT_OWNER'; END IF;
  IF existing.workspace_write_id=p_write AND existing.workspace_write_hash=p_hash THEN RETURN to_jsonb(existing); END IF;
  IF existing.status NOT IN ('draft','in_progress') OR existing.workspace_version<>p_version THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM public.inspection_masters WHERE id<>p_id AND inspector_id=p_actor AND store_id=(p_master->>'store_id')::uuid AND inspection_date=existing.inspection_date AND COALESCE(inspection_type,'supervisor')=p_master->>'inspection_type') THEN RAISE EXCEPTION 'DUPLICATE_DAY'; END IF;
  rid=p_id;
 END IF;
 target_status=p_master->>'status';
 IF target_status NOT IN ('draft','completed') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 -- Preserve result IDs so linked improvement records remain attached.
 FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
  INSERT INTO public.inspection_results(inspection_id,template_id,max_score,given_score,deduction_amount,is_improvement,selected_items,workspace_quantities,notes,photo_urls)
  VALUES(rid,(item->>'template_id')::uuid,(item->>'max_score')::numeric,(item->>'given_score')::numeric,(item->>'deduction_amount')::numeric,(item->>'is_improvement')::boolean,item->'selected_items',item->'workspace_quantities',item->>'notes',item->'photo_urls')
  ON CONFLICT(inspection_id,template_id) DO UPDATE SET max_score=EXCLUDED.max_score,given_score=EXCLUDED.given_score,deduction_amount=EXCLUDED.deduction_amount,is_improvement=EXCLUDED.is_improvement,selected_items=EXCLUDED.selected_items,workspace_quantities=EXCLUDED.workspace_quantities,notes=EXCLUDED.notes,photo_urls=EXCLUDED.photo_urls;
 END LOOP;
 DELETE FROM public.inspection_on_duty_staff WHERE inspection_id=rid;
 INSERT INTO public.inspection_on_duty_staff(inspection_id,employee_code,employee_name,position,is_duty_supervisor,is_manually_added)
 SELECT rid,r.employee_code,r.employee_name,r.position,r.is_duty_supervisor,r.is_manually_added FROM jsonb_to_recordset(p_staff) AS r(employee_code text,employee_name text,position text,is_duty_supervisor boolean,is_manually_added boolean);
 UPDATE public.inspection_masters SET
 store_id=(p_master->>'store_id')::uuid,inspection_type=p_master->>'inspection_type',status=target_status,
 total_score=(p_master->>'total_score')::numeric,max_possible_score=220,grade=p_master->>'grade',score_percentage=(p_master->>'score_percentage')::numeric,
 supervisor_notes=p_master->>'supervisor_notes',indoor_temperature=(p_master->>'indoor_temperature')::numeric,
 signature_photo_url=p_master->>'signature_photo_url',supervisor_signature_url=p_master->>'supervisor_signature_url',
 workspace_version=workspace_version+1,workspace_write_id=p_write,workspace_write_hash=p_hash,updated_at=clock_timestamp()
 WHERE id=rid RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
