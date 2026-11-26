-- 請款單紙本格式列印（ga-pr-print）：請款單新增四個可空的列印欄位，加兩支專用函式（不改任何既有函式）。
--   欄位 ga_payment_requests：applicant_name 申請人、applicant_dept 申請部門、attach_docs 檢附單據、reason_override 申請事由覆寫（空白＝系統自動帶）。
--   ga_ws_pay_request_print_fields_set(p_id, p_payload)：儲存上述四欄。需請款管理權限；除了已作廢，任何狀態都可改（只影響列印字樣，不動金額、狀態、版本時間）；有變動才寫一筆 update 操作紀錄。
--   ga_ws_pay_request_print_extra(p_id)：列印用補充資料（建立人姓名與部門、水電明細的門市簡稱與帳單備註）。需請款檢視；帳單備註另需水電檢視。
-- 先決：第 4.5 批請款單、G46 水電話費請款（ga_payment_request_bill_lines）、ga-improve-b1。不新增權限碼、不授權給任何角色。可重複執行。
-- 還原：20261126110000_ga_pr_print_fields.rollback.sql。
DO $$
BEGIN
  IF to_regclass('public.ga_payment_requests') IS NULL OR to_regclass('public.ga_payment_request_bill_lines') IS NULL
     OR to_regprocedure('public.ga_pay_event(uuid,text,text,text,uuid,text,numeric,jsonb,text)') IS NULL
     OR to_regprocedure('public.ga_pay_txt(jsonb,text,integer,text)') IS NULL
     OR to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用請款單、水電話費請款與 ga-improve-b1';
  END IF;
END $$;

ALTER TABLE public.ga_payment_requests
  ADD COLUMN IF NOT EXISTS applicant_name text,
  ADD COLUMN IF NOT EXISTS applicant_dept text,
  ADD COLUMN IF NOT EXISTS attach_docs text,
  ADD COLUMN IF NOT EXISTS reason_override text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_requests'::regclass AND conname = 'ga_pr_print_fields_len') THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_pr_print_fields_len CHECK (
      char_length(applicant_name) <= 50 AND char_length(applicant_dept) <= 50 AND char_length(attach_docs) <= 100 AND char_length(reason_override) <= 200);
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

CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_print_extra(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  q public.ga_payment_requests%ROWTYPE;
  v_creator jsonb;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款單的權限'); END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  SELECT jsonb_build_object('name', p.full_name, 'department', p.department) INTO v_creator FROM public.profiles p WHERE p.id = q.created_by;
  IF q.source = 'UTILITY' AND public.ga_ub_can_view(v_uid) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('line_id', l.id, 'store_short_name', s.short_name, 'store_name', s.store_name, 'notes', nullif(btrim(b.notes), '')) ORDER BY l.line_no), '[]'::jsonb)
      INTO v_lines
      FROM public.ga_payment_request_bill_lines l
      JOIN public.ga_utility_bills b ON b.id = l.bill_id
      LEFT JOIN public.stores s ON s.id = l.store_id
     WHERE l.pr_id = q.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('creator', COALESCE(v_creator, '{}'::jsonb), 'bill_lines', v_lines));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_pay_request_print_fields_set(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_pay_request_print_extra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_pay_request_print_fields_set(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ga_ws_pay_request_print_extra(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
