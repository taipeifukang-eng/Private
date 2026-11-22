-- M6 第 3 批 3b W32（2026-11-22）：督導管理日誌「軟刪除」交易函式（DEV）。
--   workspace_supervisor_soft_delete(kind, id, reason)：case / record / followup 軟刪除並在 supervisor_management_case_events 留時間線事件。
--   以呼叫者的登入身分（auth.uid()）執行，舊版資料表觸發器與 RLS 的檢查照常生效。
--   規則（E2）：管理者（supervisor.management_log.manage）可刪全部；其他人只能刪「自己建立」的案件、紀錄、追蹤，
--   案件另需 update_own 權限且未結案或取消；紀錄與追蹤需符合舊版 supervisor_management_case_is_manageable。
--   與舊版 supervisor_management_soft_delete_case 的差異：(1) 非管理者可刪自己的；(2) 先軟刪紀錄與追蹤、最後才軟刪案件
--   （舊版先軟刪案件，之後紀錄的觸發器會因為案件已刪除而拒絕）。
-- 資料表與舊版函式不動。還原：20261122130000_m6_supervisor_log_rpc.rollback.sql。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.supervisor_management_cases') IS NULL
     OR to_regclass('public.supervisor_management_records') IS NULL
     OR to_regclass('public.supervisor_management_followups') IS NULL
     OR to_regclass('public.supervisor_management_case_events') IS NULL
     OR to_regprocedure('public.supervisor_management_case_is_manageable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: supervisor_management_* 資料表或函式不存在';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_supervisor_soft_delete(p_kind text, p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_now timestamptz := now();
  v_manage boolean;
  v_case public.supervisor_management_cases%ROWTYPE;
  v_rec public.supervisor_management_records%ROWTYPE;
  v_fu public.supervisor_management_followups%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_NOT_AUTHENTICATED: 未登入';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_REASON_REQUIRED: 請輸入刪除原因';
  END IF;
  v_manage := public.supervisor_management_current_user_has_permission('supervisor.management_log.manage');

  IF p_kind = 'case' THEN
    SELECT * INTO v_case FROM public.supervisor_management_cases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_NOT_FOUND: 督導管理案件不存在'; END IF;
    IF v_case.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_ALREADY_DELETED: 此督導管理案件已被刪除'; END IF;
    IF NOT (v_manage OR (
         v_case.owner_user_id = v_uid
         AND public.supervisor_management_current_user_has_permission('supervisor.management_log.update_own')
         AND v_case.status NOT IN ('CLOSED', 'CANCELLED'))) THEN
      RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_PERMISSION_DENIED: 沒有刪除督導管理案件權限';
    END IF;
    PERFORM set_config('app.supervisor_management_soft_delete_case', 'on', true);
    PERFORM set_config('app.supervisor_management_soft_delete_record', 'on', true);
    PERFORM set_config('app.supervisor_management_soft_delete_followup', 'on', true);
    UPDATE public.supervisor_management_records
       SET deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_at = v_now, updated_by = v_uid
     WHERE case_id = p_id AND deleted_at IS NULL;
    UPDATE public.supervisor_management_followups
       SET deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_at = v_now, updated_by = v_uid
     WHERE case_id = p_id AND deleted_at IS NULL;
    UPDATE public.supervisor_management_cases
       SET deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_at = v_now, updated_by = v_uid
     WHERE id = p_id AND deleted_at IS NULL;
    INSERT INTO public.supervisor_management_case_events (case_id, event_type, event_at, title, body, actor_user_id, metadata)
    VALUES (p_id, 'SOFT_DELETE', v_now, '刪除督導管理案件', v_reason, v_uid, jsonb_build_object('deleted_by_rpc', true, 'workspace', true));
    RETURN jsonb_build_object('ok', true, 'id', p_id);

  ELSIF p_kind = 'record' THEN
    SELECT * INTO v_rec FROM public.supervisor_management_records WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_NOT_FOUND: 督導管理紀錄不存在'; END IF;
    IF v_rec.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_ALREADY_DELETED: 此督導管理紀錄已被刪除'; END IF;
    IF NOT (v_manage OR (v_rec.created_by = v_uid AND public.supervisor_management_case_is_manageable(v_rec.case_id))) THEN
      RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_PERMISSION_DENIED: 沒有刪除督導管理紀錄權限';
    END IF;
    PERFORM set_config('app.supervisor_management_soft_delete_record', 'on', true);
    UPDATE public.supervisor_management_records
       SET deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_at = v_now, updated_by = v_uid
     WHERE id = p_id AND deleted_at IS NULL;
    INSERT INTO public.supervisor_management_case_events (case_id, record_id, event_type, event_at, title, body, actor_user_id, metadata)
    VALUES (v_rec.case_id, p_id, 'RECORD_SOFT_DELETE', v_now, '刪除督導管理紀錄', v_reason, v_uid, jsonb_build_object('deleted_by_rpc', true, 'workspace', true));
    RETURN jsonb_build_object('ok', true, 'id', p_id);

  ELSIF p_kind = 'followup' THEN
    SELECT * INTO v_fu FROM public.supervisor_management_followups WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_NOT_FOUND: 督導追蹤紀錄不存在'; END IF;
    IF v_fu.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_ALREADY_DELETED: 此督導追蹤紀錄已被刪除'; END IF;
    IF NOT (v_manage OR (v_fu.created_by = v_uid AND public.supervisor_management_case_is_manageable(v_fu.case_id))) THEN
      RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_PERMISSION_DENIED: 沒有刪除督導追蹤紀錄權限';
    END IF;
    PERFORM set_config('app.supervisor_management_soft_delete_followup', 'on', true);
    UPDATE public.supervisor_management_followups
       SET deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_at = v_now, updated_by = v_uid
     WHERE id = p_id AND deleted_at IS NULL;
    INSERT INTO public.supervisor_management_case_events (case_id, followup_id, event_type, event_at, title, body, actor_user_id, metadata)
    VALUES (v_fu.case_id, p_id, 'FOLLOWUP_SOFT_DELETE', v_now, '刪除督導追蹤紀錄', v_reason, v_uid, jsonb_build_object('deleted_by_rpc', true, 'workspace', true));
    RETURN jsonb_build_object('ok', true, 'id', p_id);
  END IF;

  RAISE EXCEPTION 'WORKSPACE_SUPERVISOR_BAD_KIND: 不支援的刪除類型';
END;
$f$;

REVOKE ALL ON FUNCTION public.workspace_supervisor_soft_delete(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_supervisor_soft_delete(text, uuid, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
