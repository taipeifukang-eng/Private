-- W06 / M2 規格 A、B 組：異動回寫每月人員名冊（DEV 專用，CREATE OR REPLACE，可重複套用）。
-- 單一真相：workspace_roster_recompute(員編, 起始月份, ...) 依該員工全部異動紀錄重算名冊列。
--   A.1 異動登記、初始化、刪除恢復（C 組）都呼叫它，所以「先初始化後登錄」與「先登錄後初始化」結果相同。
--   A.2 已送審／已確認月份不動，寫入 monthly_staff_recheck（W05 建立的共用結構）；退回草稿後可一鍵重算。
--   A.3 草稿月份以異動為準覆蓋，變更欄位留下記錄（monthly_staff_adjustment_log）。
--   A.4 留停期間後續月份不列名冊；復職可指定門市。A.5 調店兩店列加提示。A.6 升職生效月整月。
--   B.1 補登過去異動只寫歷史；B.2 同日多階取最高職等；B.3 升職同步員工主檔。
BEGIN;

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

-- H.5：員工在指定日（含，依登記先後）是否仍是某店的代理店長（最近一次代理之後沒有結束異動）。調店確認用它判斷「原為代理」。
CREATE OR REPLACE FUNCTION public.workspace_acting_active(p_code text,p_store uuid,p_until date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=p_code
  AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND a.movement_date<=p_until
  AND (a.store_id IS NULL OR a.store_id=p_store)
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

-- 注意：workspace_movement_save／workspace_promotion_save／workspace_transfer_confirm 的唯一定義在 20261106200000_p02_d_batch_transfer.sql（含 D.1、D.2）。
-- 本檔不再定義這三支，重複套用本檔不會蓋掉 P02 版本；全新環境請先套用本檔再套用 P02（apply-workspace-p02-dev.cjs）。
-- ---- 未來生效的升職：到期啟用時同樣走單一計算 ----
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

CREATE OR REPLACE FUNCTION public.workspace_transfer_correct(p_actor uuid, p_id uuid, p_date date, p_reason text, p_version text, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE req store_transfer_requests%rowtype; cached workspace_transfer_corrections%rowtype; target store_employees%rowtype; old_data jsonb;result jsonb;is_admin boolean;ym text;d integer;total integer;from_name text;to_name text;history employee_movement_history%rowtype;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR p_request IS NULL OR p_date IS NULL OR p_date<'2000-01-01'::date OR p_date>'2100-12-31'::date OR coalesce(btrim(p_reason),'')='' OR length(p_reason)>2000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
 
 SELECT role='admin' INTO is_admin FROM profiles WHERE id=p_actor;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
  WHERE ur.user_id=p_actor AND ur.is_active=true AND (ur.expires_at IS NULL OR ur.expires_at>now()) AND r.is_active=true
  AND (r.code IN('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
   OR EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND rp.is_allowed=true AND p.is_active=true AND p.code='employee.store_transfer.confirm'))
 ) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
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
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND id<>history.id AND movement_date>=least(req.effective_date,p_date)) THEN RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT';END IF;
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
 UPDATE store_employees SET last_movement_date=p_date WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND last_movement_type='store_transfer' AND last_movement_date=req.effective_date;
 PERFORM workspace_roster_recompute(p_actor,req.employee_code,ym,NULL,NULL,true,false,'store_transfer',history.id::text,'調店生效日更正（'||p_date||'）');
 UPDATE store_transfer_requests SET effective_date=p_date,corrected_at=now(),corrected_by=p_actor,correction_reason=btrim(p_reason) WHERE id=p_id;
 result:=jsonb_build_object('id',p_id,'effective_date',p_date,'status','confirmed');
 INSERT INTO workspace_transfer_corrections(request_id,actor_id,transfer_id,old_date,new_date,reason,before_data,result) VALUES(p_request,p_actor,p_id,req.effective_date,p_date,btrim(p_reason),old_data,result);
 RETURN result;
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
