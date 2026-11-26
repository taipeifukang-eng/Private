-- 正式區草稿 ga-improve-b1-sql/03-ga-improve-b1-pay-methods-payee.sql（G4 付款方式與同仁代墊）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125120000_ga_improve_b1_pay_methods_payee.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 03-ga-improve-b1-pay-methods-payee.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 總務採購與請款改善第一批（ga-improve-b1）階段 4：G4 付款方式（信用卡、網購平台／第三方支付）與同仁代墊（DEV；正式區草稿 ga-improve-b1-sql/03 內容相同）。
-- 內容：
--   1. 請款單欄位：payee_type（VENDOR／EMPLOYEE，預設 VENDOR）、payee_profile_id、payee_name_snapshot、payee_account_snapshot、pay_card_last4、pay_platform（皆有預設或可為空）；
--      pay_method 的 CHECK 放寬成「轉帳、現金、支票、信用卡、網購平台」超集。廠商與 bank_snapshot 維持原樣（付款對象帳戶另存 payee_account_snapshot）。
--   2. 同仁匯款帳戶：ga_employee_payout_accounts、ga_employee_payout_account_events（不可修改刪除，事件不含帳號本文）；RPC：ga_ws_payout_account_get_own／set_own（本人）、
--      get_for／set_for（需請款管理加廠商帳務檢視）、ga_ws_pay_employee_options（挑選同仁）、ga_ws_pay_my_reimbursements（我的代墊款）。
--   3. 守門觸發器 ga_ib1_payee_guard：送出後付款對象鎖定、代墊單送出時要有同仁帳戶快照（PAYEE_NO_ACCOUNT）、標已付款的人不可是付款對象本人（SELF_PAYEE）、代墊單只能用轉帳／現金／支票。
--   4. 既有函式加掛（GAIB1-S4 標記，撤回時逐字還原）：ga_pay_request_json（遮蔽同仁帳戶）、ga_ws_pay_request_action（付款方式與欄位、重抓同仁帳戶）、ga_ws_pay_request_list（付款對象篩選）、ga_ws_pay_export（extended 欄位）。
-- 不新增權限碼、不授權給任何角色。沒用到新功能時輸出與原本相同。可重複執行。先決：20261125100000、20261125110000。
-- 還原：20261125120000_ga_improve_b1_pay_methods_payee.rollback.sql（已有信用卡、網購平台或代墊請款單時中止）。
DO $$
BEGIN
  IF to_regprocedure('public.ga_ib1_pay_set_buyer(uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261125100000_ga_improve_b1_buyer_companies'; END IF;
  IF to_regclass('public.ga_payment_request_bill_lines') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: 請先套用 G46 水電請款'; END IF;
END $$;

-- ================================================================ 1. 請款單欄位與約束
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS payee_type text NOT NULL DEFAULT 'VENDOR';
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS payee_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS payee_name_snapshot text;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS payee_account_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS pay_card_last4 text;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS pay_platform text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_payee_check' AND conrelid = 'public.ga_payment_requests'::regclass) THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_payee_check CHECK (
      (payee_type = 'VENDOR' AND payee_profile_id IS NULL) OR (payee_type = 'EMPLOYEE' AND payee_profile_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_pay_fields_check' AND conrelid = 'public.ga_payment_requests'::regclass) THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_pay_fields_check CHECK (
      (pay_card_last4 IS NULL OR (pay_method = 'CREDIT_CARD' AND pay_card_last4 ~ '^[0-9]{4}$'))
      AND (pay_platform IS NULL OR (pay_method = 'ONLINE_PLATFORM' AND char_length(pay_platform) BETWEEN 1 AND 40)));
  END IF;
  -- pay_method 放寬成超集（舊值全部保留）
  ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_pay_method_check;
  ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_pay_method_check CHECK (pay_method IS NULL OR pay_method IN ('TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'ONLINE_PLATFORM'));
END $$;
CREATE INDEX IF NOT EXISTS idx_ga_payment_requests_payee_profile ON public.ga_payment_requests (payee_profile_id, status) WHERE payee_profile_id IS NOT NULL;

-- ================================================================ 2. 同仁匯款帳戶
CREATE TABLE IF NOT EXISTS public.ga_employee_payout_accounts (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  bank_branch text,
  bank_account text NOT NULL,
  bank_account_name text NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ga_employee_payout_accounts_text_check CHECK (char_length(bank_name) BETWEEN 1 AND 60 AND (bank_branch IS NULL OR char_length(bank_branch) <= 60)
    AND bank_account ~ '^[0-9 -]{6,30}$' AND char_length(bank_account_name) BETWEEN 1 AND 60)
);
CREATE TABLE IF NOT EXISTS public.ga_employee_payout_account_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  actor_id uuid,
  via text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  account_last4 text,
  prev_last4 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_employee_payout_account_events_via_check CHECK (via IN ('SELF', 'PROXY', 'VIEW'))
);
-- 審查 M2／L7：事件多記「變更前末四碼」，並放行 VIEW（別人查看同仁帳戶的稽核紀錄）；DEV 已存在的表在這裡補齊
ALTER TABLE public.ga_employee_payout_account_events ADD COLUMN IF NOT EXISTS prev_last4 text;
ALTER TABLE public.ga_employee_payout_account_events DROP CONSTRAINT IF EXISTS ga_employee_payout_account_events_via_check;
ALTER TABLE public.ga_employee_payout_account_events ADD CONSTRAINT ga_employee_payout_account_events_via_check CHECK (via IN ('SELF', 'PROXY', 'VIEW'));
CREATE INDEX IF NOT EXISTS idx_ga_employee_payout_account_events_profile ON public.ga_employee_payout_account_events (profile_id, created_at);
DROP TRIGGER IF EXISTS trg_ga_employee_payout_account_events_immutable ON public.ga_employee_payout_account_events;
CREATE TRIGGER trg_ga_employee_payout_account_events_immutable BEFORE UPDATE OR DELETE ON public.ga_employee_payout_account_events FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_events_immutable();
ALTER TABLE public.ga_employee_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_employee_payout_account_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_employee_payout_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ga_employee_payout_account_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_employee_payout_accounts TO service_role;
GRANT ALL ON public.ga_employee_payout_account_events TO service_role;

-- ================================================================ 3. 內部輔助
-- 同仁是否在職：有員工編號且 store_employees 有紀錄時，要有一筆啟用且非離職；沒有紀錄（例如總部同仁）視為在職
CREATE OR REPLACE FUNCTION public.ga_ib1_employee_active(p_profile uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT CASE WHEN p.employee_code IS NULL OR NOT EXISTS (SELECT 1 FROM public.store_employees se WHERE se.employee_code = p.employee_code) THEN true
              ELSE EXISTS (SELECT 1 FROM public.store_employees se WHERE se.employee_code = p.employee_code AND se.is_active AND COALESCE(se.employment_status, 'active') <> 'resigned') END
    FROM public.profiles p WHERE p.id = p_profile;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ib1_payee_account_snapshot(p_profile uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT COALESCE((SELECT jsonb_build_object('bank_name', a.bank_name, 'bank_branch', a.bank_branch, 'bank_account', a.bank_account, 'bank_account_name', a.bank_account_name)
                     FROM public.ga_employee_payout_accounts a WHERE a.profile_id = p_profile), '{}'::jsonb);
$f$;

-- 請款單草稿的付款對象：payload 有 payee_type／payee_profile_id 才處理（VENDOR 清回預設；EMPLOYEE 檢查在職並抓帳戶快照）
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_set_payee(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  v_type text;
  v_pid uuid;
  v_name text;
  v_has_pid boolean;
BEGIN
  IF NOT (p ? 'payee_type' OR p ? 'payee_profile_id') THEN RETURN; END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr AND status = 'DRAFT';
  IF NOT FOUND THEN RETURN; END IF;
  v_has_pid := nullif(btrim(COALESCE(p ->> 'payee_profile_id', '')), '') IS NOT NULL;
  v_type := upper(COALESCE(nullif(btrim(COALESCE(p ->> 'payee_type', '')), ''), CASE WHEN v_has_pid THEN 'EMPLOYEE' ELSE q.payee_type END));
  IF v_type NOT IN ('VENDOR', 'EMPLOYEE') THEN PERFORM public.ga_rq_raise(400, 'PAYEE_TYPE', '付款對象只能是廠商或同仁代墊'); END IF;
  IF v_type = 'VENDOR' THEN
    IF q.payee_type <> 'VENDOR' THEN
      UPDATE public.ga_payment_requests SET payee_type = 'VENDOR', payee_profile_id = NULL, payee_name_snapshot = NULL, payee_account_snapshot = '{}'::jsonb WHERE id = p_pr;
    END IF;
    RETURN;
  END IF;
  v_pid := public.ga_pay_uuid(COALESCE(nullif(btrim(COALESCE(p ->> 'payee_profile_id', '')), ''), q.payee_profile_id::text), '付款同仁', true);
  IF q.payee_type = 'EMPLOYEE' AND q.payee_profile_id = v_pid THEN RETURN; END IF;
  SELECT p2.full_name || COALESCE('（' || p2.employee_code || '）', '') INTO v_name FROM public.profiles p2 WHERE p2.id = v_pid;
  IF NOT FOUND THEN PERFORM public.ga_rq_raise(404, 'PAYEE_NOT_FOUND', '找不到這位同仁'); END IF;
  IF NOT public.ga_ib1_employee_active(v_pid) THEN PERFORM public.ga_rq_raise(409, 'PAYEE_INACTIVE', '這位同仁已離職，不能指定為代墊對象'); END IF;
  UPDATE public.ga_payment_requests SET payee_type = 'EMPLOYEE', payee_profile_id = v_pid, payee_name_snapshot = v_name, payee_account_snapshot = public.ga_ib1_payee_account_snapshot(v_pid) WHERE id = p_pr;
END;
$f$;

-- 標已付款時的信用卡末四碼與平台名稱檢查
CREATE OR REPLACE FUNCTION public.ga_ib1_check_pay_fields(p_method text, p jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_card text := nullif(btrim(COALESCE(p ->> 'card_last4', '')), '');
  v_plat text := nullif(btrim(COALESCE(p ->> 'platform', '')), '');
BEGIN
  IF v_card IS NOT NULL AND p_method <> 'CREDIT_CARD' THEN PERFORM public.ga_rq_raise(400, 'PAY_FIELD_MISMATCH', '只有信用卡付款可以填卡號末四碼'); END IF;
  IF v_plat IS NOT NULL AND p_method <> 'ONLINE_PLATFORM' THEN PERFORM public.ga_rq_raise(400, 'PAY_FIELD_MISMATCH', '只有網購平台／第三方支付可以填平台名稱'); END IF;
  IF v_card IS NOT NULL AND v_card !~ '^[0-9]{4}$' THEN PERFORM public.ga_rq_raise(400, 'CARD_LAST4', '卡號末四碼要是 4 位數字（不要填完整卡號）'); END IF;
  IF v_plat IS NOT NULL AND char_length(v_plat) > 40 THEN PERFORM public.ga_rq_raise(400, 'PLATFORM_TOO_LONG', '平台名稱不可超過 40 字'); END IF;
END;
$f$;

-- 付款對象守門：送出後鎖定、代墊單送出要有同仁帳戶、付款的人不可是付款對象本人、代墊單的付款方式限轉帳／現金／支票
CREATE OR REPLACE FUNCTION public.ga_ib1_payee_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  IF OLD.status <> 'DRAFT' AND (NEW.payee_type, NEW.payee_profile_id, NEW.payee_name_snapshot, NEW.payee_account_snapshot) IS DISTINCT FROM (OLD.payee_type, OLD.payee_profile_id, OLD.payee_name_snapshot, OLD.payee_account_snapshot) THEN
    RAISE EXCEPTION '已送出或已付款的請款單，付款對象不能修改' USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status = 'PAID' AND (NEW.pay_card_last4, NEW.pay_platform) IS DISTINCT FROM (OLD.pay_card_last4, OLD.pay_platform) THEN
    RAISE EXCEPTION '已付款的請款單，付款資訊不能修改' USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' AND NEW.payee_type = 'EMPLOYEE' THEN
    -- 審查 M3：送出時一律以同仁目前的匯款帳戶覆寫快照（草稿期間帳戶若被改過，不會匯到舊帳號）
    NEW.payee_account_snapshot := public.ga_ib1_payee_account_snapshot(NEW.payee_profile_id);
    IF NEW.payee_account_snapshot = '{}'::jsonb THEN
      PERFORM public.ga_rq_raise(409, 'PAYEE_NO_ACCOUNT', '這位同仁還沒有登錄匯款帳戶，請同仁到「我的代墊款」登錄，或由會計代為登錄');
    END IF;
  END IF;
  IF NEW.status = 'PAID' AND OLD.status <> 'PAID' AND NEW.payee_type = 'EMPLOYEE' THEN
    IF NEW.paid_by IS NOT DISTINCT FROM NEW.payee_profile_id THEN
      PERFORM public.ga_rq_raise(403, 'SELF_PAYEE', '不能自己核付自己的代墊款，請其他同仁處理');
    END IF;
    IF NEW.pay_method NOT IN ('TRANSFER', 'CASH', 'CHECK') THEN
      PERFORM public.ga_rq_raise(400, 'PAY_METHOD', '同仁代墊的款項只能用轉帳、現金或支票還給同仁');
    END IF;
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_ib1_payee_guard ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_ib1_payee_guard BEFORE UPDATE ON public.ga_payment_requests FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_payee_guard();

-- 請款單 JSON 的付款對象欄位：同仁帳戶只給「請款管理加廠商帳務檢視」與同仁本人（其餘回 {} 並標 masked，只露末四碼）
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_json_ext(p_pr uuid, p_vendor boolean, p_detail boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  v_visible boolean;
BEGIN
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  v_visible := q.payee_type <> 'EMPLOYEE' OR p_vendor OR q.payee_profile_id IS NOT DISTINCT FROM auth.uid();
  RETURN jsonb_build_object(
    'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
    'payee_account_snapshot', CASE WHEN v_visible THEN q.payee_account_snapshot ELSE '{}'::jsonb END,
    'payee_account_masked', NOT v_visible,
    'payee_account_last4', CASE WHEN q.payee_type = 'EMPLOYEE' AND q.payee_account_snapshot ->> 'bank_account' IS NOT NULL THEN right(regexp_replace(q.payee_account_snapshot ->> 'bank_account', '[^0-9]', '', 'g'), 4) END);
END;
$f$;

-- 請款單列表的付款對象篩選（階段 5 會重新定義，加入預付類型與逾期篩選）
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_filter_ok(p_pr uuid, v_f jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT COALESCE(upper(nullif(v_f ->> 'payee_type', '')), '') = '' OR EXISTS (SELECT 1 FROM public.ga_payment_requests q WHERE q.id = p_pr AND q.payee_type = upper(v_f ->> 'payee_type'));
$f$;

-- 對帳匯出的 extended 欄位（階段 5 會重新定義，加入預付單列）。沒帶 extended 時原樣回傳。
CREATE OR REPLACE FUNCTION public.ga_ib1_export_enrich(p_res jsonb, v_f jsonb, p_uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_can_vendor boolean := public.ga_pay_can_vendor(p_uid);
  v_rows jsonb;
BEGIN
  IF COALESCE(v_f ->> 'extended', '') NOT IN ('1', 'true') OR COALESCE((p_res ->> 'ok')::boolean, false) IS NOT TRUE THEN RETURN p_res; END IF;
  SELECT COALESCE(jsonb_agg(r.value || jsonb_build_object(
      'pay_kind', COALESCE(q.pay_kind_txt, 'NORMAL'), 'payee_type', COALESCE(q.payee_type, 'VENDOR'),
      'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
      'buyer_title', q.buyer_title_snapshot, 'card_last4', q.pay_card_last4, 'platform', q.pay_platform)
      || CASE WHEN v_can_vendor AND q.payee_type = 'EMPLOYEE' THEN jsonb_build_object('payee_bank_name', q.payee_account_snapshot ->> 'bank_name', 'payee_bank_account', q.payee_account_snapshot ->> 'bank_account') ELSE '{}'::jsonb END
      ORDER BY r.ord), '[]'::jsonb)
    INTO v_rows
    FROM jsonb_array_elements(COALESCE(p_res -> 'data' -> 'rows', '[]'::jsonb)) WITH ORDINALITY r(value, ord)
    LEFT JOIN LATERAL (SELECT x.payee_type, x.payee_name_snapshot, x.vendor_name_snapshot, x.buyer_title_snapshot, x.pay_card_last4, x.pay_platform, 'NORMAL'::text AS pay_kind_txt
                         FROM public.ga_payment_requests x WHERE x.pr_no = r.value ->> 'pr_no') q ON true;
  RETURN jsonb_set(p_res, '{data,rows}', v_rows) || jsonb_build_object('extended', true);
END;
$f$;

-- ================================================================ 4. 同仁匯款帳戶與我的代墊款
CREATE OR REPLACE FUNCTION public.ga_ib1_payout_account_save(p_profile uuid, p_payload jsonb, p_actor uuid, p_via text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  o public.ga_employee_payout_accounts%ROWTYPE;
  v_bank text;
  v_branch text;
  v_acct text;
  v_name text;
  v_changed text[] := ARRAY[]::text[];
  v_prev text;
BEGIN
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN RETURN public.ga_rq_err(404, 'PAYEE_NOT_FOUND', '找不到這位同仁'); END IF;
  SELECT * INTO o FROM public.ga_employee_payout_accounts WHERE profile_id = p_profile FOR UPDATE;
  v_prev := CASE WHEN o.profile_id IS NOT NULL THEN right(regexp_replace(o.bank_account, '[^0-9]', '', 'g'), 4) END;
  v_bank := public.ga_pay_txt(p, 'bank_name', 60, '銀行名稱');
  v_branch := CASE WHEN p ? 'bank_branch' THEN public.ga_pay_txt(p, 'bank_branch', 60, '分行') ELSE o.bank_branch END;
  v_acct := CASE WHEN p ? 'bank_account' THEN public.ga_pay_txt(p, 'bank_account', 40, '帳號') ELSE o.bank_account END;
  v_name := CASE WHEN p ? 'bank_account_name' THEN public.ga_pay_txt(p, 'bank_account_name', 60, '戶名') ELSE o.bank_account_name END;
  IF NOT (p ? 'bank_name') THEN v_bank := o.bank_name; END IF;
  IF v_bank IS NULL OR v_acct IS NULL OR v_name IS NULL THEN RETURN public.ga_rq_err(400, 'FIELD_REQUIRED', '請填寫銀行名稱、帳號與戶名'); END IF;
  IF v_acct !~ '^[0-9 -]{6,30}$' THEN RETURN public.ga_rq_err(400, 'ACCOUNT_FORMAT', '帳號只能是數字（可含空白與連字號），長度 6 到 30 碼'); END IF;
  IF o.profile_id IS NULL THEN v_changed := ARRAY['bank_name', 'bank_branch', 'bank_account', 'bank_account_name'];
  ELSE
    IF o.bank_name IS DISTINCT FROM v_bank THEN v_changed := v_changed || 'bank_name'::text; END IF;
    IF o.bank_branch IS DISTINCT FROM v_branch THEN v_changed := v_changed || 'bank_branch'::text; END IF;
    IF o.bank_account IS DISTINCT FROM v_acct THEN v_changed := v_changed || 'bank_account'::text; END IF;
    IF o.bank_account_name IS DISTINCT FROM v_name THEN v_changed := v_changed || 'bank_account_name'::text; END IF;
  END IF;
  IF array_length(v_changed, 1) IS NOT NULL THEN
    INSERT INTO public.ga_employee_payout_accounts (profile_id, bank_name, bank_branch, bank_account, bank_account_name, updated_by, updated_at) VALUES (p_profile, v_bank, v_branch, v_acct, v_name, p_actor, clock_timestamp())
      ON CONFLICT (profile_id) DO UPDATE SET bank_name = EXCLUDED.bank_name, bank_branch = EXCLUDED.bank_branch, bank_account = EXCLUDED.bank_account, bank_account_name = EXCLUDED.bank_account_name,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
    INSERT INTO public.ga_employee_payout_account_events (profile_id, actor_id, via, changed_fields, account_last4, prev_last4) VALUES (p_profile, p_actor, p_via, v_changed, right(regexp_replace(v_acct, '[^0-9]', '', 'g'), 4), v_prev);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('changed_fields', to_jsonb(v_changed), 'account', public.ga_ib1_payee_account_snapshot(p_profile),
    'account_last4', right(regexp_replace(v_acct, '[^0-9]', '', 'g'), 4)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_payout_account_get_own() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_acc jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_acc := public.ga_ib1_payee_account_snapshot(v_uid);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('account', CASE WHEN v_acc = '{}'::jsonb THEN NULL ELSE v_acc END,
    'account_last4', CASE WHEN v_acc = '{}'::jsonb THEN NULL ELSE right(regexp_replace(v_acc ->> 'bank_account', '[^0-9]', '', 'g'), 4) END));
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_payout_account_set_own(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  RETURN public.ga_ib1_payout_account_save(v_uid, p_payload, v_uid, 'SELF');
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_payout_account_get_for(p_profile uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_acc jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT (public.ga_pay_can_manage(v_uid) AND public.ga_pay_can_vendor(v_uid)) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看同仁匯款帳戶的權限（需要請款管理與廠商帳務檢視權限）'); END IF;
  v_acc := public.ga_ib1_payee_account_snapshot(p_profile);
  -- 審查 L7：查看別人的匯款帳戶要留稽核紀錄（只記誰、看誰、末四碼，不記帳號本文）
  IF v_acc <> '{}'::jsonb AND p_profile IS DISTINCT FROM v_uid THEN
    INSERT INTO public.ga_employee_payout_account_events (profile_id, actor_id, via, changed_fields, account_last4) VALUES (p_profile, v_uid, 'VIEW', '{}', right(regexp_replace(v_acc ->> 'bank_account', '[^0-9]', '', 'g'), 4));
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('account', CASE WHEN v_acc = '{}'::jsonb THEN NULL ELSE v_acc END));
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_payout_account_set_for(p_profile uuid, p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT (public.ga_pay_can_manage(v_uid) AND public.ga_pay_can_vendor(v_uid)) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有代同仁登錄匯款帳戶的權限（需要請款管理與廠商帳務檢視權限）'); END IF;
  RETURN public.ga_ib1_payout_account_save(p_profile, p_payload, v_uid, CASE WHEN p_profile = v_uid THEN 'SELF' ELSE 'PROXY' END);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_employee_options(p_q text, p_page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_q text := nullif(btrim(COALESCE(p_q, '')), '');
  v_pat text;
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有挑選代墊同仁的權限（需要請款管理權限）'); END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(left(v_q, 50)) || '%'; END IF;
  SELECT count(*) INTO v_total FROM public.profiles p WHERE (v_pat IS NULL OR p.full_name ILIKE v_pat ESCAPE '\' OR p.employee_code ILIKE v_pat ESCAPE '\') AND public.ga_ib1_employee_active(p.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'employee_code', x.employee_code, 'department', x.department,
      'has_account', EXISTS (SELECT 1 FROM public.ga_employee_payout_accounts a WHERE a.profile_id = x.id)) ORDER BY x.full_name, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT p.id, p.full_name, p.employee_code, p.department FROM public.profiles p
           WHERE (v_pat IS NULL OR p.full_name ILIKE v_pat ESCAPE '\' OR p.employee_code ILIKE v_pat ESCAPE '\') AND public.ga_ib1_employee_active(p.id)
           ORDER BY p.full_name, p.id LIMIT 20 OFFSET (v_page - 1) * 20) x;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', 20));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

-- 我的代墊款：只回付款對象是自己、已送出以後的請款單；不含廠商帳戶與統編
CREATE OR REPLACE FUNCTION public.ga_ws_pay_my_reimbursements(p_page integer, p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 50);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  SELECT count(*) INTO v_total FROM public.ga_payment_requests q WHERE q.payee_profile_id = v_uid AND q.status <> 'DRAFT';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'pr_no', x.pr_no, 'created_at', x.created_at, 'vendor_name', x.vendor_name_snapshot, 'amount_total', x.amount_total,
      'status', x.status, 'paid_date', x.paid_date, 'source', x.source) ORDER BY x.created_at DESC, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT * FROM public.ga_payment_requests q WHERE q.payee_profile_id = v_uid AND q.status <> 'DRAFT' ORDER BY q.created_at DESC, q.id LIMIT v_size OFFSET (v_page - 1) * v_size) x;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

-- 階段 2 的延伸點重新定義（加入付款對象）
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_set_buyer(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_cur uuid;
  v_new uuid;
  v_txt text;
BEGIN
  PERFORM public.ga_ib1_pay_set_payee(p_pr, p);
  SELECT buyer_company_id INTO v_cur FROM public.ga_payment_requests WHERE id = p_pr AND status = 'DRAFT';
  IF NOT FOUND THEN RETURN; END IF;
  IF p ? 'buyer_company_id' THEN
    v_txt := nullif(btrim(COALESCE(p ->> 'buyer_company_id', '')), '');
    IF v_txt IS NOT NULL THEN
      v_new := public.ga_pay_uuid(v_txt, '買受人公司', true);
      IF NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE id = v_new AND (is_active OR id = v_cur)) THEN
        PERFORM public.ga_rq_raise(404, 'BUYER_NOT_FOUND', '找不到這家買受人公司，或已停用');
      END IF;
    ELSE
      v_new := public.ga_ib1_buyer_default_id();
    END IF;
  ELSIF v_cur IS NULL THEN
    SELECT o.buyer_company_id INTO v_new FROM public.ga_payment_request_lines l JOIN public.ga_purchase_orders o ON o.id = l.po_id WHERE l.pr_id = p_pr ORDER BY l.line_no LIMIT 1;
    IF v_new IS NULL THEN v_new := public.ga_ib1_buyer_default_id(); END IF;
  ELSE
    RETURN;
  END IF;
  IF v_new IS DISTINCT FROM v_cur THEN UPDATE public.ga_payment_requests SET buyer_company_id = v_new WHERE id = p_pr; END IF;
END;
$f$;

-- ================================================================ 既有函式加掛（讀現行定義＋文字替換；已套用就略過、形狀不符就中止）
CREATE OR REPLACE FUNCTION public.ga_ib1_nl(p_ref text, p_x text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN position(E'\r\n' IN p_ref) > 0 THEN replace(replace(p_x, E'\r\n', E'\n'), E'\n', E'\r\n') ELSE replace(p_x, E'\r\n', E'\n') END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  IF position(p_old IN substr(p_text, position(p_old IN p_text) + 1)) > 0 THEN RAISE EXCEPTION '函式形狀與預期不符，要替換的文字出現不只一次（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  v_out := (v_out - 'payee_account_snapshot') || public.ga_ib1_pay_json_ext(q.id, p_vendor, p_detail); -- GAIB1-S4
  RETURN v_out;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  RETURN v_out;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  v_out := (v_out - 'payee_account_snapshot') || public.ga_ib1_pay_json_ext(q.id, p_vendor, p_detail); -- GAIB1-S4
  RETURN v_out;$ib1n$), 'public.ga_pay_request_json(uuid,boolean,boolean,boolean) 付款對象輸出');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'ONLINE_PLATFORM') /* GAIB1-S4 */ THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金或支票，或是信用卡、網購平台／第三方支付'); END IF;
    PERFORM public.ga_ib1_check_pay_fields(v_method, p); -- GAIB1-S4$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK') THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金或支票'); END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'ONLINE_PLATFORM') /* GAIB1-S4 */ THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金或支票，或是信用卡、網購平台／第三方支付'); END IF;
    PERFORM public.ga_ib1_check_pay_fields(v_method, p); -- GAIB1-S4$ib1n$), 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 付款方式');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, pay_card_last4 = CASE WHEN v_method = 'CREDIT_CARD' THEN nullif(btrim(COALESCE(p ->> 'card_last4', '')), '') END, pay_platform = CASE WHEN v_method = 'ONLINE_PLATFORM' THEN nullif(btrim(COALESCE(p ->> 'platform', '')), '') END, /* GAIB1-S4 */ paid_date = v_paid,$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, paid_date = v_paid,$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, pay_card_last4 = CASE WHEN v_method = 'CREDIT_CARD' THEN nullif(btrim(COALESCE(p ->> 'card_last4', '')), '') END, pay_platform = CASE WHEN v_method = 'ONLINE_PLATFORM' THEN nullif(btrim(COALESCE(p ->> 'platform', '')), '') END, /* GAIB1-S4 */ paid_date = v_paid,$ib1n$), 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 付款欄位');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', payee_account_snapshot = CASE WHEN q.payee_type = 'EMPLOYEE' THEN public.ga_ib1_payee_account_snapshot(q.payee_profile_id) ELSE q.payee_account_snapshot END /* GAIB1-S4 */, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', payee_account_snapshot = CASE WHEN q.payee_type = 'EMPLOYEE' THEN public.ga_ib1_payee_account_snapshot(q.payee_profile_id) ELSE q.payee_account_snapshot END /* GAIB1-S4 */, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$), 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 重抓同仁帳戶');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_request_list(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$       AND public.ga_ib1_pay_filter_ok(q.id, v_f) -- GAIB1-S4
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$       AND public.ga_ib1_pay_filter_ok(q.id, v_f) -- GAIB1-S4
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),$ib1n$), 'public.ga_ws_pay_request_list(jsonb,integer,integer) 付款對象篩選');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_export(jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$THEN RETURN public.ga_ib1_export_enrich(public.ga_ws_pay_export_ub(v_f), v_f, v_uid); /* GAIB1-S4 */ END IF;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$THEN RETURN public.ga_ws_pay_export_ub(v_f); END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$THEN RETURN public.ga_ib1_export_enrich(public.ga_ws_pay_export_ub(v_f), v_f, v_uid); /* GAIB1-S4 */ END IF;$ib1n$), 'public.ga_ws_pay_export(jsonb) 水電匯出');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  RETURN public.ga_ib1_export_enrich(jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor)), v_f, v_uid); -- GAIB1-S4$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor));$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  RETURN public.ga_ib1_export_enrich(jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor)), v_f, v_uid); -- GAIB1-S4$ib1n$), 'public.ga_ws_pay_export(jsonb) 採購匯出');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

-- ================================================================ 5. 權限：對外函式只給登入者；內部輔助與觸發器函式不開放（不授權給任何角色）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ws_payout_account_get_own', 'ga_ws_payout_account_set_own', 'ga_ws_payout_account_get_for', 'ga_ws_payout_account_set_for',
                                                         'ga_ws_pay_employee_options', 'ga_ws_pay_my_reimbursements') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ib1_employee_active', 'ga_ib1_payee_account_snapshot', 'ga_ib1_pay_set_payee', 'ga_ib1_check_pay_fields', 'ga_ib1_payee_guard',
                                                         'ga_ib1_pay_json_ext', 'ga_ib1_pay_filter_ok', 'ga_ib1_export_enrich', 'ga_ib1_payout_account_save', 'ga_ib1_pay_set_buyer') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
