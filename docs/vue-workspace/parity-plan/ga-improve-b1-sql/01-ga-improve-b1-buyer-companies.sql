-- 正式區草稿 ga-improve-b1-sql/01-ga-improve-b1-buyer-companies.sql（G11 多家買受人公司）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125100000_ga_improve_b1_buyer_companies.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 01-ga-improve-b1-buyer-companies.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 總務採購與請款改善第一批（ga-improve-b1）階段 2：G11 多家買受人公司（DEV；正式區草稿 ga-improve-b1-sql/01 內容相同）。
-- 內容：
--   1. 資料表：ga_buyer_companies（名稱＋統編，預設至多一家、統編在啟用中不重複）、ga_buyer_company_events（不可修改刪除）；
--      ga_purchase_orders 加 buyer_company_id；ga_payment_requests 加 buyer_company_id、buyer_title_snapshot、buyer_tax_id_snapshot（皆可為空，既有資料不重寫）。
--   2. 搬移：既有設定 pay_buyer_title／pay_buyer_tax_id 兩者都有且統編為 8 碼時，轉成預設公司；其他情況不搬移（由總務補齊後手動新增）。原三個設定鍵保留並雙寫。
--   3. 對外函式：ga_ws_buyer_company_list／save／set_default／deactivate；內部：ga_ib1_pay_set_buyer、ga_ib1_pay_buyer、送出凍結抬頭快照觸發器。
--   4. 既有函式加掛（GAIB1-S2 標記，撤回時逐字還原）：ga_ws_pay_settings_get／set（設定讀寫相容）、ga_ws_pay_request_get（買受人解析）、ga_ws_pay_invoice_save（統編核對多公司）、
--      ga_po_header_apply／ga_po_data（採購單抬頭）、ga_ws_pay_request_create／update、ga_ws_pay_ub_create／update（請款單抬頭）。
-- 不新增權限碼、不授權給任何角色。可重複執行。先決：第 4.5 批請款單、G25 採購單、G46 水電請款。
-- 還原：20261125100000_ga_improve_b1_buyer_companies.rollback.sql（已有單據引用公司時中止）。
DO $$
BEGIN
  IF to_regclass('public.ga_payment_requests') IS NULL OR to_regclass('public.ga_purchase_orders') IS NULL OR to_regclass('public.ga_workflow_settings') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 請款單、採購單與設定表';
  END IF;
  IF to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NULL OR to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 第 4.5 批請款單函式';
  END IF;
  IF to_regclass('public.ga_payment_request_bill_lines') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: 請先套用 G46 水電請款（20261124100000 至 130000）'; END IF;
END $$;

-- ================================================================ 1. 資料表
CREATE TABLE IF NOT EXISTS public.ga_buyer_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tax_id text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ga_buyer_companies_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT ga_buyer_companies_tax_check CHECK (tax_id ~ '^[0-9]{8}$'),
  CONSTRAINT ga_buyer_companies_default_check CHECK (NOT is_default OR is_active)
);
CREATE UNIQUE INDEX IF NOT EXISTS ga_buyer_companies_tax_active_uidx ON public.ga_buyer_companies (tax_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS ga_buyer_companies_default_uidx ON public.ga_buyer_companies ((true)) WHERE is_default AND is_active;

CREATE TABLE IF NOT EXISTS public.ga_buyer_company_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.ga_buyer_companies(id),
  event_type text NOT NULL,
  actor_id uuid,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_buyer_company_events_type_check CHECK (event_type IN ('create', 'update', 'set_default', 'deactivate', 'activate', 'migrate'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ga_buyer_company_events_idem_uidx ON public.ga_buyer_company_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga_buyer_company_events_company ON public.ga_buyer_company_events (company_id, created_at);

CREATE OR REPLACE FUNCTION public.ga_ib1_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION '操作紀錄不可修改或刪除' USING ERRCODE = 'GA045';
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_buyer_company_events_immutable ON public.ga_buyer_company_events;
CREATE TRIGGER trg_ga_buyer_company_events_immutable BEFORE UPDATE OR DELETE ON public.ga_buyer_company_events FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_events_immutable();

ALTER TABLE public.ga_buyer_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_buyer_company_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_buyer_companies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ga_buyer_company_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_buyer_companies TO service_role;
GRANT ALL ON public.ga_buyer_company_events TO service_role;

ALTER TABLE public.ga_purchase_orders ADD COLUMN IF NOT EXISTS buyer_company_id uuid REFERENCES public.ga_buyer_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS buyer_company_id uuid REFERENCES public.ga_buyer_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS buyer_title_snapshot text;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS buyer_tax_id_snapshot text;
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_buyer_company ON public.ga_purchase_orders (buyer_company_id) WHERE buyer_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga_payment_requests_buyer_company ON public.ga_payment_requests (buyer_company_id) WHERE buyer_company_id IS NOT NULL;

-- ================================================================ 2. 內部輔助
CREATE OR REPLACE FUNCTION public.ga_ib1_buyer_default_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT id FROM public.ga_buyer_companies WHERE is_default AND is_active LIMIT 1; $f$;

-- 預設公司的內容寫回舊設定鍵（雙寫，供舊版畫面與回退使用）
CREATE OR REPLACE FUNCTION public.ga_ib1_buyer_sync_settings(p_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  c public.ga_buyer_companies%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.ga_buyer_companies WHERE is_default AND is_active LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.ga_workflow_settings (key, value_text, updated_by, updated_at) VALUES ('pay_buyer_title', c.name, p_uid, clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  INSERT INTO public.ga_workflow_settings (key, value_text, updated_by, updated_at) VALUES ('pay_buyer_tax_id', c.tax_id, p_uid, clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$f$;

-- 舊設定寫入後，把兩個值都合格的設定轉成（或更新成）預設公司；舊畫面把抬頭或統編清掉就停用預設公司
CREATE OR REPLACE FUNCTION public.ga_ib1_buyer_from_settings(p_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_title text;
  v_tax text;
  v_id uuid;
BEGIN
  SELECT btrim(value_text) INTO v_title FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title';
  SELECT btrim(value_text) INTO v_tax FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id';
  IF COALESCE(v_title, '') = '' OR v_tax IS NULL OR v_tax !~ '^[0-9]{8}$' THEN
    -- 舊畫面把抬頭或統編清掉：視為不再設定預設買受人，停用預設公司（舊設定鍵是舊畫面的真相；公司與事件保留）
    SELECT id INTO v_id FROM public.ga_buyer_companies WHERE is_default AND is_active;
    IF v_id IS NOT NULL THEN
      UPDATE public.ga_buyer_companies SET is_active = false, is_default = false, updated_by = p_uid, updated_at = clock_timestamp() WHERE id = v_id;
      INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, payload) VALUES (v_id, 'deactivate', p_uid, jsonb_build_object('via', 'settings'));
    END IF;
    RETURN;
  END IF;
  SELECT id INTO v_id FROM public.ga_buyer_companies WHERE is_default AND is_active;
  IF v_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE id = v_id AND (name IS DISTINCT FROM v_title OR tax_id IS DISTINCT FROM v_tax)) THEN
      UPDATE public.ga_buyer_companies SET name = v_title, tax_id = v_tax, updated_by = p_uid, updated_at = clock_timestamp() WHERE id = v_id;
      INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, payload) VALUES (v_id, 'update', p_uid, jsonb_build_object('via', 'settings'));
    END IF;
  ELSE
    SELECT id INTO v_id FROM public.ga_buyer_companies WHERE tax_id = v_tax AND is_active;
    IF v_id IS NOT NULL THEN
      UPDATE public.ga_buyer_companies SET name = v_title, is_default = true, updated_by = p_uid, updated_at = clock_timestamp() WHERE id = v_id;
    ELSE
      INSERT INTO public.ga_buyer_companies (name, tax_id, is_default, created_by, updated_by) VALUES (v_title, v_tax, true, p_uid, p_uid) RETURNING id INTO v_id;
    END IF;
    INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, payload) VALUES (v_id, 'update', p_uid, jsonb_build_object('via', 'settings', 'set_default', true));
  END IF;
END;
$f$;

-- 請款單的買受人（快照 → 所選公司 → 設定值）
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_buyer(p_pr uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  c public.ga_buyer_companies%ROWTYPE;
  v_title text;
  v_tax text;
BEGIN
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr;
  IF q.buyer_title_snapshot IS NOT NULL OR q.buyer_tax_id_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object('title', q.buyer_title_snapshot, 'tax_id', q.buyer_tax_id_snapshot, 'company_id', q.buyer_company_id, 'source', 'SNAPSHOT');
  END IF;
  IF q.buyer_company_id IS NOT NULL THEN
    SELECT * INTO c FROM public.ga_buyer_companies WHERE id = q.buyer_company_id;
    IF FOUND THEN RETURN jsonb_build_object('title', c.name, 'tax_id', c.tax_id, 'company_id', c.id, 'source', 'COMPANY'); END IF;
  END IF;
  SELECT value_text INTO v_title FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title';
  SELECT value_text INTO v_tax FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id';
  RETURN jsonb_build_object('title', v_title, 'tax_id', v_tax, 'company_id', NULL, 'source', 'SETTINGS');
END;
$f$;

-- 請款單草稿的抬頭：payload 有 buyer_company_id 就用（null＝改回預設）；沒帶且目前沒有抬頭就取第一條明細的採購單公司，再沒有取預設公司
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_set_buyer(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_cur uuid;
  v_new uuid;
  v_txt text;
BEGIN
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

-- 採購單抬頭（建立與草稿修改）：header 有 buyer_company_id 就用；新單沒帶就取預設公司（由觸發器處理）
CREATE OR REPLACE FUNCTION public.ga_ib1_po_header_ext(p_po_id uuid, p_header jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_txt text;
  v_id uuid;
  v_cur uuid;
BEGIN
  IF p_header ? 'buyer_company_id' THEN
    SELECT buyer_company_id INTO v_cur FROM public.ga_purchase_orders WHERE id = p_po_id;
    v_txt := nullif(btrim(COALESCE(p_header ->> 'buyer_company_id', '')), '');
    IF v_txt IS NULL THEN
      v_id := public.ga_ib1_buyer_default_id();
    ELSE
      IF v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM public.ga_po_raise(400, 'INVALID_BUYER', '買受人公司格式錯誤'); END IF;
      v_id := v_txt::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE id = v_id AND (is_active OR id = v_cur)) THEN PERFORM public.ga_po_raise(404, 'BUYER_NOT_FOUND', '找不到這家買受人公司，或已停用'); END IF;
    END IF;
    UPDATE public.ga_purchase_orders SET buyer_company_id = v_id WHERE id = p_po_id AND buyer_company_id IS DISTINCT FROM v_id;
  END IF;
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ib1_po_data_ext(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object('buyer_company_name', c.name, 'buyer_company_tax_id', c.tax_id)
    FROM public.ga_purchase_orders o LEFT JOIN public.ga_buyer_companies c ON c.id = o.buyer_company_id WHERE o.id = p_id;
$f$;

-- 採購單新增時沒有指定抬頭就取預設公司
CREATE OR REPLACE FUNCTION public.ga_ib1_po_buyer_default() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  IF NEW.buyer_company_id IS NULL THEN NEW.buyer_company_id := public.ga_ib1_buyer_default_id(); END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_ib1_po_buyer_default ON public.ga_purchase_orders;
CREATE TRIGGER trg_ga_ib1_po_buyer_default BEFORE INSERT ON public.ga_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_po_buyer_default();

-- 請款單送出時凍結抬頭快照；送出後抬頭不可改
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_buyer_freeze() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  c public.ga_buyer_companies%ROWTYPE;
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN
    SELECT * INTO c FROM public.ga_buyer_companies WHERE id = COALESCE(NEW.buyer_company_id, public.ga_ib1_buyer_default_id());
    IF FOUND THEN
      NEW.buyer_company_id := c.id; NEW.buyer_title_snapshot := c.name; NEW.buyer_tax_id_snapshot := c.tax_id;
    ELSE
      SELECT value_text INTO NEW.buyer_title_snapshot FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title';
      SELECT value_text INTO NEW.buyer_tax_id_snapshot FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id';
    END IF;
  ELSIF OLD.status <> 'DRAFT' AND (NEW.buyer_company_id, NEW.buyer_title_snapshot, NEW.buyer_tax_id_snapshot) IS DISTINCT FROM (OLD.buyer_company_id, OLD.buyer_title_snapshot, OLD.buyer_tax_id_snapshot) THEN
    IF NOT (OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT') THEN RAISE EXCEPTION '已送出或已付款的請款單，買受人抬頭不能修改' USING ERRCODE = 'GA045'; END IF;
  END IF;
  -- 退回草稿：清掉快照，之後依選擇的公司重新凍結
  IF OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT' THEN NEW.buyer_title_snapshot := NULL; NEW.buyer_tax_id_snapshot := NULL; END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_ib1_pay_buyer_freeze ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_ib1_pay_buyer_freeze BEFORE UPDATE ON public.ga_payment_requests FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_pay_buyer_freeze();

-- ================================================================ 3. 對外函式
CREATE OR REPLACE FUNCTION public.ga_ib1_buyer_rows() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'tax_id', c.tax_id, 'is_default', c.is_default, 'is_active', c.is_active,
      'sort_order', c.sort_order, 'updated_at', c.updated_at,
      'usage_count', (SELECT count(*) FROM public.ga_purchase_orders o WHERE o.buyer_company_id = c.id) + (SELECT count(*) FROM public.ga_payment_requests q WHERE q.buyer_company_id = c.id))
      ORDER BY c.is_active DESC, c.is_default DESC, c.sort_order, c.created_at), '[]'::jsonb),
    'updated_at', (SELECT max(updated_at) FROM public.ga_buyer_companies))
    FROM public.ga_buyer_companies c;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_buyer_company_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT (public.ga_pay_can_view(v_uid) OR public.ga_po_can_view(v_uid)) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看買受人公司的權限'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ib1_buyer_rows() || jsonb_build_object('can_edit', public.ga_pay_can_manage(v_uid)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_buyer_company_save(p_payload jsonb, p_key text, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  c public.ga_buyer_companies%ROWTYPE;
  v_id uuid;
  v_name text;
  v_tax text;
  v_default boolean;
  v_active boolean;
  v_sort integer;
  v_ev uuid;
  v_new boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有調整買受人公司的權限（需要請款管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_buyer_companies', 0));
  SELECT e.company_id INTO v_ev FROM public.ga_buyer_company_events e WHERE e.idempotency_key = v_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_ib1_buyer_rows() || jsonb_build_object('id', v_ev)); END IF;
  v_new := NOT (p ? 'id') OR nullif(btrim(COALESCE(p ->> 'id', '')), '') IS NULL;
  v_name := public.ga_pay_txt(p, 'name', 100, '公司名稱');
  v_tax := public.ga_pay_norm_tax(public.ga_pay_txt(p, 'tax_id', 20, '統一編號'));
  IF v_name IS NULL AND (v_new OR p ? 'name') THEN RETURN public.ga_rq_err(400, 'FIELD_REQUIRED', '請填寫公司名稱'); END IF;
  IF v_new THEN
    IF v_tax IS NULL OR v_tax !~ '^[0-9]{8}$' THEN RETURN public.ga_rq_err(400, 'TAX_ID_FORMAT', '統一編號要是 8 碼數字'); END IF;
    IF EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE tax_id = v_tax AND is_active) THEN RETURN public.ga_rq_err(409, 'DUPLICATE_TAX_ID', '已有啟用中的公司使用這個統一編號'); END IF;
    v_default := COALESCE((p ->> 'is_default')::boolean, false) OR NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE is_default AND is_active);
    v_sort := COALESCE((p ->> 'sort_order')::integer, 0);
    IF v_default THEN UPDATE public.ga_buyer_companies SET is_default = false, updated_by = v_uid, updated_at = clock_timestamp() WHERE is_default; END IF;
    INSERT INTO public.ga_buyer_companies (name, tax_id, is_default, sort_order, created_by, updated_by) VALUES (v_name, v_tax, v_default, v_sort, v_uid, v_uid) RETURNING id INTO v_id;
    INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, idempotency_key, payload) VALUES (v_id, 'create', v_uid, v_key, jsonb_build_object('name', v_name, 'tax_id', v_tax, 'is_default', v_default));
  ELSE
    v_id := public.ga_pay_uuid(p ->> 'id', '買受人公司', true);
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
    SELECT * INTO c FROM public.ga_buyer_companies WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這家買受人公司'); END IF;
    IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這家公司剛被其他人修改，請重新載入後再操作'); END IF;
    v_name := COALESCE(v_name, c.name);
    v_tax := CASE WHEN p ? 'tax_id' THEN v_tax ELSE c.tax_id END;
    IF v_tax IS NULL OR v_tax !~ '^[0-9]{8}$' THEN RETURN public.ga_rq_err(400, 'TAX_ID_FORMAT', '統一編號要是 8 碼數字'); END IF;
    v_active := c.is_active;
    IF p ? 'is_active' THEN v_active := COALESCE((p ->> 'is_active')::boolean, c.is_active); END IF;
    IF v_active AND EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE tax_id = v_tax AND is_active AND id <> v_id) THEN RETURN public.ga_rq_err(409, 'DUPLICATE_TAX_ID', '已有啟用中的公司使用這個統一編號'); END IF;
    IF NOT v_active AND c.is_default AND EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE is_active AND id <> v_id) THEN RETURN public.ga_rq_err(409, 'DEFAULT_REQUIRED', '預設公司不能直接停用，請先指定其他公司為預設'); END IF;
    v_sort := COALESCE((p ->> 'sort_order')::integer, c.sort_order);
    v_default := c.is_default AND v_active;
    IF p ? 'is_default' AND COALESCE((p ->> 'is_default')::boolean, false) AND v_active THEN
      UPDATE public.ga_buyer_companies SET is_default = false, updated_by = v_uid, updated_at = clock_timestamp() WHERE is_default AND id <> v_id;
      v_default := true;
    END IF;
    UPDATE public.ga_buyer_companies SET name = v_name, tax_id = v_tax, is_active = v_active, is_default = v_default, sort_order = v_sort, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = v_id;
    INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, idempotency_key, payload)
      VALUES (v_id, CASE WHEN v_active AND NOT c.is_active THEN 'activate' ELSE 'update' END, v_uid, v_key, jsonb_build_object('name', v_name, 'tax_id', v_tax, 'is_default', v_default, 'is_active', v_active));
  END IF;
  PERFORM public.ga_ib1_buyer_sync_settings(v_uid);
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'replay', false, 'data', public.ga_ib1_buyer_rows() || jsonb_build_object('id', v_id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_buyer_company_set_default(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  c public.ga_buyer_companies%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有調整買受人公司的權限（需要請款管理權限）'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_buyer_companies', 0));
  SELECT * INTO c FROM public.ga_buyer_companies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這家買受人公司'); END IF;
  IF NOT c.is_active THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已停用的公司不能設為預設'); END IF;
  IF NOT c.is_default THEN
    UPDATE public.ga_buyer_companies SET is_default = false, updated_by = v_uid, updated_at = clock_timestamp() WHERE is_default;
    UPDATE public.ga_buyer_companies SET is_default = true, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = p_id;
    INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, payload) VALUES (p_id, 'set_default', v_uid, '{}'::jsonb);
    PERFORM public.ga_ib1_buyer_sync_settings(v_uid);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ib1_buyer_rows() || jsonb_build_object('id', p_id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_buyer_company_deactivate(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  c public.ga_buyer_companies%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有調整買受人公司的權限（需要請款管理權限）'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_buyer_companies', 0));
  SELECT * INTO c FROM public.ga_buyer_companies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這家買受人公司'); END IF;
  IF NOT c.is_active THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '這家公司已經停用'); END IF;
  IF c.is_default AND EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE is_active AND id <> p_id) THEN RETURN public.ga_rq_err(409, 'DEFAULT_REQUIRED', '預設公司不能直接停用，請先指定其他公司為預設'); END IF;
  UPDATE public.ga_buyer_companies SET is_active = false, is_default = false, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = p_id;
  INSERT INTO public.ga_buyer_company_events (company_id, event_type, actor_id, payload) VALUES (p_id, 'deactivate', v_uid, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ib1_buyer_rows() || jsonb_build_object('id', p_id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

-- ================================================================ 4. 搬移既有設定（兩個值都有且統編為 8 碼才搬；已有公司就不動）
DO $mig$
DECLARE
  v_title text;
  v_tax text;
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ga_buyer_companies) THEN RETURN; END IF;
  SELECT btrim(value_text) INTO v_title FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title';
  SELECT btrim(value_text) INTO v_tax FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id';
  IF COALESCE(v_title, '') <> '' AND v_tax ~ '^[0-9]{8}$' THEN
    INSERT INTO public.ga_buyer_companies (name, tax_id, is_default) VALUES (left(v_title, 100), v_tax, true) RETURNING id INTO v_id;
    INSERT INTO public.ga_buyer_company_events (company_id, event_type, payload) VALUES (v_id, 'migrate', jsonb_build_object('from', 'ga_workflow_settings'));
  END IF;
END $mig$;

-- ================================================================ 6. 既有函式加掛（讀現行定義＋文字替換；已套用就略過、形狀不符就中止）
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
  v_def := pg_get_functiondef('public.ga_ws_pay_settings_get()'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer_title', COALESCE((SELECT c.name FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title')),
    'buyer_tax_id', COALESCE((SELECT c.tax_id FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')),$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    'buyer_title', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title'),
    'buyer_tax_id', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id'),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer_title', COALESCE((SELECT c.name FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title')),
    'buyer_tax_id', COALESCE((SELECT c.tax_id FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')),$ib1n$), 'public.ga_ws_pay_settings_get() 買受人讀取');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_settings_set(jsonb,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  -- GAIB1-S2
  IF v_vals ? 'buyer_title' OR v_vals ? 'buyer_tax_id' THEN PERFORM public.ga_ib1_buyer_from_settings(v_uid); END IF;
  RETURN public.ga_ws_pay_settings_get();$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  RETURN public.ga_ws_pay_settings_get();$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  -- GAIB1-S2
  IF v_vals ? 'buyer_title' OR v_vals ? 'buyer_tax_id' THEN PERFORM public.ga_ib1_buyer_from_settings(v_uid); END IF;
  RETURN public.ga_ws_pay_settings_get();$ib1n$), 'public.ga_ws_pay_settings_set(jsonb,timestamp with time zone) 寫入後同步公司');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_request_get(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer', public.ga_ib1_pay_buyer(p_id));$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    'buyer', jsonb_build_object('title', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title'), 'tax_id', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')));$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer', public.ga_ib1_pay_buyer(p_id));$ib1n$), 'public.ga_ws_pay_request_get(uuid) 買受人解析');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$AND v_buyer <> v_buyer_cfg AND NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies bc WHERE bc.is_active AND bc.tax_id = v_buyer) /* GAIB1-S2 */ THEN v_mismatch := true; END IF;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$AND v_buyer <> v_buyer_cfg THEN v_mismatch := true; END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$AND v_buyer <> v_buyer_cfg AND NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies bc WHERE bc.is_active AND bc.tax_id = v_buyer) /* GAIB1-S2 */ THEN v_mismatch := true; END IF;$ib1n$), 'public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone) 統編核對多公司');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_po_header_apply(uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;
  -- GAIB1-S2
  PERFORM public.ga_ib1_po_header_ext(p_po_id, p_header);$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;
  -- GAIB1-S2
  PERFORM public.ga_ib1_po_header_ext(p_po_id, p_header);$ib1n$), 'public.ga_po_header_apply(uuid,jsonb) 採購單抬頭');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_po_data(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  RETURN v_obj || public.ga_ib1_po_data_ext(p_id) /* GAIB1-S2 */ || jsonb_build_object('items', v_items, 'events', v_events);$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  RETURN v_obj || jsonb_build_object('items', v_items, 'events', v_events);$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  RETURN v_obj || public.ga_ib1_po_data_ext(p_id) /* GAIB1-S2 */ || jsonb_build_object('items', v_items, 'events', v_events);$ib1n$), 'public.ga_po_data(uuid) 採購單輸出');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_request_create(jsonb,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$), 'public.ga_ws_pay_request_create(jsonb,text) 請款單抬頭');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$), 'public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone) 請款單抬頭');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_ub_create(jsonb,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$), 'public.ga_ws_pay_ub_create(jsonb,text) 水電單抬頭');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$), 'public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone) 水電單抬頭');
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
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ws_buyer_company_list', 'ga_ws_buyer_company_save', 'ga_ws_buyer_company_set_default', 'ga_ws_buyer_company_deactivate') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ib1_events_immutable', 'ga_ib1_buyer_default_id', 'ga_ib1_buyer_sync_settings', 'ga_ib1_buyer_from_settings', 'ga_ib1_pay_buyer', 'ga_ib1_pay_set_buyer',
                                                         'ga_ib1_po_header_ext', 'ga_ib1_po_data_ext', 'ga_ib1_po_buyer_default', 'ga_ib1_pay_buyer_freeze', 'ga_ib1_buyer_rows') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
