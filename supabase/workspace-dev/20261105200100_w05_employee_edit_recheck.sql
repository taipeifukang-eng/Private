-- W05 / M2 規格 E.4：員工管理改職位只改「未送審、未確認」月份，姓名全部同步；已送審／已確認月份記錄到「需重新確認」。
-- monthly_staff_recheck 是共用資料結構：A.2（異動回寫遇到已送審／已確認月份）也沿用同一張表與
-- workspace_monthly_recheck_add()，月結頁讀 status='pending' 的列顯示「需重新確認」清單。（DEV 專用，可重複套用）
BEGIN;

CREATE TABLE IF NOT EXISTS public.monthly_staff_recheck(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_code text NOT NULL,
 employee_name text,
 store_id uuid NOT NULL REFERENCES public.stores(id),
 year_month text NOT NULL CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 monthly_staff_status_id uuid,
 field text NOT NULL,                       -- 受影響欄位，例如 position
 old_value text,                            -- 已送審／確認月份目前的值（沒改）
 new_value text,                            -- 依來源應該變成的值
 reason text NOT NULL,                      -- 機器代碼，例如 employee_edit_position、movement:promotion
 reason_label text NOT NULL,                -- 月結頁顯示用的原因文字
 source_type text NOT NULL,                 -- employee_edit | movement
 source_id text,                            -- 異動 id 或員工編輯的 request id
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid,
 resolved_at timestamptz
);
-- 同一員工、門市、月份、欄位、原因只留一筆待確認；重複登記只更新新值與來源。
CREATE UNIQUE INDEX IF NOT EXISTS monthly_staff_recheck_pending_uidx
 ON public.monthly_staff_recheck(employee_code,store_id,year_month,field,reason) WHERE status='pending';
CREATE INDEX IF NOT EXISTS monthly_staff_recheck_month_idx ON public.monthly_staff_recheck(store_id,year_month,status);
ALTER TABLE public.monthly_staff_recheck ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monthly_staff_recheck FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.monthly_staff_recheck TO service_role;

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
REVOKE ALL ON FUNCTION public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text) TO service_role;

-- 月份是否已送審或已確認：與 workspace_add_monthly_employee 相同的判斷（人員列或門市月統計任一為 submitted／confirmed）。
CREATE OR REPLACE FUNCTION public.workspace_staff_month_locked(p_store uuid,p_month text,p_row_status text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p_row_status,'draft') IN ('submitted','confirmed')
  OR EXISTS(SELECT 1 FROM monthly_store_summary s WHERE s.store_id=p_store AND s.year_month=p_month AND s.store_status IN ('submitted','confirmed'))
$$;
REVOKE ALL ON FUNCTION public.workspace_staff_month_locked(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_staff_month_locked(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION workspace_employee_edit(p_actor uuid,p_request uuid,p_data jsonb,p_expected jsonb) RETURNS jsonb
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
 UPDATE store_employees SET employee_name=new_name,start_date=started,birthday=birth,position=new_pos,current_position=new_pos WHERE employee_code=code;
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
REVOKE ALL ON FUNCTION workspace_employee_edit(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_employee_edit(uuid,uuid,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
