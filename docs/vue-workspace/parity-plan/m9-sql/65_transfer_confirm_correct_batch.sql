-- ============================================================================
-- 65_transfer_confirm_correct_batch.sql  （M9 正式區 SQL 草稿，尚未套用到正式區）
--
-- 組名：調店確認、更正與批次調店
-- 對應 DEV 檔（supabase/workspace-dev/，僅供對照，本檔不是照搬）：
--   20261029110000_vue_transfer_confirm / 20261029120000_vue_transfer_version /
--   20261029130000_vue_transfer_correct / 20261029140000_vue_transfer_snapshot_sources /
--   20261029220000_vue_transfer_future_dates / 20261106200000_p02_d_batch_transfer（調店相關部分）/
--   20261107100000_m2h_stage_and_transfer_confirm
-- DEV 這 7 支是一路改過來的中間版本；本檔直接寫「最終版」，疊在正式區現況上，
-- 不假設 DEV 中間版本存在，也不用 pg_get_functiondef 動態改寫。
--
-- 這份做什麼（白話）
--   A. 調店申請表 store_transfer_requests 補欄位：requested_date（批次填的日期）、
--      acting_ended／continue_acting／acting_movement_id（調店時代理店長的處理）。
--      corrected_at／corrected_by／correction_reason 正式區已有（20260923090000），這裡只是 IF NOT EXISTS 保險。
--   B. 員工主檔 store_employees 補「階段」欄位 newbie_level（調店確認時會連階段一起帶到新店）。
--   C. 新增調店確認紀錄表 store_transfer_confirmations（一個申請只留一筆，side：from／to／both／admin）。
--      若表已經存在（例如舊版雙方確認留下多筆），會只保留最早一筆、換成新的檢查條件並補唯一索引。
--   D. 新增調店生效日更正紀錄表 workspace_transfer_corrections（每次更正留前後資料，重送同一個 request 不會重複改）。
--   E. 新增／取代 3 支函式（只授權給 service_role，由 workspace API 呼叫）：
--        workspace_transfer_snapshot(uuid)                      調店單當下資料的版本指紋（防止畫面過期後誤確認）
--        workspace_transfer_confirm(uuid,uuid,date,text)        確認調店（任一方督導確認即成立；管理員可代確認；允許未來日期）
--        workspace_transfer_correct(uuid,uuid,date,text,text,uuid)  更正已確認調店的生效日（同月內）
--   F. 依升職異動回填既有員工的階段（只填目前為空的列；與 m2-sql/backfill_employee_stage_C 的 UPDATE 相同，已做過就不會再改）。
--
-- 權限語意（依正式區 has_permission，不是 DEV 版）
--   - 只看 user_roles.is_active／expires_at、role_permissions.is_allowed、permissions.is_active 與 code，
--     不檢查 roles.is_active，DB 端沒有 admin 角色代碼放行（DEV 中間版本的「角色代碼白名單」已移除）。
--   - 因此：能確認／更正調店 = 必須被授予 employee.store_transfer.confirm。管理員若沒被授予此權限碼，也會得到 WORKSPACE_FORBIDDEN。
--   - 通過權限後的範圍判斷：確認 = 原店或新店督導（store_managers.role_type='supervisor'）或 profiles.role='admin'（代確認，留 is_proxy 紀錄）；
--     更正 = 原店或新店任一位負責人（store_managers）或 profiles.role='admin'。這是範圍判斷，不替代權限判斷。
--   - 本檔「不建立也不授權」任何權限碼：employee.store_transfer.confirm 正式區已存在（20260724002545），
--     授權給哪些角色由老闆之後用權限勾選頁決定。
--
-- 依賴（本檔不建立，須先由其他草稿套用；函式採後期繫結，建立時不報錯，但執行調店確認／更正時缺少會失敗）
--   workspace_acting_active(text,uuid,date)、workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text)
--   （DEV 檔 20261106100000_w06_roster_recompute 的名冊重算）。套用前請用 65_transfer_confirm_correct_batch.verify.sql 檢查。
--   批次調店（workspace_movement_save 內建立待確認申請的那一段）屬於異動批次的函式，不在本檔；
--   本檔提供它需要的欄位（requested_date、continue_acting）與 store_transfer_confirmations。
--
-- 會動到既有資料（所以要備份）
--   1. 若 store_transfer_confirmations 已存在且有重複列：刪除重複列（保留最早一筆）。
--   2. 回填 store_employees.newbie_level（只填 NULL 的列）。
--   套用前請先執行 65_transfer_confirm_correct_batch.backup.sql。
--
-- 可重複執行：欄位 IF NOT EXISTS、表 IF NOT EXISTS、函式 CREATE OR REPLACE、回填只動 NULL。
-- 還原：65_transfer_confirm_correct_batch.rollback.sql；驗證（唯讀）：65_transfer_confirm_correct_batch.verify.sql。
-- ============================================================================
BEGIN;

-- A. 調店申請補欄位 ----------------------------------------------------------
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS requested_date date;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS acting_ended boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS continue_acting boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS acting_movement_id uuid;

-- B. 員工階段欄位 -------------------------------------------------------------
ALTER TABLE public.store_employees ADD COLUMN IF NOT EXISTS newbie_level varchar(20);

-- C. 調店確認紀錄表（一個申請只留一筆）------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_transfer_confirmations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES public.store_transfer_requests(id) ON DELETE CASCADE,
 side text NOT NULL CHECK(side IN('from','to','both','admin')),
 confirmed_by uuid NOT NULL,
 is_proxy boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id)
);
-- 表若是舊形狀（雙方確認）：只保留每個申請最早的一筆，換新的 side 檢查，補 request_id 唯一索引。
DELETE FROM public.store_transfer_confirmations c USING public.store_transfer_confirmations d
 WHERE c.request_id=d.request_id AND (c.created_at,c.id)>(d.created_at,d.id);
ALTER TABLE public.store_transfer_confirmations DROP CONSTRAINT IF EXISTS store_transfer_confirmations_side_check;
ALTER TABLE public.store_transfer_confirmations ADD CONSTRAINT store_transfer_confirmations_side_check CHECK(side IN('from','to','both','admin'));
ALTER TABLE public.store_transfer_confirmations DROP CONSTRAINT IF EXISTS store_transfer_confirmations_request_id_side_key;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.store_transfer_confirmations'::regclass AND i.indisunique AND i.indnatts=1
   AND i.indkey[0]=(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=i.indrelid AND a.attname='request_id')) THEN
  CREATE UNIQUE INDEX store_transfer_confirmations_request_uidx ON public.store_transfer_confirmations(request_id);
 END IF;
END $$;
ALTER TABLE public.store_transfer_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_transfer_confirmations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.store_transfer_confirmations TO service_role;

-- D. 生效日更正紀錄表 ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_transfer_corrections(
 request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,transfer_id uuid NOT NULL,old_date date NOT NULL,new_date date NOT NULL,
 reason text NOT NULL,before_data jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_transfer_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_transfer_corrections FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_transfer_corrections TO service_role;

-- E1. 版本指紋（最終版：含確認紀錄、兩家門市所有月份的初始化狀態）-------------------
CREATE OR REPLACE FUNCTION public.workspace_transfer_snapshot(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object(
 'request',to_jsonb(r),
 'stores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stores s WHERE s.id IN(r.from_store_id,r.to_store_id)),
 'employees',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM store_employees e WHERE e.employee_code=r.employee_code),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM employee_movement_history h WHERE h.employee_code=r.employee_code),
 'monthly',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM monthly_staff_status m WHERE m.employee_code=r.employee_code AND m.store_id IN(r.from_store_id,r.to_store_id)),
 'confirmations',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.side) FROM store_transfer_confirmations k WHERE k.request_id=r.id),
 'initialized',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.store_id,x.year_month,x.status) FROM (SELECT DISTINCT store_id,year_month,status FROM monthly_staff_status WHERE store_id IN(r.from_store_id,r.to_store_id))x)
 )::text) FROM store_transfer_requests r WHERE r.id=p_id;
$$;
REVOKE ALL ON FUNCTION public.workspace_transfer_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_snapshot(uuid) TO service_role;

-- E2. 確認調店（最終版）----------------------------------------------------------
-- 與 DEV 最終版的差異只有權限段：改成正式區語意（見檔頭）。未來生效日不設限（使用者已確認）。
CREATE OR REPLACE FUNCTION public.workspace_transfer_confirm(p_actor uuid, p_id uuid, p_date date, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 sup_from boolean; sup_to boolean; conf_side text; from_name text;to_name text;mid uuid;effective_month text;is_admin boolean;is_latest boolean;was_acting boolean;keep_acting boolean;acting_id uuid;cur_pos text;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR (p_date IS NOT NULL AND p_date<'1912-01-01'::date) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- 權限：正式區 has_permission 語意（不檢查 roles.is_active、沒有 admin 角色代碼放行）。
 IF NOT EXISTS(
  SELECT 1 FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.is_allowed=true
  JOIN permissions p ON p.id=rp.permission_id AND p.is_active=true AND p.code='employee.store_transfer.confirm'
  WHERE ur.user_id=p_actor AND ur.is_active=true AND (ur.expires_at IS NULL OR ur.expires_at>now())
 ) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 SELECT role='admin' INTO is_admin FROM profiles WHERE id=p_actor;
 -- Same ordering as employee and promotion transactions; serialize duplicate checks and monthly initialization.
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status,store_transfer_requests IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO req FROM store_transfer_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 IF req.status='confirmed' AND req.confirmed_by=p_actor AND req.effective_date=p_date AND req.movement_history_id IS NOT NULL THEN
  RETURN jsonb_build_object('id',p_id,'status','confirmed','movement_history_id',req.movement_history_id,'alreadyConfirmed',true,'actingEnded',coalesce(req.acting_ended,false),'actingContinued',req.acting_movement_id IS NOT NULL);
 END IF;
 IF req.status<>'pending' THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 -- H.1／H.7：原店或新店任一位督導（role_type=supervisor，主責或代理）確認即成立；系統管理員可代確認並留下紀錄；店長與其他人不能確認。
 sup_from:=EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND role_type='supervisor' AND store_id=req.from_store_id);
 sup_to:=EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND role_type='supervisor' AND store_id=req.to_store_id);
 IF NOT sup_from AND NOT sup_to AND NOT coalesce(is_admin,false) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 conf_side:=CASE WHEN sup_from AND sup_to THEN 'both' WHEN sup_from THEN 'from' WHEN sup_to THEN 'to' ELSE 'admin' END;
 IF p_date IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'WORKSPACE_DATE_REQUIRED'; END IF;
 PERFORM id FROM stores WHERE id IN(req.from_store_id,req.to_store_id) ORDER BY id FOR SHARE;
 IF p_version IS DISTINCT FROM workspace_transfer_snapshot(p_id) THEN RAISE EXCEPTION 'WORKSPACE_STALE'; END IF;
 IF req.from_store_id=req.to_store_id THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 SELECT store_name INTO from_name FROM stores WHERE id=req.from_store_id AND is_active=true;
 SELECT store_name INTO to_name FROM stores WHERE id=req.to_store_id AND is_active=true;
 IF from_name IS NULL OR to_name IS NULL THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND movement_type='store_transfer' AND movement_date=p_date) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 -- B.1：補登過去的調店只寫歷史；員工目前狀態以最新一筆為準，月份名冊依生效日重新計算。
 is_latest:=NOT EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND movement_date>p_date)
  AND NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND last_movement_date>p_date);
 IF is_latest AND (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND is_active=true)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 SELECT * INTO source FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.from_store_id AND is_active=true;
 IF is_latest AND (NOT FOUND OR source.employee_name IS DISTINCT FROM req.employee_name) THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id)>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id;
 effective_month:=to_char(p_date,'YYYY-MM');
 -- A.2：已送審／已確認月份不動，改記到需重新確認清單（由 workspace_roster_recompute 處理）。
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month>=effective_month GROUP BY store_id,year_month HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_MONTH_DUPLICATE'; END IF;
 -- H.5：調店生效時，原店仍是代理店長者代理註記隨調店結束；申請上答了「新店續任代理」者，確認後在新店自動登記代理店長異動（生效日同調店日）。
 was_acting:=workspace_acting_active(req.employee_code,req.from_store_id,p_date);
 keep_acting:=was_acting AND coalesce(req.continue_acting,false);
 -- H.1：確認紀錄只留一筆（由哪一方、哪位督導確認，或管理員代確認）。
 DELETE FROM store_transfer_confirmations WHERE request_id=p_id;
 INSERT INTO store_transfer_confirmations(request_id,side,confirmed_by,is_proxy) VALUES(p_id,conf_side,p_actor,conf_side='admin');
 INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by)
 VALUES(req.employee_code,req.employee_name,req.to_store_id,'store_transfer',p_date,from_name,to_name,req.notes,p_actor) RETURNING id INTO mid;
 IF is_latest THEN
 UPDATE store_employees SET is_active=false,employment_status='resigned',last_movement_date=p_date,last_movement_type='store_transfer' WHERE id=source.id;
 IF target.id IS NULL THEN
  INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,newbie_level,employment_type,is_pharmacist,is_active,start_date,birthday,employment_status,last_promotion_date,last_movement_date,last_movement_type)
  VALUES(req.to_store_id,source.user_id,req.employee_code,req.employee_name,source.position,source.current_position,source.newbie_level,source.employment_type,source.is_pharmacist,true,source.start_date,source.birthday,source.employment_status,source.last_promotion_date,p_date,'store_transfer');
 ELSE
  UPDATE store_employees SET user_id=source.user_id,employee_name=req.employee_name,position=source.position,current_position=source.current_position,newbie_level=source.newbie_level,employment_type=source.employment_type,is_pharmacist=source.is_pharmacist,is_active=true,start_date=source.start_date,birthday=source.birthday,employment_status=source.employment_status,last_promotion_date=source.last_promotion_date,last_movement_date=p_date,last_movement_type='store_transfer' WHERE id=target.id;
 END IF;
 END IF;

 IF keep_acting THEN
  -- 異動歷史以 created_at 排序：新店代理要排在調店之後，才不會被同日的調店結束。
  UPDATE employee_movement_history SET created_at=clock_timestamp() WHERE id=mid;
  SELECT coalesce(current_position,position) INTO cur_pos FROM store_employees WHERE employee_code=req.employee_code ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
  INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,created_at)
  VALUES(req.employee_code,req.employee_name,req.to_store_id,'acting_manager',p_date,nullif(cur_pos,'代理店長'),'代理店長','調店時續任代理店長（隨調店申請自動登記）',p_actor,clock_timestamp()+interval '1 millisecond') RETURNING id INTO acting_id;
 END IF;
 PERFORM workspace_roster_recompute(p_actor,req.employee_code,effective_month,NULL,NULL,true,false,'store_transfer',mid::text,'調店（'||p_date||'）');
 UPDATE store_transfer_requests SET status='confirmed',confirmed_by=p_actor,confirmed_at=now(),effective_date=p_date,movement_history_id=mid,acting_ended=(was_acting AND NOT keep_acting),acting_movement_id=acting_id WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'status','confirmed','movement_history_id',mid,'side',conf_side,'actingEnded',(was_acting AND NOT keep_acting),'actingContinued',keep_acting,'employee_code',req.employee_code,'to_store_id',req.to_store_id,'effective_date',p_date);
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_transfer_confirm(uuid,uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_confirm(uuid,uuid,date,text) TO service_role;

-- E3. 更正已確認調店的生效日（最終版：同月內；連動新店自動登記的代理異動；名冊交給 workspace_roster_recompute）------
CREATE OR REPLACE FUNCTION public.workspace_transfer_correct(p_actor uuid, p_id uuid, p_date date, p_reason text, p_version text, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE req store_transfer_requests%rowtype; cached workspace_transfer_corrections%rowtype; target store_employees%rowtype; old_data jsonb;result jsonb;is_admin boolean;ym text;d integer;total integer;from_name text;to_name text;history employee_movement_history%rowtype;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR p_request IS NULL OR p_date IS NULL OR p_date<'2000-01-01'::date OR p_date>'2100-12-31'::date OR coalesce(btrim(p_reason),'')='' OR length(p_reason)>2000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
 -- 權限：正式區 has_permission 語意（不檢查 roles.is_active、沒有 admin 角色代碼放行）。
 IF NOT EXISTS(
  SELECT 1 FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.is_allowed=true
  JOIN permissions p ON p.id=rp.permission_id AND p.is_active=true AND p.code='employee.store_transfer.confirm'
  WHERE ur.user_id=p_actor AND ur.is_active=true AND (ur.expires_at IS NULL OR ur.expires_at>now())
 ) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 SELECT role='admin' INTO is_admin FROM profiles WHERE id=p_actor;
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status,store_transfer_requests IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO req FROM store_transfer_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';END IF;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND store_id IN(req.from_store_id,req.to_store_id)) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN';END IF;
 SELECT * INTO cached FROM workspace_transfer_corrections WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.transfer_id<>p_id OR cached.new_date<>p_date OR cached.reason<>btrim(p_reason) THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED';END IF;
  RETURN cached.result||jsonb_build_object('alreadyCorrected',true);
 END IF;
 IF req.status<>'confirmed' OR req.effective_date IS NULL OR req.movement_history_id IS NULL THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT';END IF;
 IF req.effective_date=p_date THEN RAISE EXCEPTION 'WORKSPACE_SAME_DATE';END IF;
 IF to_char(req.effective_date,'YYYY-MM')<>to_char(p_date,'YYYY-MM') THEN RAISE EXCEPTION 'WORKSPACE_CROSS_MONTH_PENDING';END IF;
 PERFORM id FROM stores WHERE id IN(req.from_store_id,req.to_store_id) ORDER BY id FOR SHARE;
 IF p_version IS NULL OR p_version IS DISTINCT FROM workspace_transfer_snapshot(p_id) THEN RAISE EXCEPTION 'WORKSPACE_STALE';END IF;
 SELECT * INTO history FROM employee_movement_history WHERE id=req.movement_history_id;
 IF NOT FOUND OR history.movement_type<>'store_transfer' OR history.employee_code IS DISTINCT FROM req.employee_code OR history.store_id IS DISTINCT FROM req.to_store_id OR history.movement_date IS DISTINCT FROM req.effective_date THEN RAISE EXCEPTION 'WORKSPACE_HISTORY_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND id<>history.id AND id IS DISTINCT FROM req.acting_movement_id AND movement_date>=least(req.effective_date,p_date)) THEN RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT';END IF;
 IF EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND last_movement_date>req.effective_date) THEN RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT';END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND is_active=true)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED';END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id AND is_active=true;
 IF NOT FOUND OR target.last_movement_type IS DISTINCT FROM 'store_transfer' OR target.last_movement_date IS DISTINCT FROM req.effective_date THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED';END IF;
 IF NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.from_store_id AND is_active=false AND last_movement_type='store_transfer' AND last_movement_date=req.effective_date) THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED';END IF;
 ym:=to_char(p_date,'YYYY-MM');d:=extract(day FROM p_date);total:=extract(day FROM(date_trunc('month',p_date)+interval '1 month - 1 day'));
 -- A.2：已送審／已確認月份不動，改記到需重新確認清單（由 workspace_roster_recompute 處理）。
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month=ym GROUP BY store_id HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_MONTH_DUPLICATE';END IF;
 SELECT store_name INTO from_name FROM stores WHERE id=req.from_store_id;SELECT store_name INTO to_name FROM stores WHERE id=req.to_store_id;
 old_data:=jsonb_build_object('request',to_jsonb(req),'history',to_jsonb(history),'employees',(SELECT jsonb_agg(to_jsonb(e)) FROM store_employees e WHERE employee_code=req.employee_code),'monthly',(SELECT jsonb_agg(to_jsonb(m)) FROM monthly_staff_status m WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month=ym));
 UPDATE employee_movement_history SET movement_date=p_date,notes=concat_ws('；',nullif(notes,''),'生效日更正 '||req.effective_date||' → '||p_date||'（'||btrim(p_reason)||'）') WHERE id=history.id;
 -- H.5：調店確認時自動登記的新店代理異動，生效日跟著調店更正。
 UPDATE employee_movement_history SET movement_date=p_date WHERE id=req.acting_movement_id;
 UPDATE store_employees SET last_movement_date=p_date WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND last_movement_type='store_transfer' AND last_movement_date=req.effective_date;
 PERFORM workspace_roster_recompute(p_actor,req.employee_code,ym,NULL,NULL,true,false,'store_transfer',history.id::text,'調店生效日更正（'||p_date||'）');
 UPDATE store_transfer_requests SET effective_date=p_date,corrected_at=now(),corrected_by=p_actor,correction_reason=btrim(p_reason) WHERE id=p_id;
 result:=jsonb_build_object('id',p_id,'effective_date',p_date,'status','confirmed');
 INSERT INTO workspace_transfer_corrections(request_id,actor_id,transfer_id,old_date,new_date,reason,before_data,result) VALUES(p_request,p_actor,p_id,req.effective_date,p_date,btrim(p_reason),old_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_transfer_correct(uuid,uuid,date,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_correct(uuid,uuid,date,text,text,uuid) TO service_role;

-- F. 回填既有員工階段（只填目前為空的列；與 m2-sql/backfill_employee_stage_C_backfill.sql 的 UPDATE 相同）-----------
-- BACKFILL-BEGIN
WITH ranked AS (
  SELECT h.id, h.employee_code, h.movement_date, h.new_value AS pos,
         substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS lvl, h.created_at,
         CASE h.new_value
           WHEN '新人' THEN CASE WHEN h.notes LIKE '%二階%' THEN 2 WHEN h.notes LIKE '%一階%' THEN 1 ELSE 0 END
           WHEN '行政' THEN 100 + CASE WHEN h.notes LIKE '%未過階%' THEN 0 WHEN h.notes LIKE '%過階%' THEN 1 ELSE 0 END
           WHEN '專員' THEN 3 WHEN '組長' THEN 4 WHEN '主任' THEN 5 WHEN '副店長' THEN 6
           WHEN '店長' THEN 7 WHEN '督導' THEN 8 WHEN '經理' THEN 9
           ELSE NULL END AS rank_no
  FROM employee_movement_history h
  WHERE h.movement_type = 'promotion' AND h.new_value IS NOT NULL AND h.new_value <> '代理店長'
    AND h.movement_date <= (now() AT TIME ZONE 'Asia/Taipei')::date
), latest_day AS (
  SELECT r.* FROM ranked r
  WHERE r.movement_date = (SELECT max(x.movement_date) FROM ranked x WHERE x.employee_code = r.employee_code)
), latest AS (
  SELECT DISTINCT ON (l.employee_code) l.employee_code, l.pos, l.lvl
  FROM latest_day l
  ORDER BY l.employee_code,
           CASE WHEN (SELECT bool_and(y.rank_no IS NOT NULL AND y.rank_no / 100 = l.rank_no / 100)
                        FROM latest_day y WHERE y.employee_code = l.employee_code) THEN l.rank_no END DESC NULLS LAST,
           l.created_at ASC, l.id ASC
), proposed AS (
  SELECT e.id,
         CASE WHEN l.pos IS NOT NULL THEN CASE WHEN l.pos IN ('新人','行政') AND e.current_position = l.pos THEN l.lvl END
              WHEN e.current_position IN ('新人','行政') THEN
                (SELECT m.newbie_level FROM monthly_staff_status m
                  WHERE m.employee_code = e.employee_code AND m.position = e.current_position AND m.newbie_level IS NOT NULL
                  ORDER BY m.year_month DESC LIMIT 1)
         END AS lvl
  FROM store_employees e LEFT JOIN latest l ON l.employee_code = e.employee_code
)
UPDATE store_employees e SET newbie_level = p.lvl
FROM proposed p
WHERE e.id = p.id AND e.newbie_level IS NULL AND p.lvl IS NOT NULL;
-- BACKFILL-END

NOTIFY pgrst,'reload schema';
COMMIT;
