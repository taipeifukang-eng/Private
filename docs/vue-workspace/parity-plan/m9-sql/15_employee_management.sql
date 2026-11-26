-- M9 正式區草稿 15：員工（生日匯入、新增、編輯、匯入、員編規則、月份需重新確認）。【尚未套用到正式區】
-- 來源：DEV 的 20261029090000_vue_employee_birthdays、20261029100000_vue_employee_create、20261029210000_vue_employee_edit、
--       20261030010000_vue_employee_import、20261105200000_w05_employee_id_rule、20261105200100_w05_employee_edit_recheck。
-- 本檔把六份 DEV 檔「合併成最終狀態」一次建立：正式區沒有任何 workspace_* 員工函式，所以不會假設 DEV 的中間版本存在，
-- 每個函式只建最終版（員編規則版、含需重新確認版）。
--
-- 會新增（皆為新物件，不改舊版任何資料表欄位、不改既有資料）：
--   資料表  workspace_birthday_requests / workspace_employee_create_requests / workspace_employee_edit_requests / workspace_employee_import_receipts
--           （請求去重回執，防止同一請求重送）、monthly_staff_recheck（月份「需重新確認」清單，之後異動回寫也會共用）
--   函式    workspace_birthday_snapshot、workspace_birthday_save、workspace_employee_create、workspace_employee_edit_state、workspace_employee_edit、
--           workspace_employee_import_check、workspace_employee_import_save、workspace_employee_id_valid、workspace_employee_id_type、
--           workspace_monthly_recheck_add、workspace_staff_month_locked、workspace_guard_onboarding_code、workspace_guard_manual_staff_code
--   觸發器  employee_movement_history 上的 workspace_guard_onboarding_code（BEFORE INSERT）
--           monthly_staff_status 上的 workspace_guard_manual_staff_code（BEFORE INSERT）
--   不新增任何權限碼，也不授權給任何角色（授權之後由老闆在勾選頁決定）。函式與資料表只授權給 service_role（workspace API 使用）。
--
-- 員編規則：FK+4 碼數字、FKF+5 碼數字、FKPT+3 碼數字；FKI（實習生）一律拒絕；FKPT 為兼職，其餘正職。
--
-- 【重要風險：兩個觸發器會改變「既有資料表」的寫入行為，舊版頁面也會受影響】
--   1. employee_movement_history：新增 movement_type='onboarding'（入職異動）時，員編不符規則就整筆被擋（錯誤 WORKSPACE_INVALID）。
--   2. monthly_staff_status：新增 is_manually_added=true 的列時，員編必須符合規則（留空、FKI 都會被擋），且 employment_type 會被強制改成依員編判斷。
--   觸發器只管 INSERT，不影響 UPDATE，也不影響既有資料列。但舊版仍以舊規則寫入的頁面（例如舊版異動入職、每月人員狀態「手動新增」）
--   一旦遇到不合規員編就會失敗。套用前請先跑 15_employee_management.preview.sql 看既有不合規員編與近期舊版寫入情形。
--   若上線後要先關掉這兩個擋點：DROP TRIGGER IF EXISTS workspace_guard_onboarding_code ON public.employee_movement_history;
--                                DROP TRIGGER IF EXISTS workspace_guard_manual_staff_code ON public.monthly_staff_status;
--
-- 前置條件：store_employees.newbie_level 欄位必須已存在（由 m2-sql/backfill_employee_stage_A_add_column.sql 新增）；缺少時本檔會直接中止，不做任何變更。
-- 備份：不需要。本檔不修改、不刪除任何既有資料列，也沒有既有 workspace_* 函式會被覆蓋。觸發器還原方式見 .rollback.sql。
-- 可重複執行（IF NOT EXISTS／CREATE OR REPLACE／DROP TRIGGER IF EXISTS 後重建）。還原：15_employee_management.rollback.sql。驗證（唯讀）：15_employee_management.verify.sql。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.store_employees') IS NULL OR to_regclass('public.employee_movement_history') IS NULL
     OR to_regclass('public.monthly_staff_status') IS NULL OR to_regclass('public.monthly_store_summary') IS NULL
     OR to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: store_employees／employee_movement_history／monthly_staff_status／monthly_store_summary／stores 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_employees' AND column_name='newbie_level') THEN
    RAISE EXCEPTION 'Missing prerequisite: store_employees.newbie_level 不存在，請先執行 m2-sql/backfill_employee_stage_A_add_column.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_staff_status' AND column_name='is_manually_added') THEN
    RAISE EXCEPTION 'Missing prerequisite: monthly_staff_status.is_manually_added 不存在';
  END IF;
END $$;

-- ===== 請求去重回執（同一請求重送時回傳第一次的結果；不同內容重用同一請求編號會被拒絕）=====
CREATE TABLE IF NOT EXISTS public.workspace_birthday_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.workspace_employee_create_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.workspace_employee_edit_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.workspace_employee_import_receipts(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_birthday_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_employee_create_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_employee_edit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_employee_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_birthday_requests,public.workspace_employee_create_requests,public.workspace_employee_edit_requests,public.workspace_employee_import_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_birthday_requests,public.workspace_employee_create_requests,public.workspace_employee_edit_requests,public.workspace_employee_import_receipts TO service_role;

-- ===== 月份需重新確認清單（員工編輯改職位時，已送審／已確認月份不動，改記到這裡；異動回寫之後沿用同一張表）=====
CREATE TABLE IF NOT EXISTS public.monthly_staff_recheck(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_code text NOT NULL,
 employee_name text,
 store_id uuid NOT NULL REFERENCES public.stores(id),
 year_month text NOT NULL CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 monthly_staff_status_id uuid,
 field text NOT NULL,
 old_value text,
 new_value text,
 reason text NOT NULL,
 reason_label text NOT NULL,
 source_type text NOT NULL,
 source_id text,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid,
 resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS monthly_staff_recheck_pending_uidx
 ON public.monthly_staff_recheck(employee_code,store_id,year_month,field,reason) WHERE status='pending';
CREATE INDEX IF NOT EXISTS monthly_staff_recheck_month_idx ON public.monthly_staff_recheck(store_id,year_month,status);
ALTER TABLE public.monthly_staff_recheck ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monthly_staff_recheck FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.monthly_staff_recheck TO service_role;

-- ===== 員編規則 =====
CREATE OR REPLACE FUNCTION public.workspace_employee_id_valid(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(p_code,'') ~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$' $$;
CREATE OR REPLACE FUNCTION public.workspace_employee_id_type(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN coalesce(p_code,'') LIKE 'FKPT%' THEN 'part_time' ELSE 'full_time' END $$;
REVOKE ALL ON FUNCTION public.workspace_employee_id_valid(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_employee_id_type(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_id_valid(text),public.workspace_employee_id_type(text) TO service_role;

-- ===== 生日匯入 =====
CREATE OR REPLACE FUNCTION public.workspace_birthday_snapshot(p_codes text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH records AS (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_code',employee_code,'employee_name',employee_name,'birthday',birthday,'is_active',is_active,'employment_status',employment_status,'last_movement_date',last_movement_date) ORDER BY id),'[]') AS rows
 FROM store_employees WHERE upper(btrim(employee_code))=ANY(p_codes))
 SELECT jsonb_build_object('rows',rows,'version',md5(rows::text)) FROM records;
$$;
CREATE OR REPLACE FUNCTION public.workspace_birthday_save(p_actor uuid,p_request uuid,p_rows jsonb,p_expected text,p_visible_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_birthday_requests%rowtype; codes text[]; snapshot jsonb; row jsonb; canonical_name text; birthday_date date; affected integer; result jsonb;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 LOCK TABLE store_employees IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_birthday_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 SELECT array_agg(value->>'employee_code') INTO codes FROM jsonb_array_elements(p_rows);
 IF EXISTS(SELECT 1 FROM unnest(codes) c GROUP BY c HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 snapshot:=workspace_birthday_snapshot(codes);
 IF snapshot->>'version' IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'rows') r WHERE NOT coalesce((r->>'id')::uuid=ANY(p_visible_ids),false)) THEN RAISE EXCEPTION 'WORKSPACE_SCOPE'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF NOT workspace_employee_id_valid(row->>'employee_code') OR coalesce(row->>'birthday','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  birthday_date:=(row->>'birthday')::date;
  IF birthday_date<'1900-01-01'::date OR birthday_date>(now() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'WORKSPACE_DATE'; END IF;
  SELECT employee_name INTO canonical_name FROM store_employees WHERE upper(btrim(employee_code))=row->>'employee_code'
   ORDER BY (is_active IS DISTINCT FROM false AND employment_status IS DISTINCT FROM 'resigned') DESC,last_movement_date DESC NULLS LAST,id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  IF btrim(coalesce(canonical_name,'')) IS DISTINCT FROM row->>'employee_name' THEN RAISE EXCEPTION 'WORKSPACE_NAME'; END IF;
 END LOOP;
 UPDATE store_employees e SET birthday=(r->>'birthday')::date FROM jsonb_array_elements(p_rows) r WHERE upper(btrim(e.employee_code))=r->>'employee_code';
 GET DIAGNOSTICS affected=ROW_COUNT;
 result:=jsonb_build_object('employees',jsonb_array_length(p_rows),'records',affected);
 INSERT INTO workspace_birthday_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_birthday_snapshot(text[]),public.workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_birthday_snapshot(text[]),public.workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]) TO service_role;

-- ===== 新增員工（員編格式與兼職判斷由規則決定）=====
CREATE OR REPLACE FUNCTION public.workspace_employee_create(p_actor uuid,p_request uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_employee_create_requests%rowtype; code text; employee_id uuid; result jsonb; birth date; started date; kind text;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 code:=p_data->>'employee_code';
 IF NOT workspace_employee_id_valid(code) OR coalesce(btrim(p_data->>'employee_name'),'')='' OR length(p_data->>'employee_name')>100 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 kind:=workspace_employee_id_type(code);
 birth:=nullif(p_data->>'birthday','')::date;started:=nullif(p_data->>'start_date','')::date;
 IF birth<'1900-01-01'::date OR birth>(now() AT TIME ZONE 'Asia/Taipei')::date OR started<'1900-01-01'::date OR (birth IS NOT NULL AND started IS NOT NULL AND birth>started) THEN RAISE EXCEPTION 'WORKSPACE_DATE'; END IF;
 -- 與升職寫入同一鎖定順序；三個來源都檢查，連「只有異動紀錄的員編」也會擋下。
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_employee_create_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF EXISTS(SELECT 1 FROM store_employees WHERE upper(btrim(employee_code))=code)
 OR EXISTS(SELECT 1 FROM employee_movement_history WHERE upper(btrim(employee_code))=code)
 OR EXISTS(SELECT 1 FROM monthly_staff_status WHERE upper(btrim(employee_code))=code) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 INSERT INTO store_employees(employee_code,employee_name,position,current_position,start_date,birthday,employment_type,employment_status,is_active,store_id)
 VALUES(code,btrim(p_data->>'employee_name'),nullif(p_data->>'current_position',''),nullif(p_data->>'current_position',''),started,birth,kind,'active',true,null) RETURNING id INTO employee_id;
 result:=jsonb_build_object('id',employee_id,'employee_code',code,'employment_type',kind);
 INSERT INTO workspace_employee_create_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_employee_create(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_create(uuid,uuid,jsonb) TO service_role;

-- ===== 編輯員工（含月份需重新確認）=====
CREATE OR REPLACE FUNCTION public.workspace_employee_edit_state(p_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'masters',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM (SELECT id,employee_code,employee_name,start_date,birthday,position,current_position,is_active,employment_status,last_movement_date FROM store_employees WHERE employee_code=p_code) t),'[]'::jsonb),
  'statuses',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY year_month DESC,id) FROM (SELECT id,employee_code,employee_name,position,year_month,monthly_status,start_date FROM monthly_staff_status WHERE employee_code=p_code) t),'[]'::jsonb),
  'movements',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY movement_date DESC,created_at DESC,id) FROM (SELECT id,employee_code,employee_name,movement_type,new_value,movement_date,created_at FROM employee_movement_history WHERE employee_code=p_code) t),'[]'::jsonb)
 );
$$;
CREATE OR REPLACE FUNCTION public.workspace_monthly_recheck_add(
 p_actor uuid,p_code text,p_name text,p_store uuid,p_month text,p_status_id uuid,p_field text,p_old text,p_new text,
 p_reason text,p_label text,p_source_type text,p_source_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rid uuid;
BEGIN
 INSERT INTO monthly_staff_recheck(employee_code,employee_name,store_id,year_month,monthly_staff_status_id,field,old_value,new_value,reason,reason_label,source_type,source_id,created_by)
 VALUES(p_code,p_name,p_store,p_month,p_status_id,p_field,p_old,p_new,p_reason,p_label,p_source_type,p_source_id,p_actor)
 ON CONFLICT (employee_code,store_id,year_month,field,reason) WHERE status='pending'
 DO UPDATE SET new_value=EXCLUDED.new_value,employee_name=EXCLUDED.employee_name,reason_label=EXCLUDED.reason_label,source_type=EXCLUDED.source_type,source_id=EXCLUDED.source_id,updated_at=now()
 RETURNING id INTO rid;
 RETURN rid;
END;$$;
-- 月份是否已送審或已確認：人員列或門市月統計任一為 submitted／confirmed。
CREATE OR REPLACE FUNCTION public.workspace_staff_month_locked(p_store uuid,p_month text,p_row_status text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p_row_status,'draft') IN ('submitted','confirmed')
  OR EXISTS(SELECT 1 FROM monthly_store_summary s WHERE s.store_id=p_store AND s.year_month=p_month AND s.store_status IN ('submitted','confirmed'))
$$;
CREATE OR REPLACE FUNCTION public.workspace_employee_edit(p_actor uuid,p_request uuid,p_data jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_employee_edit_requests%rowtype; code text; snapshot jsonb; result jsonb; birth date; started date; changed integer;
 new_name text; new_pos text; m record; updated_months integer:=0; rechecks jsonb:='[]'::jsonb;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 code:=p_data->>'employee_code';
 IF coalesce(code,'') !~ '^[A-Z0-9_-]{1,30}$' OR coalesce(btrim(p_data->>'employee_name'),'')='' OR length(p_data->>'employee_name')>100 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 birth:=nullif(p_data->>'birthday','')::date;started:=nullif(p_data->>'start_date','')::date;
 IF birth<'1900-01-01'::date OR birth>(now() AT TIME ZONE 'Asia/Taipei')::date OR started<'1900-01-01'::date OR (birth IS NOT NULL AND started IS NOT NULL AND birth>started) THEN RAISE EXCEPTION 'WORKSPACE_DATE'; END IF;
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_employee_edit_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 snapshot:=workspace_employee_edit_state(code);
 IF snapshot IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CHANGED'; END IF;
 IF jsonb_array_length(snapshot->'masters')+jsonb_array_length(snapshot->'statuses')+jsonb_array_length(snapshot->'movements')=0 THEN RAISE EXCEPTION 'WORKSPACE_MISSING'; END IF;
 new_name:=btrim(p_data->>'employee_name');new_pos:=nullif(p_data->>'current_position','');
 -- 階段只屬於新人／行政，且跟升職異動走；改成其他職位就清空，職位不變則保留。
 UPDATE store_employees SET employee_name=new_name,start_date=started,birthday=birth,position=new_pos,current_position=new_pos,
  newbie_level=CASE WHEN new_pos IN('新人','行政') AND current_position IS NOT DISTINCT FROM new_pos THEN newbie_level ELSE NULL END WHERE employee_code=code;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN
  INSERT INTO store_employees(employee_code,employee_name,position,current_position,start_date,birthday,employment_type,employment_status,is_active,store_id)
  VALUES(code,new_name,new_pos,new_pos,started,birth,'full_time','active',true,null);
 END IF;
 -- 姓名：所有月份同步。
 UPDATE monthly_staff_status SET employee_name=new_name WHERE employee_code=code AND employee_name IS DISTINCT FROM new_name;
 -- 職位：只改未送審、未確認的月份；已送審／已確認的月份不動，記錄到需重新確認清單。
 IF new_pos IS NOT NULL THEN
  FOR m IN SELECT id,store_id,year_month,position,status FROM monthly_staff_status WHERE employee_code=code AND position IS DISTINCT FROM new_pos ORDER BY year_month,id LOOP
   IF workspace_staff_month_locked(m.store_id,m.year_month,m.status) THEN
    PERFORM workspace_monthly_recheck_add(p_actor,code,new_name,m.store_id,m.year_month,m.id,'position',m.position,new_pos,'employee_edit_position','員工管理修改職位，此月份已送審或已確認未更動','employee_edit',p_request::text);
    rechecks:=rechecks||jsonb_build_array(jsonb_build_object('store_id',m.store_id,'year_month',m.year_month,'old',m.position,'new',new_pos));
   ELSE
    UPDATE monthly_staff_status SET position=new_pos WHERE id=m.id;
    updated_months:=updated_months+1;
   END IF;
  END LOOP;
  -- 之前登記的待確認項目，若該月份職位現在已等於新職位（例如改回原職位），自動結案。
  UPDATE monthly_staff_recheck r SET status='resolved',resolved_by=p_actor,resolved_at=now(),updated_at=now()
  WHERE r.employee_code=code AND r.field='position' AND r.reason='employee_edit_position' AND r.status='pending'
   AND EXISTS(SELECT 1 FROM monthly_staff_status s WHERE s.employee_code=code AND s.store_id=r.store_id AND s.year_month=r.year_month AND s.position=new_pos);
 END IF;
 result:=jsonb_build_object('success',true,'employee_code',code,'position_updated_months',updated_months,'recheck_count',jsonb_array_length(rechecks),'recheck',rechecks);
 INSERT INTO workspace_employee_edit_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_employee_edit_state(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_employee_edit(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_staff_month_locked(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_edit_state(text),public.workspace_employee_edit(uuid,uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_staff_month_locked(uuid,text,text) TO service_role;

-- ===== 員工匯入（員編格式、職位限公司職位清單：types/workflow.ts POSITION_OPTIONS）=====
CREATE OR REPLACE FUNCTION public.workspace_employee_import_check(p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; errors jsonb:='[]'; n int:=0; msg text; sid uuid; dt date; code text; seen text[]:='{}';
 positions text[]:=ARRAY['總經理','副總經理','資深經理','經理','督導','店長','副店長','主任','資深副理','副理','組長','資深專員','高級專員','專員','出納專員','助理','新人','行政','兼職專員','兼職藥師','兼職藥師專員','兼職助理'];
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>10000 THEN RAISE EXCEPTION 'IMPORT_INVALID';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  n:=n+1;msg:=NULL;code:=r->>'employee_code';
  BEGIN
   IF code LIKE 'FKI%' THEN RAISE EXCEPTION '實習生不納入系統，員編不可為 FKI 開頭';END IF;
   IF NOT workspace_employee_id_valid(code) THEN RAISE EXCEPTION '員編格式錯誤，正確格式：FK+4碼數字、FKF+5碼數字、FKPT+3碼數字';END IF;
   IF nullif(btrim(r->>'employee_name'),'') IS NULL OR length(r->>'employee_name')>200 OR nullif(btrim(r->>'position'),'') IS NULL OR length(r->>'position')>100 THEN RAISE EXCEPTION '欄位不完整或姓名、職位過長';END IF;
   IF NOT (r->>'position'=ANY(positions)) THEN RAISE EXCEPTION '職位不在公司職位清單內';END IF;
   sid:=(r->>'store_id')::uuid;dt:=(r->>'start_date')::date;
   IF dt IS NULL OR r->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' OR dt<'1900-01-01' OR dt>'2099-12-31' THEN RAISE EXCEPTION '到職日期不正確';END IF;
   IF sid IS NULL OR NOT(sid=ANY(coalesce(p_visible,'{}'::uuid[]))) OR NOT EXISTS(SELECT 1 FROM stores WHERE id=sid AND is_active=true) THEN RAISE EXCEPTION '門市不在可匯入範圍或已停用';END IF;
   IF code=ANY(seen) THEN RAISE EXCEPTION '檔案內員編重複';END IF;
   IF EXISTS(SELECT 1 FROM store_employees WHERE upper(btrim(employee_code))=code) THEN RAISE EXCEPTION '員編已存在，不會覆寫既有資料';END IF;
  EXCEPTION WHEN OTHERS THEN msg:=SQLERRM;END;
  seen:=array_append(seen,code);
  IF msg IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('row',coalesce(r->>'row',n::text),'message',msg));END IF;
 END LOOP;
 RETURN jsonb_build_object('valid',jsonb_array_length(errors)=0,'errors',errors);
END;$$;
CREATE OR REPLACE FUNCTION public.workspace_employee_import_save(p_actor uuid,p_request uuid,p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cached workspace_employee_import_receipts; checked jsonb; result jsonb; r jsonb; total int:=0;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'IMPORT_INVALID';END IF;
 LOCK TABLE workspace_employee_import_receipts IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_employee_import_receipts WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'IMPORT_REQUEST_REUSED';END IF;
  RETURN cached.result;
 END IF;
 LOCK TABLE stores IN SHARE MODE;
 LOCK TABLE store_employees IN SHARE ROW EXCLUSIVE MODE;
 checked:=workspace_employee_import_check(p_rows,p_visible);
 IF NOT (checked->>'valid')::boolean THEN RAISE EXCEPTION 'IMPORT_CONFLICT';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  INSERT INTO store_employees(store_id,employee_code,employee_name,position,current_position,start_date,employment_type,is_active,employment_status)
  VALUES((r->>'store_id')::uuid,r->>'employee_code',r->>'employee_name',r->>'position',r->>'position',(r->>'start_date')::date,workspace_employee_id_type(r->>'employee_code'),true,'active');
  total:=total+1;
 END LOOP;
 result:=jsonb_build_object('success',true,'imported',total,'requestId',p_request);
 INSERT INTO workspace_employee_import_receipts(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,result);
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.workspace_employee_import_check(jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_import_check(jsonb,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]) TO service_role;

-- ===== 觸發器：改變既有資料表 employee_movement_history／monthly_staff_status 的新增行為（只管 INSERT）=====
-- 觸發器函式為 SECURITY DEFINER（擁有者仍可呼叫已 REVOKE 的 workspace_employee_id_valid），舊版以 authenticated 身分寫入的路徑不受 REVOKE 影響，但會受員編規則約束。
CREATE OR REPLACE FUNCTION public.workspace_guard_onboarding_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.movement_type='onboarding' AND NOT workspace_employee_id_valid(NEW.employee_code) THEN
  RAISE EXCEPTION 'WORKSPACE_INVALID' USING DETAIL='employee_id_rule';
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS workspace_guard_onboarding_code ON public.employee_movement_history;
CREATE TRIGGER workspace_guard_onboarding_code BEFORE INSERT ON public.employee_movement_history
 FOR EACH ROW EXECUTE FUNCTION public.workspace_guard_onboarding_code();
REVOKE ALL ON FUNCTION public.workspace_guard_onboarding_code() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.workspace_guard_manual_staff_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(NEW.is_manually_added,false) THEN
  IF NOT workspace_employee_id_valid(NEW.employee_code) THEN
   RAISE EXCEPTION 'WORKSPACE_INVALID' USING DETAIL='employee_id_rule';
  END IF;
  NEW.employment_type:=workspace_employee_id_type(NEW.employee_code);
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS workspace_guard_manual_staff_code ON public.monthly_staff_status;
CREATE TRIGGER workspace_guard_manual_staff_code BEFORE INSERT ON public.monthly_staff_status
 FOR EACH ROW EXECUTE FUNCTION public.workspace_guard_manual_staff_code();
REVOKE ALL ON FUNCTION public.workspace_guard_manual_staff_code() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
