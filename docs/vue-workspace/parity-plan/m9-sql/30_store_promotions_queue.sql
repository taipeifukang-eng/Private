-- M9 正式區草稿 30：門市升遷申請與生效佇列（合併 DEV 20261028150000_vue_store_promotions + 20261028160000_vue_promotion_activation）。
-- 尚未套用到正式區。套用前先跑 30_store_promotions_queue.backup.sql 與 .preview.sql；套用後跑 .verify.sql；要還原跑 .rollback.sql。
--
-- 白話說明
--   1. workspace_promotion_requests：每次「新版工作台送出升遷」的收據（request_id 防重複送出、保存送出內容與結果）。
--   2. workspace_promotion_snapshot / workspace_promotion_save：儲存升遷。同一交易內寫入 employee_movement_history（movement_type='promotion'），
--      重算受影響人員的 monthly_staff_status 區間，並在生效日已到時更新 store_employees 的 position / current_position / last_promotion_date。
--   3. workspace_promotion_activation：「未來生效」升遷的佇列，只收新版工作台建立的升遷，不收舊版歷史。
--   4. 觸發器 workspace_queue_promotion_activation：收據寫入時，把「生效日晚於今天（台北時間）」的升遷排入佇列。
--   5. workspace_apply_due_promotions(date)：把已到生效日的佇列套用到 store_employees 與 monthly_staff_status，並標記 processed_at。
--   6. 排程：若正式區已安裝 pg_cron，則每分鐘呼叫 workspace_apply_due_promotions；沒有 pg_cron 時只丟 NOTICE，不自動安裝擴充
--      （要不要裝由人決定；沒有排程時未來生效的升遷不會自動生效，可由 service_role 手動呼叫該函式）。
--
-- 與正式區現況的關係：正式區目前沒有以上任何物件（supabase/migrations 查無 workspace_promotion*）。本檔只依賴正式區既有的
--   stores、store_employees(current_position, last_promotion_date)、employee_movement_history（movement_type 含 promotion / acting_manager）、
--   monthly_staff_status(newbie_level, is_acting_manager)，不假設 DEV 的中間版本存在。
-- 會碰到既有資料嗎：套用本檔本身不修改上述三張人員表的任何一列；結尾「回補佇列」只讀歷史並寫入新的
--   workspace_promotion_activation，且正式區收據表一開始是空的，預期回補 0 筆。
--   但套用後，儲存升遷與套用到期升遷的函式使用時會更新 store_employees 與 monthly_staff_status，所以仍請先備份。
-- 權限：不新增、不授權任何權限碼；表與函式只授權給 service_role（workspace API 以服務金鑰呼叫），anon / authenticated 全部收回。
--   存取檢查在 API 層（依正式區 has_permission 語意：不檢查 roles.is_active、資料庫端無 admin 繞過）。
-- 可重複執行：IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.stores') IS NULL OR to_regclass('public.store_employees') IS NULL
     OR to_regclass('public.employee_movement_history') IS NULL OR to_regclass('public.monthly_staff_status') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: stores / store_employees / employee_movement_history / monthly_staff_status 不齊全';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND (
        (table_name='store_employees' AND column_name IN ('current_position','last_promotion_date','updated_at'))
     OR (table_name='monthly_staff_status' AND column_name IN ('newbie_level','is_acting_manager','updated_at')))) <> 6 THEN
    RAISE EXCEPTION 'Missing prerequisite: 人員表缺少 current_position / last_promotion_date / newbie_level / is_acting_manager / updated_at 欄位';
  END IF;
END $$;

-- ===== 第 1 段：升遷申請收據與儲存函式 =====
CREATE TABLE IF NOT EXISTS public.workspace_promotion_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_promotion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_promotion_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_promotion_requests TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_promotion_snapshot(p_store uuid,p_rows jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH codes AS (SELECT DISTINCT value->>'employee_code' AS code FROM jsonb_array_elements(p_rows))
 SELECT md5(jsonb_build_object(
  'store',(SELECT to_jsonb(s) FROM stores s WHERE id=p_store),
  'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM store_employees e WHERE e.employee_code IN (SELECT code FROM codes)),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb) FROM employee_movement_history h WHERE h.employee_code IN (SELECT code FROM codes)),
  'monthly',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) FROM monthly_staff_status m WHERE m.employee_code IN (SELECT code FROM codes))
 )::text);
$$;

CREATE OR REPLACE FUNCTION public.workspace_promotion_save(p_actor uuid,p_request uuid,p_store uuid,p_rows jsonb,p_expected text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_promotion_requests%rowtype; item jsonb; emp store_employees%rowtype;
 code text; start_month text; start_date date; previous_position text; level text; position_row record;
 ids jsonb:='[]'::jsonb; new_id uuid; output jsonb; monthly_count integer:=0; changed integer;
 today date:=(now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- Lock before checking both the receipt and snapshot. Legacy writers also take row-exclusive table locks.
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_promotion_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.store_id<>p_store OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM stores WHERE id=p_store AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_INACTIVE'; END IF;
 IF workspace_promotion_snapshot(p_store,p_rows) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'employee_code',r->>'effective_date',r->>'position',r->>'newbie_level' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) WITH ORDINALITY ORDER BY value->>'effective_date',CASE value->>'newbie_level' WHEN '二階新人' THEN 2 WHEN '一階新人' THEN 1 ELSE 0 END,ordinality LOOP
  code:=item->>'employee_code';level:=nullif(item->>'newbie_level','');
  IF coalesce(code,'')='' OR code<>upper(btrim(code)) OR length(code)>20 OR coalesce(item->>'employee_name','')='' OR
     coalesce(item->>'effective_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR (item->>'effective_date')::date<'1912-01-01'::date OR
     coalesce(item->>'position','') NOT IN ('總經理','副總經理','資深經理','經理','督導','店長','副店長','主任','資深副理','副理','組長','資深專員','高級專員','專員','出納專員','助理','新人','行政','兼職專員','兼職藥師','兼職藥師專員','兼職助理','代理店長') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF item->>'position'='新人' AND coalesce(level,'') NOT IN ('未過階新人','一階新人','二階新人') OR item->>'position'='行政' AND coalesce(level,'') NOT IN ('未過階行政','過階行政') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF (SELECT count(*) FROM store_employees WHERE store_id=p_store AND employee_code=code)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  SELECT * INTO emp FROM store_employees WHERE store_id=p_store AND employee_code=code;
  IF emp.employee_name IS DISTINCT FROM item->>'employee_name' THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.movement_date=(item->>'effective_date')::date AND h.new_value=item->>'position'
    AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(level,'')) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
  -- The previous official position follows chronology, never an acting appointment.
  SELECT h.new_value INTO previous_position FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=(item->>'effective_date')::date
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF previous_position IS NULL THEN
   SELECT m.position INTO previous_position FROM monthly_staff_status m WHERE m.employee_code=code AND m.year_month<left(item->>'effective_date',7) AND m.position<>'代理店長' ORDER BY m.year_month DESC,m.id LIMIT 1;
  END IF;
  IF previous_position IS NULL THEN
   SELECT nullif(h.old_value,'代理店長') INTO previous_position FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date>(item->>'effective_date')::date ORDER BY h.movement_date,h.created_at,h.id LIMIT 1;
  END IF;
  IF previous_position IS NULL THEN previous_position:=nullif(coalesce(emp.current_position,emp.position),'代理店長'); END IF;
  INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,created_at)
   VALUES(code,item->>'employee_name',p_store,'promotion',(item->>'effective_date')::date,previous_position,item->>'position',nullif(concat_ws('；',nullif(item->>'notes',''),CASE WHEN item->>'position'='新人' THEN '新人等級:'||level WHEN item->>'position'='行政' THEN '行政階級:'||level END),''),p_actor,clock_timestamp()) RETURNING id INTO new_id;
  ids:=ids||jsonb_build_array(new_id);
 END LOOP;
 -- Recompute complete affected monthly intervals, so a backdated insert cannot overwrite a later promotion.
 FOR code,start_month,start_date IN SELECT value->>'employee_code',min(left(value->>'effective_date',7)),min((value->>'effective_date')::date) FROM jsonb_array_elements(p_rows) GROUP BY value->>'employee_code' LOOP
  WITH desired AS (
   SELECT m.id,h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS new_level,
    EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=code AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=m.year_month) AS acting
   FROM monthly_staff_status m LEFT JOIN LATERAL (
    SELECT h.new_value,h.notes FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=m.year_month
    ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1
   ) h ON true WHERE m.employee_code=code AND m.year_month>=start_month
  ) UPDATE monthly_staff_status m SET position=coalesce(d.new_value,m.position),
     newbie_level=CASE WHEN d.new_value IS NULL THEN m.newbie_level WHEN d.new_value IN ('新人','行政') THEN d.new_level ELSE NULL END,
     is_acting_manager=CASE WHEN d.acting THEN true ELSE m.is_acting_manager END,updated_at=now()
    FROM desired d WHERE d.id=m.id;
  GET DIAGNOSTICS changed=ROW_COUNT; monthly_count:=monthly_count+changed;
  -- Future appointments remain in history/monthly planning and do not prematurely change today's master.
  SELECT h.new_value,h.movement_date INTO position_row FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=today
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND AND start_date<=today THEN
   UPDATE store_employees SET position=position_row.new_value,current_position=position_row.new_value,last_promotion_date=position_row.movement_date,updated_at=now() WHERE employee_code=code;
  END IF;
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'ids',ids,'monthlyUpdated',monthly_count);
 INSERT INTO workspace_promotion_requests(request_id,actor_id,store_id,payload,result) VALUES(p_request,p_actor,p_store,p_rows,output);
 RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_promotion_snapshot(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_promotion_snapshot(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text) TO service_role;
-- ===== 第 2 段：生效佇列、觸發器、回補、套用到期升遷 =====
-- Queue only promotions created through the new workspace, never unrelated legacy history.
CREATE TABLE IF NOT EXISTS public.workspace_promotion_activation (
 history_id uuid PRIMARY KEY REFERENCES public.employee_movement_history(id) ON DELETE CASCADE,
 request_id uuid NOT NULL REFERENCES public.workspace_promotion_requests(request_id) ON DELETE CASCADE,
 queued_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 applied_history_id uuid REFERENCES public.employee_movement_history(id) ON DELETE SET NULL
);
ALTER TABLE public.workspace_promotion_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_promotion_activation FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_promotion_activation TO service_role;
CREATE INDEX IF NOT EXISTS workspace_promotion_activation_pending ON public.workspace_promotion_activation(history_id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.workspace_queue_promotion_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO workspace_promotion_activation(history_id,request_id)
 SELECT h.id,NEW.request_id FROM employee_movement_history h
 WHERE h.id IN (SELECT value::uuid FROM jsonb_array_elements_text(NEW.result->'ids'))
 AND h.movement_type='promotion' AND h.movement_date>(now() AT TIME ZONE 'Asia/Taipei')::date
 ON CONFLICT(history_id) DO NOTHING;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspace_queue_promotion_activation ON public.workspace_promotion_requests;
CREATE TRIGGER workspace_queue_promotion_activation AFTER INSERT ON public.workspace_promotion_requests
FOR EACH ROW EXECUTE FUNCTION public.workspace_queue_promotion_activation();
INSERT INTO workspace_promotion_activation(history_id,request_id)
 SELECT h.id,r.request_id FROM workspace_promotion_requests r CROSS JOIN LATERAL jsonb_array_elements_text(r.result->'ids') item
 JOIN employee_movement_history h ON h.id=item.value::uuid
 WHERE h.movement_type='promotion' AND h.movement_date>(r.created_at AT TIME ZONE 'Asia/Taipei')::date
 ON CONFLICT(history_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.workspace_apply_due_promotions(p_as_of date DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET lock_timeout='5s' AS $$
DECLARE code text; latest record; first_month text; master_count integer:=0; monthly_count integer:=0; processed_count integer:=0; changed integer;
BEGIN
 IF p_as_of IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID_DATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of) THEN
  RETURN jsonb_build_object('processed',0,'mastersUpdated',0,'monthlyUpdated',0);
 END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE workspace_promotion_activation IN SHARE ROW EXCLUSIVE MODE;
 FOR code IN SELECT DISTINCT h.employee_code FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of ORDER BY h.employee_code LIMIT 500 LOOP
  SELECT min(to_char(h.movement_date,'YYYY-MM')) INTO first_month FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  SELECT h.id,h.new_value,h.movement_date INTO latest FROM employee_movement_history h
   WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=p_as_of
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND THEN
   UPDATE store_employees SET position=latest.new_value,current_position=latest.new_value,last_promotion_date=latest.movement_date,updated_at=now()
    WHERE employee_code=code AND (position,current_position,last_promotion_date) IS DISTINCT FROM (latest.new_value,latest.new_value,latest.movement_date);
   GET DIAGNOSTICS changed=ROW_COUNT;master_count:=master_count+changed;
  END IF;
  -- Include months created after the original save, and preserve all later official promotions.
  WITH desired AS (
   SELECT m.id,h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS new_level,
    EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=code AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=m.year_month) AS acting
   FROM monthly_staff_status m LEFT JOIN LATERAL (
    SELECT h.new_value,h.notes FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=m.year_month
    ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1
   ) h ON true WHERE m.employee_code=code AND m.year_month>=first_month
  ) UPDATE monthly_staff_status m SET position=coalesce(d.new_value,m.position),newbie_level=CASE WHEN d.new_value IS NULL THEN m.newbie_level WHEN d.new_value IN ('新人','行政') THEN d.new_level ELSE NULL END,
    is_acting_manager=CASE WHEN d.acting THEN true ELSE m.is_acting_manager END,updated_at=now()
    FROM desired d WHERE d.id=m.id;
  GET DIAGNOSTICS changed=ROW_COUNT;monthly_count:=monthly_count+changed;
  UPDATE workspace_promotion_activation q SET processed_at=now(),applied_history_id=latest.id
   FROM employee_movement_history h WHERE h.id=q.history_id AND q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  GET DIAGNOSTICS changed=ROW_COUNT;processed_count:=processed_count+changed;
 END LOOP;
 RETURN jsonb_build_object('processed',processed_count,'mastersUpdated',master_count,'monthlyUpdated',monthly_count);
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_queue_promotion_activation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_apply_due_promotions(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_apply_due_promotions(date) TO service_role;

-- 排程（可重複執行：先取消同名再建立；未安裝 pg_cron 則略過）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='workspace-promotion-activation';
    PERFORM cron.schedule('workspace-promotion-activation','* * * * *','SELECT public.workspace_apply_due_promotions();');
  ELSE
    RAISE NOTICE 'pg_cron 未安裝：略過排程，未來生效的升遷需手動呼叫 workspace_apply_due_promotions()';
  END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
