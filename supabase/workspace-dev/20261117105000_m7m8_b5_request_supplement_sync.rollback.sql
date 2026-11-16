-- 還原 20261117105000_m7m8_b5_request_supplement_sync.sql：把 ga_ws_req_transition、ga_ws_req_store_action 還原成第 4 批原定義（套用前的 pg_get_functiondef 備份）。
-- 還原後補資料不再同步工單、送門市確認又回到內嵌的工單更新（行為與第 4 批相同）。
CREATE OR REPLACE FUNCTION public.ga_ws_req_store_action(p_id uuid, p_action text, p_note text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_a text := lower(COALESCE(p_action, ''));
  v_note text := ga_normalize_optional_text(p_note);
  v_manage boolean;
  v_member boolean;
  v_proxy boolean := false;
  v_allowed boolean;
  v_need text;
  v_new text;
  v_progress text;
  v_title text;
  v_type text;
  v_body text;
  v_wo public.maintenance_requests%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_stage text;
  v_mstatus text;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_a NOT IN ('submit_supplement', 'confirm_complete', 'report_problem') THEN RETURN public.ga_rq_err(400, 'INVALID_ACTION', '門市回覆動作錯誤'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTE_TOO_LONG', '說明不可超過 2000 字'); END IF;
  IF v_a = 'submit_supplement' AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '補充資料必須填寫回覆說明'); END IF;
  IF v_a = 'report_problem' AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '回報有問題必須填寫問題原因'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    v_manage := has_permission(v_uid, 'general_affairs.request.manage');
    v_member := public.ga_rq_is_store_member(v_uid, v_req.store_id);
    v_allowed := CASE WHEN v_a = 'submit_supplement' THEN v_manage OR (has_permission(v_uid, 'general_affairs.request.comment_own_store') AND v_member)
                      ELSE v_manage OR (has_permission(v_uid, 'general_affairs.request.confirm_own_store') AND v_member) END;
    IF NOT v_allowed THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有門市回覆此需求單的權限'); END IF;
    -- 總務代門市操作：操作人是需求單管理者、又不是該門市名單上的人。
    v_proxy := v_manage AND NOT v_member;
    IF p_expected_updated_at IS NOT NULL AND v_req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張需求單剛被其他人更新，請重新載入後再操作'); END IF;
    v_need := CASE WHEN v_a = 'submit_supplement' THEN 'WAITING_STORE_SUPPLEMENT' ELSE 'WAITING_STORE_CONFIRMATION' END;
    IF v_req.main_status <> v_need THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可執行此動作，需求單狀態為 ' || v_req.main_status); END IF;
    IF v_proxy AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'PROXY_NOTE_REQUIRED', '總務代門市操作必須填寫說明（例如：店長電話確認收到）'); END IF;
    IF v_a = 'submit_supplement' THEN
      v_new := 'WAITING_GA_REVIEW'; v_progress := '門市已補充資料，等待總務複核。'; v_title := '門市補充資料'; v_type := 'STORE_SUPPLEMENT_SUBMITTED'; v_body := v_note;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress WHERE id = p_id;
    ELSIF v_a = 'confirm_complete' THEN
      v_new := 'COMPLETED'; v_progress := CASE WHEN v_proxy THEN '總務代門市確認完成。' ELSE '門市已確認完成。' END; v_title := CASE WHEN v_proxy THEN '總務代門市確認完成' ELSE '門市確認完成' END;
      v_type := 'STORE_COMPLETION_CONFIRMED'; v_body := COALESCE(v_note, '門市確認完成。');
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, completed_at = v_now, confirmed_at = v_now WHERE id = p_id;
    ELSE
      v_new := 'IN_PROGRESS'; v_progress := CASE WHEN v_proxy THEN '總務代門市回報完成結果仍有問題，已退回處理。' ELSE '門市回報完成結果仍有問題，已退回總務處理。' END || v_note;
      v_title := CASE WHEN v_proxy THEN '總務代門市回報仍有問題' ELSE '門市回報仍有問題' END; v_type := 'STORE_COMPLETION_REPORTED_PROBLEM'; v_body := v_note;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress WHERE id = p_id;
    END IF;
    IF v_proxy THEN v_body := '【總務代門市操作】' || COALESCE(v_body, ''); END IF;
    -- 同步連結的維修工單（沿用舊版）。
    IF v_a <> 'submit_supplement' AND v_req.maintenance_request_id IS NOT NULL THEN
      SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_req.maintenance_request_id FOR UPDATE;
      IF FOUND THEN
        v_mstatus := CASE WHEN v_a = 'confirm_complete' THEN 'COMPLETED' ELSE 'PROCESSING' END;
        v_stage := CASE WHEN v_a = 'confirm_complete' THEN COALESCE(v_wo.progress_stage, 'WAITING_STORE_CONFIRMATION') ELSE 'REOPENED' END;
        IF v_a = 'confirm_complete' THEN
          UPDATE public.maintenance_requests SET status = v_mstatus, progress_stage = v_stage, completed_at = v_now, completed_by = v_uid, completion_method = 'STORE_CONFIRMED' WHERE id = v_wo.id;
        ELSE
          UPDATE public.maintenance_requests SET status = v_mstatus, progress_stage = v_stage, unresolved_reason = v_note WHERE id = v_wo.id;
        END IF;
        INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, updated_by, updated_by_name)
        VALUES (v_wo.id, v_mstatus, v_stage, 'PUBLIC', v_body, v_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown'));
        INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, previous_progress_stage, new_progress_stage, description, visibility, created_by, metadata)
        VALUES (v_wo.id, CASE WHEN v_a = 'confirm_complete' THEN 'STORE_CONFIRM_COMPLETE' ELSE 'REPORT_UNRESOLVED' END, v_wo.status, v_mstatus, v_wo.progress_stage, v_stage, v_body, 'PUBLIC', v_uid,
          jsonb_build_object('source', 'ga_service_request_store_action', 'proxy_for_store', v_proxy));
      END IF;
    END IF;
    -- 同步料件處理單。
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF FOUND THEN
      IF v_a = 'confirm_complete' THEN
        UPDATE public.ga_part_fulfillments SET status = 'COMPLETED', current_step = '門市已確認收貨，處理完成', updated_by = v_uid WHERE id = v_ful.id;
      ELSIF v_a = 'report_problem' THEN
        UPDATE public.ga_part_fulfillments SET status = 'EXCEPTION', current_step = '門市回報異常，等待總務處理', updated_by = v_uid WHERE id = v_ful.id;
      END IF;
      INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
      VALUES (v_ful.id, CASE v_a WHEN 'confirm_complete' THEN 'STORE_CONFIRMED' WHEN 'report_problem' THEN 'STORE_REPORTED_PROBLEM' ELSE 'STORE_SUPPLEMENT_SUBMITTED' END,
        CASE v_a WHEN 'confirm_complete' THEN CASE WHEN v_proxy THEN '總務代門市確認收貨' ELSE '門市已確認收貨' END WHEN 'report_problem' THEN '門市回報收貨異常' ELSE '門市補充資料' END,
        v_body, jsonb_build_object('source', 'ga_service_request_store_action', 'action', v_a, 'previous_status', v_ful.status, 'proxy_for_store', v_proxy), v_uid);
    END IF;
    INSERT INTO public.ga_service_request_comments (request_id, visibility, body, created_by, created_by_name)
    VALUES (p_id, 'PUBLIC', v_body, v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid));
    PERFORM public.ga_rq_event(p_id, v_type, v_req.main_status, v_new, 'PUBLIC', v_title, v_body, jsonb_build_object('action', v_a, 'maintenance_request_id', v_req.maintenance_request_id, 'proxy_for_store', v_proxy), v_uid, v_proxy);
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_req.id, 'request_no', v_req.request_no, 'main_status', v_req.main_status,
      'public_progress', v_req.public_progress, 'proxy_for_store', v_proxy, 'updated_at', v_req.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ga_ws_req_transition(p_id uuid, p_action text, p_expected_updated_at timestamp with time zone, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_a text := lower(COALESCE(p_action, ''));
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_manage boolean;
  v_docs jsonb;
  v_note text;
  v_new text;
  v_progress text;
  v_title text;
  v_desc text;
  v_type text;
  v_vis text := 'PUBLIC';
  v_reason text;
  v_why text;
  v_wo public.maintenance_requests%ROWTYPE;
  v_ful uuid;
  v_label text;
  v_rlabel text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_a NOT IN ('reject', 'request_supplement', 'update_progress', 'request_store_confirmation', 'assign', 'cancel', 'reopen', 'withdraw') THEN
    RETURN public.ga_rq_err(400, 'INVALID_ACTION', '需求單處理動作錯誤');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  v_manage := has_permission(v_uid, 'general_affairs.request.manage');
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    IF v_a = 'withdraw' THEN
      IF NOT (v_req.created_by = v_uid OR public.ga_rq_is_store_member(v_uid, v_req.store_id)) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有提出需求的人或該門市店長可以撤回'); END IF;
    ELSIF NOT v_manage THEN
      RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有總務需求單管理權限');
    END IF;
    IF v_req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張需求單剛被其他人更新，請重新載入後再操作'); END IF;
    v_docs := public.ga_rq_docs(p_id);
    v_note := ga_normalize_optional_text(v_p->>'note');
    v_reason := ga_normalize_optional_text(v_p->>'reason');

    IF v_a = 'withdraw' THEN
      IF v_req.main_status <> 'PENDING_INTAKE' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '總務已受理或已處理，不能撤回；請改用留言聯絡總務'); END IF;
      v_new := 'CANCELED'; v_progress := '門市已撤回需求。'; v_title := '門市撤回需求'; v_desc := COALESCE(v_reason, '門市撤回需求'); v_type := 'REQUEST_WITHDRAWN';
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, cancel_reason = COALESCE(v_reason, '門市撤回') WHERE id = p_id;
    ELSIF v_a = 'cancel' THEN
      IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS') THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可取消（等門市確認、已完成、已駁回、已取消的單不能取消）');
      END IF;
      IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '取消需求單必須填寫原因'); END IF;
      IF (v_docs->>'issued')::numeric > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已經出庫，不能取消；請先在料件處理中心作廢單據或改用庫存調整'); END IF;
      IF (v_docs->>'po_count')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有採購單（' || COALESCE(v_docs->>'po_nos', '') || '），不能取消；請先取消採購單'); END IF;
      IF (v_docs->>'transfer_active')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有調撥單，不能取消；請先在料件處理中心作廢單據'); END IF;
      IF (v_docs->>'work_order_open')::boolean THEN RETURN public.ga_rq_err(409, 'HAS_WORK_ORDER', '這張需求單有進行中的維修工單，不能取消；請先在工單中心處理工單'); END IF;
      v_new := 'CANCELED'; v_progress := '總務已取消需求：' || v_reason; v_title := '總務取消需求'; v_desc := v_reason; v_type := 'REQUEST_CANCELED';
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, cancel_reason = v_reason, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
      UPDATE public.ga_part_fulfillments SET status = 'CANCELED', current_step = '需求單已取消', updated_by = v_uid WHERE request_id = p_id AND deleted_at IS NULL AND status NOT IN ('COMPLETED', 'CANCELED');
    ELSIF v_a = 'reject' THEN
      IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_GA_REVIEW', 'ACCEPTED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可駁回（只有待受理、待總務複核與已受理的單可以駁回）'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'rejection_reason'), ''));
      v_note := ga_normalize_optional_text(v_p->>'rejection_note');
      IF v_why NOT IN ('OUT_OF_SCOPE', 'INSUFFICIENT_DATA_RECREATE', 'DUPLICATE_REQUEST', 'NOT_ELIGIBLE', 'ALTERNATIVE_AVAILABLE', 'OTHER') THEN RETURN public.ga_rq_err(400, 'REASON_TYPE_INVALID', '駁回原因類型錯誤'); END IF;
      IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '駁回時必須填寫原因說明'); END IF;
      IF (v_docs->>'work_order_open')::boolean OR (v_docs->>'po_count')::integer > 0 OR (v_docs->>'issued')::numeric > 0 OR (v_docs->>'transfer_active')::integer > 0 THEN
        RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有進行中的工單或有效單據（採購單、出庫、調撥），不能駁回；請先作廢單據或取消採購單');
      END IF;
      v_rlabel := CASE v_why WHEN 'OUT_OF_SCOPE' THEN '不屬於總務/工務處理範圍' WHEN 'INSUFFICIENT_DATA_RECREATE' THEN '資料不足，請重新提出' WHEN 'DUPLICATE_REQUEST' THEN '重複申請'
                    WHEN 'NOT_ELIGIBLE' THEN '不符合採購/維修條件' WHEN 'ALTERNATIVE_AVAILABLE' THEN '已有替代處理方式' ELSE '其他' END;
      v_new := 'REJECTED'; v_progress := '總務已駁回：' || v_rlabel || '。' || v_note; v_title := '總務駁回需求'; v_desc := v_rlabel || '：' || v_note; v_type := 'REQUEST_REJECTED';
      UPDATE public.ga_service_requests SET main_status = v_new, rejection_reason = v_why, rejection_note = v_note, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSIF v_a = 'request_supplement' THEN
      IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可要求補資料'); END IF;
      IF (v_docs->>'po_count')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有採購單（' || COALESCE(v_docs->>'po_nos', '') || '，含草稿），不能請門市補資料；請改用留言，或先取消草稿採購單'); END IF;
      IF (v_docs->>'issued')::numeric > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已經出庫，不能請門市補資料；請改用留言'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'supplement_type'), ''));
      v_note := ga_normalize_optional_text(v_p->>'supplement_note');
      IF v_why NOT IN ('PHOTO_UNCLEAR', 'MISSING_PHOTO', 'DESCRIPTION_INSUFFICIENT', 'RESOURCE_SELECTION_WRONG', 'QUANTITY_OR_SPEC_INSUFFICIENT', 'OTHER') THEN RETURN public.ga_rq_err(400, 'REASON_TYPE_INVALID', '補資料類型錯誤'); END IF;
      IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '要求補資料時必須填寫說明'); END IF;
      v_rlabel := CASE v_why WHEN 'PHOTO_UNCLEAR' THEN '照片不清楚' WHEN 'MISSING_PHOTO' THEN '缺少必要照片' WHEN 'DESCRIPTION_INSUFFICIENT' THEN '問題描述不足'
                    WHEN 'RESOURCE_SELECTION_WRONG' THEN '設備/設施選擇錯誤' WHEN 'QUANTITY_OR_SPEC_INSUFFICIENT' THEN '數量/規格說明不足' ELSE '其他' END;
      v_new := 'WAITING_STORE_SUPPLEMENT'; v_progress := '總務要求補資料：' || v_rlabel || '。' || v_note; v_title := '總務要求門市補資料'; v_desc := v_rlabel || '：' || v_note; v_type := 'SUPPLEMENT_REQUESTED';
      UPDATE public.ga_service_requests SET main_status = v_new, supplement_type = v_why, supplement_note = v_note, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSIF v_a = 'update_progress' THEN
      IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可更新處理進度（需先受理）'); END IF;
      v_new := 'IN_PROGRESS';
      v_progress := CASE v_req.intake_route WHEN 'REPAIR_DISPATCH' THEN '維修需求已受理，目前由總務 / 工務處理中。' WHEN 'PURCHASE_REVIEW' THEN '添購需求已受理，目前由總務評估採購處理中。'
                    WHEN 'STOCK_ISSUE' THEN '需求已受理，目前由總務評估庫存出庫處理中。' WHEN 'TRANSFER' THEN '需求已受理，目前由總務評估調撥處理中。'
                    WHEN 'ASSET_TASK' THEN '需求已受理，目前由總務安排資產異動處理中。' ELSE '需求已受理，目前由總務處理中。' END;
      v_note := ga_normalize_optional_text(v_p->>'internal_note');
      v_title := '總務更新處理紀錄'; v_desc := COALESCE(v_note, v_progress); v_type := 'REQUEST_PROGRESS_UPDATED'; v_vis := CASE WHEN v_note IS NOT NULL THEN 'INTERNAL' ELSE 'PUBLIC' END;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, internal_note = COALESCE(v_note, internal_note) WHERE id = p_id;
    ELSIF v_a = 'request_store_confirmation' THEN
      IF v_req.main_status <> 'IN_PROGRESS' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有處理中的單可以送門市確認'); END IF;
      SELECT id INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_id AND deleted_at IS NULL AND status NOT IN ('CANCELED');
      IF FOUND THEN RETURN public.ga_rq_err(409, 'USE_FULFILLMENT', '這張需求單有料件處理單，請到「料件處理中心」按「送門市確認」，需求單與處理單才會一起往下'); END IF;
      v_new := 'WAITING_STORE_CONFIRMATION'; v_progress := '總務已標記處理完成，等待門市確認結果。'; v_title := '總務送門市確認'; v_desc := v_progress; v_type := 'STORE_CONFIRMATION_REQUESTED';
      IF v_req.maintenance_request_id IS NOT NULL THEN
        SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_req.maintenance_request_id FOR UPDATE;
        IF FOUND THEN
          UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'WAITING_STORE_CONFIRMATION', completion_requested_at = now(), completion_requested_by = v_uid WHERE id = v_wo.id;
          INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, updated_by, updated_by_name)
          VALUES (v_wo.id, 'PROCESSING', 'WAITING_STORE_CONFIRMATION', 'PUBLIC', v_progress, v_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown'));
          INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, previous_progress_stage, new_progress_stage, description, visibility, created_by, metadata)
          VALUES (v_wo.id, 'REQUEST_COMPLETION', v_wo.status, 'PROCESSING', v_wo.progress_stage, 'WAITING_STORE_CONFIRMATION', v_progress, 'PUBLIC', v_uid, jsonb_build_object('source', 'ga_service_request_workspace'));
        END IF;
      END IF;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSIF v_a = 'assign' THEN
      IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已結案的單不能轉派'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'assignee_role'), ''));
      IF v_why NOT IN ('GENERAL_AFFAIRS', 'WORKS') THEN RETURN public.ga_rq_err(400, 'ROLE_REQUIRED', '轉派時必須選擇總務或工務角色'); END IF;
      v_label := CASE v_why WHEN 'GENERAL_AFFAIRS' THEN '總務' ELSE '工務' END;
      v_new := v_req.main_status; v_progress := '需求已轉由' || v_label || '評估。'; v_title := '總務轉派承辦角色'; v_desc := '承辦角色：' || v_label; v_type := 'REQUEST_ASSIGNED';
      UPDATE public.ga_service_requests SET assignee_role = v_why, assignee_user_id = NULLIF(v_p->>'assignee_user_id', '')::uuid, assignee_name = ga_normalize_optional_text(v_p->>'assignee_name'),
        public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSE -- reopen
      IF v_req.main_status NOT IN ('COMPLETED', 'REJECTED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有已完成或已駁回的單可以重新開啟'); END IF;
      IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '重新開啟必須填寫原因'); END IF;
      v_new := CASE v_req.main_status WHEN 'COMPLETED' THEN 'IN_PROGRESS' ELSE 'PENDING_INTAKE' END;
      v_progress := '總務已重新開啟需求：' || v_reason; v_title := '總務重新開啟需求'; v_desc := v_reason; v_type := 'REQUEST_REOPENED';
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, reopened_count = reopened_count + 1, completed_at = NULL, confirmed_at = NULL WHERE id = p_id;
      UPDATE public.ga_part_fulfillments SET status = 'EXCEPTION', current_step = '需求單已重新開啟，請重新決定處理方式', updated_by = v_uid
       WHERE request_id = p_id AND deleted_at IS NULL AND status = 'COMPLETED';
      IF v_req.main_status = 'COMPLETED' AND v_req.maintenance_request_id IS NOT NULL THEN
        SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_req.maintenance_request_id FOR UPDATE;
        IF FOUND AND v_wo.status = 'COMPLETED' THEN
          UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'REOPENED' WHERE id = v_wo.id;
          INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, updated_by, updated_by_name)
          VALUES (v_wo.id, 'PROCESSING', 'REOPENED', 'PUBLIC', v_progress, v_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown'));
        END IF;
      END IF;
    END IF;
    PERFORM public.ga_rq_event(p_id, v_type, v_req.main_status, v_new, v_vis, v_title, v_desc, jsonb_build_object('action', v_a, 'reason', v_reason), v_uid);
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_req.id, 'request_no', v_req.request_no, 'main_status', v_req.main_status, 'public_progress', v_req.public_progress, 'updated_at', v_req.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$function$;

NOTIFY pgrst, 'reload schema';
