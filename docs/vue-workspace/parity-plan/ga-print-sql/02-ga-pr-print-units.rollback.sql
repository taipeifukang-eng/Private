-- 還原 20261126130000_ga_pr_print_units.sql（請款單列印使用單位逐列可改）。
-- 安全規則：已有請款單填了使用單位覆寫就中止（請先確認可以丟掉；測試資料請先清除）。會把「儲存列印欄位」函式還原成四欄位版本。可重複執行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'print_units') THEN
    IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE print_units IS NOT NULL) THEN
      RAISE EXCEPTION '不能撤回：還有請款單填了列印使用單位。';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_print_fields_set(p_id uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  q public.ga_payment_requests%ROWTYPE;
  n_name text; n_dept text; n_docs text; n_reason text;
  v_changed text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有修改請款單列印欄位的權限（需要請款管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF NOT (p ? 'applicant_name' OR p ? 'applicant_dept' OR p ? 'attach_docs' OR p ? 'reason_override') THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '沒有要儲存的列印欄位'); END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  IF q.status = 'VOID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '這張請款單已作廢，不能修改', jsonb_build_object('current_status', q.status)); END IF;
  n_name := CASE WHEN p ? 'applicant_name' THEN public.ga_pay_txt(p, 'applicant_name', 50, '申請人') ELSE q.applicant_name END;
  n_dept := CASE WHEN p ? 'applicant_dept' THEN public.ga_pay_txt(p, 'applicant_dept', 50, '申請部門') ELSE q.applicant_dept END;
  n_docs := CASE WHEN p ? 'attach_docs' THEN public.ga_pay_txt(p, 'attach_docs', 100, '檢附單據') ELSE q.attach_docs END;
  n_reason := CASE WHEN p ? 'reason_override' THEN public.ga_pay_txt(p, 'reason_override', 200, '申請事由') ELSE q.reason_override END;
  IF n_name IS DISTINCT FROM q.applicant_name THEN v_changed := array_append(v_changed, 'applicant_name'::text); END IF;
  IF n_dept IS DISTINCT FROM q.applicant_dept THEN v_changed := array_append(v_changed, 'applicant_dept'::text); END IF;
  IF n_docs IS DISTINCT FROM q.attach_docs THEN v_changed := array_append(v_changed, 'attach_docs'::text); END IF;
  IF n_reason IS DISTINCT FROM q.reason_override THEN v_changed := array_append(v_changed, 'reason_override'::text); END IF;
  IF array_length(v_changed, 1) IS NOT NULL THEN
    UPDATE public.ga_payment_requests SET applicant_name = n_name, applicant_dept = n_dept, attach_docs = n_docs, reason_override = n_reason WHERE id = q.id RETURNING * INTO q;
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
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_pr_print_units_shape;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS print_units;
NOTIFY pgrst, 'reload schema';
