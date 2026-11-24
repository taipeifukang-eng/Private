-- ============================================================================
-- 正式區草稿 02（套用）。內容與 DEV 已實測的 supabase/workspace-dev/20261124110000_ga_utility_payment_bill_side.sql 相同。
-- 狀態：草稿，尚未套用到正式區；須老闆核可後，依 README.md 的順序執行。上線時間：12/8 全面切換之後（約 12/15 週）。
-- 不授權給任何角色（不含任何 GRANT 給角色、不新增權限碼）；可重複執行（已套用的部分略過）。
-- ============================================================================
-- 水電話費請款（G46）階段 2：帳單端（正式區草稿）。
-- 內容：
--   1. 內部輔助：ga_pay_ub_label（帳單白話標籤）、ga_pay_ub_ident（顯示用識別號碼）、ga_ub_check_payee（繳費單位必須是合作中的公用事業廠商）、ga_ub_json_ext（帳單 JSON 的新欄位）、ga_pay_ub_bill_lock_check（D7 鎖定）。
--   2. 帳單觸發器 ga_utility_bill_before_write 改版（讀現行定義＋文字替換，形狀不符就中止，已套用就略過）：
--        a. 「請款單同步」情境（交易內 ga.ub_sync_pr 指向一張存在的水電請款單、且只變動 paid_at／paid_by_pr_id）略過水電管理權限檢查（仍要求已登入）——會計退回、作廢請款單時才能把帳單改回待繳；
--        b. 非同步情境下 paid_at 有變動就把 paid_by_pr_id 清空（手動標記、手動改回待繳、手動改日期都變成「手動」，之後退回或作廢不會動它）；
--        c. 帳單位於已送出或已付款請款單內時，鎖金額、繳費單位、帳單月份、費用類型、據點、識別號碼、刪除（勾自動標記者另鎖繳費日期）。
--   3. ga_ub_json 多 payee_vendor_id、payee_vendor_name、paid_by_pr_id、attachment_count、payment_request、locked；ga_ws_ub_save 接受 payee_vendor_id（有帶才處理）；ga_ws_ub_list 多 request、payee 篩選。
--   4. 新增對外函式 ga_ws_ub_payees（繳費單位下拉）、ga_ws_ub_set_payee（批次補填，只填空值，最多 200 筆）。
--   5. 附件守門 ga_pay_ub_attachment_last_guard（另一個觸發器，不改 ga_pay_attachment_last_image_guard）：水電帳單位於已送出或已付款請款單內時，最後一個附件不能刪除。
-- 加掛的文字以 GAUP-BEGIN／GAUP-END 標記包住；撤回時依標記移除，不整支覆蓋。先決：20261124100000。可重複執行。
-- 還原：02-ga-utility-payment-bill-side.rollback.sql。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_utility_bills' AND column_name = 'payee_vendor_id') THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261124100000_ga_utility_payment_schema';
  END IF;
  IF to_regprocedure('public.ga_utility_bill_before_write()') IS NULL OR to_regprocedure('public.ga_ub_json(uuid)') IS NULL
     OR to_regprocedure('public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)') IS NULL OR to_regprocedure('public.ga_ws_ub_list(jsonb,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用 G23 水電網費（20261118110000_m7m8_b6_utility_bills）';
  END IF;
END $$;

-- 文字替換輔助（本檔結尾會刪除）：找不到要替換的文字就中止，不整支覆蓋。
CREATE OR REPLACE FUNCTION public.ga_gaup_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  IF position(p_old IN substr(p_text, position(p_old IN p_text) + 1)) > 0 THEN RAISE EXCEPTION '函式形狀與預期不符，要替換的文字出現不只一次（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

-- ================================================================ 1. 內部輔助
CREATE OR REPLACE FUNCTION public.ga_pay_ub_ident(p_service_identifier text, p_equipment_serial text, p_account_number text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE(nullif(btrim(p_service_identifier), ''), nullif(btrim(p_equipment_serial), ''), nullif(btrim(p_account_number), ''), ''); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_ub_label(b public.ga_utility_bills) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT b.location_name || ' ' || CASE b.expense_type WHEN 'WATER' THEN '水費' WHEN 'ELECTRICITY' THEN '電費' WHEN 'PHONE' THEN '電話費' WHEN 'INTERNET' THEN '網路費' ELSE b.expense_type END
        || CASE WHEN public.ga_pay_ub_ident(b.service_identifier, b.equipment_serial, b.account_number) <> '' THEN ' ' || public.ga_pay_ub_ident(b.service_identifier, b.equipment_serial, b.account_number) ELSE '' END; $$;

-- 繳費單位檢查：廠商存在、合作中、屬「公用事業」分類（設定鍵 utility_payee_category_id，用 id 判斷，不看分類名稱與啟用狀態）。
CREATE OR REPLACE FUNCTION public.ga_ub_check_payee(p_vendor uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v public.ga_vendors%ROWTYPE;
  v_cat uuid;
BEGIN
  SELECT * INTO v FROM public.ga_vendors WHERE id = p_vendor;
  IF NOT FOUND THEN PERFORM public.ga_rq_raise(404, 'VENDOR_NOT_FOUND', '找不到這個繳費單位'); END IF;
  SELECT s.value_text::uuid INTO v_cat FROM public.ga_workflow_settings s WHERE s.key = 'utility_payee_category_id';
  IF v_cat IS NULL OR NOT (v_cat = ANY (v.service_category_ids)) THEN
    PERFORM public.ga_rq_raise(409, 'PAYEE_NOT_UTILITY', '「' || v.name || '」不是公用事業分類的廠商，請先到廠商資料加上「公用事業」分類');
  END IF;
  IF v.status <> 'active' THEN PERFORM public.ga_rq_raise(409, 'VENDOR_INACTIVE', '「' || v.name || '」已停止合作，不能選用'); END IF;
END;
$$;

-- D7：帳單位於已送出或已付款請款單內時，鎖金額、繳費單位、帳單月份、費用類型、據點、識別號碼、刪除；勾自動標記者另鎖繳費日期（由請款單管理）。草稿內的帳單不鎖。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_bill_lock_check(o public.ga_utility_bills, n public.ga_utility_bills) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record;
  v_state text;
BEGIN
  SELECT q.pr_no, q.status, q.auto_mark_paid INTO r
    FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
   WHERE l.bill_id = o.id AND l.active AND q.status IN ('SUBMITTED', 'PAID') LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  v_state := CASE r.status WHEN 'PAID' THEN '已付款' ELSE '已送出' END;
  IF (n.amount, n.payee_vendor_id, n.billing_month, n.expense_type, n.store_id, n.location_name, n.service_identifier, n.equipment_serial, n.account_number, n.deleted_at IS NOT NULL)
     IS DISTINCT FROM (o.amount, o.payee_vendor_id, o.billing_month, o.expense_type, o.store_id, o.location_name, o.service_identifier, o.equipment_serial, o.account_number, o.deleted_at IS NOT NULL) THEN
    PERFORM public.ga_rq_raise(409, 'BILL_IN_REQUEST', '這筆帳單已在請款單 ' || r.pr_no || ' 內（' || v_state || '），金額、繳費單位與刪除已鎖定；請先請款單退回或作廢', jsonb_build_object('pr_no', r.pr_no, 'locked', true));
  END IF;
  IF r.auto_mark_paid AND n.paid_at IS DISTINCT FROM o.paid_at THEN
    PERFORM public.ga_rq_raise(409, 'BILL_IN_REQUEST', '這筆帳單已在請款單 ' || r.pr_no || ' 內（' || v_state || '，勾選送出後自動標記已繳），繳費狀態由請款單管理；請先請款單退回或作廢', jsonb_build_object('pr_no', r.pr_no, 'locked', true));
  END IF;
END;
$$;

-- 帳單 JSON 的新欄位（ga_ub_json 以 || 接上）：沒有請款檢視權限者只看到「已在請款單內」，不含單號。
CREATE OR REPLACE FUNCTION public.ga_ub_json_ext(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'payee_vendor_id', b.payee_vendor_id,
    'payee_vendor_name', (SELECT v.name FROM public.ga_vendors v WHERE v.id = b.payee_vendor_id),
    'paid_by_pr_id', b.paid_by_pr_id,
    'paid_by_pr_no', CASE WHEN public.ga_pay_can_view(auth.uid()) THEN (SELECT q.pr_no FROM public.ga_payment_requests q WHERE q.id = b.paid_by_pr_id) END,
    'attachment_count', (SELECT count(*) FROM public.ga_resource_attachments a WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = b.id AND a.deleted_at IS NULL),
    'payment_request', (SELECT CASE WHEN public.ga_pay_can_view(auth.uid())
                                   THEN jsonb_build_object('in_request', true, 'id', q.id, 'pr_no', q.pr_no, 'status', q.status, 'auto_mark_paid', q.auto_mark_paid)
                                   ELSE jsonb_build_object('in_request', true) END
                          FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.bill_id = b.id AND l.active LIMIT 1),
    'locked', COALESCE((SELECT CASE WHEN q.auto_mark_paid THEN '["amount","payee_vendor_id","billing_month","expense_type","location","identifier","delete","paid_at"]'::jsonb
                                    ELSE '["amount","payee_vendor_id","billing_month","expense_type","location","identifier","delete"]'::jsonb END
                          FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
                         WHERE l.bill_id = b.id AND l.active AND q.status IN ('SUBMITTED', 'PAID') LIMIT 1), '[]'::jsonb))
  FROM public.ga_utility_bills b WHERE b.id = p_id;
$$;

-- ================================================================ 2. 帳單觸發器改版
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_utility_bill_before_write()'::regprocedure);
  IF position('GAUP-BEGIN' IN v_def) > 0 THEN RAISE NOTICE 'ga_utility_bill_before_write 已加掛，略過'; RETURN; END IF;
  v_new := public.ga_gaup_swap(v_def, $a$  IF NOT public.current_user_has_permission('general_affairs.utility_bill.manage') THEN$a$,
$a$  -- GAUP-BEGIN
  -- 請款單同步情境：只變動 paid_at／paid_by_pr_id，且 ga.ub_sync_pr 指向一張水電請款單（只由 SECURITY DEFINER 的 ga_pay_ub_sync 在交易內設定）時，略過水電管理權限檢查。
  IF TG_OP = 'UPDATE' AND nullif(current_setting('ga.ub_sync_pr', true), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ga_payment_requests gq WHERE gq.id::text = current_setting('ga.ub_sync_pr', true) AND gq.source = 'UTILITY')
     AND (to_jsonb(NEW) - 'paid_at' - 'paid_by_pr_id' - 'updated_at' - 'updated_by') = (to_jsonb(OLD) - 'paid_at' - 'paid_by_pr_id' - 'updated_at' - 'updated_by') THEN
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    RETURN NEW;
  END IF;
  -- 手動變更繳費日期：之後退回或作廢請款單不再動這筆帳單；再套用 D7 鎖定。
  IF TG_OP = 'UPDATE' THEN
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at AND NEW.paid_by_pr_id IS NOT DISTINCT FROM OLD.paid_by_pr_id THEN NEW.paid_by_pr_id := NULL; END IF;
    PERFORM public.ga_pay_ub_bill_lock_check(OLD, NEW);
  END IF;
  -- GAUP-END
  IF NOT public.current_user_has_permission('general_affairs.utility_bill.manage') THEN$a$, 'ga_utility_bill_before_write');
  EXECUTE v_new;
END $$;

-- 2b. 直接寫入防護（GAUP-V2）：水電管理者可直接對資料表 PATCH，所以 paid_by_pr_id 與 payee_vendor_id 的檢查必須放在觸發器內。
--   paid_by_pr_id：非請款單同步情境下，只允許清成 NULL；新增時一律 NULL；想改成別的值會還原成原值。
--   payee_vendor_id：新增或變動成非空值時，檢查必須是合作中的公用事業廠商。
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_utility_bill_before_write()'::regprocedure);
  IF position('GAUP-V2' IN v_def) > 0 THEN RAISE NOTICE 'GAUP-V2 已加掛，略過'; RETURN; END IF;
  v_new := public.ga_gaup_swap(v_def, $a$  -- 手動變更繳費日期：$a$,
$a$  -- GAUP-V2：直接寫入防護
  IF TG_OP = 'INSERT' THEN
    NEW.paid_by_pr_id := NULL;
  ELSIF NEW.paid_by_pr_id IS NOT NULL AND NEW.paid_by_pr_id IS DISTINCT FROM OLD.paid_by_pr_id THEN
    NEW.paid_by_pr_id := OLD.paid_by_pr_id;
  END IF;
  IF NEW.payee_vendor_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.payee_vendor_id IS DISTINCT FROM OLD.payee_vendor_id) THEN
    PERFORM public.ga_ub_check_payee(NEW.payee_vendor_id);
  END IF;
  -- 手動變更繳費日期：$a$, 'ga_utility_bill_before_write V2');
  EXECUTE v_new;
END $$;

-- ================================================================ 3. ga_ub_json／ga_ws_ub_save／ga_ws_ub_list 加掛
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ub_json(uuid)'::regprocedure);
  IF position('GAUP-BEGIN' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  FROM public.ga_utility_bills b WHERE b.id = p_id;$a$,
$a$  -- GAUP-BEGIN
  || public.ga_ub_json_ext(b.id)
  -- GAUP-END
  FROM public.ga_utility_bills b WHERE b.id = p_id;$a$, 'ga_ub_json');
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)'::regprocedure);
  IF position('GAUP-BEGIN' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  v_anomaly := public.ga_ub_anomaly($a$,
$a$  -- GAUP-BEGIN
  IF jsonb_exists(p, 'payee_vendor_id') THEN
    DECLARE
      v_payee uuid := public.ga_pay_uuid(p ->> 'payee_vendor_id', '繳費單位', false);
    BEGIN
      IF v_payee IS DISTINCT FROM b.payee_vendor_id THEN
        IF v_payee IS NOT NULL THEN PERFORM public.ga_ub_check_payee(v_payee); END IF;
        UPDATE public.ga_utility_bills SET payee_vendor_id = v_payee WHERE id = b.id RETURNING * INTO b;
      END IF;
    END;
  END IF;
  -- GAUP-END
  v_anomaly := public.ga_ub_anomaly($a$, 'ga_ws_ub_save');
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('public.ga_ws_ub_list(jsonb,integer,integer)'::regprocedure);
  IF position('GAUP-BEGIN' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  IF v_overdue THEN v_status := 'overdue'; END IF;$a$,
$a$  IF v_overdue THEN v_status := 'overdue'; END IF;
  -- GAUP-BEGIN
  IF COALESCE(v_f ->> 'request', '') NOT IN ('', 'none', 'in_request') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '請款狀態篩選值錯誤'); END IF;
  IF COALESCE(v_f ->> 'payee', '') NOT IN ('', 'none') AND (v_f ->> 'payee') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '繳費單位篩選值錯誤'); END IF;
  -- GAUP-END$a$, 'ga_ws_ub_list 驗證');
    v_new := public.ga_gaup_swap(v_new, $a$OR COALESCE(b.reference_no, '') ILIKE v_pat ESCAPE '\')$a$,
$a$OR COALESCE(b.reference_no, '') ILIKE v_pat ESCAPE '\')
       -- GAUP-BEGIN
       AND (COALESCE(v_f ->> 'request', '') = ''
            OR (v_f ->> 'request' = 'none' AND NOT EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines gl WHERE gl.bill_id = b.id AND gl.active))
            OR (v_f ->> 'request' = 'in_request' AND EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines gl WHERE gl.bill_id = b.id AND gl.active)))
       AND (COALESCE(v_f ->> 'payee', '') = '' OR (v_f ->> 'payee' = 'none' AND b.payee_vendor_id IS NULL) OR b.payee_vendor_id::text = lower(v_f ->> 'payee'))
       -- GAUP-END$a$, 'ga_ws_ub_list 條件');
    EXECUTE v_new;
  END IF;
END $$;

-- ================================================================ 4. 對外函式
CREATE OR REPLACE FUNCTION public.ga_ws_ub_payees() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cat uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看水電網費的權限'); END IF;
  SELECT s.value_text::uuid INTO v_cat FROM public.ga_workflow_settings s WHERE s.key = 'utility_payee_category_id';
  RETURN jsonb_build_object('ok', true, 'status', 200, 'category_id', v_cat,
    'data', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name) ORDER BY v.name, v.id) FROM public.ga_vendors v WHERE v.status = 'active' AND v_cat IS NOT NULL AND v_cat = ANY (v.service_category_ids)), '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 批次補填繳費單位：只填空值（已有繳費單位、已刪除、找不到的跳過並回報原因），一次最多 200 筆；需水電管理權限。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_set_payee(p_ids uuid[], p_vendor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  b public.ga_utility_bills%ROWTYPE;
  v_seen uuid[] := '{}';
  v_done integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有補填繳費單位的權限（需要水電網費管理權限）'); END IF;
  IF p_vendor IS NULL THEN RETURN public.ga_rq_err(400, 'FIELD_REQUIRED', '請選擇繳費單位'); END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_ids FROM unnest(COALESCE(p_ids, '{}')) x;
  IF cardinality(v_ids) = 0 THEN RETURN public.ga_rq_err(400, 'IDS_REQUIRED', '請選擇要補填的帳單'); END IF;
  IF cardinality(v_ids) > 200 THEN RETURN public.ga_rq_err(400, 'TOO_MANY', '一次最多補填 200 筆帳單'); END IF;
  PERFORM public.ga_ub_check_payee(p_vendor);
  FOR b IN SELECT * FROM public.ga_utility_bills WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE LOOP
    v_seen := v_seen || b.id;
    IF b.deleted_at IS NOT NULL THEN v_skipped := v_skipped || jsonb_build_object('id', b.id, 'reason', 'DELETED');
    ELSIF b.payee_vendor_id IS NOT NULL THEN v_skipped := v_skipped || jsonb_build_object('id', b.id, 'reason', 'HAS_PAYEE');
    ELSE
      UPDATE public.ga_utility_bills SET payee_vendor_id = p_vendor WHERE id = b.id;
      v_done := v_done + 1;
    END IF;
  END LOOP;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT (v_id = ANY (v_seen)) THEN v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'NOT_FOUND'); END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('updated', v_done, 'skipped', v_skipped));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 5. 附件守門（另一個觸發器，不改 ga_pay_attachment_last_image_guard）
CREATE OR REPLACE FUNCTION public.ga_pay_ub_attachment_last_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pr text;
BEGIN
  IF NEW.resource_type <> 'UTILITY_BILL' THEN RETURN NEW; END IF;
  IF NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN RETURN NEW; END IF;
  -- 先鎖帳單列：兩個人同時各刪一個附件時依序檢查（後者會看到前者已刪）
  PERFORM 1 FROM public.ga_utility_bills WHERE id = NEW.resource_id FOR UPDATE;
  SELECT q.pr_no INTO v_pr FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
   WHERE l.bill_id = NEW.resource_id AND l.active AND q.status IN ('SUBMITTED', 'PAID') LIMIT 1;
  IF v_pr IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ga_resource_attachments a WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = NEW.resource_id AND a.deleted_at IS NULL AND a.id <> NEW.id) THEN
    RAISE EXCEPTION 'BILL_LAST_ATTACHMENT_LOCKED: 這筆帳單已在請款單 % 內，最後一個附件不能刪除；請先上傳新的附件，或先退回、作廢請款單', v_pr USING ERRCODE = 'GA047';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_attachment_last_guard ON public.ga_resource_attachments;
CREATE TRIGGER trg_ga_pay_ub_attachment_last_guard BEFORE UPDATE ON public.ga_resource_attachments FOR EACH ROW EXECUTE FUNCTION public.ga_pay_ub_attachment_last_guard();

-- ================================================================ 6. 權限：對外函式只給登入者；內部輔助不開放（不授權給任何角色）
REVOKE ALL ON FUNCTION public.ga_ws_ub_payees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_ub_payees() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ga_ws_ub_set_payee(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_ub_set_payee(uuid[], uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ga_pay_ub_ident(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_pay_ub_label(public.ga_utility_bills) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ub_check_payee(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_pay_ub_bill_lock_check(public.ga_utility_bills, public.ga_utility_bills) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ub_json_ext(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_pay_ub_attachment_last_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_ub_ident(text, text, text), public.ga_pay_ub_label(public.ga_utility_bills), public.ga_ub_check_payee(uuid), public.ga_pay_ub_bill_lock_check(public.ga_utility_bills, public.ga_utility_bills), public.ga_ub_json_ext(uuid) TO service_role;
DROP FUNCTION IF EXISTS public.ga_gaup_swap(text, text, text, text);

NOTIFY pgrst, 'reload schema';
