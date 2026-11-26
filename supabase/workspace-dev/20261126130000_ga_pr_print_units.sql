-- 請款單列印「使用單位」逐列可改（ga-pr-print-units）：請款單新增一個可空的 jsonb 欄位 print_units，並更新「儲存列印欄位」函式讓它多收一個 units。
--   欄位 ga_payment_requests.print_units：物件，key＝列印列的穩定識別（水電＝門市 id；採購＝採購單號），value＝使用單位文字（最多 40 字，最多 50 筆）。空＝列印時用預設值（水電＝門市簡稱加帳單備註、採購＝空白）。
--   ga_ws_pay_request_print_fields_set(p_id, p_payload)：payload 多一個 units（物件）。key 對應的值是 null 或空字串＝清除該列覆寫；units 本身是 null＝全部清除；沒帶 units＝不動。
--     有變動才寫 update 操作紀錄，print_fields 清單多一個 print_units。其餘權限、狀態規則與 20261126110000 版相同。
-- 先決：20261126110000_ga_pr_print_fields.sql 已套用。不新增權限碼、不授權給任何角色。可重複執行。
-- 還原：20261126130000_ga_pr_print_units.rollback.sql（會把函式還原成四欄位版本）。
DO $$
BEGIN
  IF to_regprocedure('public.ga_ws_pay_request_print_fields_set(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 ga_pr_print_fields';
  END IF;
END $$;

ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS print_units jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_requests'::regclass AND conname = 'ga_pr_print_units_shape') THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_pr_print_units_shape CHECK (print_units IS NULL OR jsonb_typeof(print_units) = 'object');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_print_fields_set(p_id uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  q public.ga_payment_requests%ROWTYPE;
  n_name text; n_dept text; n_docs text; n_reason text; n_units jsonb;
  v_changed text[] := '{}';
  r record;
  t text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有修改請款單列印欄位的權限（需要請款管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF NOT (p ? 'applicant_name' OR p ? 'applicant_dept' OR p ? 'attach_docs' OR p ? 'reason_override' OR p ? 'units') THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '沒有要儲存的列印欄位'); END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  IF q.status = 'VOID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '這張請款單已作廢，不能修改', jsonb_build_object('current_status', q.status)); END IF;
  n_name := CASE WHEN p ? 'applicant_name' THEN public.ga_pay_txt(p, 'applicant_name', 50, '申請人') ELSE q.applicant_name END;
  n_dept := CASE WHEN p ? 'applicant_dept' THEN public.ga_pay_txt(p, 'applicant_dept', 50, '申請部門') ELSE q.applicant_dept END;
  n_docs := CASE WHEN p ? 'attach_docs' THEN public.ga_pay_txt(p, 'attach_docs', 100, '檢附單據') ELSE q.attach_docs END;
  n_reason := CASE WHEN p ? 'reason_override' THEN public.ga_pay_txt(p, 'reason_override', 200, '申請事由') ELSE q.reason_override END;
  n_units := q.print_units;
  IF p ? 'units' THEN
    IF jsonb_typeof(p -> 'units') = 'null' THEN
      n_units := NULL;
    ELSIF jsonb_typeof(p -> 'units') <> 'object' THEN
      PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', '使用單位格式錯誤');
    ELSE
      n_units := COALESCE(q.print_units, '{}'::jsonb);
      FOR r IN SELECT key AS k, value AS v FROM jsonb_each(p -> 'units') LOOP
        IF char_length(r.k) = 0 OR char_length(r.k) > 100 THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', '使用單位的列識別錯誤'); END IF;
        IF jsonb_typeof(r.v) = 'null' THEN
          n_units := n_units - r.k;
        ELSIF jsonb_typeof(r.v) <> 'string' THEN
          PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', '使用單位格式錯誤');
        ELSE
          t := btrim(r.v #>> '{}');
          IF t = '' THEN n_units := n_units - r.k;
          ELSIF char_length(t) > 40 THEN PERFORM public.ga_rq_raise(400, 'FIELD_TOO_LONG', '使用單位不可超過 40 個字');
          ELSE n_units := n_units || jsonb_build_object(r.k, t);
          END IF;
        END IF;
      END LOOP;
      IF n_units = '{}'::jsonb THEN n_units := NULL; END IF;
    END IF;
    IF n_units IS NOT NULL AND (SELECT count(*) FROM jsonb_object_keys(n_units)) > 50 THEN PERFORM public.ga_rq_raise(400, 'FIELD_TOO_LONG', '使用單位最多 50 列'); END IF;
  END IF;
  IF n_name IS DISTINCT FROM q.applicant_name THEN v_changed := array_append(v_changed, 'applicant_name'::text); END IF;
  IF n_dept IS DISTINCT FROM q.applicant_dept THEN v_changed := array_append(v_changed, 'applicant_dept'::text); END IF;
  IF n_docs IS DISTINCT FROM q.attach_docs THEN v_changed := array_append(v_changed, 'attach_docs'::text); END IF;
  IF n_reason IS DISTINCT FROM q.reason_override THEN v_changed := array_append(v_changed, 'reason_override'::text); END IF;
  IF n_units IS DISTINCT FROM q.print_units THEN v_changed := array_append(v_changed, 'print_units'::text); END IF;
  IF array_length(v_changed, 1) IS NOT NULL THEN
    UPDATE public.ga_payment_requests SET applicant_name = n_name, applicant_dept = n_dept, attach_docs = n_docs, reason_override = n_reason, print_units = n_units WHERE id = q.id RETURNING * INTO q;
    PERFORM public.ga_pay_event(q.id, 'update', q.status, q.status, v_uid, NULL, q.amount_total, jsonb_build_object('print_fields', to_jsonb(v_changed)), NULL);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'changed', to_jsonb(v_changed),
    'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_pay_request_print_fields_set(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_pay_request_print_fields_set(uuid, jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
