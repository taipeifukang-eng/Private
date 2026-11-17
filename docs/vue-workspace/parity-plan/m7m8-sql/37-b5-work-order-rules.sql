-- 37-b5-work-order-rules.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261117100000_m7m8_b5_work_order_rules.sql 相同。
-- 第 5 批 A（G18 工單中心規則函式：讀取、流轉、強制結案、補資料、刪除、新增舊式回報、改分類、列印資料）（2026-11-16 第 5 批問卷 W1 至 W9）。
-- 性質：只新增函式、不改任何資料表結構與既有資料（Q19 不拆表）。12 個對外函式 ga_ws_wo_*（list、get、summary、print、transition、store_confirm、report_unresolved、reply_supplement、delete、create_legacy、category；領用料件在 39）
--   與 26 個內部輔助函式 ga_wo_*（登入者不能直接呼叫）。全部 SECURITY DEFINER、固定 search_path、權限一律用 has_permission（只看角色權限；profiles.role = admin 不是後備，沒有更新角色的管理員只能看）。
-- 行為（與舊版不同處已登記白名單、問卷 W1 至 W9 與 Q19 至 Q21 已核可）：伺服端檢查工單狀態與合法流轉；存進度「有填才更新」不覆蓋承辦人、處理方式、廠商；寫入同交易、失敗全回復、帶版本（409 STALE）；
--   需求單已完成、退回、取消時工單存進度不翻回；強制結案原因只有內部看得到（門市只看到「總務已結案」）；已受理或已連需求單的工單不能刪、只能強制結案，刪除時附件只標記不實刪；
--   列表伺服端分頁、精確筆數、焦點卡全量計數、搜尋跳脫；新增舊式回報（跨部門頁，最多 5 張圖片走共用附件）；舊式單送門市確認不再報錯。
-- 先決條件：先套第 4 批 32（ga_rq_* 輔助函式）、33（ga_po_like_escape、ga_po_fmt）；maintenance_*、ga_resource_attachments 資料表已存在。套用前先跑 36-b5-preview-before-apply.sql（不能有 MISSING）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：37-b5-work-order-rules-rollback.sql。套用前先跑 36-b5-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.maintenance_requests') IS NULL OR to_regclass('public.maintenance_updates') IS NULL OR to_regclass('public.maintenance_ticket_events') IS NULL
     OR to_regclass('public.maintenance_categories') IS NULL OR to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.ga_resource_attachments') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 維修工單／需求單／共用附件相關資料表';
  END IF;
  IF to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_docs(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112100000_m7m8_b4_request_rules';
  END IF;
  -- plpgsql 晚綁定，缺函式要到執行才爆；這裡一次檢查本檔會呼叫的第 4 批輔助函式（B4 審查 #4）。
  IF to_regprocedure('public.ga_rq_event(uuid,text,text,text,text,text,text,jsonb,uuid,boolean)') IS NULL
     OR to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.ga_rq_catch(text,text)') IS NULL
     OR to_regprocedure('public.ga_rq_is_store_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.ga_po_like_escape(text)') IS NULL
     OR to_regprocedure('public.ga_po_fmt(numeric)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 32（ga_rq_*）與 33（ga_po_like_escape、ga_po_fmt）';
  END IF;
END $$;

-- ================================================================ 1. 內部輔助
CREATE OR REPLACE FUNCTION public.ga_wo_no(p_id uuid) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT 'WO-' || upper(left(p_id::text, 8)); $$;

CREATE OR REPLACE FUNCTION public.ga_wo_stage_codes() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT ARRAY['INITIAL_REVIEW', 'WAITING_STORE_INFO', 'INTERNAL_HANDLING', 'SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED',
  'WAITING_VENDOR_VISIT', 'VENDOR_WORKING', 'WAITING_PARTS', 'PARTS_IN_TRANSIT', 'WAITING_INTERNAL_APPROVAL', 'WAITING_STORE_CONFIRMATION', 'REOPENED', 'OTHER']::text[]; $$;

CREATE OR REPLACE FUNCTION public.ga_wo_stage_label(p_code text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE p_code
  WHEN 'INITIAL_REVIEW' THEN '初步評估' WHEN 'WAITING_STORE_INFO' THEN '等待門市補充資料' WHEN 'INTERNAL_HANDLING' THEN '總務自行處理' WHEN 'SEARCHING_VENDOR' THEN '尋找廠商'
  WHEN 'WAITING_VENDOR_REPLY' THEN '等待廠商回覆' WHEN 'WAITING_VENDOR_QUOTE' THEN '等待廠商報價' WHEN 'QUOTE_REVIEW' THEN '報價確認中' WHEN 'VENDOR_ASSIGNED' THEN '已安排廠商'
  WHEN 'WAITING_VENDOR_VISIT' THEN '等待廠商到場' WHEN 'VENDOR_WORKING' THEN '廠商施工中' WHEN 'WAITING_PARTS' THEN '等待料件' WHEN 'PARTS_IN_TRANSIT' THEN '料件配送中'
  WHEN 'WAITING_INTERNAL_APPROVAL' THEN '等待內部確認' WHEN 'WAITING_STORE_CONFIRMATION' THEN '處理完成待門市確認' WHEN 'REOPENED' THEN '門市反映仍有問題' WHEN 'OTHER' THEN '其他'
  ELSE NULL END; $$;

CREATE OR REPLACE FUNCTION public.ga_wo_status_label(p_status text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE p_status WHEN 'UNACCEPTED' THEN '未受理' WHEN 'ACCEPTED' THEN '已受理' WHEN 'PROCESSING' THEN '處理中' WHEN 'COMPLETED' THEN '已完成' ELSE p_status END; $$;

-- 執行類階段（存進度時把工單推成「處理中」）；與舊版 EXECUTION_PROGRESS_STAGES 相同。
CREATE OR REPLACE FUNCTION public.ga_wo_is_exec_stage(p_code text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_code = ANY (ARRAY['WAITING_STORE_INFO', 'SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT',
  'VENDOR_WORKING', 'WAITING_PARTS', 'PARTS_IN_TRANSIT', 'WAITING_INTERNAL_APPROVAL', 'WAITING_STORE_CONFIRMATION', 'REOPENED']::text[]); $$;

-- 焦點卡分類（與舊版 getWorkOrderFocusKey 相同）。
CREATE OR REPLACE FUNCTION public.ga_wo_focus(p_status text, p_stage text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE
  WHEN p_status = 'COMPLETED' THEN 'completed'
  WHEN p_stage = 'REOPENED' THEN 'store_rejected'
  WHEN p_stage = 'WAITING_STORE_CONFIRMATION' THEN 'store_confirmation'
  WHEN p_stage IN ('WAITING_PARTS', 'PARTS_IN_TRANSIT') THEN 'parts'
  WHEN p_stage IN ('SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING') THEN 'vendor'
  ELSE 'arrange' END; $$;

CREATE OR REPLACE FUNCTION public.ga_wo_try_uuid(p_text text) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN RETURN p_text::uuid; EXCEPTION WHEN OTHERS THEN RETURN NULL; END; $$;

-- 權限判斷（一律 has_permission(uid, code)：只看角色權限；profiles.role = 'admin' 不是後備）。
CREATE OR REPLACE FUNCTION public.ga_wo_can_update(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.work_order.update') OR has_permission(p_uid, 'general_affairs.work_order.manage')
  OR has_permission(p_uid, 'general_affairs.maintenance_request.update') OR has_permission(p_uid, 'cross_dept.maintenance.update'); $$;

CREATE OR REPLACE FUNCTION public.ga_wo_can_view_all(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.work_order.view_all') OR has_permission(p_uid, 'general_affairs.maintenance_request.view_all')
  OR has_permission(p_uid, 'cross_dept.maintenance.view_all'); $$;

CREATE OR REPLACE FUNCTION public.ga_wo_has_own_perm(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.work_order.view_own_store') OR has_permission(p_uid, 'general_affairs.maintenance_request.view_own_store')
  OR has_permission(p_uid, 'general_affairs.maintenance_request.create') OR has_permission(p_uid, 'cross_dept.maintenance.submit'); $$;

-- 刪除權限（總務端）：更新或管理權限，不含只有「查看全部」與一般 work_order.update（與舊版刪除政策相同，去掉 view_all）。
CREATE OR REPLACE FUNCTION public.ga_wo_can_delete_perm(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.work_order.manage') OR has_permission(p_uid, 'general_affairs.maintenance_request.update') OR has_permission(p_uid, 'cross_dept.maintenance.update'); $$;

-- 進入工單頁面：任一查看或更新權限（只有自己門市的也算）。
CREATE OR REPLACE FUNCTION public.ga_wo_can_enter(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.ga_wo_can_view_all(p_uid) OR public.ga_wo_can_update(p_uid) OR public.ga_wo_has_own_perm(p_uid); $$;

-- 總務端（看得到內部內容與處理人姓名）：看全部或可更新。
CREATE OR REPLACE FUNCTION public.ga_wo_ga_side(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.ga_wo_can_view_all(p_uid) OR public.ga_wo_can_update(p_uid); $$;

-- 這個人看不看得到這張工單（與列表同一規則）：總務端全部；其他是回報人或該門市店長（且持有自己門市的查看或回報權限）。
CREATE OR REPLACE FUNCTION public.ga_wo_can_see(p_uid uuid, p_reported_by uuid, p_store_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.ga_wo_can_enter(p_uid) AND (public.ga_wo_ga_side(p_uid) OR p_reported_by = p_uid
  OR (public.ga_wo_has_own_perm(p_uid) AND public.ga_rq_is_store_member(p_uid, p_store_id))); $$;

-- 門市端動作者：回報人，或該門市店長且持有回報權限（舊版 canStoreActOnTicket）。
CREATE OR REPLACE FUNCTION public.ga_wo_store_actor(p_uid uuid, p_reported_by uuid, p_store_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_reported_by = p_uid OR (public.ga_rq_is_store_member(p_uid, p_store_id)
  AND (has_permission(p_uid, 'general_affairs.maintenance_request.create') OR has_permission(p_uid, 'cross_dept.maintenance.submit'))); $$;

-- 沒有修改權限時的白話錯誤：只有查看權限、或 profiles.role = admin 但沒有任何帶更新權限的角色，各自講清楚。
CREATE OR REPLACE FUNCTION public.ga_wo_perm_error(p_uid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE
  WHEN public.ga_wo_can_view_all(p_uid) THEN public.ga_rq_err(403, 'PERMISSION_DENIED', '您只有查看工單的權限，不能修改；需要「工單更新」或「工單管理」權限')
  WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = p_uid AND role = 'admin') THEN public.ga_rq_err(403, 'ADMIN_WITHOUT_ROLE', '您的帳號沒有可修改工單的角色，請洽管理員授權')
  ELSE public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有修改工單的權限；需要「工單更新」或「工單管理」權限') END; $$;

-- 寫工單進度（maintenance_updates）與時間軸事件（maintenance_ticket_events）。
CREATE OR REPLACE FUNCTION public.ga_wo_log(p_wo uuid, p_status text, p_stage text, p_vis text, p_notes text, p_uid uuid, p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id uuid; v_cat uuid;
BEGIN
  SELECT category_id INTO v_cat FROM public.maintenance_requests WHERE id = p_wo;
  INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, progress_date, category_id, updated_by, updated_by_name)
  VALUES (p_wo, p_status, p_stage, p_vis, p_notes, COALESCE(p_date, (now() AT TIME ZONE 'Asia/Taipei')::date), v_cat, p_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = p_uid), 'Unknown'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_wo_event(p_wo uuid, p_type text, p_old_status text, p_new_status text, p_old_stage text, p_new_stage text, p_desc text, p_vis text, p_uid uuid, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, previous_progress_stage, new_progress_stage, description, visibility, created_by, metadata)
      VALUES (p_wo, p_type, p_old_status, p_new_status, p_old_stage, p_new_stage, p_desc, p_vis, p_uid, COALESCE(p_meta, '{}'::jsonb)); $$;

-- 「有填才更新」：欄位沒給或留白就不動（舊版每次存進度都把承辦人改成操作者、處理方式與廠商清成空值）。
CREATE OR REPLACE FUNCTION public.ga_wo_apply_fields(p_wo uuid, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_cat uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'category_id'));
  v_assignee uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'assignee_id'));
  v_vendor uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'vendor_id'));
  v_name text := ga_normalize_optional_text(v_p->>'assignee_name');
  v_method text := ga_normalize_optional_text(v_p->>'handling_method');
BEGIN
  IF v_assignee IS NOT NULL AND v_name IS NULL THEN v_name := (SELECT full_name FROM public.profiles WHERE id = v_assignee); END IF;
  IF v_cat IS NULL AND v_assignee IS NULL AND v_vendor IS NULL AND v_name IS NULL AND v_method IS NULL THEN RETURN; END IF;
  UPDATE public.maintenance_requests SET category_id = COALESCE(v_cat, category_id), assignee_id = COALESCE(v_assignee, assignee_id), assignee_name = COALESCE(v_name, assignee_name),
    handling_method = COALESCE(v_method, handling_method), vendor_id = COALESCE(v_vendor, vendor_id) WHERE id = p_wo;
END;
$$;

-- 送門市確認（工單端）：第 4 批 ga_ws_req_transition 的 request_store_confirmation 與本批 REQUEST_COMPLETION 共用這一個內部函式（單一邏輯）。
-- 只處理工單；回傳 true 表示已套用（工單需為已受理或處理中、且還沒在待確認）。
CREATE OR REPLACE FUNCTION public.ga_wo_apply_completion_request(p_wo uuid, p_uid uuid, p_text text, p_source text DEFAULT 'work_order_center')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_wo public.maintenance_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_wo FOR UPDATE;
  IF NOT FOUND OR v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') OR v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION' THEN
    IF FOUND THEN PERFORM public.ga_wo_sync_skipped(p_wo, p_uid, '送門市確認', v_wo.status, v_wo.progress_stage, p_source); END IF;
    RETURN false;
  END IF;
  UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'WAITING_STORE_CONFIRMATION', completion_requested_at = now(), completion_requested_by = p_uid WHERE id = p_wo;
  PERFORM public.ga_wo_log(p_wo, 'PROCESSING', 'WAITING_STORE_CONFIRMATION', 'PUBLIC', p_text, p_uid);
  PERFORM public.ga_wo_event(p_wo, 'REQUEST_COMPLETION', v_wo.status, 'PROCESSING', v_wo.progress_stage, 'WAITING_STORE_CONFIRMATION', p_text, 'PUBLIC', p_uid, jsonb_build_object('source', p_source));
  RETURN true;
END;
$$;

-- 需求單端呼叫工單同步函式卻因工單狀態不符而沒同步時，留一筆內部事件（不擋需求單，但事後查得到兩邊為什麼分岔；審查 #3）。
CREATE OR REPLACE FUNCTION public.ga_wo_sync_skipped(p_wo uuid, p_uid uuid, p_what text, p_status text, p_stage text, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_source IS NOT DISTINCT FROM 'work_order_center' THEN RETURN; END IF; -- 工單端自己呼叫時，呼叫端會直接報錯，不需另記
  IF NOT EXISTS (SELECT 1 FROM public.maintenance_requests WHERE id = p_wo) THEN RETURN; END IF;
  PERFORM public.ga_wo_event(p_wo, 'REQUEST_SYNC_SKIPPED', p_status, p_status, p_stage, p_stage,
    '需求單端的「' || p_what || '」沒有同步到這張工單（工單目前狀態不符），請總務確認兩邊進度', 'INTERNAL', p_uid, jsonb_build_object('what', p_what, 'source', p_source));
END;
$$;

-- 請門市補資料（工單端）：第 4 批需求單端 request_supplement 與本批 REQUEST_SUPPLEMENT 共用。工單 → 處理中＋等待門市補充資料（公開）。
CREATE OR REPLACE FUNCTION public.ga_wo_apply_supplement_request(p_wo uuid, p_uid uuid, p_type text, p_label text, p_note text, p_source text DEFAULT 'work_order_center')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_wo public.maintenance_requests%ROWTYPE; v_text text := '總務要求補資料：' || COALESCE(p_label, '') || '。' || COALESCE(p_note, '');
BEGIN
  SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_wo FOR UPDATE;
  IF NOT FOUND OR v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') OR v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO'
     OR v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION' THEN
    IF FOUND THEN PERFORM public.ga_wo_sync_skipped(p_wo, p_uid, '請門市補資料', v_wo.status, v_wo.progress_stage, p_source); END IF;
    RETURN false;
  END IF;
  UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'WAITING_STORE_INFO' WHERE id = p_wo;
  PERFORM public.ga_wo_log(p_wo, 'PROCESSING', 'WAITING_STORE_INFO', 'PUBLIC', v_text, p_uid);
  PERFORM public.ga_wo_event(p_wo, 'SUPPLEMENT_REQUESTED', v_wo.status, 'PROCESSING', v_wo.progress_stage, 'WAITING_STORE_INFO', v_text, 'PUBLIC', p_uid,
    jsonb_build_object('supplement_type', p_type, 'source', p_source));
  RETURN true;
END;
$$;

-- 門市回覆補資料：工單回到「初步評估」（處理中），需求單端（第 4 批 submit_supplement）同時進待總務複核。
CREATE OR REPLACE FUNCTION public.ga_wo_apply_supplement_reply(p_wo uuid, p_uid uuid, p_note text, p_proxy boolean DEFAULT false, p_source text DEFAULT 'ga_service_request_store_action')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_wo public.maintenance_requests%ROWTYPE; v_text text;
BEGIN
  SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_wo FOR UPDATE;
  IF NOT FOUND OR v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') OR v_wo.progress_stage IS DISTINCT FROM 'WAITING_STORE_INFO' THEN
    IF FOUND THEN PERFORM public.ga_wo_sync_skipped(p_wo, p_uid, '門市回覆補資料', v_wo.status, v_wo.progress_stage, p_source); END IF;
    RETURN false;
  END IF;
  v_text := CASE WHEN COALESCE(p_proxy, false) THEN '【總務代門市操作】' ELSE '' END || '門市已補充資料：' || COALESCE(p_note, '');
  UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'INITIAL_REVIEW' WHERE id = p_wo;
  PERFORM public.ga_wo_log(p_wo, 'PROCESSING', 'INITIAL_REVIEW', 'PUBLIC', v_text, p_uid);
  PERFORM public.ga_wo_event(p_wo, 'SUPPLEMENT_REPLIED', v_wo.status, 'PROCESSING', v_wo.progress_stage, 'INITIAL_REVIEW', v_text, 'PUBLIC', p_uid,
    jsonb_build_object('proxy_for_store', COALESCE(p_proxy, false), 'source', p_source));
  RETURN true;
END;
$$;

-- 工單端寫入同步到需求單（同交易）。護欄：需求單已完成／退回／取消只記工單、不翻回；補資料往返與待總務複核期間，一般進度不翻轉需求單狀態。
-- p_kind：PROGRESS、COMPLETION_REQUESTED、FORCE_CLOSED、SUPPLEMENT_REQUESTED。
CREATE OR REPLACE FUNCTION public.ga_wo_sync_request(p_wo_id uuid, p_kind text, p_text text, p_vis text, p_uid uuid, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_wo public.maintenance_requests%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_new text;
  v_type text := 'WORK_ORDER_PROGRESS_SYNCED';
  v_title text := '維修工單進度同步';
  v_vis text := COALESCE(p_vis, 'PUBLIC');
BEGIN
  SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_wo_id;
  IF NOT FOUND OR v_wo.ga_service_request_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_wo.ga_service_request_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN RETURN; END IF; -- 護欄
  IF p_kind = 'PROGRESS' THEN
    IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS') THEN RETURN; END IF;
    v_new := 'IN_PROGRESS';
    UPDATE public.ga_service_requests SET main_status = v_new, public_progress = p_text WHERE id = v_req.id;
  ELSIF p_kind = 'COMPLETION_REQUESTED' THEN
    IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS') THEN RETURN; END IF;
    v_new := 'WAITING_STORE_CONFIRMATION'; v_type := 'STORE_CONFIRMATION_REQUESTED'; v_title := '總務送門市確認'; v_vis := 'PUBLIC';
    UPDATE public.ga_service_requests SET main_status = v_new, public_progress = p_text WHERE id = v_req.id;
  ELSIF p_kind = 'FORCE_CLOSED' THEN
    v_new := 'COMPLETED'; v_title := '維修工單強制結案'; v_vis := 'PUBLIC';
    UPDATE public.ga_service_requests SET main_status = v_new, public_progress = p_text, completed_at = now() WHERE id = v_req.id;
  ELSIF p_kind = 'SUPPLEMENT_REQUESTED' THEN
    IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW') THEN RETURN; END IF;
    v_new := 'WAITING_STORE_SUPPLEMENT'; v_type := 'SUPPLEMENT_REQUESTED'; v_title := '總務要求門市補資料'; v_vis := 'PUBLIC';
    UPDATE public.ga_service_requests SET main_status = v_new, supplement_type = p_meta->>'supplement_type', supplement_note = p_meta->>'supplement_note', public_progress = p_text WHERE id = v_req.id;
  ELSE
    RETURN;
  END IF;
  PERFORM public.ga_rq_event(v_req.id, v_type, v_req.main_status, v_new, v_vis, v_title, p_text,
    COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('maintenance_request_id', p_wo_id, 'maintenance_status', v_wo.status, 'maintenance_progress_stage', v_wo.progress_stage, 'action', p_kind, 'source', 'work_order_center'), p_uid);
END;
$$;

-- 單張工單的列資料（列表與詳情共用）；總務端才帶承辦人、處理方式、廠商與處理人。
CREATE OR REPLACE FUNCTION public.ga_wo_row(p_id uuid, p_ga boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'wo_no', public.ga_wo_no(m.id), 'store_id', m.store_id, 'store_code', s.store_code, 'store_name', s.store_name,
    'title', m.title, 'description', m.description, 'status', m.status, 'status_label', public.ga_wo_status_label(m.status),
    'progress_stage', m.progress_stage, 'stage_label', public.ga_wo_stage_label(m.progress_stage), 'priority', m.priority,
    'reported_by', m.reported_by, 'reporter_name', m.reporter_name, 'reported_at', m.reported_at, 'contact_name', m.contact_name, 'contact_phone', m.contact_phone,
    'issue_type', m.issue_type, 'resource_type', m.resource_type, 'category_id', m.category_id, 'category_name', c.name,
    'source', CASE WHEN m.ga_service_request_id IS NULL THEN 'LEGACY' ELSE 'REQUEST' END,
    'ga_service_request_id', m.ga_service_request_id, 'request_no', r.request_no, 'request_status', r.main_status, 'request_public_progress', r.public_progress,
    'request_resource_type', r.resource_type, 'equipment_id', r.equipment_id, 'facility_id', r.facility_id,
    'equipment_name', (SELECT e.name FROM public.ga_equipment e WHERE e.id = r.equipment_id), 'facility_name', (SELECT f.name FROM public.ga_facilities f WHERE f.id = r.facility_id),
    'focus', public.ga_wo_focus(m.status, m.progress_stage),
    'accepted_at', m.accepted_at, 'completed_at', m.completed_at, 'completion_requested_at', m.completion_requested_at, 'unresolved_reason', m.unresolved_reason,
    'completion_method', m.completion_method,
    'completion_method_label', CASE m.completion_method WHEN 'STORE_CONFIRMED' THEN '門市確認完成' WHEN 'ADMIN_FORCE_CLOSED' THEN '強制結案' ELSE NULL END,
    'created_at', m.created_at, 'updated_at', m.updated_at
  ) || CASE WHEN p_ga THEN jsonb_build_object('assignee_id', m.assignee_id, 'assignee_name', m.assignee_name, 'handling_method', m.handling_method, 'vendor_id', m.vendor_id,
    'accepted_by', m.accepted_by, 'completed_by', m.completed_by) ELSE '{}'::jsonb END
  FROM public.maintenance_requests m
  JOIN public.stores s ON s.id = m.store_id
  LEFT JOIN public.maintenance_categories c ON c.id = m.category_id
  LEFT JOIN public.ga_service_requests r ON r.id = m.ga_service_request_id AND r.deleted_at IS NULL
  WHERE m.id = p_id;
$$;

-- ================================================================ 2. 工單讀取
-- p_filters：store_id、status、focus、q、source（REQUEST／LEGACY）、category_id。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_ga boolean;
  v_all boolean;
  v_own boolean;
  v_page integer := LEAST(GREATEST(COALESCE(p_page, 1), 1), 100000);
  v_size integer := CASE WHEN COALESCE(p_page_size, 20) < 1 THEN 20 ELSE LEAST(p_page_size, 100) END;
  v_store uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_f->>'store_id'));
  v_cat uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_f->>'category_id'));
  v_status text := upper(ga_normalize_optional_text(v_f->>'status'));
  v_focus text := lower(ga_normalize_optional_text(v_f->>'focus'));
  v_source text := upper(ga_normalize_optional_text(v_f->>'source'));
  v_q text := ga_normalize_optional_text(v_f->>'q');
  v_like text;
  v_total integer;
  v_rows jsonb;
  v_counts jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_wo_can_enter(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看工單的權限'); END IF;
  IF jsonb_typeof(v_f) <> 'object' THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '篩選條件格式錯誤'); END IF;
  IF ga_normalize_optional_text(v_f->>'store_id') IS NOT NULL AND v_store IS NULL THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '門市篩選錯誤'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED') THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '狀態篩選錯誤'); END IF;
  IF v_focus IS NOT NULL AND v_focus NOT IN ('all', 'store_rejected', 'arrange', 'vendor', 'parts', 'store_confirmation', 'completed') THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '焦點篩選錯誤'); END IF;
  IF v_source IS NOT NULL AND v_source NOT IN ('REQUEST', 'LEGACY') THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '來源篩選錯誤'); END IF;
  v_ga := public.ga_wo_ga_side(v_uid);
  v_all := public.ga_wo_can_view_all(v_uid) OR public.ga_wo_can_update(v_uid);
  v_own := public.ga_wo_has_own_perm(v_uid);
  v_like := CASE WHEN v_q IS NULL THEN NULL ELSE '%' || public.ga_po_like_escape(v_q) || '%' END;
  WITH base AS (
    SELECT m.id, public.ga_wo_focus(m.status, m.progress_stage) AS focus, m.reported_at
      FROM public.maintenance_requests m
      JOIN public.stores s ON s.id = m.store_id
      LEFT JOIN public.ga_service_requests r ON r.id = m.ga_service_request_id AND r.deleted_at IS NULL
     WHERE (v_all OR m.reported_by = v_uid OR (v_own AND EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.store_id = m.store_id AND sm.user_id = v_uid)))
       AND (v_store IS NULL OR m.store_id = v_store)
       AND (v_cat IS NULL OR m.category_id = v_cat)
       AND (v_status IS NULL OR m.status = v_status)
       AND (v_source IS NULL OR (v_source = 'REQUEST') = (m.ga_service_request_id IS NOT NULL))
       AND (v_like IS NULL OR m.title ILIKE v_like ESCAPE '\' OR m.description ILIKE v_like ESCAPE '\' OR m.reporter_name ILIKE v_like ESCAPE '\' OR s.store_name ILIKE v_like ESCAPE '\'
            OR s.store_code ILIKE v_like ESCAPE '\' OR public.ga_wo_no(m.id) ILIKE v_like ESCAPE '\' OR r.request_no ILIKE v_like ESCAPE '\' OR m.contact_name ILIKE v_like ESCAPE '\'
            OR (v_ga AND m.assignee_name ILIKE v_like ESCAPE '\'))
  ), picked AS (
    SELECT id, reported_at FROM base WHERE v_focus IS NULL OR v_focus = 'all' OR focus = v_focus ORDER BY reported_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size
  )
  SELECT (SELECT jsonb_build_object('all', count(*), 'store_rejected', count(*) FILTER (WHERE focus = 'store_rejected'), 'arrange', count(*) FILTER (WHERE focus = 'arrange'),
            'vendor', count(*) FILTER (WHERE focus = 'vendor'), 'parts', count(*) FILTER (WHERE focus = 'parts'), 'store_confirmation', count(*) FILTER (WHERE focus = 'store_confirmation'),
            'completed', count(*) FILTER (WHERE focus = 'completed')) FROM base),
         (SELECT count(*) FROM base WHERE v_focus IS NULL OR v_focus = 'all' OR focus = v_focus),
         COALESCE((SELECT jsonb_agg(public.ga_wo_row(pk.id, v_ga) ORDER BY pk.reported_at DESC, pk.id) FROM picked pk), '[]'::jsonb)
    INTO v_counts, v_total, v_rows;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'focus_counts', v_counts));
END;
$$;

-- 這個人對這張工單能做哪些動作、做不到的原因（abilities）。
CREATE OR REPLACE FUNCTION public.ga_wo_abilities(p_id uuid, p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  m public.maintenance_requests%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_upd boolean := public.ga_wo_can_update(p_uid);
  v_open boolean;
  v_waiting_conf boolean;
  v_waiting_info boolean;
  v_linked boolean;
  v_actor boolean;
  v_force boolean := has_permission(p_uid, 'general_affairs.service_center.force_close');
  v_txn boolean := has_permission(p_uid, 'general_affairs.inventory_transaction.manage');
  v_part boolean := has_permission(p_uid, 'general_affairs.part.view') OR has_permission(p_uid, 'general_affairs.part.manage');
  v_docs jsonb;
  v_missing text[];
  v_sup_ok boolean := false; v_sup_reason text;
  v_del boolean := false; v_del_reason text;
  v_part_ok boolean := false; v_part_reason text;
  v_use_req boolean := false;
  v_cur_block text;
  v_ro_reason text;
BEGIN
  SELECT * INTO m FROM public.maintenance_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  v_linked := m.ga_service_request_id IS NOT NULL;
  IF v_linked THEN SELECT * INTO v_req FROM public.ga_service_requests WHERE id = m.ga_service_request_id AND deleted_at IS NULL; END IF;
  v_open := m.status IN ('ACCEPTED', 'PROCESSING');
  v_waiting_conf := m.status = 'PROCESSING' AND m.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION';
  v_waiting_info := m.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO' AND v_linked AND v_req.main_status = 'WAITING_STORE_SUPPLEMENT';
  v_actor := public.ga_wo_store_actor(p_uid, m.reported_by, m.store_id);
  v_use_req := v_linked AND v_req.id IS NOT NULL AND v_req.main_status = 'WAITING_STORE_CONFIRMATION';
  v_ro_reason := CASE WHEN v_upd THEN NULL WHEN public.ga_wo_can_view_all(p_uid) THEN '您只有查看工單的權限，不能修改' WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = p_uid AND role = 'admin') THEN '您的帳號沒有可修改工單的角色，請洽管理員授權' ELSE '您沒有修改工單的權限' END;
  -- 補資料
  IF NOT v_upd THEN v_sup_reason := v_ro_reason;
  ELSIF NOT v_open THEN v_sup_reason := CASE WHEN m.status = 'COMPLETED' THEN '工單已完成' ELSE '工單還沒受理，請先存進度' END;
  ELSIF m.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO' THEN v_sup_reason := '已經在等門市補資料';
  ELSIF v_waiting_conf THEN v_sup_reason := '已送門市確認，不能同時請門市補資料';
  ELSIF v_linked AND v_req.id IS NOT NULL AND v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW') THEN v_sup_reason := '需求單目前的狀態不能請門市補資料';
  ELSE
    v_sup_ok := true;
    IF v_linked AND v_req.id IS NOT NULL THEN
      v_docs := public.ga_rq_docs(v_req.id);
      IF (v_docs->>'po_count')::integer > 0 THEN v_sup_ok := false; v_sup_reason := '需求單已有採購單（含草稿），請改用留言'; END IF;
      IF v_sup_ok AND (v_docs->>'issued')::numeric > 0 THEN v_sup_ok := false; v_sup_reason := '需求單已經出庫，請改用留言'; END IF;
    END IF;
  END IF;
  -- 領用料件
  v_missing := array_remove(ARRAY[CASE WHEN NOT v_upd THEN '工單更新' END, CASE WHEN NOT v_txn THEN '庫存交易管理' END, CASE WHEN NOT v_part THEN '料件查看' END], NULL);
  IF array_length(v_missing, 1) > 0 THEN v_part_reason := '領用料件需要「工單更新」、「庫存交易管理」與「料件查看」三個權限，您缺少：' || array_to_string(v_missing, '、');
  ELSIF NOT v_open THEN v_part_reason := CASE WHEN m.status = 'COMPLETED' THEN '工單已完成，不能領用料件' ELSE '工單還沒受理，請先存進度' END;
  ELSIF v_waiting_conf THEN v_part_reason := '已送門市確認，不能再領用料件';
  ELSE v_part_ok := true; END IF;
  -- 刪除
  IF m.status <> 'UNACCEPTED' THEN v_del_reason := '這張工單已受理，不能刪除；不需要處理請用「不處理，強制結案」';
  ELSIF v_linked THEN v_del_reason := '這張工單已連結需求單，不能刪除；不需要處理請用「不處理，強制結案」';
  ELSIF m.reported_by = p_uid OR public.ga_wo_can_delete_perm(p_uid) THEN v_del := true;
  ELSE v_del_reason := '只有回報人本人或有工單管理權限的人可以刪除'; END IF;
  -- 存進度的阻擋原因
  v_cur_block := CASE WHEN NOT v_upd THEN v_ro_reason WHEN m.status = 'COMPLETED' THEN '工單已完成，不能再存進度' WHEN v_waiting_conf THEN '已送門市確認，請等門市回覆'
    WHEN v_waiting_info THEN '已請門市補資料，請等門市在「我的追蹤」回覆' ELSE NULL END;
  RETURN jsonb_build_object(
    'read_only', NOT v_upd, 'read_only_reason', v_ro_reason,
    'can_save_progress', v_upd AND v_cur_block IS NULL, 'save_progress_reason', v_cur_block,
    'can_request_completion', v_upd AND v_open AND NOT v_waiting_conf AND NOT COALESCE(v_req.main_status IN ('WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW'), false),
    'request_completion_reason', CASE WHEN v_upd AND v_open AND NOT v_waiting_conf AND COALESCE(v_req.main_status = 'WAITING_GA_REVIEW', false) THEN '門市已回覆補資料，請先到需求單按「受理」複核，再送門市確認' END,
    'can_force_close', v_upd AND v_force AND v_open, 'force_close_missing', CASE WHEN v_upd AND NOT v_force THEN '強制結案' END,
    'can_request_supplement', v_sup_ok, 'request_supplement_reason', v_sup_reason,
    'can_issue_part', v_part_ok, 'issue_part_reason', v_part_reason, 'issue_part_missing', to_jsonb(v_missing),
    'can_delete', v_del, 'delete_reason', v_del_reason,
    'can_change_category', v_upd,
    'can_store_confirm', v_actor AND v_waiting_conf AND NOT v_use_req, 'can_report_unresolved', v_actor AND v_waiting_conf AND NOT v_use_req,
    'store_use_request', v_actor AND v_waiting_conf AND v_use_req,
    'can_reply_supplement', v_actor AND NOT v_linked AND m.status = 'PROCESSING' AND m.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO',
    'reply_supplement_use_request', v_actor AND v_linked AND m.status = 'PROCESSING' AND m.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO',
    'can_reopen', false, 'reopen_note', CASE WHEN m.status <> 'COMPLETED' THEN NULL WHEN v_linked THEN '要重新開啟請到需求單按「重新開啟」' ELSE '沒有需求單的舊式工單完成後不能重新開啟，需要時請另開新單' END,
    'can_print_internal', v_upd, 'can_view_assignee', public.ga_wo_ga_side(p_uid));
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_wo_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  m public.maintenance_requests%ROWTYPE;
  v_ga boolean;
  v_timeline jsonb;
  v_parts jsonb;
  v_att jsonb;
  v_legacy jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_wo_can_enter(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看工單的權限'); END IF;
  SELECT * INTO m FROM public.maintenance_requests WHERE id = p_id;
  IF NOT FOUND OR NOT public.ga_wo_can_see(v_uid, m.reported_by, m.store_id) THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
  v_ga := public.ga_wo_ga_side(v_uid);
  -- 時間軸：進度紀錄＋沒有對應進度紀錄的事件（受理、建立、轉店、用料、改分類）；非總務端只看公開。
  SELECT COALESCE(jsonb_agg(t.x ORDER BY t.at, t.ord), '[]'::jsonb) INTO v_timeline FROM (
    SELECT u.created_at AS at, 1 AS ord, jsonb_build_object('kind', 'update', 'id', u.id, 'at', u.created_at, 'progress_date', u.progress_date, 'status', u.status,
        'stage', u.progress_stage, 'stage_label', public.ga_wo_stage_label(u.progress_stage), 'visibility', u.visibility, 'text', u.notes,
        'by_name', CASE WHEN v_ga THEN u.updated_by_name END) AS x
      FROM public.maintenance_updates u WHERE u.request_id = p_id AND (v_ga OR u.visibility = 'PUBLIC')
    UNION ALL
    SELECT e.created_at, 2, jsonb_build_object('kind', 'event', 'id', e.id, 'at', e.created_at, 'event_type', e.event_type, 'visibility', e.visibility, 'text', e.description,
        'stage', e.new_progress_stage, 'by_name', CASE WHEN v_ga THEN (SELECT full_name FROM public.profiles WHERE id = e.created_by) END)
      FROM public.maintenance_ticket_events e
     WHERE e.ticket_id = p_id AND e.event_type IN ('CREATED', 'ACCEPT', 'MIGRATED', 'STORE_MOVED', 'PART_ISSUED', 'CATEGORY_CHANGED', 'REQUEST_SYNC_SKIPPED')
       AND (v_ga OR e.visibility = 'PUBLIC')
  ) t;
  -- 用料清單（總務端）：由 PART_ISSUED 事件組成，數量以庫存流水為準（回查流水核對）。
  IF v_ga THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id', e.id, 'at', e.created_at, 'transaction_id', e.metadata->>'transaction_id', 'transaction_no', e.metadata->>'transaction_no',
        'part_id', e.metadata->>'part_id', 'part_code', e.metadata->>'part_code', 'part_name', e.metadata->>'part_name', 'location_id', e.metadata->>'location_id',
        'location_name', e.metadata->>'location_name', 'quantity', e.metadata->>'quantity', 'unit', e.metadata->>'unit', 'reason', e.metadata->>'reason',
        'by_name', (SELECT full_name FROM public.profiles WHERE id = e.created_by),
        'verified_quantity_base', (SELECT -t.quantity_base FROM public.ga_inventory_transactions t WHERE t.id = public.ga_wo_try_uuid(e.metadata->>'transaction_id'))) ORDER BY e.created_at), '[]'::jsonb)
      INTO v_parts FROM public.maintenance_ticket_events e WHERE e.ticket_id = p_id AND e.event_type = 'PART_ISSUED';
  ELSE
    v_parts := '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'resource_type', a.resource_type, 'resource_id', a.resource_id, 'storage_bucket', a.storage_bucket, 'storage_path', a.storage_path,
      'file_name', a.file_name, 'content_type', a.content_type, 'size_bytes', a.size_bytes, 'uploaded_at', a.uploaded_at, 'legacy', false) ORDER BY a.uploaded_at, a.id), '[]'::jsonb) INTO v_att
    FROM public.ga_resource_attachments a
   WHERE a.deleted_at IS NULL AND ((a.resource_type = 'MAINTENANCE_REQUEST' AND a.resource_id = p_id)
      OR (a.resource_type = 'MAINTENANCE_UPDATE' AND a.resource_id IN (SELECT u.id FROM public.maintenance_updates u WHERE u.request_id = p_id AND (v_ga OR u.visibility = 'PUBLIC'))));
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at'), (x->>'id')), '[]'::jsonb) INTO v_legacy FROM (
    SELECT jsonb_build_object('id', p.id, 'storage_bucket', 'maintenance-photos', 'storage_path', p.storage_path, 'file_name', p.file_name, 'photo_type', p.photo_type, 'created_at', p.created_at, 'legacy', true) AS x
      FROM public.maintenance_photos p WHERE p.request_id = p_id
    UNION ALL
    SELECT jsonb_build_object('id', up.id, 'storage_bucket', 'maintenance-photos', 'storage_path', up.storage_path, 'file_name', up.file_name, 'photo_type', 'progress', 'update_id', up.update_id, 'created_at', up.created_at, 'legacy', true)
      FROM public.maintenance_update_photos up JOIN public.maintenance_updates u ON u.id = up.update_id WHERE u.request_id = p_id AND (v_ga OR u.visibility = 'PUBLIC')
  ) l;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('work_order', public.ga_wo_row(p_id, v_ga), 'timeline', v_timeline, 'parts', v_parts,
    'attachments', v_att, 'legacy_photos', v_legacy, 'abilities', public.ga_wo_abilities(p_id, v_uid), 'ga_side', v_ga));
END;
$$;

-- 各門市摘要（資料庫端 group by，不受 1000 列限制）；只算呼叫者看得到的工單。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_all boolean;
  v_own boolean;
  v_status text := upper(ga_normalize_optional_text(v_f->>'status'));
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_wo_can_enter(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看工單的權限'); END IF;
  IF jsonb_typeof(v_f) <> 'object' THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '篩選條件格式錯誤'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED') THEN RETURN public.ga_rq_err(400, 'FILTER_INVALID', '狀態篩選錯誤'); END IF;
  v_all := public.ga_wo_can_view_all(v_uid) OR public.ga_wo_can_update(v_uid);
  v_own := public.ga_wo_has_own_perm(v_uid);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', g.store_id, 'store_code', g.store_code, 'store_name', g.store_name, 'total', g.total, 'unaccepted', g.unaccepted,
      'accepted', g.accepted, 'processing', g.processing, 'completed', g.completed, 'waiting_store_confirmation', g.waiting_conf) ORDER BY g.store_code), '[]'::jsonb) INTO v_rows
    FROM (SELECT s.id AS store_id, s.store_code, s.store_name, count(*) AS total, count(*) FILTER (WHERE m.status = 'UNACCEPTED') AS unaccepted,
            count(*) FILTER (WHERE m.status = 'ACCEPTED') AS accepted, count(*) FILTER (WHERE m.status = 'PROCESSING') AS processing, count(*) FILTER (WHERE m.status = 'COMPLETED') AS completed,
            count(*) FILTER (WHERE m.status = 'PROCESSING' AND m.progress_stage = 'WAITING_STORE_CONFIRMATION') AS waiting_conf
            FROM public.maintenance_requests m JOIN public.stores s ON s.id = m.store_id
           WHERE (v_all OR m.reported_by = v_uid OR (v_own AND EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.store_id = m.store_id AND sm.user_id = v_uid)))
             AND (v_status IS NULL OR m.status = v_status)
           GROUP BY s.id, s.store_code, s.store_name) g;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('stores', v_rows));
END;
$$;

-- A4 列印資料：基本資料、公開進度、照片清單；p_include_internal=true 只有更新／管理類權限可用（view_all 只看者與門市回 403）。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_print(p_id uuid, p_include_internal boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  m public.maintenance_requests%ROWTYPE;
  v_ga boolean;
  v_internal boolean;
  v_public jsonb;
  v_internal_rows jsonb := '[]'::jsonb;
  v_force text;
  v_att jsonb;
  v_legacy jsonb;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_wo_can_enter(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看工單的權限'); END IF;
  SELECT * INTO m FROM public.maintenance_requests WHERE id = p_id;
  IF NOT FOUND OR NOT public.ga_wo_can_see(v_uid, m.reported_by, m.store_id) THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
  v_ga := public.ga_wo_ga_side(v_uid);
  -- 只看（view_all）不能印內部備註：要求內部內容時，必須有工單更新或管理類權限（2026-11-17 使用者決定：看得到、不能列印）。
  IF COALESCE(p_include_internal, false) AND NOT public.ga_wo_can_update(v_uid) THEN
    RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有具備工單更新或管理權限的人可以列印內部備註');
  END IF;
  v_internal := v_ga AND COALESCE(p_include_internal, false);
  v_row := public.ga_wo_row(p_id, false);
  SELECT COALESCE(jsonb_agg(t.x ORDER BY t.at, t.ord), '[]'::jsonb) INTO v_public FROM (
    SELECT u.created_at AS at, 1 AS ord, jsonb_build_object('at', u.created_at, 'progress_date', u.progress_date, 'stage_label', public.ga_wo_stage_label(u.progress_stage),
        'status_label', public.ga_wo_status_label(u.status), 'text', u.notes) AS x
      FROM public.maintenance_updates u WHERE u.request_id = p_id AND u.visibility = 'PUBLIC'
    UNION ALL
    SELECT e.created_at, 2, jsonb_build_object('at', e.created_at, 'stage_label', public.ga_wo_stage_label(e.new_progress_stage), 'status_label', NULL, 'text', e.description)
      FROM public.maintenance_ticket_events e WHERE e.ticket_id = p_id AND e.visibility = 'PUBLIC' AND e.event_type IN ('CREATED', 'ACCEPT', 'MIGRATED', 'STORE_MOVED')
  ) t;
  IF v_internal THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('at', u.created_at, 'text', u.notes, 'by_name', u.updated_by_name) ORDER BY u.created_at), '[]'::jsonb) INTO v_internal_rows
      FROM public.maintenance_updates u WHERE u.request_id = p_id AND u.visibility = 'INTERNAL';
    SELECT e.description INTO v_force FROM public.maintenance_ticket_events e WHERE e.ticket_id = p_id AND e.event_type = 'FORCE_CLOSE' ORDER BY e.created_at DESC LIMIT 1;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'storage_bucket', a.storage_bucket, 'storage_path', a.storage_path, 'file_name', a.file_name, 'content_type', a.content_type, 'legacy', false) ORDER BY a.uploaded_at, a.id), '[]'::jsonb) INTO v_att
    FROM public.ga_resource_attachments a
   WHERE a.deleted_at IS NULL AND a.content_type LIKE 'image/%' AND ((a.resource_type = 'MAINTENANCE_REQUEST' AND a.resource_id = p_id)
      OR (a.resource_type = 'MAINTENANCE_UPDATE' AND a.resource_id IN (SELECT u.id FROM public.maintenance_updates u WHERE u.request_id = p_id AND u.visibility = 'PUBLIC')));
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'id')), '[]'::jsonb) INTO v_legacy FROM (
    SELECT jsonb_build_object('id', p.id, 'storage_bucket', 'maintenance-photos', 'storage_path', p.storage_path, 'file_name', p.file_name, 'legacy', true) AS x FROM public.maintenance_photos p WHERE p.request_id = p_id
    UNION ALL
    SELECT jsonb_build_object('id', up.id, 'storage_bucket', 'maintenance-photos', 'storage_path', up.storage_path, 'file_name', up.file_name, 'legacy', true)
      FROM public.maintenance_update_photos up JOIN public.maintenance_updates u ON u.id = up.update_id WHERE u.request_id = p_id AND u.visibility = 'PUBLIC'
  ) l;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('work_order', v_row, 'public_timeline', v_public, 'attachments', v_att, 'legacy_photos', v_legacy,
    'include_internal', v_internal, 'internal_updates', v_internal_rows, 'force_close_reason', v_force, 'printed_at', now()));
END;
$$;

-- ================================================================ 3. 工單寫入
-- 單一寫入入口：SAVE_PROGRESS、REQUEST_COMPLETION、FORCE_CLOSE、REQUEST_SUPPLEMENT。
-- p_payload：notes、progress_stage、visibility、progress_date、category_id、assignee_id、assignee_name、handling_method、vendor_id、force_close_reason、supplement_type、supplement_note。
-- 鎖定順序與第 4 批一致：先需求單、再工單。錯誤一律在寫入前回傳；寫入後的失敗用 RAISE 讓整段子交易回復。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_transition(p_id uuid, p_action text, p_expected_updated_at timestamptz, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_a text := upper(COALESCE(p_action, ''));
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_wo public.maintenance_requests%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_rid uuid;
  v_notes text;
  v_vis text;
  v_stage text;
  v_target text;
  v_status text;
  v_label text;
  v_text text;
  v_why text;
  v_reason text;
  v_date date;
  v_docs jsonb;
  v_ok boolean;
  v_new_stage text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_a NOT IN ('SAVE_PROGRESS', 'REQUEST_COMPLETION', 'FORCE_CLOSE', 'REQUEST_SUPPLEMENT') THEN RETURN public.ga_rq_err(400, 'INVALID_ACTION', '工單動作錯誤'); END IF;
  IF jsonb_typeof(v_p) <> 'object' THEN RETURN public.ga_rq_err(400, 'PAYLOAD_INVALID', '送出的內容格式錯誤'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF NOT public.ga_wo_can_update(v_uid) THEN RETURN public.ga_wo_perm_error(v_uid); END IF;
  IF v_a = 'FORCE_CLOSE' AND NOT has_permission(v_uid, 'general_affairs.service_center.force_close') THEN
    RETURN public.ga_rq_err(403, 'FORCE_CLOSE_PERMISSION_REQUIRED', '沒有「強制結案」權限，請洽管理員授權');
  END IF;
  v_notes := ga_normalize_optional_text(v_p->>'notes');
  IF v_notes IS NOT NULL AND length(v_notes) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '處理說明不可超過 2000 字'); END IF;
  v_vis := upper(COALESCE(ga_normalize_optional_text(v_p->>'visibility'), 'PUBLIC'));
  IF v_vis NOT IN ('PUBLIC', 'INTERNAL') THEN RETURN public.ga_rq_err(400, 'VISIBILITY_INVALID', '公開範圍錯誤'); END IF;
  v_stage := upper(ga_normalize_optional_text(v_p->>'progress_stage'));
  IF v_stage IS NOT NULL AND NOT (v_stage = ANY (public.ga_wo_stage_codes())) THEN RETURN public.ga_rq_err(400, 'STAGE_INVALID', '進度階段錯誤'); END IF;
  IF ga_normalize_optional_text(v_p->>'progress_date') IS NOT NULL THEN
    BEGIN v_date := (v_p->>'progress_date')::date;
    EXCEPTION WHEN OTHERS THEN RETURN public.ga_rq_err(400, 'DATE_INVALID', '進度日期格式錯誤（請用 YYYY-MM-DD）'); END;
  END IF;
  FOREACH v_why IN ARRAY ARRAY['category_id', 'assignee_id', 'vendor_id'] LOOP
    IF ga_normalize_optional_text(v_p->>v_why) IS NOT NULL AND public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>v_why)) IS NULL THEN
      RETURN public.ga_rq_err(400, 'ID_INVALID', '分類、承辦人或廠商的識別碼格式錯誤');
    END IF;
  END LOOP;
  BEGIN
    SELECT ga_service_request_id INTO v_rid FROM public.maintenance_requests WHERE id = p_id;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF v_rid IS NOT NULL THEN SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_rid AND deleted_at IS NULL FOR UPDATE; END IF;
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at OR v_wo.ga_service_request_id IS DISTINCT FROM v_rid THEN
      RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作');
    END IF;

    IF v_a = 'SAVE_PROGRESS' THEN
      IF v_wo.status = 'COMPLETED' THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE WHEN v_wo.ga_service_request_id IS NOT NULL THEN '工單已完成，不能再存進度；若要重新處理，請到需求單按「重新開啟」'
          ELSE '工單已完成，不能再存進度；沒有需求單的舊式工單完成後不能重新開啟，需要時請另開新單' END);
      END IF;
      IF v_wo.status = 'PROCESSING' AND v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION' THEN
        RETURN public.ga_rq_err(409, 'WAITING_STORE_CONFIRMATION', '已送門市確認，請等門市回覆；如需聯絡門市請用留言');
      END IF;
      IF v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO' AND v_req.id IS NOT NULL AND v_req.main_status = 'WAITING_STORE_SUPPLEMENT' THEN
        RETURN public.ga_rq_err(409, 'WAITING_STORE_SUPPLEMENT', '已請門市補資料，請等門市在「我的追蹤」回覆後再存進度');
      END IF;
      IF v_notes IS NULL THEN RETURN public.ga_rq_err(400, 'NOTES_REQUIRED', '請填寫處理說明'); END IF;
      IF v_stage = 'WAITING_STORE_CONFIRMATION' THEN RETURN public.ga_rq_err(422, 'USE_REQUEST_COMPLETION', '要送門市確認請按「送門市確認」，不要直接選這個階段'); END IF;
      IF v_stage = 'WAITING_STORE_INFO' AND v_wo.ga_service_request_id IS NOT NULL THEN RETURN public.ga_rq_err(422, 'USE_SUPPLEMENT', '要請門市補資料請按「補資料」，不要直接選這個階段'); END IF;
      v_target := COALESCE(v_stage, v_wo.progress_stage);
      IF v_target IS NOT NULL AND public.ga_wo_is_exec_stage(v_target) THEN v_status := 'PROCESSING';
      ELSIF v_wo.status = 'UNACCEPTED' THEN v_status := 'ACCEPTED'; v_target := COALESCE(v_target, 'INITIAL_REVIEW');
      ELSE v_status := v_wo.status; END IF;
      UPDATE public.maintenance_requests SET status = v_status, progress_stage = v_target,
        accepted_at = CASE WHEN v_wo.status = 'UNACCEPTED' THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
        accepted_by = CASE WHEN v_wo.status = 'UNACCEPTED' THEN COALESCE(accepted_by, v_uid) ELSE accepted_by END
       WHERE id = p_id;
      PERFORM public.ga_wo_apply_fields(p_id, v_p);
      PERFORM public.ga_wo_log(p_id, v_status, v_target, v_vis, v_notes, v_uid, v_date);
      PERFORM public.ga_wo_event(p_id, 'SAVE_PROGRESS', v_wo.status, v_status, v_wo.progress_stage, v_target, v_notes, v_vis, v_uid,
        jsonb_build_object('progress_date', v_date, 'category_id', v_p->>'category_id', 'assignee_id', v_p->>'assignee_id', 'handling_method', v_p->>'handling_method', 'vendor_id', v_p->>'vendor_id'));
      v_label := COALESCE(public.ga_wo_stage_label(v_target), public.ga_wo_status_label(v_status));
      v_text := CASE WHEN v_vis = 'INTERNAL' THEN '維修工單已更新，目前狀態：' || v_label || '。' ELSE '維修工單進度更新：' || v_label || '。' || v_notes END;
      PERFORM public.ga_wo_sync_request(p_id, 'PROGRESS', v_text, v_vis, v_uid, jsonb_build_object('action', 'SAVE_PROGRESS'));

    ELSIF v_a = 'REQUEST_COMPLETION' THEN
      IF v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE WHEN v_wo.status = 'COMPLETED' THEN '工單已完成' ELSE '工單還沒受理，請先存進度再送門市確認' END);
      END IF;
      IF v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION' THEN RETURN public.ga_rq_err(409, 'WAITING_STORE_CONFIRMATION', '已經送門市確認了，請等門市回覆'); END IF;
      IF v_req.id IS NOT NULL AND v_req.main_status = 'WAITING_STORE_SUPPLEMENT' THEN RETURN public.ga_rq_err(409, 'WAITING_STORE_SUPPLEMENT', '已請門市補資料，請等門市回覆後再送門市確認'); END IF;
      -- 審查 #1：門市補完資料後，需求單在「待總務複核」；要先到需求單按「受理」複核，否則工單送確認後需求單會停在待複核、門市看不到確認入口。
      IF v_req.id IS NOT NULL AND v_req.main_status = 'WAITING_GA_REVIEW' THEN RETURN public.ga_rq_err(409, 'REQUEST_REVIEW_REQUIRED', '門市已回覆補資料，請先到需求單按「受理」複核，再送門市確認'); END IF;
      v_text := COALESCE(v_notes, '總務已標記處理完成，等待門市確認結果。');
      PERFORM public.ga_wo_apply_fields(p_id, v_p);
      v_ok := public.ga_wo_apply_completion_request(p_id, v_uid, v_text, 'work_order_center');
      IF NOT v_ok THEN PERFORM public.ga_rq_raise(409, 'INVALID_STATE', '目前狀態不能送門市確認'); END IF;
      PERFORM public.ga_wo_sync_request(p_id, 'COMPLETION_REQUESTED', '總務已將處理結果送門市確認。' || v_text, 'PUBLIC', v_uid, jsonb_build_object('action', 'REQUEST_COMPLETION'));

    ELSIF v_a = 'FORCE_CLOSE' THEN
      v_reason := ga_normalize_optional_text(v_p->>'force_close_reason');
      IF v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE WHEN v_wo.status = 'COMPLETED' THEN '工單已經完成' ELSE '工單還沒受理，不需要處理請直接刪除（沒有連需求單時）或先受理' END);
      END IF;
      IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '強制結案必須填寫原因'); END IF;
      IF length(v_reason) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '原因不可超過 2000 字'); END IF;
      v_new_stage := COALESCE(v_wo.progress_stage, 'OTHER');
      UPDATE public.maintenance_requests SET status = 'COMPLETED', progress_stage = v_new_stage, completed_at = now(), completed_by = v_uid, completion_method = 'ADMIN_FORCE_CLOSED' WHERE id = p_id;
      PERFORM public.ga_wo_log(p_id, 'COMPLETED', v_new_stage, 'INTERNAL', '不處理，強制結案。原因：' || v_reason, v_uid, v_date);
      PERFORM public.ga_wo_log(p_id, 'COMPLETED', v_new_stage, 'PUBLIC', '總務已結案', v_uid, v_date);
      PERFORM public.ga_wo_event(p_id, 'FORCE_CLOSE', v_wo.status, 'COMPLETED', v_wo.progress_stage, v_new_stage, '不處理，強制結案。原因：' || v_reason, 'INTERNAL', v_uid, jsonb_build_object('reason', v_reason));
      PERFORM public.ga_wo_event(p_id, 'FORCE_CLOSE_NOTICE', v_wo.status, 'COMPLETED', v_wo.progress_stage, v_new_stage, '總務已結案', 'PUBLIC', v_uid, '{}'::jsonb);
      PERFORM public.ga_wo_sync_request(p_id, 'FORCE_CLOSED', '總務已結案', 'PUBLIC', v_uid, jsonb_build_object('action', 'FORCE_CLOSE'));

    ELSE -- REQUEST_SUPPLEMENT
      IF v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE WHEN v_wo.status = 'COMPLETED' THEN '工單已完成，不能請門市補資料' ELSE '工單還沒受理，請先存進度再請門市補資料' END);
      END IF;
      IF v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已經在等門市補資料了'); END IF;
      IF v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已送門市確認，不能同時請門市補資料'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'supplement_type'), ''));
      v_reason := ga_normalize_optional_text(v_p->>'supplement_note');
      IF v_why NOT IN ('PHOTO_UNCLEAR', 'MISSING_PHOTO', 'DESCRIPTION_INSUFFICIENT', 'RESOURCE_SELECTION_WRONG', 'QUANTITY_OR_SPEC_INSUFFICIENT', 'OTHER') THEN RETURN public.ga_rq_err(400, 'REASON_TYPE_INVALID', '補資料類型錯誤'); END IF;
      IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '要求補資料時必須填寫說明'); END IF;
      IF length(v_reason) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '說明不可超過 2000 字'); END IF;
      IF v_req.id IS NOT NULL THEN
        IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW') THEN
          RETURN public.ga_rq_err(409, 'REQUEST_STATE', CASE v_req.main_status WHEN 'WAITING_STORE_SUPPLEMENT' THEN '需求單已經在等門市補資料' WHEN 'WAITING_STORE_CONFIRMATION' THEN '需求單已送門市確認，不能請門市補資料'
            ELSE '需求單已結案、退回或取消，不能請門市補資料' END);
        END IF;
        v_docs := public.ga_rq_docs(v_req.id);
        IF (v_docs->>'po_count')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有採購單（' || COALESCE(v_docs->>'po_nos', '') || '，含草稿），不能請門市補資料；請改用留言'); END IF;
        IF (v_docs->>'issued')::numeric > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已經出庫，不能請門市補資料；請改用留言'); END IF;
      END IF;
      v_label := CASE v_why WHEN 'PHOTO_UNCLEAR' THEN '照片不清楚' WHEN 'MISSING_PHOTO' THEN '缺少必要照片' WHEN 'DESCRIPTION_INSUFFICIENT' THEN '問題描述不足'
                   WHEN 'RESOURCE_SELECTION_WRONG' THEN '設備/設施選擇錯誤' WHEN 'QUANTITY_OR_SPEC_INSUFFICIENT' THEN '數量/規格說明不足' ELSE '其他' END;
      v_ok := public.ga_wo_apply_supplement_request(p_id, v_uid, v_why, v_label, v_reason, 'work_order_center');
      IF NOT v_ok THEN PERFORM public.ga_rq_raise(409, 'INVALID_STATE', '目前狀態不能請門市補資料'); END IF;
      PERFORM public.ga_wo_sync_request(p_id, 'SUPPLEMENT_REQUESTED', '總務要求補資料：' || v_label || '。' || v_reason, 'PUBLIC', v_uid,
        jsonb_build_object('action', 'REQUEST_SUPPLEMENT', 'supplement_type', v_why, 'supplement_note', v_reason));
    END IF;

    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id;
    IF v_rid IS NOT NULL THEN SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_rid; END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_wo.id, 'wo_no', public.ga_wo_no(v_wo.id), 'status', v_wo.status, 'progress_stage', v_wo.progress_stage,
      'completion_method', v_wo.completion_method, 'ga_service_request_id', v_wo.ga_service_request_id, 'request_status', v_req.main_status, 'updated_at', v_wo.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 門市確認完成（舊式回報；有需求單且需求單在「等門市確認」者請走第 4 批 ga_ws_req_store_action，避免雙路徑）。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_store_confirm(p_id uuid, p_note text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wo public.maintenance_requests%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_rid uuid;
  v_note text := ga_normalize_optional_text(p_note);
  v_text text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '說明不可超過 2000 字'); END IF;
  BEGIN
    SELECT ga_service_request_id INTO v_rid FROM public.maintenance_requests WHERE id = p_id;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF v_rid IS NOT NULL THEN SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_rid AND deleted_at IS NULL FOR UPDATE; END IF;
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF NOT public.ga_wo_can_enter(v_uid) AND v_wo.reported_by <> v_uid THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有確認這張工單的權限'); END IF;
    IF NOT public.ga_wo_store_actor(v_uid, v_wo.reported_by, v_wo.store_id) THEN
      RETURN CASE WHEN public.ga_wo_can_see(v_uid, v_wo.reported_by, v_wo.store_id) THEN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有回報人或該門市店長可以確認完成')
        ELSE public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單') END;
    END IF;
    IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作'); END IF;
    IF NOT (v_wo.status = 'PROCESSING' AND v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION') THEN
      RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前不是「處理完成待門市確認」，不能按確認完成');
    END IF;
    IF v_req.id IS NOT NULL AND v_req.main_status = 'WAITING_STORE_CONFIRMATION' THEN
      RETURN public.ga_rq_err(409, 'USE_REQUEST', '這張工單有需求單，請到「我的追蹤」確認完成');
    END IF;
    v_text := COALESCE(v_note, '門市確認完成。');
    UPDATE public.maintenance_requests SET status = 'COMPLETED', completed_at = now(), completed_by = v_uid, completion_method = 'STORE_CONFIRMED' WHERE id = p_id;
    PERFORM public.ga_wo_log(p_id, 'COMPLETED', v_wo.progress_stage, 'PUBLIC', v_text, v_uid);
    PERFORM public.ga_wo_event(p_id, 'STORE_CONFIRM_COMPLETE', v_wo.status, 'COMPLETED', v_wo.progress_stage, v_wo.progress_stage, v_text, 'PUBLIC', v_uid, jsonb_build_object('source', 'work_order_center'));
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_wo.id, 'wo_no', public.ga_wo_no(v_wo.id), 'status', v_wo.status, 'progress_stage', v_wo.progress_stage,
      'completion_method', v_wo.completion_method, 'updated_at', v_wo.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 回報仍有問題（舊式回報）：工單回「處理中＋門市反映仍有問題」，必須填原因。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_report_unresolved(p_id uuid, p_reason text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wo public.maintenance_requests%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_rid uuid;
  v_reason text := ga_normalize_optional_text(p_reason);
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '回報仍有問題必須填寫原因'); END IF;
  IF length(v_reason) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '原因不可超過 2000 字'); END IF;
  BEGIN
    SELECT ga_service_request_id INTO v_rid FROM public.maintenance_requests WHERE id = p_id;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF v_rid IS NOT NULL THEN SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_rid AND deleted_at IS NULL FOR UPDATE; END IF;
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF NOT public.ga_wo_can_enter(v_uid) AND v_wo.reported_by <> v_uid THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有回報這張工單的權限'); END IF;
    IF NOT public.ga_wo_store_actor(v_uid, v_wo.reported_by, v_wo.store_id) THEN
      RETURN CASE WHEN public.ga_wo_can_see(v_uid, v_wo.reported_by, v_wo.store_id) THEN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有回報人或該門市店長可以回報仍有問題')
        ELSE public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單') END;
    END IF;
    IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作'); END IF;
    IF NOT (v_wo.status = 'PROCESSING' AND v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION') THEN
      RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前不是「處理完成待門市確認」，不能回報仍有問題');
    END IF;
    IF v_req.id IS NOT NULL AND v_req.main_status = 'WAITING_STORE_CONFIRMATION' THEN
      RETURN public.ga_rq_err(409, 'USE_REQUEST', '這張工單有需求單，請到「我的追蹤」回報問題');
    END IF;
    UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'REOPENED', unresolved_reason = v_reason WHERE id = p_id;
    PERFORM public.ga_wo_log(p_id, 'PROCESSING', 'REOPENED', 'PUBLIC', v_reason, v_uid);
    PERFORM public.ga_wo_event(p_id, 'REPORT_UNRESOLVED', v_wo.status, 'PROCESSING', v_wo.progress_stage, 'REOPENED', v_reason, 'PUBLIC', v_uid, jsonb_build_object('source', 'work_order_center'));
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_wo.id, 'wo_no', public.ga_wo_no(v_wo.id), 'status', v_wo.status, 'progress_stage', v_wo.progress_stage,
      'updated_at', v_wo.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 舊式單（沒有需求單）門市回覆補資料；有需求單者店長走第 4 批「我的追蹤」入口（兩邊同步）。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_reply_supplement(p_id uuid, p_note text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wo public.maintenance_requests%ROWTYPE;
  v_note text := ga_normalize_optional_text(p_note);
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '補充資料必須填寫回覆說明'); END IF;
  IF length(v_note) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '說明不可超過 2000 字'); END IF;
  BEGIN
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF NOT public.ga_wo_can_enter(v_uid) AND v_wo.reported_by <> v_uid THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有回覆這張工單的權限'); END IF;
    IF NOT public.ga_wo_store_actor(v_uid, v_wo.reported_by, v_wo.store_id) THEN
      RETURN CASE WHEN public.ga_wo_can_see(v_uid, v_wo.reported_by, v_wo.store_id) THEN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有回報人或該門市店長可以補充資料')
        ELSE public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單') END;
    END IF;
    IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_wo.ga_service_request_id IS NOT NULL THEN RETURN public.ga_rq_err(409, 'USE_REQUEST', '這張工單有需求單，請到「我的追蹤」回覆補資料'); END IF;
    IF NOT (v_wo.status = 'PROCESSING' AND v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_INFO') THEN
      RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前不是「等待門市補充資料」，不需要回覆');
    END IF;
    IF NOT public.ga_wo_apply_supplement_reply(p_id, v_uid, v_note, false, 'work_order_center') THEN PERFORM public.ga_rq_raise(409, 'INVALID_STATE', '目前狀態不能回覆補資料'); END IF;
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_wo.id, 'wo_no', public.ga_wo_no(v_wo.id), 'status', v_wo.status, 'progress_stage', v_wo.progress_stage, 'updated_at', v_wo.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 刪除（W4）：只有未受理且沒連需求單的單；總務（工單管理等）可刪任何人的，回報人只能刪自己的。附件只標記刪除、不實刪儲存檔；
-- 其餘子表（進度、事件、舊照片列）由資料表的 ON DELETE CASCADE 連帶刪除（DEV 實測 FK 皆為 CASCADE；需求單端 ga_service_request_id 為 SET NULL）。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_delete(p_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wo public.maintenance_requests%ROWTYPE;
  v_n integer := 0;
  v_n2 integer := 0;
  v_name text;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  BEGIN
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF NOT (v_wo.reported_by = v_uid OR public.ga_wo_can_delete_perm(v_uid)) THEN
      RETURN CASE WHEN public.ga_wo_can_enter(v_uid) AND public.ga_wo_can_see(v_uid, v_wo.reported_by, v_wo.store_id) THEN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有回報人本人或有工單管理權限的人可以刪除工單')
        ELSE public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單') END;
    END IF;
    IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_wo.status <> 'UNACCEPTED' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '這張工單已受理，不能刪除；不需要處理請用「不處理，強制結案」'); END IF;
    IF v_wo.ga_service_request_id IS NOT NULL THEN RETURN public.ga_rq_err(409, 'HAS_REQUEST', '這張工單已連結需求單，不能刪除；不需要處理請用「不處理，強制結案」'); END IF;
    v_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), '未知');
    v_reason := '工單 ' || public.ga_wo_no(p_id) || ' 已刪除（刪除人：' || v_name || '）';
    PERFORM set_config('app.ga_resource_attachment_soft_delete', 'on', true);
    UPDATE public.ga_resource_attachments SET deleted_at = now(), deleted_by = v_uid, deletion_reason = v_reason
     WHERE deleted_at IS NULL AND ((resource_type = 'MAINTENANCE_REQUEST' AND resource_id = p_id)
        OR (resource_type = 'MAINTENANCE_UPDATE' AND resource_id IN (SELECT id FROM public.maintenance_updates WHERE request_id = p_id)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('app.ga_resource_attachment_soft_delete', 'off', true);
    DELETE FROM public.maintenance_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', p_id, 'wo_no', public.ga_wo_no(p_id), 'attachments_marked_deleted', v_n, 'deleted', true));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 新增舊式回報（跨部門維修頁；沒有需求單）：標題、說明、最多 5 張照片（共用附件，storage_path 必須是 maintenance_request/<工單id>/…，且檔案已上傳到儲存空間）。
-- p_payload：id（選填，前端先產生以便照片路徑）、store_id、title、description、contact_name、contact_phone、priority、category_id、issue_type、resource_type、attachments[]。
-- p_key 為防重複識別碼（同人同識別碼重送回原工單）。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_create_legacy(p_payload jsonb, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := ga_normalize_optional_text(p_key);
  v_store uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'store_id'));
  v_id uuid := COALESCE(public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'id')), gen_random_uuid());
  v_title text := ga_normalize_optional_text(v_p->>'title');
  v_desc text := ga_normalize_optional_text(v_p->>'description');
  v_priority text := lower(COALESCE(ga_normalize_optional_text(v_p->>'priority'), 'normal'));
  v_cat uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'category_id'));
  v_atts jsonb := COALESCE(v_p->'attachments', '[]'::jsonb);
  v_att jsonb;
  v_name text;
  v_prev uuid;
  v_wo public.maintenance_requests%ROWTYPE;
  v_ct text;
  v_size bigint;
  v_path text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF jsonb_typeof(v_p) <> 'object' THEN RETURN public.ga_rq_err(400, 'PAYLOAD_INVALID', '送出的內容格式錯誤'); END IF;
  IF v_key IS NULL OR length(v_key) > 120 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  -- 同一人同一個識別碼重送：先回原工單（不重新驗證內容、不重複建立）。同時重送（連點、網路重送）時用建議鎖排隊，鎖完再查一次（審查 #2）。
  PERFORM pg_advisory_xact_lock(hashtextextended('wo_create:' || v_uid::text || ':' || v_key, 0));
  SELECT e.ticket_id INTO v_prev FROM public.maintenance_ticket_events e WHERE e.event_type = 'CREATED' AND e.created_by = v_uid AND e.metadata->>'create_key' = v_key LIMIT 1;
  IF v_prev IS NOT NULL THEN
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_prev;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', true, 'data', jsonb_build_object('id', v_wo.id, 'wo_no', public.ga_wo_no(v_wo.id), 'status', v_wo.status, 'updated_at', v_wo.updated_at));
    END IF;
  END IF;
  IF v_store IS NULL THEN RETURN public.ga_rq_err(400, 'STORE_REQUIRED', '請選擇門市'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_store AND COALESCE(is_active, true)) THEN RETURN public.ga_rq_err(400, 'STORE_INVALID', '找不到這間門市或已停用'); END IF;
  IF NOT (public.ga_wo_can_update(v_uid) OR (public.ga_rq_is_store_member(v_uid, v_store)
          AND (has_permission(v_uid, 'general_affairs.maintenance_request.create') OR has_permission(v_uid, 'cross_dept.maintenance.submit')))) THEN
    RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有為這間門市回報維修問題的權限（需為該門市店長並有回報權限，或有工單更新權限）');
  END IF;
  IF v_title IS NULL THEN RETURN public.ga_rq_err(400, 'TITLE_REQUIRED', '請填寫標題'); END IF;
  IF length(v_title) > 200 THEN RETURN public.ga_rq_err(400, 'TITLE_TOO_LONG', '標題不可超過 200 字'); END IF;
  IF v_desc IS NOT NULL AND length(v_desc) > 2000 THEN RETURN public.ga_rq_err(400, 'DESCRIPTION_TOO_LONG', '說明不可超過 2000 字'); END IF;
  IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN RETURN public.ga_rq_err(400, 'PRIORITY_INVALID', '優先順序錯誤'); END IF;
  IF ga_normalize_optional_text(v_p->>'category_id') IS NOT NULL AND v_cat IS NULL THEN RETURN public.ga_rq_err(400, 'ID_INVALID', '分類識別碼格式錯誤'); END IF;
  IF jsonb_typeof(v_atts) <> 'array' THEN RETURN public.ga_rq_err(400, 'ATTACHMENTS_INVALID', '照片格式錯誤'); END IF;
  IF jsonb_array_length(v_atts) > 5 THEN RETURN public.ga_rq_err(400, 'TOO_MANY_PHOTOS', '最多只能附 5 張照片'); END IF;
  FOR v_att IN SELECT value FROM jsonb_array_elements(v_atts) LOOP
    v_path := ga_normalize_optional_text(v_att->>'storage_path');
    v_ct := lower(COALESCE(ga_normalize_optional_text(v_att->>'content_type'), ''));
    BEGIN v_size := (v_att->>'size_bytes')::bigint; EXCEPTION WHEN OTHERS THEN v_size := NULL; END;
    IF v_path IS NULL OR ga_normalize_optional_text(v_att->>'file_name') IS NULL THEN RETURN public.ga_rq_err(400, 'ATTACHMENTS_INVALID', '照片資料不完整'); END IF;
    IF v_ct NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') THEN RETURN public.ga_rq_err(400, 'NOT_IMAGE', '回報只能附圖片（JPEG、PNG、WebP、HEIC）'); END IF;
    IF v_size IS NULL OR v_size <= 0 OR v_size > 20971520 THEN RETURN public.ga_rq_err(400, 'FILE_TOO_LARGE', '每張照片需大於 0 且不超過 20MB'); END IF;
    IF left(v_path, length('maintenance_request/' || v_id::text || '/')) <> 'maintenance_request/' || v_id::text || '/' THEN RETURN public.ga_rq_err(400, 'PATH_INVALID', '照片儲存路徑不正確'); END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'general-affairs-attachments' AND o.name = v_path) THEN RETURN public.ga_rq_err(400, 'FILE_MISSING', '找不到已上傳的照片檔案，請重新上傳'); END IF;
  END LOOP;
  BEGIN
    IF EXISTS (SELECT 1 FROM public.maintenance_requests WHERE id = v_id) THEN RETURN public.ga_rq_err(409, 'DUPLICATE', '這個工單識別碼已被使用，請重新整理畫面後再試'); END IF;
    v_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown');
    INSERT INTO public.maintenance_requests (id, store_id, title, description, reported_by, reporter_name, status, priority, category_id, issue_type, resource_type, contact_name, contact_phone)
    VALUES (v_id, v_store, v_title, v_desc, v_uid, v_name, 'UNACCEPTED', v_priority, v_cat, ga_normalize_optional_text(v_p->>'issue_type'), ga_normalize_optional_text(v_p->>'resource_type'),
      COALESCE(ga_normalize_optional_text(v_p->>'contact_name'), v_name), ga_normalize_optional_text(v_p->>'contact_phone'))
    RETURNING * INTO v_wo;
    PERFORM public.ga_wo_event(v_id, 'CREATED', NULL, 'UNACCEPTED', NULL, NULL, '回報維修問題：' || v_title, 'PUBLIC', v_uid, jsonb_build_object('create_key', v_key, 'source', 'legacy_report'));
    FOR v_att IN SELECT value FROM jsonb_array_elements(v_atts) LOOP
      INSERT INTO public.ga_resource_attachments (resource_type, resource_id, purpose, storage_path, file_name, content_type, size_bytes, sort_order, uploaded_by)
      VALUES ('MAINTENANCE_REQUEST', v_id, 'REPORT_PHOTO', btrim(v_att->>'storage_path'), btrim(v_att->>'file_name'), lower(btrim(v_att->>'content_type')), (v_att->>'size_bytes')::bigint, 0, v_uid);
    END LOOP;
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('id', v_wo.id, 'wo_no', public.ga_wo_no(v_wo.id), 'status', v_wo.status, 'updated_at', v_wo.updated_at,
      'attachment_count', jsonb_array_length(v_atts)));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 改分類（可清除）：需要更新權限；寫一筆內部時間軸事件。
CREATE OR REPLACE FUNCTION public.ga_ws_wo_category(p_id uuid, p_category_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wo public.maintenance_requests%ROWTYPE;
  v_old text;
  v_new text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF NOT public.ga_wo_can_update(v_uid) THEN RETURN public.ga_wo_perm_error(v_uid); END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.maintenance_categories WHERE id = p_category_id) THEN RETURN public.ga_rq_err(404, 'CATEGORY_NOT_FOUND', '找不到這個維修分類'); END IF;
  BEGIN
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作'); END IF;
    SELECT name INTO v_old FROM public.maintenance_categories WHERE id = v_wo.category_id;
    SELECT name INTO v_new FROM public.maintenance_categories WHERE id = p_category_id;
    UPDATE public.maintenance_requests SET category_id = p_category_id WHERE id = p_id;
    PERFORM public.ga_wo_event(p_id, 'CATEGORY_CHANGED', v_wo.status, v_wo.status, v_wo.progress_stage, v_wo.progress_stage,
      '工單分類由「' || COALESCE(v_old, '未分類') || '」改為「' || COALESCE(v_new, '未分類') || '」', 'INTERNAL', v_uid, jsonb_build_object('old_category_id', v_wo.category_id, 'new_category_id', p_category_id));
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_wo.id, 'category_id', v_wo.category_id, 'updated_at', v_wo.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ================================================================ 授權
-- 內部輔助函式不開放給登入者與匿名者直接呼叫（只能由 SECURITY DEFINER 的 ga_ws_* 呼叫）。
REVOKE ALL ON FUNCTION public.ga_wo_no(uuid), public.ga_wo_stage_codes(), public.ga_wo_stage_label(text), public.ga_wo_status_label(text), public.ga_wo_is_exec_stage(text),
  public.ga_wo_focus(text, text), public.ga_wo_try_uuid(text), public.ga_wo_can_update(uuid), public.ga_wo_can_view_all(uuid), public.ga_wo_has_own_perm(uuid),
  public.ga_wo_can_delete_perm(uuid), public.ga_wo_can_enter(uuid), public.ga_wo_ga_side(uuid), public.ga_wo_can_see(uuid, uuid, uuid), public.ga_wo_store_actor(uuid, uuid, uuid),
  public.ga_wo_perm_error(uuid), public.ga_wo_log(uuid, text, text, text, text, uuid, date), public.ga_wo_event(uuid, text, text, text, text, text, text, text, uuid, jsonb),
  public.ga_wo_apply_fields(uuid, jsonb), public.ga_wo_apply_completion_request(uuid, uuid, text, text), public.ga_wo_apply_supplement_request(uuid, uuid, text, text, text, text),
  public.ga_wo_apply_supplement_reply(uuid, uuid, text, boolean, text), public.ga_wo_sync_skipped(uuid, uuid, text, text, text, text), public.ga_wo_sync_request(uuid, text, text, text, uuid, jsonb), public.ga_wo_row(uuid, boolean),
  public.ga_wo_abilities(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_wo_list(jsonb, integer, integer), public.ga_ws_wo_get(uuid), public.ga_ws_wo_summary(jsonb), public.ga_ws_wo_print(uuid, boolean),
  public.ga_ws_wo_transition(uuid, text, timestamptz, jsonb), public.ga_ws_wo_store_confirm(uuid, text, timestamptz), public.ga_ws_wo_report_unresolved(uuid, text, timestamptz),
  public.ga_ws_wo_reply_supplement(uuid, text, timestamptz), public.ga_ws_wo_delete(uuid, timestamptz), public.ga_ws_wo_create_legacy(jsonb, text),
  public.ga_ws_wo_category(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_wo_list(jsonb, integer, integer), public.ga_ws_wo_get(uuid), public.ga_ws_wo_summary(jsonb), public.ga_ws_wo_print(uuid, boolean),
  public.ga_ws_wo_transition(uuid, text, timestamptz, jsonb), public.ga_ws_wo_store_confirm(uuid, text, timestamptz), public.ga_ws_wo_report_unresolved(uuid, text, timestamptz),
  public.ga_ws_wo_reply_supplement(uuid, text, timestamptz), public.ga_ws_wo_delete(uuid, timestamptz), public.ga_ws_wo_create_legacy(jsonb, text),
  public.ga_ws_wo_category(uuid, uuid, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (proname LIKE 'ga_ws_wo_%' OR proname LIKE 'ga_wo_%') ORDER BY 1;
-- 核對：應列出 11 個 ga_ws_wo_*（38 之後再加領用料件 39 的 1 個）與 26 個 ga_wo_*
SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon_can_run, count(*) FILTER (WHERE proname LIKE 'ga_wo_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS internal_open_to_users
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (proname LIKE 'ga_ws_wo_%' OR proname LIKE 'ga_wo_%');
-- 核對：兩個數字都應是 0
