-- ============================================================================
-- 80_movement_batch_monthly_roster.sql  （M9 正式區 SQL 草稿，尚未套用到正式區）
--
-- 組名：異動批次與每月人員狀態
-- 對應 DEV 檔（supabase/workspace-dev/，僅供對照，不是照搬）：
--   20261029180000_vue_monthly_tools        月結工具（津貼整批替換、月統計存檔、手動新增人員）
--   20261029230000_vue_movement_batch       異動批次（最終版在 20261106200000_p02_d_batch_transfer，本檔採 P02 最終版）
--   20261103010000_vue_monthly_bonus_block  區塊計算（正式區已有等價版本，本檔「不替換」，見 C 段）
--   20261106100000_w06_roster_recompute     名冊重算（單一真相）
--   20261106110000_w06_c_movement_edit_delete  修改／刪除歷史異動
--   20261107110000_monthly_roster_page      名冊頁一次取回的 RPC
-- DEV 這些檔是一路改過來的中間版本；本檔直接寫最終狀態，疊在正式區現況上（schema-intake/production-public.schema-only.sql），
-- 不假設任何 DEV 中間版本存在。
--
-- 這份做什麼（白話）
--   0. store_employees 補「階段」欄位 newbie_level（名冊重算同步升職階段會寫它；與草稿 65 相同，IF NOT EXISTS）。
--   A. 月結工具 3 個函式：workspace_save_monthly_allowance（支援／交通／人才培育／春節／誤餐津貼整批替換，含樂觀鎖與月份鎖定）、
--      workspace_save_monthly_summary（門市月統計存檔）、workspace_add_monthly_employee（手動新增人員，冪等）。
--   B. 異動批次：
--      - 放寬 employee_movement_history 的 valid_movement_type，加入 acting_manager（正式區目前只允許 7 種，不含代理店長）；
--        放寬前先檢查既有資料，若有不在新清單內的類型就中止，不會硬改。
--      - workspace_movement_requests（重送去重回執）、workspace_movement_snapshot（畫面版本指紋）、
--        workspace_movement_save（P02 最終版：整批原子、完全重複列略過、批次調店只建「待確認」申請、其餘類型寫歷史後呼叫名冊重算）、
--        workspace_movement_preview（走同一條寫入路徑再必定還原）。
--   C. 區塊計算：正式區已有同名同簽名的 calculate_bonus_block（9 參數版）、update_calculated_block 與
--      monthly_staff_status 上的 trigger_update_calculated_block，邏輯與 DEV 逐行相同。DEV 檔自己註明「不得套用到 Production」，
--      所以本檔不替換、不動權限（正式區現行對 anon 也有 EXECUTE，DEV 版 REVOKE anon 會改變現況）。這一段只做存在性檢查（見上方前置檢查）。
--   D. 名冊重算：monthly_staff_status 補 movement_hint 欄位；新增 monthly_staff_adjustment_log（名冊調整紀錄）；
--      職等表 workspace_position_rank、有效升職 workspace_effective_promotion、主檔職位同步 workspace_employee_master_position_sync、
--      代理店長判斷 workspace_acting_end_event／workspace_acting_active、單人重算 workspace_roster_recompute、
--      單店單月重算 workspace_roster_apply_store_month，以及「到期升職套用」workspace_apply_due_promotions（取代草稿 30 的簡化版）。
--      行為：草稿月份以異動為準覆蓋並留調整紀錄；已送審／已確認月份不動，改記「需重新確認」（monthly_staff_recheck）。
--   E. 修改／刪除歷史異動：workspace_employee_master_resync、workspace_movement_update、workspace_movement_delete。
--   F. 名冊頁 RPC：workspace_extract_store_code、workspace_monthly_roster_page（SECURITY INVOKER，沿用呼叫者的 RLS）。
--
-- 會動到既有資料嗎
--   套用本檔本身：只新增欄位（movement_hint、newbie_level，皆可為空、不重寫表）、新增 2 張表、重建函式、
--   以及把 valid_movement_type 換成更寬的檢查（掃描一次、不改資料）。不會改任何既有人員或異動資料列。
--   套用後「用到」這些函式時（API 呼叫異動登記、初始化月份、刪除／修改異動、到期升職）會改寫
--   monthly_staff_status、store_employees、employee_movement_history、store_transfer_requests，所以套用前請先跑
--   80_movement_batch_monthly_roster.backup.sql，並用 .preview.sql 預覽某月重算會改哪些列。
--   （異動要回寫每月人員狀態，含「初始化後才登錄的異動」；這一點由 workspace_roster_recompute 單一計算保證。）
--
-- 權限語意（依正式區 has_permission，不是 DEV 版）
--   - 本檔所有 workspace_* 函式（除 F 段）只授權 service_role；anon／authenticated 全部收回。權限檢查在 API 層，
--     依正式區語意：不檢查 roles.is_active、資料庫端沒有 admin 角色代碼放行。
--   - 不建立、也不授權任何權限碼（本組沒有新權限碼；授權由老闆之後用勾選頁決定）。
--   - F 段 workspace_monthly_roster_page 是 SECURITY INVOKER，必須以使用者 session 呼叫，結果由呼叫者在正式區各表的 RLS／授權決定，
--     本檔不放大任何權限；給 authenticated 與 service_role 執行，收回 PUBLIC／anon。
--
-- 前置（本檔不建立，須先由其他草稿套用；下面 DO 區塊會逐一檢查，缺少就中止）
--   10_organization_department 或舊版組織表（organization_units／organization_memberships）、
--   15_employee_management（monthly_staff_recheck、workspace_monthly_recheck_add、workspace_staff_month_locked）、
--   30_store_promotions_queue（workspace_promotion_snapshot／save、workspace_promotion_activation）、
--   65_transfer_confirm_correct_batch（store_transfer_requests.requested_date／continue_acting／acting_movement_id、
--   workspace_transfer_correct 由 65 提供，本檔不再定義）。
--   套用順序：10、15、30、65 → 本檔(80)。草稿 65 內呼叫名冊重算的地方（草稿 30 不呼叫），在本檔套用前呼叫會失敗（後期繫結），
--   所以請在 API 切到新版前一次套完。
--   重要：重跑草稿 30 會把 workspace_apply_due_promotions 蓋回簡化版；若重跑 30，請接著再跑本檔。
--
-- 可重複執行：欄位／表 IF NOT EXISTS、函式 CREATE OR REPLACE、約束先 DROP IF EXISTS 再 ADD。
-- 還原：80_movement_batch_monthly_roster.rollback.sql；驗證（唯讀）：.verify.sql；預覽（必定還原）：.preview.sql；備份：.backup.sql。
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- 前置檢查 ------------------------------------------------------------------
DO $$
DECLARE t text; f text; miss text[] := ARRAY[]::text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['stores','profiles','store_employees','employee_movement_history','monthly_staff_status','monthly_store_summary',
    'monthly_performance_details','support_staff_bonus','talent_cultivation_bonus','spring_festival_bonus','meal_allowance_records',
    'store_transfer_requests','organization_units','organization_memberships','monthly_staff_recheck','workspace_promotion_activation'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN miss := miss || ('資料表 '||t); END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text)',
    'public.workspace_staff_month_locked(uuid,text,text)',
    'public.workspace_promotion_snapshot(uuid,jsonb)',
    'public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text)',
    'public.calculate_bonus_block(character varying,character varying,boolean,character varying,boolean,boolean,numeric,text[],boolean)',
    'public.update_calculated_block()'] LOOP
    IF to_regprocedure(f) IS NULL THEN miss := miss || ('函式 '||f); END IF;
  END LOOP;
  IF to_regclass('public.store_transfer_requests') IS NOT NULL AND (
     SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='store_transfer_requests'
       AND column_name IN ('requested_date','continue_acting','acting_movement_id','movement_history_id')) <> 4 THEN
    miss := miss || 'store_transfer_requests 欄位 requested_date／continue_acting／acting_movement_id／movement_history_id（草稿 65）';
  END IF;
  IF to_regclass('public.monthly_staff_status') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trigger_update_calculated_block' AND tgrelid='public.monthly_staff_status'::regclass AND NOT tgisinternal) THEN
    miss := miss || '觸發器 monthly_staff_status.trigger_update_calculated_block';
  END IF;
  IF array_length(miss,1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisite（請先套用前置草稿）：%', array_to_string(miss, '；');
  END IF;
END $$;

-- 0. 員工主檔階段欄位 ---------------------------------------------------------
ALTER TABLE public.store_employees ADD COLUMN IF NOT EXISTS newbie_level varchar(20);

-- A. 月結工具（DEV 20261029180000）---------------------------------------------
create or replace function public.workspace_save_monthly_allowance(p_actor uuid,p_store uuid,p_month text,p_kind text,p_rows jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t text; current_rows jsonb; r jsonb; n integer;
begin
  t := case p_kind when 'support' then 'support_staff_bonus' when 'transport' then 'monthly_staff_status' when 'talent' then 'talent_cultivation_bonus' when 'spring' then 'spring_festival_bonus' when 'meal' then 'meal_allowance_records' end;
  if t is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)>1500 then raise exception 'invalid rows'; end if;
  -- Shared order with summary saving; also blocks legacy status updates during commit.
  lock table monthly_store_summary in share row exclusive mode;
  lock table monthly_staff_status in share row exclusive mode;
  execute format('lock table %I in share row exclusive mode',t);
  if exists(select 1 from monthly_store_summary where store_id=p_store and year_month=p_month and store_status in ('submitted','confirmed'))
     or exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and status in ('submitted','confirmed')) then raise exception 'month locked'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by id),''[]''::jsonb) from %I x where store_id=$1 and year_month=$2',t) into current_rows using p_store,p_month;
  if current_rows is distinct from p_expected then raise exception 'data changed'; end if;
  if p_kind='transport' then
    for r in select value from jsonb_array_elements(p_rows) loop
      update monthly_staff_status set monthly_transport_expense=(r->>'monthly_transport_expense')::numeric,transport_expense_notes=r->>'transport_expense_notes',updated_at=now()
      where store_id=p_store and year_month=p_month and employee_code=r->>'employee_code';
      get diagnostics n=row_count;
      if n<>1 then raise exception 'employee missing or duplicated'; end if;
    end loop;
  else
    execute format('delete from %I where store_id=$1 and year_month=$2',t) using p_store,p_month;
    for r in select value from jsonb_array_elements(p_rows) loop
      if p_kind='support' then
        insert into support_staff_bonus(year_month,store_id,employee_code,employee_name,bonus_amount,created_by)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',(r->>'bonus_amount')::numeric,p_actor);
      elsif p_kind='talent' then
        insert into talent_cultivation_bonus(year_month,store_id,employee_code,employee_name,cultivation_bonus,cultivation_target,created_by)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',(r->>'cultivation_bonus')::integer,r->>'cultivation_target',p_actor);
      elsif p_kind='spring' then
        insert into spring_festival_bonus(year_month,store_id,employee_code,employee_name,attendance_date,category,bonus_amount,created_by)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',(r->>'attendance_date')::date,r->>'category',(r->>'bonus_amount')::integer,p_actor);
      else
        insert into meal_allowance_records(year_month,store_id,employee_code,employee_name,record_date,work_hours,meal_period,employee_type)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',r->>'record_date',r->>'work_hours',r->>'meal_period',r->>'employee_type');
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.workspace_save_monthly_allowance(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_save_monthly_allowance(uuid,uuid,text,text,jsonb,jsonb) to service_role;

create or replace function public.workspace_save_monthly_summary(p_store uuid,p_month text,p_updates jsonb,p_version timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare before_row monthly_store_summary; k text; v jsonb;
begin
  lock table monthly_store_summary in share row exclusive mode;
  lock table monthly_staff_status in share row exclusive mode;
  select * into before_row from monthly_store_summary where store_id=p_store and year_month=p_month;
  if before_row.updated_at is distinct from p_version then raise exception 'data changed'; end if;
  if before_row.store_status in ('submitted','confirmed') or exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and status in ('submitted','confirmed')) then raise exception 'month locked'; end if;
  if before_row.id is null then
    insert into monthly_store_summary(year_month,store_id,total_employees,confirmed_count,store_status) values(p_month,p_store,0,0,'in_progress') returning * into before_row;
  end if;
  for k,v in select * from jsonb_each(p_updates) loop
    if not (k=any(array['total_staff_count','admin_staff_count','newbie_count','business_days','total_gross_profit','total_customer_count','prescription_addon_only_count','regular_prescription_count','chronic_prescription_count','support_to_other_stores_hours','support_from_other_stores_hours'])) or jsonb_typeof(v)<>'number' or v::text::numeric<0 then raise exception 'invalid field'; end if;
    execute format('update monthly_store_summary set %I=$1,updated_at=now() where id=$2',k) using v::text::numeric,before_row.id;
  end loop;
end $$;
revoke all on function public.workspace_save_monthly_summary(uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.workspace_save_monthly_summary(uuid,text,jsonb,timestamptz) to service_role;
create or replace function public.workspace_add_monthly_employee(p_store uuid,p_month text,p_id uuid,p_employee jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing monthly_staff_status; result monthly_staff_status; start_day date;
begin
  lock table monthly_store_summary in share row exclusive mode;
  lock table monthly_staff_status in share row exclusive mode;
  select * into existing from monthly_staff_status where id=p_id;
  if existing.id is not null then
    if existing.store_id<>p_store or existing.year_month<>p_month or not existing.is_manually_added or existing.employee_name<>p_employee->>'employee_name' or coalesce(existing.employee_code,'')<>coalesce(p_employee->>'employee_code','') then raise exception 'request changed'; end if;
    return to_jsonb(existing);
  end if;
  if exists(select 1 from monthly_store_summary where store_id=p_store and year_month=p_month and store_status in ('submitted','confirmed')) or exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and status in ('submitted','confirmed')) then raise exception 'month locked'; end if;
  if nullif(p_employee->>'employee_code','') is not null and exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and upper(employee_code)=upper(p_employee->>'employee_code')) then raise exception 'employee duplicated'; end if;
  select start_date into start_day from store_employees where employee_code=p_employee->>'employee_code' order by (store_id=p_store) desc,start_date limit 1;
  insert into monthly_staff_status(id,year_month,store_id,user_id,employee_code,employee_name,position,employment_type,is_pharmacist,monthly_status,work_days,work_hours,total_days_in_month,notes,status,is_manually_added,newbie_level,start_date,created_at,updated_at)
  values(p_id,p_month,p_store,null,nullif(p_employee->>'employee_code',''),p_employee->>'employee_name',p_employee->>'position',p_employee->>'employment_type',(p_employee->>'is_pharmacist')::boolean,p_employee->>'monthly_status',(p_employee->>'work_days')::numeric,(p_employee->>'work_hours')::numeric,extract(day from (to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day')),nullif(p_employee->>'notes',''),'draft',true,nullif(p_employee->>'newbie_level',''),start_day,now(),now()) returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.workspace_add_monthly_employee(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_add_monthly_employee(uuid,text,uuid,jsonb) to service_role;

-- B. 異動批次（DEV 20261029230000 的表與快照 + 20261106200000 P02 最終版的 save／preview）-------------
-- B.1 放寬 valid_movement_type（加入 acting_manager）。先確認既有資料都落在新清單內，否則中止（不硬改）。
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT movement_type::text, '、') INTO bad FROM public.employee_movement_history
  WHERE movement_type::text NOT IN ('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'employee_movement_history 有不在新清單內的 movement_type：%（請先處理這些資料再套用）', bad;
  END IF;
END $$;
ALTER TABLE public.employee_movement_history DROP CONSTRAINT IF EXISTS valid_movement_type;
ALTER TABLE public.employee_movement_history ADD CONSTRAINT valid_movement_type CHECK(movement_type IN('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer'));

-- B.2 重送去重回執表、畫面版本指紋函式
CREATE TABLE IF NOT EXISTS public.workspace_movement_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL, payload jsonb NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_movement_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_movement_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_movement_requests TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_movement_snapshot(p_rows jsonb) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH codes AS (SELECT DISTINCT value->>'employee_code' code FROM jsonb_array_elements(p_rows))
 SELECT md5(jsonb_build_object(
 'rows',p_rows,
 'stores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM stores s),
 'units',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM organization_units u),
 'profiles',(SELECT jsonb_agg(jsonb_build_object('id',id,'code',employee_code) ORDER BY id) FROM profiles WHERE employee_code IN(SELECT code FROM codes)),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM organization_memberships m JOIN profiles p ON p.id=m.user_id WHERE p.employee_code IN(SELECT code FROM codes)),
 'employees',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM store_employees e WHERE employee_code IN(SELECT code FROM codes)),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM employee_movement_history h WHERE employee_code IN(SELECT code FROM codes)),
 'monthly',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM monthly_staff_status m WHERE employee_code IN(SELECT code FROM codes)),
 'initialized',(SELECT jsonb_agg(to_jsonb(x) ORDER BY store_id,year_month,status) FROM (SELECT DISTINCT store_id,year_month,status FROM monthly_staff_status)x)
 )::text);
$$;

-- B.3 異動批次最終版（P02）：save 與 preview 在 20261106200000 以後才是最終定義；舊中間版（20261029230000）不使用。
CREATE OR REPLACE FUNCTION public.workspace_movement_save(p_actor uuid, p_request uuid, p_rows jsonb, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE cached workspace_movement_requests%rowtype; item jsonb; entry record; emp store_employees%rowtype;
 req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 unit organization_units%rowtype; uid uuid; sid uuid; orgid uuid; mid uuid; ids jsonb:='[]'; output jsonb;
 code text; kind text; dt date; oldval text; newval text; note text; rowno integer;
 skipped jsonb:='[]'; xfer integer:=0; from_sid uuid; to_sid uuid; from_name text;to_name text;ym text;effective_month text;d integer;total integer;month_day text;p_date date;is_latest boolean;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- The API checks RBAC; RPC is service-only. Do not permit a nonexistent audit actor.
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status,organization_units,profiles,organization_memberships IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_movement_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF p_expected IS NULL OR workspace_movement_snapshot(p_rows) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_STALE'; END IF;
 FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(p_rows) WITH ORDINALITY ORDER BY value->>'effective_date',ordinality LOOP
  item:=entry.value;rowno:=entry.ordinality;
  BEGIN
   code:=item->>'employee_code';kind:=item->>'movement_type';dt:=(item->>'effective_date')::date;
   IF code IS NULL OR code !~ '^[A-Z0-9_-]{1,20}$' OR code LIKE 'EXAMPLE-%' OR coalesce(item->>'employee_name','')='' OR dt IS NULL OR dt<'1912-01-01' OR kind NOT IN('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   orgid:=CASE WHEN left(item->>'store_id',4)='org:' THEN substring(item->>'store_id' FROM 5)::uuid END;
   sid:=CASE WHEN orgid IS NULL THEN (item->>'store_id')::uuid END;
   IF orgid IS NOT NULL AND kind<>'onboarding' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   IF orgid IS NULL AND NOT EXISTS(SELECT 1 FROM stores WHERE id=sid AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
   -- 同一天不可同時有留停與復職（狀態與天數會互相矛盾）。
   IF kind IN('leave_without_pay','return_to_work') AND EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_date=dt AND h.movement_type=CASE WHEN kind='leave_without_pay' THEN 'return_to_work' ELSE 'leave_without_pay' END) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_date=dt AND
    CASE WHEN h.movement_type='promotion' AND h.new_value='代理店長' THEN 'acting_manager' ELSE h.movement_type END=kind AND
    (kind<>'promotion' OR (h.new_value=item->>'position' AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(item->>'newbie_level','')))) THEN
    -- D.1：完全重複且已存在的列自動略過，列在結果；其他錯誤整批不存。
    skipped:=skipped||jsonb_build_array(jsonb_build_object('row',rowno,'employee_code',code,'movement_type',kind,'effective_date',dt,'message','已有相同員工、日期及內容的異動紀錄，將自動略過'));CONTINUE;
   END IF;
   IF kind='store_transfer' THEN
    -- D.2：批次輸入的調店列只建立「待確認」調店申請，要原店與新店督導都確認才生效（生效時才寫異動與回寫名冊）。
    from_sid:=(item->>'from_store_id')::uuid;to_sid:=(item->>'to_store_id')::uuid;
    IF from_sid IS NULL OR to_sid IS NULL OR from_sid=to_sid THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
    SELECT store_name INTO from_name FROM stores WHERE id=from_sid AND is_active=true;
    SELECT store_name INTO to_name FROM stores WHERE id=to_sid AND is_active=true;
    IF from_name IS NULL OR to_name IS NULL THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=code AND movement_type='store_transfer' AND movement_date=dt)
     OR EXISTS(SELECT 1 FROM store_transfer_requests WHERE employee_code=code AND status='pending' AND from_store_id=from_sid AND to_store_id=to_sid) THEN
     skipped:=skipped||jsonb_build_array(jsonb_build_object('row',rowno,'employee_code',code,'movement_type',kind,'effective_date',dt,'message','已有相同的調店紀錄或待確認申請，將自動略過'));CONTINUE;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND store_id=from_sid)
     OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND employee_name IS DISTINCT FROM item->>'employee_name') THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    -- H.5：批次逐列可勾「新店續任代理」（預設不勾）；只有該員目前確實是代理店長才會記下。
    INSERT INTO store_transfer_requests(employee_code,employee_name,from_store_id,to_store_id,status,notes,created_by,requested_date,continue_acting)
    VALUES(code,item->>'employee_name',from_sid,to_sid,'pending',nullif(item->>'notes',''),p_actor,dt,coalesce((item->>'continue_acting')::boolean,false) AND workspace_acting_active(code,from_sid,dt)) RETURNING id INTO mid;
    xfer:=xfer+1;

   ELSE
    IF (SELECT count(*) FROM store_employees WHERE employee_code=code AND store_id IS NOT DISTINCT FROM sid)>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    SELECT * INTO emp FROM store_employees WHERE employee_code=code AND store_id IS NOT DISTINCT FROM sid;
    IF kind='return_to_work' AND emp.id IS NULL AND sid IS NOT NULL THEN
     -- 復職不一定回原店：在指定門市建立主檔列，原店列（留停中）停用。
     SELECT * INTO source FROM store_employees WHERE employee_code=code ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
     IF FOUND AND source.employee_name IS NOT DISTINCT FROM item->>'employee_name' THEN
      INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,employment_type,is_pharmacist,is_active,start_date,birthday,employment_status,last_promotion_date,last_movement_date,last_movement_type)
      VALUES(sid,source.user_id,code,source.employee_name,source.position,source.current_position,source.employment_type,source.is_pharmacist,false,source.start_date,source.birthday,'leave_without_pay',source.last_promotion_date,source.last_movement_date,source.last_movement_type);
      SELECT * INTO emp FROM store_employees WHERE employee_code=code AND store_id=sid;
     END IF;
    END IF;
    IF emp.id IS NULL AND kind<>'onboarding' THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND employee_name IS DISTINCT FROM item->>'employee_name') THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    IF kind='onboarding' AND EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND is_active AND store_id IS DISTINCT FROM sid) THEN RAISE EXCEPTION 'WORKSPACE_OTHER_STORE'; END IF;
    IF kind='return_to_work' AND EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND is_active AND employment_status IS DISTINCT FROM 'leave_without_pay' AND store_id IS DISTINCT FROM sid) THEN RAISE EXCEPTION 'WORKSPACE_OTHER_STORE'; END IF;
    IF kind='promotion' THEN
     output:=workspace_promotion_save(p_actor,gen_random_uuid(),sid,jsonb_build_array(item),workspace_promotion_snapshot(sid,jsonb_build_array(item)));
     mid:=(output->'ids'->>0)::uuid;
    ELSE
     oldval:=coalesce(emp.employment_status,'active');newval:=oldval;note:=nullif(item->>'notes','');uid:=NULL;
     IF kind='onboarding' THEN
      IF nullif(item->>'birthday','') IS NULL OR (item->>'birthday')::date>dt OR jsonb_typeof(item->'onboarding_is_pharmacist') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
      newval:='active';oldval:=NULL;
      note:=concat_ws('；',note,'是否藥師:'||CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '是' ELSE '否' END);
      IF orgid IS NOT NULL THEN
       SELECT * INTO unit FROM organization_units WHERE id=orgid AND status='active' AND type<>'company';
       IF NOT FOUND OR EXISTS(SELECT 1 FROM organization_units WHERE parent_id=orgid AND status='active') THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id,status,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.status,a.path||u.id FROM organization_units u JOIN ancestors a ON u.id=a.parent_id WHERE NOT u.id=ANY(a.path)) SELECT 1 FROM ancestors WHERE status<>'active' OR (parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_units WHERE id=ancestors.parent_id))) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF NOT EXISTS(WITH RECURSIVE chain AS (SELECT id,parent_id,type,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.type,c.path||u.id FROM organization_units u JOIN chain c ON u.id=c.parent_id WHERE NOT u.id=ANY(c.path)) SELECT 1 FROM chain WHERE parent_id IS NULL) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF EXISTS(SELECT 1 FROM organization_units WHERE type='headquarters' AND status='active') AND NOT EXISTS(WITH RECURSIVE chain AS (SELECT id,parent_id,type,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.type,c.path||u.id FROM organization_units u JOIN chain c ON u.id=c.parent_id WHERE NOT u.id=ANY(c.path)) SELECT 1 FROM chain WHERE type='headquarters' AND id<>orgid) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF (SELECT count(*) FROM profiles WHERE employee_code=code)<>1 THEN RAISE EXCEPTION 'WORKSPACE_ORG_PROFILE'; END IF;
       SELECT id INTO uid FROM profiles WHERE employee_code=code;
       newval:=unit.code||' '||unit.name;note:=concat_ws('；',note,'任職組織:'||newval);
       UPDATE organization_memberships SET status='inactive',effective_to=dt,is_primary=false,updated_by=p_actor,updated_at=now() WHERE user_id=uid AND membership_type='primary_department' AND status='active' AND effective_to IS NULL;
       IF EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=uid AND organization_unit_id=orgid AND membership_type='primary_department') THEN
        UPDATE organization_memberships SET status='active',effective_from=dt,effective_to=NULL,is_primary=true,membership_role='member',updated_by=p_actor,updated_at=now() WHERE user_id=uid AND organization_unit_id=orgid AND membership_type='primary_department';
       ELSE
        INSERT INTO organization_memberships(organization_unit_id,user_id,membership_role,membership_type,effective_from,status,is_primary,created_by,updated_by) VALUES(orgid,uid,'member','primary_department',dt,'active',true,p_actor,p_actor);
       END IF;
      END IF;
      IF emp.id IS NULL THEN
       INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,employment_type,is_pharmacist,is_active,employment_status,start_date,birthday,last_movement_date,last_movement_type)
       VALUES(sid,uid,code,item->>'employee_name',CASE WHEN code LIKE 'FKPT%' THEN CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '兼職藥師' ELSE '兼職助理' END ELSE '新人' END,CASE WHEN code LIKE 'FKPT%' THEN CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '兼職藥師' ELSE '兼職助理' END ELSE '新人' END,CASE WHEN code LIKE 'FKPT%' THEN 'part_time' ELSE 'full_time' END,(item->>'onboarding_is_pharmacist')::boolean,true,'active',dt,(item->>'birthday')::date,dt,kind);
      ELSE
       UPDATE store_employees SET is_active=true,employment_status='active',start_date=dt,birthday=(item->>'birthday')::date,is_pharmacist=(item->>'onboarding_is_pharmacist')::boolean,last_movement_date=dt,last_movement_type=kind WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt);
      END IF;
     ELSIF kind='acting_manager' THEN
      oldval:=nullif(coalesce(emp.current_position,emp.position),'代理店長');newval:='代理店長';
     ELSIF kind='pass_probation' THEN
      oldval:=coalesce(emp.current_position,emp.position);newval:=coalesce(oldval,'過試用期');
     ELSE
      newval:=CASE kind WHEN 'leave_without_pay' THEN 'leave_without_pay' WHEN 'resignation' THEN 'resigned' ELSE 'active' END;
      UPDATE store_employees SET employment_status=newval,is_active=(newval<>'resigned') WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt);
      IF kind='return_to_work' THEN UPDATE store_employees SET is_active=false,employment_status='resigned' WHERE employee_code=code AND id<>emp.id AND is_active AND (last_movement_date IS NULL OR last_movement_date<=dt); END IF;
     END IF;
     IF kind<>'onboarding' THEN UPDATE store_employees SET last_movement_date=dt,last_movement_type=kind WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt); END IF;
     INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,onboarding_is_pharmacist,created_at)
     VALUES(code,item->>'employee_name',sid,kind,dt,oldval,newval,note,p_actor,CASE WHEN kind='onboarding' THEN (item->>'onboarding_is_pharmacist')::boolean END,clock_timestamp()) RETURNING id INTO mid;
     PERFORM workspace_roster_recompute(p_actor,code,to_char(dt,'YYYY-MM'),NULL,NULL,true,false,kind,mid::text,
      CASE kind WHEN 'onboarding' THEN '入職' WHEN 'acting_manager' THEN '代理' WHEN 'leave_without_pay' THEN '留職停薪' WHEN 'return_to_work' THEN '復職' WHEN 'pass_probation' THEN '過試用期' WHEN 'resignation' THEN '離職' ELSE kind END||'（'||dt||'）');
     IF kind IN('acting_manager','pass_probation') THEN PERFORM workspace_employee_master_position_sync(code); END IF;
    END IF;
   END IF;
   ids:=ids||jsonb_build_array(jsonb_build_object('row',rowno,'id',mid,'pending_transfer_request',kind='store_transfer'));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING MESSAGE=SQLERRM,DETAIL='row='||rowno; END;
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'records',ids,'requestId',p_request,'skipped',skipped,'transferRequests',xfer);
 INSERT INTO workspace_movement_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,output);
 RETURN output;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_movement_preview(p_actor uuid,p_rows jsonb,p_expected text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE detail text; saved jsonb;
BEGIN
 BEGIN
  saved:=workspace_movement_save(p_actor,gen_random_uuid(),p_rows,p_expected);
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='preview rollback';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('valid',true,'skipped',coalesce(saved->'skipped','[]'::jsonb),'transferRequests',coalesce((saved->>'transferRequests')::int,0));
 WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('valid',false,'problem',SQLERRM,'row',coalesce(substring(detail FROM 'row=(\d+)')::integer,1));
 END;
END;
$$;

-- B.4 權限：只給 service_role（API 層做 RBAC 檢查）
REVOKE ALL ON FUNCTION public.workspace_movement_snapshot(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_movement_save(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_movement_preview(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_snapshot(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_movement_save(uuid,uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_movement_preview(uuid,jsonb,text) TO service_role;

-- C. 區塊計算：正式區已有等價的 calculate_bonus_block／update_calculated_block／trigger_update_calculated_block，
--    本檔不替換、不動權限，存在性已在檔首前置檢查確認。

-- D. 名冊重算（DEV 20261106100000，最終版）----------------------------------------
ALTER TABLE public.monthly_staff_status ADD COLUMN IF NOT EXISTS movement_hint text;

CREATE TABLE IF NOT EXISTS public.monthly_staff_adjustment_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.stores(id),
 year_month text NOT NULL CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 employee_code text NOT NULL,
 employee_name text,
 monthly_staff_status_id uuid,
 field text NOT NULL,
 old_value text,
 new_value text,
 movement_id text,
 movement_label text,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monthly_staff_adjustment_log_month_idx ON public.monthly_staff_adjustment_log(store_id,year_month,created_at DESC);
CREATE INDEX IF NOT EXISTS monthly_staff_adjustment_log_code_idx ON public.monthly_staff_adjustment_log(employee_code);
ALTER TABLE public.monthly_staff_adjustment_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monthly_staff_adjustment_log FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.monthly_staff_adjustment_log TO service_role;

-- 職等（與 lib/workspace/position-rank.ts 同一份表）。回傳：門市 0..9、行政 100..101、不在表內 NULL。
CREATE OR REPLACE FUNCTION public.workspace_position_rank(p_position text,p_level text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE btrim(coalesce(p_position,''))
  WHEN '新人' THEN CASE WHEN coalesce(p_level,'') LIKE '%二階%' THEN 2 WHEN coalesce(p_level,'') LIKE '%一階%' THEN 1 ELSE 0 END
  WHEN '行政' THEN 100+CASE WHEN coalesce(p_level,'') LIKE '%未過階%' THEN 0 WHEN coalesce(p_level,'') LIKE '%過階%' THEN 1 ELSE 0 END
  WHEN '專員' THEN 3 WHEN '組長' THEN 4 WHEN '主任' THEN 5 WHEN '副店長' THEN 6 WHEN '店長' THEN 7 WHEN '督導' THEN 8 WHEN '經理' THEN 9
  ELSE NULL END
$$;
GRANT EXECUTE ON FUNCTION public.workspace_position_rank(text,text) TO service_role;

-- B.2：指定日（含）前的有效職位。生效日較晚者優先；同日取職等最高者；無法比較時保留先登錄者。代理店長不參與。
CREATE OR REPLACE FUNCTION public.workspace_effective_promotion(p_code text,p_until date)
RETURNS TABLE(pos text,lvl text,eff_date date,move_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH p AS (
  SELECT h.id,h.movement_date d,h.new_value pos,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') lvl,
   workspace_position_rank(h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)')) rk,h.created_at c
  FROM employee_movement_history h
  WHERE h.employee_code=p_code AND h.movement_type='promotion' AND h.new_value IS NOT NULL AND h.new_value<>'代理店長' AND h.movement_date<=p_until
 ),top AS (SELECT p.* FROM p WHERE p.d=(SELECT max(d) FROM p)),
 g AS (SELECT t.*,(SELECT bool_and(x.rk IS NOT NULL AND x.rk/100=t.rk/100) FROM top x) comparable FROM top t)
 SELECT g.pos,g.lvl,g.d,g.id FROM g ORDER BY (CASE WHEN g.comparable THEN g.rk END) DESC NULLS LAST,g.c ASC,g.id ASC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.workspace_effective_promotion(text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_effective_promotion(text,date) TO service_role;

-- B.3：員工主檔目前職位＝今天（含）以前最新有效升職（B.1、B.2），只改有升職紀錄者，不會把職位清成空值。
CREATE OR REPLACE FUNCTION public.workspace_employee_master_position_sync(p_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; changed integer;
BEGIN
 SELECT * INTO r FROM workspace_effective_promotion(p_code,(now() AT TIME ZONE 'Asia/Taipei')::date);
 IF r.pos IS NULL THEN RETURN false; END IF;
 -- H.4：階段（新人：未過階／一階／二階新人；行政：未過階／過階行政）跟著同一筆有效升職；其他職位沒有階段。
 UPDATE store_employees SET position=r.pos,current_position=r.pos,last_promotion_date=r.eff_date,
  newbie_level=CASE WHEN r.pos IN('新人','行政') THEN r.lvl END,updated_at=now()
 WHERE employee_code=p_code AND (position IS DISTINCT FROM r.pos OR current_position IS DISTINCT FROM r.pos OR last_promotion_date IS DISTINCT FROM r.eff_date
  OR newbie_level IS DISTINCT FROM CASE WHEN r.pos IN('新人','行政') THEN r.lvl END);
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed>0;
END;$$;
REVOKE ALL ON FUNCTION public.workspace_employee_master_position_sync(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_master_position_sync(text) TO service_role;

-- H.5：哪些異動會結束代理店長註記（升職為店長、調店、離職、留職停薪）。代理店長本身不算。
CREATE OR REPLACE FUNCTION public.workspace_acting_end_event(p_type text,p_new text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_type IN('store_transfer','resignation','leave_without_pay') OR (p_type='promotion' AND p_new='店長') $$;
REVOKE ALL ON FUNCTION public.workspace_acting_end_event(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_acting_end_event(text,text) TO service_role;

-- H.5：員工在指定日（含，依登記先後）是否仍是某店的代理店長（最近一次代理之後沒有結束異動）。p_store 為 NULL 表示不分門市。
-- 登記調店時用它偵測「目前是代理店長」，確認調店時用它決定是否在新店自動登記代理。
CREATE OR REPLACE FUNCTION public.workspace_acting_active(p_code text,p_store uuid,p_until date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=p_code
  AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND a.movement_date<=p_until
  AND (p_store IS NULL OR a.store_id IS NULL OR a.store_id=p_store)
  AND NOT EXISTS(SELECT 1 FROM employee_movement_history e WHERE e.employee_code=p_code AND workspace_acting_end_event(e.movement_type,e.new_value)
   AND (e.movement_date,e.created_at,e.id)>(a.movement_date,a.created_at,a.id) AND e.movement_date<=p_until))
$$;
REVOKE ALL ON FUNCTION public.workspace_acting_active(text,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_acting_active(text,uuid,date) TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_roster_recompute(
 p_actor uuid,p_code text,p_from_month text,p_to_month text DEFAULT NULL,p_only_store uuid DEFAULT NULL,
 p_log boolean DEFAULT true,p_apply_locked boolean DEFAULT false,
 p_move_type text DEFAULT 'sync',p_source_id text DEFAULT NULL,p_label text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 ev record; tgt record; rw monthly_staff_status%rowtype; master store_employees%rowtype; win record;
 segs jsonb:='[]'::jsonb; marks jsonb:='[]'::jsonb; tins jsonb:='[]'::jsonb;
 state text:='unknown'; kind text; cur_store uuid; cur_from date; cur_ot text; cur_od date; from_id uuid;
 mfirst date; mlast date; dim integer; ym text; days numeric; present boolean; has_closed boolean; locked boolean; has_place boolean;
 e_kind text; e_date date; c_pos text; c_level text;
 d_status text; d_reason text; d_notes text; d_days numeric; d_pos text; d_level text; d_acting boolean; d_pharm boolean;
 d_type text; d_start date; d_hint text; has_acting boolean; has_onb boolean; fkpt boolean; onb_ph boolean;
 nd_status text; nd_reason text; nd_notes text; nd_days numeric; nd_pos text; nd_level text; nd_acting boolean; nd_pharm boolean; nd_hint text;
 diffs jsonb; fld text; ov text; nv text; sig boolean; label text; reason text;
 res_updated integer:=0; res_created integer:=0; res_removed integer:=0; res_rechecks integer:=0; res_adjust integer:=0;
 changed integer; ename text;
BEGIN
 IF p_code IS NULL OR p_from_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 LOCK TABLE monthly_staff_status,employee_movement_history IN SHARE ROW EXCLUSIVE MODE;
 reason:='movement:'||coalesce(p_move_type,'sync');
 label:=coalesce(p_label,'異動');
 -- 1) 依異動時間軸建立「在哪家店、哪幾天」的區段（離職當天算上班，留停前一天為最後工作日，調店／復職含當天）。
 FOR ev IN SELECT h.id,h.movement_type mt,h.movement_date d,h.store_id,h.old_value,h.new_value FROM employee_movement_history h WHERE h.employee_code=p_code ORDER BY h.movement_date,h.created_at,h.id LOOP
  kind:=CASE WHEN ev.mt='promotion' AND ev.new_value='代理店長' THEN 'acting_manager' ELSE ev.mt END;
  IF kind='onboarding' THEN
   IF cur_store IS NOT NULL THEN segs:=segs||jsonb_build_object('store',cur_store,'f',cur_from,'t',ev.d-1,'ot',cur_ot,'od',cur_od,'ct','rehire','cd',ev.d); END IF;
   cur_store:=ev.store_id;cur_from:=ev.d;cur_ot:='onboarding';cur_od:=ev.d;state:='on';
  ELSIF kind='resignation' THEN
   IF state='unknown' AND ev.store_id IS NOT NULL THEN cur_store:=ev.store_id;cur_from:=NULL;cur_ot:=NULL;cur_od:=NULL; END IF;
   IF cur_store IS NOT NULL THEN segs:=segs||jsonb_build_object('store',cur_store,'f',cur_from,'t',ev.d,'ot',cur_ot,'od',cur_od,'ct','resigned','cd',ev.d); END IF;
   cur_store:=NULL;state:='off';
  ELSIF kind='leave_without_pay' THEN
   IF state='unknown' AND ev.store_id IS NOT NULL THEN cur_store:=ev.store_id;cur_from:=NULL;cur_ot:=NULL;cur_od:=NULL; END IF;
   IF cur_store IS NOT NULL THEN
    segs:=segs||jsonb_build_object('store',cur_store,'f',cur_from,'t',ev.d-1,'ot',cur_ot,'od',cur_od,'ct','leave','cd',ev.d);
    marks:=marks||jsonb_build_object('store',cur_store,'d',ev.d);
   END IF;
   cur_store:=NULL;state:='off';
  ELSIF kind='return_to_work' THEN
   IF NOT (state='on' AND cur_store IS NOT NULL AND cur_store=ev.store_id) THEN
    IF cur_store IS NOT NULL THEN segs:=segs||jsonb_build_object('store',cur_store,'f',cur_from,'t',ev.d-1,'ot',cur_ot,'od',cur_od,'ct','return_move','cd',ev.d); END IF;
    cur_store:=ev.store_id;cur_from:=ev.d;cur_ot:='return';cur_od:=ev.d;
   END IF;
   state:='on';
  ELSIF kind='store_transfer' THEN
   IF state='unknown' THEN
    from_id:=NULL;
    SELECT id INTO from_id FROM stores WHERE store_name=ev.old_value AND (SELECT count(*) FROM stores WHERE store_name=ev.old_value)=1;
    IF from_id IS NOT NULL THEN cur_store:=from_id;cur_from:=NULL;cur_ot:=NULL;cur_od:=NULL; END IF;
   END IF;
   IF state<>'off' AND (cur_store IS NULL OR cur_store<>ev.store_id) THEN
    IF cur_store IS NOT NULL THEN segs:=segs||jsonb_build_object('store',cur_store,'f',cur_from,'t',ev.d-1,'ot',cur_ot,'od',cur_od,'ct','transfer_out','cd',ev.d,'cn',ev.new_value); END IF;
    cur_store:=ev.store_id;cur_from:=ev.d;cur_ot:='transfer_in';cur_od:=ev.d;state:='on';
    tins:=tins||jsonb_build_object('store',ev.store_id,'d',ev.d,'src',ev.old_value);
   END IF;
  ELSE
   IF state='unknown' AND ev.store_id IS NOT NULL THEN cur_store:=ev.store_id;cur_from:=NULL;cur_ot:=NULL;cur_od:=NULL;state:='on'; END IF;
  END IF;
 END LOOP;
 IF cur_store IS NOT NULL THEN segs:=segs||jsonb_build_object('store',cur_store,'f',cur_from,'t',NULL,'ot',cur_ot,'od',cur_od); END IF;
 DROP TABLE IF EXISTS pg_temp.wr_seg;
 CREATE TEMP TABLE wr_seg ON COMMIT DROP AS SELECT (e->>'store')::uuid store,(e->>'f')::date f,(e->>'t')::date t,e->>'ot' ot,(e->>'od')::date od,e->>'ct' ct,(e->>'cd')::date cd,e->>'cn' cn FROM jsonb_array_elements(segs) e;
 DROP TABLE IF EXISTS pg_temp.wr_mark;
 CREATE TEMP TABLE wr_mark ON COMMIT DROP AS SELECT (e->>'store')::uuid store,(e->>'d')::date d FROM jsonb_array_elements(marks) e;
 DROP TABLE IF EXISTS pg_temp.wr_tin;
 CREATE TEMP TABLE wr_tin ON COMMIT DROP AS SELECT (e->>'store')::uuid store,(e->>'d')::date d,e->>'src' src FROM jsonb_array_elements(tins) e;

 fkpt:=p_code LIKE 'FKPT%';
 SELECT EXISTS(SELECT 1 FROM wr_seg WHERE ot IS NOT NULL OR ct IS NOT NULL) INTO has_place;
 SELECT EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=p_code AND (movement_type='acting_manager' OR (movement_type='promotion' AND new_value='代理店長'))) INTO has_acting;
 SELECT EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=p_code AND movement_type='onboarding') INTO has_onb;
 SELECT employee_name INTO ename FROM employee_movement_history WHERE employee_code=p_code ORDER BY movement_date DESC,created_at DESC LIMIT 1;

 -- 2) 逐一處理（門市, 月份）。
 FOR tgt IN
  WITH init AS (
   SELECT DISTINCT store_id,year_month FROM monthly_staff_status WHERE year_month>=p_from_month
   UNION SELECT store_id,year_month FROM monthly_store_summary WHERE year_month>=p_from_month),
  cand AS (
   SELECT store_id,year_month::text year_month FROM monthly_staff_status WHERE employee_code=p_code AND year_month>=p_from_month
   UNION SELECT i.store_id,i.year_month::text FROM init i JOIN wr_seg s ON s.store=i.store_id AND s.ot IS NOT NULL
     AND (s.od IS NULL OR to_char(s.od,'YYYY-MM')<=i.year_month) AND (s.t IS NULL OR to_char(s.t,'YYYY-MM')>=i.year_month)
   UNION SELECT i.store_id,i.year_month::text FROM init i JOIN wr_mark k ON k.store=i.store_id AND to_char(k.d,'YYYY-MM')=i.year_month)
  SELECT store_id sid,year_month ym FROM cand WHERE (p_to_month IS NULL OR year_month<=p_to_month) AND (p_only_store IS NULL OR store_id=p_only_store) ORDER BY year_month,store_id
 LOOP
  ym:=tgt.ym;mfirst:=(ym||'-01')::date;mlast:=(mfirst+interval '1 month - 1 day')::date;dim:=extract(day FROM mlast);
  SELECT coalesce(sum(greatest(0,least(coalesce(s.t,mlast),mlast)-greatest(coalesce(s.f,mfirst),mfirst)+1)),0) INTO days FROM wr_seg s WHERE s.store=tgt.sid;
  SELECT EXISTS(SELECT 1 FROM wr_mark k WHERE k.store=tgt.sid AND to_char(k.d,'YYYY-MM')=ym) INTO present;
  present:=present OR days>0;
  SELECT EXISTS(SELECT 1 FROM wr_seg s WHERE s.store=tgt.sid AND s.t IS NOT NULL AND s.t<mfirst) INTO has_closed;
  rw:=NULL;
  SELECT * INTO rw FROM monthly_staff_status WHERE employee_code=p_code AND store_id=tgt.sid AND year_month=ym ORDER BY created_at,id LIMIT 1;
  locked:=workspace_staff_month_locked(tgt.sid,ym,rw.status);
  master:=NULL;
  SELECT * INTO master FROM store_employees WHERE employee_code=p_code AND store_id=tgt.sid ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
  IF master.id IS NULL THEN SELECT * INTO master FROM store_employees WHERE employee_code=p_code ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1; END IF;

  -- 2a) 這家店此月份已不應列名冊（留停期間、離職後、調出後）。
  IF NOT present THEN
   IF (has_closed OR has_place) AND rw.id IS NOT NULL AND NOT coalesce(rw.is_manually_added,false) THEN
    IF locked AND NOT p_apply_locked THEN
     PERFORM workspace_monthly_recheck_add(p_actor,p_code,coalesce(ename,rw.employee_name),tgt.sid,ym,rw.id,'roster_row','列入名冊','應移出名冊',reason,label||'：此月份依異動不應列名冊，但已送審或已確認未更動','movement',p_source_id);
     res_rechecks:=res_rechecks+1;
    ELSE
     IF p_log THEN
      INSERT INTO monthly_staff_adjustment_log(store_id,year_month,employee_code,employee_name,monthly_staff_status_id,field,old_value,new_value,movement_id,movement_label,created_by)
      VALUES(tgt.sid,ym,p_code,coalesce(ename,rw.employee_name),rw.id,'roster_row','列入名冊','已移出名冊',p_source_id,label,p_actor);
      res_adjust:=res_adjust+1;
     END IF;
     DELETE FROM monthly_staff_status WHERE employee_code=p_code AND store_id=tgt.sid AND year_month=ym;
     UPDATE monthly_staff_recheck SET status='resolved',resolved_by=p_actor,resolved_at=now(),updated_at=now() WHERE employee_code=p_code AND store_id=tgt.sid AND year_month=ym AND source_type='movement' AND status='pending';
     res_removed:=res_removed+1;
    END IF;
   END IF;
   CONTINUE;
  END IF;

  -- 2b) 期望值。
  e_kind:=NULL;e_date:=NULL;
  SELECT x.k,x.d INTO e_kind,e_date FROM (
   SELECT 'new_hire' k,s.od d,1 pr FROM wr_seg s WHERE s.store=tgt.sid AND s.ot='onboarding' AND to_char(s.od,'YYYY-MM')=ym
   UNION ALL SELECT 'return',s.od,1 FROM wr_seg s WHERE s.store=tgt.sid AND s.ot='return' AND to_char(s.od,'YYYY-MM')=ym
   UNION ALL SELECT 'transfer_in',s.od,1 FROM wr_seg s WHERE s.store=tgt.sid AND s.ot='transfer_in' AND to_char(s.od,'YYYY-MM')=ym
   UNION ALL SELECT s.ct,s.cd,2 FROM wr_seg s WHERE s.store=tgt.sid AND s.ct IN('resigned','leave','transfer_out') AND to_char(s.cd,'YYYY-MM')=ym
  ) x ORDER BY x.d DESC,x.pr DESC LIMIT 1;
  d_hint:=NULL;d_status:=NULL;d_reason:=NULL;d_notes:=NULL;
  IF e_kind='new_hire' THEN d_status:='new_hire';d_notes:=to_char(e_date,'MM/DD')||'到職';
  ELSIF e_kind='return' THEN d_status:='full_month';d_reason:='復職';d_notes:=to_char(e_date,'MM/DD')||'復職';
  ELSIF e_kind='transfer_in' THEN d_status:='transferred_in';d_reason:='調入店';d_notes:=to_char(e_date,'MM/DD')||'自'||coalesce((SELECT t.src FROM wr_tin t WHERE t.store=tgt.sid AND t.d=e_date LIMIT 1),'')||'調入';d_hint:='請填寫本店實際時數';
  ELSIF e_kind='resigned' THEN d_status:='resigned';d_reason:='離職';d_notes:=to_char(e_date,'MM/DD')||'離職';
  ELSIF e_kind='leave' THEN d_status:='leave_of_absence';d_reason:='留職停薪';d_notes:=to_char(e_date,'MM/DD')||'留職停薪';
  ELSIF e_kind='transfer_out' THEN d_status:='transferred_out';d_reason:='調出店';d_notes:=to_char(e_date,'MM/DD')||'調出至'||coalesce((SELECT s.cn FROM wr_seg s WHERE s.store=tgt.sid AND s.ct='transfer_out' AND s.cd=e_date LIMIT 1),'');d_hint:='請填寫本店實際時數'; END IF;
  d_days:=NULL;
  IF e_kind IS NOT NULL THEN d_days:=CASE WHEN e_kind='new_hire' AND (fkpt OR coalesce(rw.employment_type,master.employment_type)='part_time') THEN NULL ELSE days END; END IF;
  -- 職位（A.6 升職日所在月份起整月）、階段、代理、藥師
  SELECT * INTO win FROM workspace_effective_promotion(p_code,mlast);
  d_pos:=NULL;d_level:=NULL;
  IF win.pos IS NOT NULL THEN d_pos:=win.pos;d_level:=CASE WHEN win.pos IN('新人','行政') THEN win.lvl END;
  ELSIF e_kind='new_hire' THEN
   onb_ph:=NULL;SELECT onboarding_is_pharmacist INTO onb_ph FROM employee_movement_history WHERE employee_code=p_code AND movement_type='onboarding' AND movement_date=e_date ORDER BY created_at DESC,id DESC LIMIT 1;
   d_pos:=CASE WHEN fkpt THEN CASE WHEN coalesce(onb_ph,false) THEN '兼職藥師' ELSE '兼職助理' END ELSE '新人' END;
   d_level:=CASE WHEN fkpt THEN NULL ELSE '未過階新人' END;
  END IF;
  -- 新建列的預設職位／階段：沒有升職紀錄時，不論月份都依該月以前最近一次入職推導（兼職依是否藥師，其餘新人＋未過階新人）。
  c_pos:=d_pos;c_level:=d_level;
  IF c_pos IS NULL AND has_onb THEN
   onb_ph:=NULL;
   SELECT onboarding_is_pharmacist INTO onb_ph FROM employee_movement_history WHERE employee_code=p_code AND movement_type='onboarding' AND movement_date<=mlast ORDER BY movement_date DESC,created_at DESC,id DESC LIMIT 1;
   IF FOUND THEN
    c_pos:=CASE WHEN fkpt THEN CASE WHEN coalesce(onb_ph,false) THEN '兼職藥師' ELSE '兼職助理' END ELSE '新人' END;
    c_level:=CASE WHEN fkpt THEN NULL ELSE '未過階新人' END;
   END IF;
  END IF;
  d_acting:=NULL;
  -- H.5：代理店長註記在升職為店長、調店、離職、留停時自動結束（結束日＝該異動生效日，該月起名冊不標代理）。
  -- 同一天、較晚登記的代理異動（例如調店後在新店代理）不會被同日的調店結束；代理註記只標在登記代理的那家店。
  IF has_acting THEN d_acting:=EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=p_code
    AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=ym
    AND (a.store_id IS NULL OR a.store_id=tgt.sid)
    AND NOT EXISTS(SELECT 1 FROM employee_movement_history e WHERE e.employee_code=p_code AND workspace_acting_end_event(e.movement_type,e.new_value)
      AND (e.movement_date,e.created_at,e.id)>(a.movement_date,a.created_at,a.id) AND to_char(e.movement_date,'YYYY-MM')<=ym)); END IF;
  d_pharm:=NULL;
  IF has_onb THEN SELECT onboarding_is_pharmacist INTO d_pharm FROM employee_movement_history WHERE employee_code=p_code AND movement_type='onboarding' AND onboarding_is_pharmacist IS NOT NULL AND to_char(movement_date,'YYYY-MM')<=ym ORDER BY movement_date DESC,created_at DESC LIMIT 1; END IF;
  d_type:=NULL;d_start:=NULL;
  IF e_kind='new_hire' THEN d_type:=CASE WHEN fkpt THEN 'part_time' ELSE 'full_time' END;d_start:=e_date; END IF;

  IF rw.id IS NULL THEN
   -- 2c) 新增名冊列：只有明確的起點（入職、復職、調入）才補列；其他情況不憑空新增。
   IF NOT EXISTS(SELECT 1 FROM wr_seg s WHERE s.store=tgt.sid AND s.ot IS NOT NULL AND (s.t IS NULL OR s.t>=mfirst) AND s.od<=mlast) THEN CONTINUE; END IF;
   IF locked AND NOT p_apply_locked THEN
    PERFORM workspace_monthly_recheck_add(p_actor,p_code,ename,tgt.sid,ym,NULL,'roster_row','未列名冊','應列入名冊',reason,label||'：此月份依異動應列入名冊，但已送審或已確認未更動','movement',p_source_id);
    res_rechecks:=res_rechecks+1;CONTINUE;
   END IF;
   INSERT INTO monthly_staff_status(year_month,store_id,user_id,employee_code,employee_name,position,employment_type,is_pharmacist,start_date,monthly_status,work_days,total_days_in_month,work_hours,is_dual_position,has_manager_bonus,is_supervisor_rotation,is_acting_manager,newbie_level,partial_month_reason,partial_month_notes,is_manually_added,status,movement_hint)
   VALUES(ym,tgt.sid,master.user_id,p_code,coalesce(ename,master.employee_name,''),coalesce(c_pos,master.current_position,master.position,'新人'),
    coalesce(d_type,master.employment_type,CASE WHEN fkpt THEN 'part_time' ELSE 'full_time' END),coalesce(d_pharm,master.is_pharmacist,false),coalesce(d_start,master.start_date),
    coalesce(d_status,'full_month'),
    CASE WHEN e_kind IS NOT NULL THEN d_days WHEN coalesce(d_type,master.employment_type,CASE WHEN fkpt THEN 'part_time' END)='part_time' THEN NULL ELSE days END,dim,
    CASE WHEN coalesce(d_type,master.employment_type,CASE WHEN fkpt THEN 'part_time' END)='part_time' THEN 0 END,false,false,false,coalesce(d_acting,false),c_level,d_reason,d_notes,false,'draft',d_hint);
   res_created:=res_created+1;
   CONTINUE;
  END IF;

  -- 2d) 既有列：比對追蹤欄位。
  sig:=has_place AND (coalesce(rw.partial_month_reason,'') IN('離職','留職停薪','復職','調出店','調入店') OR rw.monthly_status IN('new_hire','resigned','transferred_in','transferred_out','leave_of_absence')
   OR coalesce(rw.partial_month_notes,'') ~ '\d\d/\d\d(到職|離職|留職停薪|復職)$|調出至|調入$');
  nd_status:=rw.monthly_status;nd_reason:=rw.partial_month_reason;nd_notes:=rw.partial_month_notes;nd_days:=rw.work_days;
  IF e_kind IS NOT NULL THEN nd_status:=d_status;nd_reason:=d_reason;nd_notes:=d_notes;nd_days:=d_days;
  ELSIF sig THEN nd_status:='full_month';nd_reason:=NULL;nd_notes:=NULL;nd_days:=CASE WHEN rw.employment_type='part_time' THEN NULL ELSE dim END; END IF;
  nd_pos:=coalesce(d_pos,rw.position);nd_level:=CASE WHEN d_pos IS NOT NULL THEN d_level ELSE rw.newbie_level END;
  nd_acting:=coalesce(d_acting,rw.is_acting_manager);nd_pharm:=coalesce(d_pharm,rw.is_pharmacist);
  nd_hint:=CASE WHEN d_hint IS NOT NULL THEN d_hint WHEN rw.movement_hint='請填寫本店實際時數' THEN NULL ELSE rw.movement_hint END;
  diffs:='[]'::jsonb;
  IF nd_pos IS DISTINCT FROM rw.position THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('position',rw.position,nd_pos)); END IF;
  IF nd_level IS DISTINCT FROM rw.newbie_level THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('newbie_level',rw.newbie_level,nd_level)); END IF;
  IF nd_acting IS DISTINCT FROM rw.is_acting_manager THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('is_acting_manager',rw.is_acting_manager::text,nd_acting::text)); END IF;
  IF nd_pharm IS DISTINCT FROM rw.is_pharmacist THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('is_pharmacist',rw.is_pharmacist::text,nd_pharm::text)); END IF;
  IF nd_status IS DISTINCT FROM rw.monthly_status THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('monthly_status',rw.monthly_status,nd_status)); END IF;
  IF nd_days IS DISTINCT FROM rw.work_days THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('work_days',rw.work_days::text,nd_days::text)); END IF;
  IF nd_reason IS DISTINCT FROM rw.partial_month_reason THEN diffs:=diffs||jsonb_build_array(jsonb_build_array('partial_month_reason',rw.partial_month_reason,nd_reason)); END IF;

  IF locked AND NOT p_apply_locked THEN
   FOR fld,ov,nv IN SELECT x->>0,x->>1,x->>2 FROM jsonb_array_elements(diffs) x LOOP
    PERFORM workspace_monthly_recheck_add(p_actor,p_code,coalesce(ename,rw.employee_name),tgt.sid,ym,rw.id,fld,ov,nv,reason,label||'：此月份已送審或已確認，未更動','movement',p_source_id);
    res_rechecks:=res_rechecks+1;
   END LOOP;
   UPDATE monthly_staff_recheck SET status='resolved',resolved_by=p_actor,resolved_at=now(),updated_at=now()
   WHERE employee_code=p_code AND store_id=tgt.sid AND year_month=ym AND source_type='movement' AND status='pending' AND field<>'roster_row' AND NOT (field IN(SELECT x->>0 FROM jsonb_array_elements(diffs) x));
   CONTINUE;
  END IF;

  -- 草稿（或明確要求）：以異動為準覆蓋，並留下調整紀錄（A.3）。
  IF p_log THEN
   FOR fld,ov,nv IN SELECT x->>0,x->>1,x->>2 FROM jsonb_array_elements(diffs) x LOOP
    INSERT INTO monthly_staff_adjustment_log(store_id,year_month,employee_code,employee_name,monthly_staff_status_id,field,old_value,new_value,movement_id,movement_label,created_by)
    VALUES(tgt.sid,ym,p_code,coalesce(ename,rw.employee_name),rw.id,fld,ov,nv,p_source_id,label,p_actor);
    res_adjust:=res_adjust+1;
   END LOOP;
  END IF;
  UPDATE monthly_staff_status SET position=nd_pos,newbie_level=nd_level,is_acting_manager=nd_acting,is_pharmacist=nd_pharm,
   monthly_status=nd_status,work_days=nd_days,partial_month_reason=nd_reason,partial_month_notes=nd_notes,
   total_days_in_month=CASE WHEN e_kind IS NOT NULL OR sig THEN dim ELSE total_days_in_month END,
   employment_type=coalesce(d_type,employment_type),start_date=coalesce(d_start,start_date),
   is_manually_added=CASE WHEN e_kind IS NOT NULL THEN false ELSE is_manually_added END,
   movement_hint=nd_hint,updated_at=now()
  WHERE id=rw.id AND (position IS DISTINCT FROM nd_pos OR newbie_level IS DISTINCT FROM nd_level OR is_acting_manager IS DISTINCT FROM nd_acting OR is_pharmacist IS DISTINCT FROM nd_pharm
    OR monthly_status IS DISTINCT FROM nd_status OR work_days IS DISTINCT FROM nd_days OR partial_month_reason IS DISTINCT FROM nd_reason OR partial_month_notes IS DISTINCT FROM nd_notes
    OR movement_hint IS DISTINCT FROM nd_hint OR employment_type IS DISTINCT FROM coalesce(d_type,employment_type) OR start_date IS DISTINCT FROM coalesce(d_start,start_date)
    OR (e_kind IS NOT NULL AND is_manually_added) OR (e_kind IS NOT NULL OR sig) AND total_days_in_month IS DISTINCT FROM dim);
  GET DIAGNOSTICS changed=ROW_COUNT; res_updated:=res_updated+changed;
  UPDATE monthly_staff_recheck SET status='resolved',resolved_by=p_actor,resolved_at=now(),updated_at=now()
  WHERE employee_code=p_code AND store_id=tgt.sid AND year_month=ym AND source_type='movement' AND status='pending';
 END LOOP;
 RETURN jsonb_build_object('updated',res_updated,'created',res_created,'removed',res_removed,'recheck',res_rechecks,'adjusted',res_adjust);
END;$$;
REVOKE ALL ON FUNCTION public.workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text) TO service_role;

-- 初始化（或退回草稿後一鍵重算）某門市某月份：對該門市有異動紀錄的每位員工呼叫同一支計算。
CREATE OR REPLACE FUNCTION public.workspace_roster_apply_store_month(p_actor uuid,p_store uuid,p_month text,p_log boolean DEFAULT false,p_apply_locked boolean DEFAULT false,p_label text DEFAULT '依異動重算') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; r jsonb; total jsonb:=jsonb_build_object('updated',0,'created',0,'removed',0,'recheck',0,'adjusted',0,'employees',0); k text; sname text;
BEGIN
 IF p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 SELECT store_name INTO sname FROM stores WHERE id=p_store;
 FOR c IN SELECT DISTINCT h.employee_code code FROM employee_movement_history h
   WHERE h.movement_date<=((p_month||'-01')::date+interval '1 month - 1 day')::date
    AND (h.store_id=p_store OR (h.movement_type='store_transfer' AND h.old_value=sname)
     OR h.employee_code IN(SELECT employee_code FROM monthly_staff_status WHERE store_id=p_store AND year_month=p_month)) LOOP
  r:=workspace_roster_recompute(p_actor,c.code,p_month,p_month,p_store,p_log,p_apply_locked,'recompute',NULL,p_label);
  FOREACH k IN ARRAY ARRAY['updated','created','removed','recheck','adjusted'] LOOP total:=jsonb_set(total,ARRAY[k],to_jsonb((total->>k)::int+(r->>k)::int)); END LOOP;
  total:=jsonb_set(total,'{employees}',to_jsonb((total->>'employees')::int+1));
 END LOOP;
 RETURN total;
END;$$;
REVOKE ALL ON FUNCTION public.workspace_roster_apply_store_month(uuid,uuid,text,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_roster_apply_store_month(uuid,uuid,text,boolean,boolean,text) TO service_role;

-- D.x 到期升職套用：取代草稿 30 的簡化版，改走單一重算。只給 service_role。
-- 下面函式定義之後補上 DEV 檔漏寫的權限收回（正式區新建函式預設 anon／authenticated 可執行，security definer 函式必須收回）。
CREATE OR REPLACE FUNCTION public.workspace_apply_due_promotions(p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Taipei'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $$
DECLARE rec jsonb; code text; latest record; first_month text; master_count integer:=0; monthly_count integer:=0; processed_count integer:=0; changed integer;
BEGIN
 IF p_as_of IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID_DATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of) THEN
  RETURN jsonb_build_object('processed',0,'mastersUpdated',0,'monthlyUpdated',0);
 END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE workspace_promotion_activation IN SHARE ROW EXCLUSIVE MODE;
 FOR code IN SELECT DISTINCT h.employee_code FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of ORDER BY h.employee_code LIMIT 500 LOOP
  SELECT min(to_char(h.movement_date,'YYYY-MM')) INTO first_month FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  SELECT e.move_id id,e.pos new_value,e.eff_date movement_date INTO latest FROM workspace_effective_promotion(code,p_as_of) e;
  IF FOUND AND workspace_employee_master_position_sync(code) THEN master_count:=master_count+1; END IF;
  -- A.2：已送審／已確認月份不動，記入需重新確認清單。
  rec:=workspace_roster_recompute(NULL,code,first_month,NULL,NULL,true,false,'promotion',NULL,'升職生效');
  monthly_count:=monthly_count+(rec->>'updated')::int+(rec->>'created')::int;
  UPDATE workspace_promotion_activation q SET processed_at=now(),applied_history_id=latest.id
   FROM employee_movement_history h WHERE h.id=q.history_id AND q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  GET DIAGNOSTICS changed=ROW_COUNT;processed_count:=processed_count+changed;
 END LOOP;
 RETURN jsonb_build_object('processed',processed_count,'mastersUpdated',master_count,'monthlyUpdated',monthly_count);
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_apply_due_promotions(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_apply_due_promotions(date) TO service_role;
-- 職等表是純計算，但仍收回對 anon／authenticated 的預設執行權（DEV 檔只有 GRANT，沒有 REVOKE）。
REVOKE ALL ON FUNCTION public.workspace_position_rank(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_position_rank(text,text) TO service_role;

-- E. 修改／刪除歷史異動（DEV 20261106110000）-----------------------------------------

-- 依「剩餘異動」重建主檔的在職狀態與任職門市：沒有任何狀態類異動（入職、調店、復職、留停、離職）時完全不動。
CREATE OR REPLACE FUNCTION public.workspace_employee_master_resync(p_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ev record; st text; sid uuid; has_status boolean:=false; last_d date; last_t text; target store_employees%rowtype; changed integer:=0; n integer;
BEGIN
 FOR ev IN SELECT h.movement_type mt,h.movement_date d,h.store_id FROM employee_movement_history h WHERE h.employee_code=p_code ORDER BY h.movement_date,h.created_at,h.id LOOP
  last_d:=ev.d;last_t:=ev.mt;
  IF ev.mt IN('onboarding','store_transfer','return_to_work') THEN st:='active';sid:=ev.store_id;has_status:=true;
  ELSIF ev.mt='leave_without_pay' THEN st:='leave_without_pay';IF ev.store_id IS NOT NULL THEN sid:=ev.store_id; END IF;has_status:=true;
  ELSIF ev.mt='resignation' THEN st:='resigned';IF ev.store_id IS NOT NULL THEN sid:=ev.store_id; END IF;has_status:=true;
  END IF;
 END LOOP;
 IF NOT has_status THEN RETURN false; END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=p_code AND store_id IS NOT DISTINCT FROM sid ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
 IF target.id IS NULL THEN RETURN false; END IF;
 UPDATE store_employees SET is_active=(st<>'resigned'),employment_status=st,last_movement_date=last_d,last_movement_type=last_t,updated_at=now()
  WHERE id=target.id AND (is_active IS DISTINCT FROM (st<>'resigned') OR employment_status IS DISTINCT FROM st OR last_movement_date IS DISTINCT FROM last_d OR last_movement_type IS DISTINCT FROM last_t);
 GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
 UPDATE store_employees SET is_active=false,employment_status='resigned',updated_at=now()
  WHERE employee_code=p_code AND id<>target.id AND is_active;
 GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
 RETURN changed>0;
END;$$;
REVOKE ALL ON FUNCTION public.workspace_employee_master_resync(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_master_resync(text) TO service_role;

-- 修改一筆異動。p_fields：employee_name、movement_date、notes、position、newbie_level、onboarding_is_pharmacist（缺少的欄位維持原值）。
CREATE OR REPLACE FUNCTION public.workspace_movement_update(p_actor uuid,p_id uuid,p_fields jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m employee_movement_history%rowtype; nm text; nd date; nn text; npos text; nlevel text; newv text; oldv text; pharm boolean; kind text;
 rec jsonb; from_ym text; old_ym text; new_ym text; lbl text; prior text;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE store_employees,monthly_staff_status,employee_movement_history IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO m FROM employee_movement_history WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 kind:=CASE WHEN m.movement_type='promotion' AND m.new_value='代理店長' THEN 'acting_manager' ELSE m.movement_type END;
 nm:=btrim(coalesce(p_fields->>'employee_name',m.employee_name,''));
 nd:=coalesce(nullif(p_fields->>'movement_date','')::date,m.movement_date);
 IF nm='' OR length(nm)>100 OR nd<'1912-01-01' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 nn:=CASE WHEN p_fields ? 'notes' THEN nullif(btrim(coalesce(p_fields->>'notes','')),'') ELSE m.notes END;
 pharm:=CASE WHEN jsonb_typeof(p_fields->'onboarding_is_pharmacist')='boolean' THEN (p_fields->>'onboarding_is_pharmacist')::boolean ELSE m.onboarding_is_pharmacist END;
 newv:=m.new_value;oldv:=m.old_value;
 IF kind='promotion' THEN
  npos:=btrim(coalesce(p_fields->>'position',m.new_value,''));nlevel:=nullif(btrim(coalesce(p_fields->>'newbie_level','')),'');
  IF npos='行政(過階)' OR (nlevel='過階行政' AND npos='行政') THEN npos:='行政';nlevel:='過階行政';
  ELSIF npos='行政(未過階)' THEN npos:='行政';nlevel:='未過階行政'; END IF;
  IF NOT (p_fields ? 'newbie_level') AND npos IN('新人','行政') THEN nlevel:=substring(m.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'); END IF;
  IF npos='' OR npos='代理店長' OR (npos IN('新人','行政') AND nlevel IS NULL) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  newv:=npos;
  SELECT string_agg(btrim(x),'；') INTO nn FROM unnest(string_to_array(coalesce(nn,''),'；')) x WHERE btrim(x)<>'' AND btrim(x) !~ '^(行政階級|新人等級)[:：]';
  IF npos='行政' AND nlevel IS NOT NULL THEN nn:=concat_ws('；',nn,'行政階級:'||nlevel); END IF;
  IF npos='新人' AND nlevel IS NOT NULL THEN nn:=concat_ws('；',nn,'新人等級:'||nlevel); END IF;
  IF oldv='代理店長' THEN
   SELECT h.new_value INTO prior FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<nd AND h.id<>m.id ORDER BY h.movement_date DESC,h.created_at DESC LIMIT 1;
   IF prior IS NOT NULL THEN oldv:=prior; END IF;
  END IF;
 ELSIF kind='acting_manager' THEN newv:='代理店長';
 ELSIF kind='onboarding' THEN
  -- 備註內的「是否藥師」標記跟著藥師身分走（歷史頁備註欄會顯示它）。
  SELECT string_agg(btrim(x),'；') INTO nn FROM unnest(string_to_array(coalesce(nn,''),'；')) x WHERE btrim(x)<>'' AND btrim(x) !~ '^是否藥師[:：]';
  IF pharm IS NOT NULL THEN nn:=concat_ws('；',nn,'是否藥師:'||CASE WHEN pharm THEN '是' ELSE '否' END); END IF;
 END IF;
 IF nn IS NOT NULL AND length(nn)>5000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_date=nd AND h.id<>m.id AND
   CASE WHEN h.movement_type='promotion' AND h.new_value='代理店長' THEN 'acting_manager' ELSE h.movement_type END=kind AND
   (kind<>'promotion' OR h.new_value IS NOT DISTINCT FROM newv)) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 IF kind IN('leave_without_pay','return_to_work') AND EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_date=nd AND h.id<>m.id AND h.movement_type=CASE WHEN kind='leave_without_pay' THEN 'return_to_work' ELSE 'leave_without_pay' END) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 UPDATE employee_movement_history SET employee_name=nm,movement_date=nd,new_value=newv,old_value=oldv,notes=nn,
  onboarding_is_pharmacist=CASE WHEN kind='onboarding' THEN pharm ELSE onboarding_is_pharmacist END WHERE id=m.id;
 old_ym:=to_char(m.movement_date,'YYYY-MM');new_ym:=to_char(nd,'YYYY-MM');from_ym:=least(old_ym,new_ym);
 -- 主檔：姓名一律同步；入職日期與藥師身分只在這是該員工最新一次入職時同步；最後異動日期跟著改。
 IF nm IS DISTINCT FROM m.employee_name THEN
  UPDATE store_employees SET employee_name=nm,updated_at=now() WHERE employee_code=m.employee_code AND employee_name IS DISTINCT FROM nm;
  -- H.9：名冊姓名一律同步全部月份（含已送審、已確認，不列需重新確認）。
  UPDATE monthly_staff_status s SET employee_name=nm,updated_at=now() WHERE s.employee_code=m.employee_code AND s.employee_name IS DISTINCT FROM nm;
 END IF;
 IF kind='onboarding' AND NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='onboarding' AND h.id<>m.id AND (h.movement_date,h.created_at)>(nd,m.created_at)) THEN
  UPDATE store_employees SET start_date=nd,is_pharmacist=coalesce(pharm,is_pharmacist),updated_at=now()
   WHERE employee_code=m.employee_code AND store_id IS NOT DISTINCT FROM m.store_id AND (start_date IS DISTINCT FROM nd OR is_pharmacist IS DISTINCT FROM coalesce(pharm,is_pharmacist));
 END IF;
 -- H.5：調店確認時自動登記的新店代理異動，生效日跟著調店修改。
 IF nd IS DISTINCT FROM m.movement_date AND m.movement_type='store_transfer' THEN
  UPDATE employee_movement_history h SET movement_date=nd FROM store_transfer_requests q WHERE q.movement_history_id=m.id AND h.id=q.acting_movement_id;
 END IF;
 IF nd IS DISTINCT FROM m.movement_date THEN
  UPDATE store_employees SET last_movement_date=nd,updated_at=now() WHERE employee_code=m.employee_code AND last_movement_date=m.movement_date AND last_movement_type=m.movement_type;
  IF m.movement_type IN('onboarding','leave_without_pay','return_to_work','resignation','store_transfer') THEN PERFORM workspace_employee_master_resync(m.employee_code); END IF;
 END IF;
 lbl:='修改異動（'||nd||'）';
 rec:=workspace_roster_recompute(p_actor,m.employee_code,from_ym,NULL,NULL,true,false,kind,m.id::text,lbl);
 IF kind IN('promotion','acting_manager','pass_probation') THEN PERFORM workspace_employee_master_position_sync(m.employee_code); END IF;
 RETURN jsonb_build_object('id',m.id,'roster',rec,'fromMonth',from_ym);
END;$$;
REVOKE ALL ON FUNCTION public.workspace_movement_update(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_update(uuid,uuid,jsonb) TO service_role;

-- 刪除一筆異動：只能刪該員工最新一筆（movement_date、created_at、id 排序最後者）。
CREATE OR REPLACE FUNCTION public.workspace_movement_delete(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m employee_movement_history%rowtype; newer employee_movement_history%rowtype; kind text; rec jsonb; ym text; eff record; restored boolean:=false;
 today date:=(now() AT TIME ZONE 'Asia/Taipei')::date; prev_onb employee_movement_history%rowtype; rr record; gen uuid;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE store_employees,monthly_staff_status,employee_movement_history IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO m FROM employee_movement_history WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;

 -- H.5：調店確認時自動登記的新店代理異動算調店的一部分：刪調店時一併還原，不算「更晚的異動」。
 IF m.movement_type='store_transfer' THEN SELECT acting_movement_id INTO gen FROM store_transfer_requests WHERE movement_history_id=m.id; END IF;
 SELECT * INTO newer FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.id<>m.id AND h.id IS DISTINCT FROM gen AND (h.movement_date,h.created_at,h.id)>(m.movement_date,m.created_at,m.id) ORDER BY h.movement_date DESC,h.created_at DESC,h.id DESC LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_LATEST' USING DETAIL='newer='||newer.id||';date='||newer.movement_date||';type='||newer.movement_type; END IF;
 kind:=CASE WHEN m.movement_type='promotion' AND m.new_value='代理店長' THEN 'acting_manager' ELSE m.movement_type END;
 ym:=to_char(m.movement_date,'YYYY-MM');
 -- 已確認的調店申請：異動被刪除後標記為已撤銷（rejected），保留申請紀錄與原因，不再指向已不存在的異動。
 IF m.movement_type='store_transfer' THEN
  UPDATE store_transfer_requests SET status='rejected',movement_history_id=NULL,
   notes=concat_ws('；',nullif(notes,''),'調店異動已於 '||to_char(now() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD')||' 刪除（原生效日 '||m.movement_date||'），申請已撤銷')
  WHERE movement_history_id=m.id AND status='confirmed';
 END IF;
 DELETE FROM employee_movement_history WHERE id=m.id;
 IF gen IS NOT NULL THEN DELETE FROM employee_movement_history WHERE id=gen; END IF;
 -- 自動登記的代理異動本身被刪掉時，申請上的連結一併清除。
 UPDATE store_transfer_requests SET acting_movement_id=NULL WHERE acting_movement_id=m.id;
 -- 主檔狀態與門市：依剩餘異動重建（沒有任何狀態類異動時不動）。
 restored:=workspace_employee_master_resync(m.employee_code);
 -- 入職：恢復上一次入職的到職日與藥師身分。
 IF kind='onboarding' THEN
  SELECT * INTO prev_onb FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='onboarding' ORDER BY h.movement_date DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND THEN
   UPDATE store_employees SET start_date=prev_onb.movement_date,is_pharmacist=coalesce(prev_onb.onboarding_is_pharmacist,is_pharmacist),updated_at=now()
    WHERE employee_code=m.employee_code AND store_id IS NOT DISTINCT FROM prev_onb.store_id;
  END IF;
 END IF;
 -- 職位：升職、代理、過試用期刪除後，主檔職位＝今天以前最新有效升職；已沒有任何升職時退回被刪升職的原職位。
 IF kind IN('promotion','acting_manager','pass_probation') THEN
  SELECT * INTO eff FROM workspace_effective_promotion(m.employee_code,today);
  IF eff.pos IS NOT NULL THEN
   restored:=workspace_employee_master_position_sync(m.employee_code) OR restored;
  ELSIF kind='promotion' AND m.old_value IS NOT NULL AND m.old_value<>'代理店長' AND m.movement_date<=today THEN
   -- 被刪升職已經生效過（主檔曾同步到它），且沒有其他已生效升職：退回原職位。尚未生效的升職從未寫入主檔，不動。
   UPDATE store_employees SET position=m.old_value,current_position=m.old_value,last_promotion_date=NULL,newbie_level=NULL,updated_at=now()
    WHERE employee_code=m.employee_code AND current_position IS NOT DISTINCT FROM m.new_value;
   restored:=true;
  END IF;
 END IF;
 -- 名冊職位：已經沒有任何升職紀錄時，重算沒有依據可以還原，草稿月份把被這筆升職改過的職位退回原職位（寫入近期調整紀錄；已送審月份本來就沒被改過，不動）。
 IF kind='promotion' AND m.old_value IS NOT NULL AND m.old_value<>'代理店長' AND m.new_value IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='promotion' AND h.new_value IS NOT NULL AND h.new_value<>'代理店長') THEN
  WITH u AS (
   UPDATE monthly_staff_status s SET position=m.old_value,newbie_level=NULL,updated_at=now()
   WHERE s.employee_code=m.employee_code AND s.year_month>=ym AND s.position IS NOT DISTINCT FROM m.new_value AND NOT workspace_staff_month_locked(s.store_id,s.year_month,s.status)
   RETURNING s.store_id,s.year_month,s.employee_name,s.id)
  INSERT INTO monthly_staff_adjustment_log(store_id,year_month,employee_code,employee_name,monthly_staff_status_id,field,old_value,new_value,movement_id,movement_label,created_by)
  SELECT u.store_id,u.year_month,m.employee_code,u.employee_name,u.id,'position',m.new_value,m.old_value,m.id::text,'刪除異動（'||m.movement_date||'）',p_actor FROM u;
 END IF;
 rec:=workspace_roster_recompute(p_actor,m.employee_code,ym,NULL,NULL,true,false,kind,m.id::text,'刪除異動（'||m.movement_date||'）');
 -- 這位員工已經沒有任何異動：沒有東西再提議更動名冊，這筆異動留下的待確認項目一併結案。
 IF NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code) THEN
  UPDATE monthly_staff_recheck SET status='resolved',resolved_by=p_actor,resolved_at=now(),updated_at=now()
  WHERE employee_code=m.employee_code AND source_type='movement' AND status='pending' AND year_month>=ym;
  -- 刪掉唯一一筆入職：入職產生的名冊列一併移出（未鎖定月份直接刪並留調整紀錄，已送審或已確認月份記需重新確認），主檔停用。
  IF kind='onboarding' THEN
   FOR rr IN SELECT s.* FROM monthly_staff_status s WHERE s.employee_code=m.employee_code AND s.year_month>=ym AND NOT coalesce(s.is_manually_added,false) LOOP
    IF workspace_staff_month_locked(rr.store_id,rr.year_month,rr.status) THEN
     PERFORM workspace_monthly_recheck_add(p_actor,m.employee_code,coalesce(rr.employee_name,m.employee_name),rr.store_id,rr.year_month,rr.id,'roster_row','列入名冊','應移出名冊','movement:onboarding','刪除異動（'||m.movement_date||'）：入職已刪除，但此月份已送審或已確認未更動','movement',m.id::text);
    ELSE
     INSERT INTO monthly_staff_adjustment_log(store_id,year_month,employee_code,employee_name,monthly_staff_status_id,field,old_value,new_value,movement_id,movement_label,created_by)
     VALUES(rr.store_id,rr.year_month,m.employee_code,coalesce(rr.employee_name,m.employee_name),rr.id,'roster_row','列入名冊','已移出名冊',m.id::text,'刪除異動（'||m.movement_date||'）',p_actor);
     DELETE FROM monthly_staff_status WHERE id=rr.id;
    END IF;
   END LOOP;
   UPDATE store_employees SET is_active=false,employment_status='resigned',updated_at=now()
    WHERE employee_code=m.employee_code AND is_active AND last_movement_type='onboarding' AND last_movement_date=m.movement_date;
   restored:=true;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',m.id,'employee_code',m.employee_code,'employee_name',m.employee_name,'movement_type',kind,'roster',rec,'fromMonth',ym,'masterRestored',restored);
END;$$;
REVOKE ALL ON FUNCTION public.workspace_movement_delete(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_delete(uuid,uuid) TO service_role;

-- F. 名冊頁 RPC（DEV 20261107110000）：SECURITY INVOKER，沿用呼叫者在正式區的 RLS／授權 ---------------
-- 先前草稿版（service role 版、含 recheck／adjustments）若曾套用過就移除，避免留下可繞過 RLS 的函式。
DROP FUNCTION IF EXISTS public.workspace_monthly_roster_page(uuid, text, timestamptz);

-- 與 TypeScript extractStoreCode 相同：大寫後取第一段「4 碼數字＋選擇性 1 碼英文」，找不到就用去空白的大寫原字串。
CREATE OR REPLACE FUNCTION public.workspace_extract_store_code(p_raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce((regexp_match(upper(coalesce(p_raw,'')), '[0-9]{4}[A-Z]?'))[1], btrim(upper(coalesce(p_raw,'')), E' \t\r\n'))
$$;

CREATE OR REPLACE FUNCTION public.workspace_monthly_roster_page(p_store uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $$
DECLARE
 cur_code text;
 has_franchise boolean;
 summary_count integer;
 v_records jsonb;
 v_summary jsonb;
BEGIN
 IF p_store IS NULL OR p_month IS NULL OR p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- 本店代碼：看不到本店（RLS）時與 TypeScript 相同視為空字串。
 SELECT coalesce((SELECT workspace_extract_store_code(store_code) FROM stores WHERE id = p_store), '') INTO cur_code;
 SELECT EXISTS(SELECT 1 FROM stores WHERE is_franchise = true AND workspace_extract_store_code(store_code) <> '') INTO has_franchise;

 WITH fr AS (
   SELECT DISTINCT workspace_extract_store_code(store_code) AS c FROM stores WHERE is_franchise = true AND workspace_extract_store_code(store_code) <> ''
 ), staff AS (
   SELECT s.* FROM monthly_staff_status s WHERE s.year_month = p_month AND s.store_id = p_store
 ), agg AS (
   -- 與 TypeScript 相同：加盟店（非本店）的明細不計入；沒有任何加盟店設定時完全不覆寫業績。
   SELECT d.staff_status_id,
          sum(coalesce(d.transaction_count,0)::float8) AS tx,
          sum(coalesce(d.sales_amount,0)::float8) AS sales,
          sum(coalesce(d.gross_profit,0)::float8) AS gp
   FROM monthly_performance_details d
   WHERE has_franchise
     AND d.staff_status_id IN (SELECT id FROM staff)
     AND NOT (workspace_extract_store_code(d.store_code) IN (SELECT c FROM fr)
              AND workspace_extract_store_code(d.store_code) IS DISTINCT FROM cur_code)
   GROUP BY d.staff_status_id
 )
 SELECT coalesce(jsonb_agg(
   (to_jsonb(s)
     || jsonb_build_object(
          'user', (SELECT jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name) FROM profiles p WHERE p.id = s.user_id),
          'last_month_single_item_bonus', (SELECT nullif(b.bonus_amount, 0) FROM support_staff_bonus b WHERE b.year_month = p_month AND b.store_id = p_store AND b.employee_code = s.employee_code LIMIT 1))
     || coalesce((SELECT jsonb_build_object(
          'transaction_count', a.tx,
          'sales_amount', floor(a.sales * 100 + 0.5) / 100,
          'gross_profit', floor(a.gp * 100 + 0.5) / 100,
          'gross_profit_rate', CASE WHEN a.sales > 0 THEN floor((a.gp / a.sales) * 10000 + 0.5) / 100 ELSE 0 END)
        FROM agg a WHERE a.staff_status_id = s.id), '{}'::jsonb))
   ORDER BY s.employee_code), '[]'::jsonb)
 INTO v_records
 FROM staff s;

 -- 與 getStoreMonthlySummary 相同：剛好一列才回傳，沒有或重複視為沒有。
 SELECT count(*) INTO summary_count FROM monthly_store_summary WHERE year_month = p_month AND store_id = p_store;
 IF summary_count = 1 THEN
  SELECT to_jsonb(m) INTO v_summary FROM monthly_store_summary m WHERE m.year_month = p_month AND m.store_id = p_store;
 END IF;

 RETURN jsonb_build_object('records', v_records, 'summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_extract_store_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspace_monthly_roster_page(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_extract_store_code(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_monthly_roster_page(uuid, text) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
