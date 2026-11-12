-- 33-b4-purchase-orders.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261112110000_m7m8_b4_purchase_orders.sql 相同。
-- 第 4 批 B（採購單、核准、單號、歷史價；D1、D2、D3、D6 至 D11）（2026-11-12 第 4 批問卷 D1 至 D21）。
-- 性質：會寫入，新增 3 張表（採購單、品項、事件紀錄）、1 個權限碼 general_affairs.purchase_order.approve（採購核准，不指派給任何角色）、2 個觸發器（採購單更新時間、事件表不可改刪）與 ga_ws_po_* 函式；另新增庫存流水表的觸發器 trg_ga_inventory_transactions_block_legacy_po_receipt：
--   舊版需求單「採購到貨入庫」（參考單據 GA_PURCHASE_REVIEW）遇到「評估已有未取消的新版採購單」時，資料庫層擋下，避免新舊並存時雙記庫存；沒有新版採購單的評估不受影響。這是對舊版也生效的唯一一項。
-- 三張表登入者不能直接讀寫（供應商統編、付款條件快照屬帳務欄位，要依權限遮蔽），一律走函式。
-- 重點規則：含稅總額「大於」門檻（預設 5000 元，剛好 5000 免核准）才需系統內核准；核准人需有「採購核准」權限、不可是開單人也不可是最後送核准的人、管理員不繞過；
--   開單、下訂、取消、短收結案、結案需要「採購評估管理」「庫存交易管理」「料件查看」三個權限（缺哪個講清楚）；供應商必須是合作中（status = active）的既有廠商，下訂時複製名稱、統編、付款條件快照；
--   下訂後品項、數量、單價鎖定；需求單的所有未取消採購單加總超過需求量要填超量原因；歷史價只算已下訂以上。
-- 套用後要做：到「角色權限」頁，替要擔任核決的角色勾選「採購核准」（可多個角色；建議至少兩位核准人，或讓核准人不開單）。詳見 README「第 4 批」。
-- 先決條件：先套 32（設定表）；ga_vendors 有 status、tax_id、payment_terms 欄位；庫存位置有預設的中央倉庫（沒有也能用，開單時手動選收貨位置）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：33-b4-purchase-orders-rollback.sql。套用前先跑 31-b4-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_vendors') IS NULL OR to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.ga_purchase_reviews') IS NULL
     OR to_regclass('public.ga_parts') IS NULL OR to_regclass('public.ga_inventory_locations') IS NULL OR to_regclass('public.ga_inventory_transactions') IS NULL
     OR to_regclass('public.stores') IS NULL OR to_regclass('public.ga_equipment_templates') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 採購單需要的既有資料表（ga_vendors／ga_service_requests／ga_purchase_reviews／ga_parts／ga_inventory_locations／ga_inventory_transactions／stores／ga_equipment_templates／profiles／permissions）';
  END IF;
  IF to_regclass('public.ga_workflow_settings') IS NULL OR to_regclass('public.ga_workflow_setting_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_workflow_settings（請先套 20261112100000_m7m8_b4_request_rules）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'has_permission')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_normalize_optional_text') THEN
    RAISE EXCEPTION 'Missing prerequisite function (has_permission / ga_normalize_optional_text)';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 權限碼（只新增，不指派給任何角色）
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES ('general_affairs', 'purchase_order', 'general_affairs.purchase_order.approve', 'approve',
        '採購核准：核准或駁回超過核決金額的採購單，並可調整核准門檻與稅率（核准人不可核准自己開立或送出的採購單）', true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------- 2. 資料表
CREATE TABLE IF NOT EXISTS public.ga_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  vendor_id uuid REFERENCES public.ga_vendors(id),
  vendor_name_snapshot text,
  vendor_tax_id_snapshot text,
  vendor_payment_terms_snapshot text,
  source_request_id uuid REFERENCES public.ga_service_requests(id),
  purchase_review_id uuid REFERENCES public.ga_purchase_reviews(id),
  receiving_location_id uuid REFERENCES public.ga_inventory_locations(id),
  expected_delivery_date date,
  tax_rate numeric(6,4) NOT NULL DEFAULT 0.05,
  subtotal numeric(14,0) NOT NULL DEFAULT 0,
  tax_amount numeric(14,0) NOT NULL DEFAULT 0,
  total_amount numeric(14,0) NOT NULL DEFAULT 0,
  approval_required boolean NOT NULL DEFAULT false,
  approval_threshold_snapshot numeric(14,0),
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approval_note text,
  last_reject_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_reject_at timestamptz,
  last_reject_reason text,
  ordered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ordered_at timestamptz,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at timestamptz,
  canceled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  canceled_at timestamptz,
  cancel_reason text,
  short_close_reason text,
  notes text,
  create_key text,
  create_hash text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_purchase_orders_po_no_key UNIQUE (po_no),
  CONSTRAINT ga_purchase_orders_status_check CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELED')),
  CONSTRAINT ga_purchase_orders_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 0.3),
  CONSTRAINT ga_purchase_orders_amounts_check CHECK (subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_status ON public.ga_purchase_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_vendor ON public.ga_purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_request ON public.ga_purchase_orders (source_request_id);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_review ON public.ga_purchase_orders (purchase_review_id);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_created_by ON public.ga_purchase_orders (created_by);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_purchase_orders_create_key ON public.ga_purchase_orders (created_by, create_key) WHERE create_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ga_purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.ga_purchase_orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  part_id uuid REFERENCES public.ga_parts(id),
  item_name text NOT NULL,
  spec text,
  unit text NOT NULL,
  quantity numeric(14,4) NOT NULL,
  quantity_base numeric(14,4) NOT NULL,
  unit_price numeric(14,4) NOT NULL DEFAULT 0,
  line_amount numeric(14,0) NOT NULL DEFAULT 0,
  request_id uuid REFERENCES public.ga_service_requests(id),
  fulfil_mode text NOT NULL DEFAULT 'STOCK',
  target_store_id uuid REFERENCES public.stores(id),
  equipment_template_id uuid REFERENCES public.ga_equipment_templates(id),
  over_request_reason text,
  received_qty numeric(14,4) NOT NULL DEFAULT 0,
  dispatched_qty numeric(14,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_purchase_order_items_line_key UNIQUE (po_id, line_no),
  CONSTRAINT ga_purchase_order_items_name_check CHECK (btrim(item_name) <> ''),
  CONSTRAINT ga_purchase_order_items_qty_check CHECK (quantity > 0 AND quantity_base > 0 AND unit_price >= 0 AND line_amount >= 0 AND received_qty >= 0 AND dispatched_qty >= 0),
  CONSTRAINT ga_purchase_order_items_mode_check CHECK (fulfil_mode IN ('STOCK', 'DIRECT_ASSET', 'NO_STOCK')),
  CONSTRAINT ga_purchase_order_items_stock_part_check CHECK (fulfil_mode <> 'STOCK' OR part_id IS NOT NULL),
  CONSTRAINT ga_purchase_order_items_direct_store_check CHECK (fulfil_mode <> 'DIRECT_ASSET' OR target_store_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_order_items_po ON public.ga_purchase_order_items (po_id, line_no);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_order_items_part ON public.ga_purchase_order_items (part_id);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_order_items_request ON public.ga_purchase_order_items (request_id);

CREATE TABLE IF NOT EXISTS public.ga_purchase_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.ga_purchase_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ga_purchase_order_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_order_events_po ON public.ga_purchase_order_events (po_id, created_at, id);

-- 三張表不開放登入者直接讀寫（帳務欄位要依權限遮蔽）：RLS 開啟且沒有任何政策，只有 service_role 與 SECURITY DEFINER 函式能存取。
ALTER TABLE public.ga_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_purchase_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_purchase_orders, public.ga_purchase_order_items, public.ga_purchase_order_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_purchase_orders, public.ga_purchase_order_items, public.ga_purchase_order_events TO service_role;

-- 每次更新都換新的 updated_at（版本檢查用）。
CREATE OR REPLACE FUNCTION public.ga_po_touch() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_ga_purchase_orders_touch ON public.ga_purchase_orders;
CREATE TRIGGER trg_ga_purchase_orders_touch BEFORE UPDATE ON public.ga_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.ga_po_touch();

-- 事件表不可改刪：唯一例外是「帳號被刪除時把 actor_id 設為空白」（外鍵 SET NULL）。
CREATE OR REPLACE FUNCTION public.ga_po_events_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PO_EVENTS_IMMUTABLE: 採購單事件紀錄不可修改或刪除' USING ERRCODE = 'GA002';
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_po_events_immutable ON public.ga_purchase_order_events;
CREATE TRIGGER trg_ga_po_events_immutable BEFORE UPDATE OR DELETE ON public.ga_purchase_order_events FOR EACH ROW EXECUTE FUNCTION public.ga_po_events_immutable();

-- ---------------------------------------------------------------- 3. 內部輔助（不開放給前端直接呼叫）
CREATE OR REPLACE FUNCTION public.ga_po_err(p_status integer, p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT jsonb_build_object('ok', false, 'status', p_status, 'code', p_code, 'error', p_message) || COALESCE(p_extra, '{}'::jsonb); $$;

-- 在函式內丟出「帶狀態碼的白話錯誤」；外層以 ga_po_catch 轉回 {ok:false,...}，同一個子交易內的寫入會一併回復。
CREATE OR REPLACE FUNCTION public.ga_po_raise(p_status integer, p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN RAISE EXCEPTION '%', public.ga_po_err(p_status, p_code, p_message, p_extra)::text USING ERRCODE = 'GA001'; END; $$;

CREATE OR REPLACE FUNCTION public.ga_po_catch(p_message text, p_sqlstate text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_sqlstate = 'GA001' THEN RETURN p_message::jsonb; END IF;
  IF p_sqlstate IN ('40001', '40P01') THEN RETURN public.ga_po_err(409, 'BUSY', '系統忙碌中，請稍後重試'); END IF;
  IF p_sqlstate = 'GA002' THEN RETURN public.ga_po_err(409, 'PO_EVENTS_IMMUTABLE', '採購單事件紀錄不可修改或刪除'); END IF;
  IF p_sqlstate = '23505' THEN RETURN public.ga_po_err(409, 'DUPLICATE', '資料重複，請重新整理畫面後再試'); END IF;
  IF p_sqlstate = '23503' THEN RETURN public.ga_po_err(409, 'REFERENCE_INVALID', '關聯的資料已不存在，請重新整理畫面後再試'); END IF;
  RETURN public.ga_po_err(500, 'UNKNOWN_ERROR', '操作失敗，請稍後重試');
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_po_fmt(p_value numeric) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE WHEN p_value IS NULL THEN '' ELSE trim(trailing '.' FROM trim(trailing '0' FROM round(p_value, 4)::text)) END; $$;

CREATE OR REPLACE FUNCTION public.ga_po_like_escape(p_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_'); $$;

CREATE OR REPLACE FUNCTION public.ga_wf_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE((SELECT value_num FROM public.ga_workflow_settings WHERE key = p_key), p_default); $$;

CREATE OR REPLACE FUNCTION public.ga_po_today() RETURNS date LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT (now() AT TIME ZONE 'Asia/Taipei')::date; $$;

-- 可看採購單：採購評估檢視或管理，或持採購核准權限（核准人不需要三個採購權限）。
CREATE OR REPLACE FUNCTION public.ga_po_can_view(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.purchase_review.view') OR has_permission(p_uid, 'general_affairs.purchase_review.manage')
           OR has_permission(p_uid, 'general_affairs.purchase_order.approve'); $$;

-- 供應商帳務欄位（統編、付款條件）：另需廠商檢視或管理權限。
CREATE OR REPLACE FUNCTION public.ga_po_can_vendor(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.vendor.view') OR has_permission(p_uid, 'general_affairs.vendor.manage'); $$;

-- 採購寫入需要的三個權限：缺哪個講清楚（Q13）。回傳 NULL 代表三個都有。
CREATE OR REPLACE FUNCTION public.ga_po_perm_error(p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_review boolean := has_permission(p_uid, 'general_affairs.purchase_review.manage');
  v_txn boolean := has_permission(p_uid, 'general_affairs.inventory_transaction.manage');
  v_part boolean := has_permission(p_uid, 'general_affairs.part.view') OR has_permission(p_uid, 'general_affairs.part.manage');
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF v_review AND v_txn AND v_part THEN RETURN NULL; END IF;
  IF NOT v_review THEN v_missing := array_append(v_missing, '採購評估管理'::text); END IF;
  IF NOT v_txn THEN v_missing := array_append(v_missing, '庫存交易管理'::text); END IF;
  IF NOT v_part THEN v_missing := array_append(v_missing, '料件查看'::text); END IF;
  RETURN public.ga_po_err(403, CASE WHEN NOT v_review THEN 'PERMISSION_DENIED' WHEN NOT v_txn THEN 'TRANSACTION_PERMISSION_REQUIRED' ELSE 'PART_VIEW_REQUIRED' END,
    '採購單需要「採購評估管理」、「庫存交易管理」與「料件查看」三個權限，您缺少：' || array_to_string(v_missing, '、'),
    jsonb_build_object('missing', to_jsonb(v_missing)));
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_po_status_label(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE p_status WHEN 'DRAFT' THEN '草稿' WHEN 'PENDING_APPROVAL' THEN '待核准' WHEN 'APPROVED' THEN '已核准待下訂' WHEN 'ORDERED' THEN '已下訂'
  WHEN 'PARTIALLY_RECEIVED' THEN '部分到貨' WHEN 'RECEIVED' THEN '全部到貨' WHEN 'CLOSED' THEN '已結案' WHEN 'CANCELED' THEN '已取消' ELSE p_status END; $$;

CREATE OR REPLACE FUNCTION public.ga_po_event(p_po_id uuid, p_type text, p_from text, p_to text, p_actor uuid, p_note text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ INSERT INTO public.ga_purchase_order_events (po_id, event_type, from_status, to_status, actor_id, note, payload)
      VALUES (p_po_id, p_type, p_from, p_to, p_actor, p_note, COALESCE(p_payload, '{}'::jsonb)); $$;

-- 單號：PO-YYYYMMDD-NNN（台北日期）。以交易鎖保證同一天內流水不重複；滿 999 自動擴為四位以上。
CREATE OR REPLACE FUNCTION public.ga_next_po_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_day text := to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD');
  v_prefix text;
  v_seq integer;
  v_no text;
BEGIN
  v_prefix := 'PO-' || v_day || '-';
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_next_po_no:' || v_day, 0));
  SELECT COALESCE(max(substring(po_no FROM '^PO-[0-9]{8}-([0-9]+)$')::integer), 0) INTO v_seq FROM public.ga_purchase_orders WHERE po_no LIKE v_prefix || '%';
  LOOP
    v_seq := v_seq + 1;
    v_no := v_prefix || CASE WHEN v_seq < 1000 THEN lpad(v_seq::text, 3, '0') ELSE v_seq::text END;
    -- 避免和舊版評估採購編號（PO-日期-四位流水）看起來相同。
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ga_purchase_reviews WHERE purchase_no = v_no);
  END LOOP;
  RETURN v_no;
END;
$$;

-- ---------------------------------------------------------------- 4. 需求量加總
-- 需求單的需求量（基本單位）：沒有需求量回 NULL（不限制）。
CREATE OR REPLACE FUNCTION public.ga_po_request_requested_base(p_request_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_req public.ga_service_requests%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_conv numeric := 1;
BEGIN
  SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.desired_quantity IS NULL THEN RETURN NULL; END IF;
  IF v_req.part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM public.ga_parts WHERE id = v_req.part_id;
    IF FOUND AND v_req.desired_unit IS NOT NULL AND v_part.purchase_unit IS NOT NULL AND v_part.purchase_to_base_rate > 0
       AND v_req.desired_unit = v_part.purchase_unit AND v_req.desired_unit <> v_part.base_unit THEN
      v_conv := v_part.purchase_to_base_rate;
    END IF;
  END IF;
  RETURN round(v_req.desired_quantity * v_conv, 4);
END;
$$;

-- 已被採購單占用的量（基本單位）：所有「未取消」採購單（含草稿）連到這張需求單的品項，可排除某一張（編輯中的那張）。
CREATE OR REPLACE FUNCTION public.ga_po_request_committed(p_request_id uuid, p_exclude_po uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE(sum(i.quantity_base), 0) FROM public.ga_purchase_order_items i JOIN public.ga_purchase_orders o ON o.id = i.po_id
      WHERE i.request_id = p_request_id AND o.status <> 'CANCELED' AND (p_exclude_po IS NULL OR o.id <> p_exclude_po); $$;

-- 檢查一張採購單內連到某需求單的品項：加總（含其他採購單）超過需求量時，本單這些品項都要填超量原因。
CREATE OR REPLACE FUNCTION public.ga_po_check_request_limit(p_po_id uuid, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requested numeric;
  v_others numeric;
  v_mine numeric;
  v_line integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_po_req:' || p_request_id::text, 0));
  v_requested := public.ga_po_request_requested_base(p_request_id);
  IF v_requested IS NULL THEN RETURN; END IF;
  v_others := public.ga_po_request_committed(p_request_id, p_po_id);
  SELECT COALESCE(sum(quantity_base), 0) INTO v_mine FROM public.ga_purchase_order_items WHERE po_id = p_po_id AND request_id = p_request_id;
  IF v_others + v_mine <= v_requested + 0.00005 THEN RETURN; END IF;
  SELECT i.line_no INTO v_line FROM public.ga_purchase_order_items i
   WHERE i.po_id = p_po_id AND i.request_id = p_request_id AND (i.over_request_reason IS NULL OR btrim(i.over_request_reason) = '')
   ORDER BY i.line_no LIMIT 1;
  IF FOUND THEN
    PERFORM public.ga_po_raise(422, 'OVER_REQUEST_REASON_REQUIRED',
      '第 ' || v_line || ' 項連到的需求單需求量為 ' || public.ga_po_fmt(v_requested) || '（基本單位），所有未取消採購單加起來是 ' || public.ga_po_fmt(v_others + v_mine) || '，超過了，請填寫超量原因',
      jsonb_build_object('line_no', v_line, 'requested_base', v_requested, 'committed_base', v_others + v_mine));
  END IF;
END;
$$;

-- ---------------------------------------------------------------- 5. 品項寫入（整張替換）與金額重算
CREATE OR REPLACE FUNCTION public.ga_po_items_apply(p_po_id uuid, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_num constant text := '^[0-9]+(\.[0-9]{1,4})?$';
  v_no integer := 0;
  v_item jsonb;
  v_pid uuid;
  v_rid uuid;
  v_sid uuid;
  v_tid uuid;
  v_part public.ga_parts%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_name text;
  v_spec text;
  v_unit text;
  v_mode text;
  v_qty numeric;
  v_base numeric;
  v_price numeric;
  v_txt text;
  v_over text;
  v_note text;
  v_rids uuid[] := ARRAY[]::uuid[];
  v_r uuid;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN PERFORM public.ga_po_raise(400, 'ITEMS_INVALID', '品項必須是清單'); END IF;
  IF jsonb_array_length(p_items) = 0 THEN PERFORM public.ga_po_raise(400, 'ITEMS_REQUIRED', '請至少加入一個品項'); END IF;
  IF jsonb_array_length(p_items) > 50 THEN PERFORM public.ga_po_raise(400, 'TOO_MANY_ITEMS', '一張採購單最多 50 個品項'); END IF;
  DELETE FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_no := v_no + 1;
    v_pid := NULL; v_rid := NULL; v_sid := NULL; v_tid := NULL; v_part := NULL;
    IF jsonb_typeof(v_item) <> 'object' THEN PERFORM public.ga_po_raise(400, 'ITEM_INVALID', '第 ' || v_no || ' 項格式錯誤'); END IF;
    -- 料件
    v_txt := ga_normalize_optional_text(v_item->>'part_id');
    IF v_txt IS NOT NULL THEN
      IF v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'ITEM_INVALID', '第 ' || v_no || ' 項的料件格式錯誤'); END IF;
      v_pid := v_txt::uuid;
      SELECT * INTO v_part FROM public.ga_parts WHERE id = v_pid AND deleted_at IS NULL;
      IF NOT FOUND THEN PERFORM public.ga_po_raise(404, 'PART_NOT_FOUND', '第 ' || v_no || ' 項的料件不存在或已被刪除'); END IF;
      IF NOT v_part.is_active THEN PERFORM public.ga_po_raise(409, 'PART_INACTIVE', '第 ' || v_no || ' 項的料件「' || v_part.name || '」已停用'); END IF;
    END IF;
    -- 名稱、規格、單位
    v_name := ga_normalize_optional_text(v_item->>'item_name');
    IF v_name IS NULL AND v_pid IS NOT NULL THEN v_name := v_part.name; END IF;
    IF v_name IS NULL THEN PERFORM public.ga_po_raise(400, 'ITEM_NAME_REQUIRED', '第 ' || v_no || ' 項請選擇料件或填寫品名'); END IF;
    IF length(v_name) > 200 THEN PERFORM public.ga_po_raise(400, 'ITEM_NAME_TOO_LONG', '第 ' || v_no || ' 項品名不可超過 200 字'); END IF;
    v_spec := ga_normalize_optional_text(v_item->>'spec');
    IF v_spec IS NOT NULL AND length(v_spec) > 200 THEN PERFORM public.ga_po_raise(400, 'SPEC_TOO_LONG', '第 ' || v_no || ' 項規格不可超過 200 字'); END IF;
    v_unit := ga_normalize_optional_text(v_item->>'unit');
    IF v_pid IS NOT NULL THEN
      IF v_unit IS NULL THEN v_unit := v_part.base_unit; END IF;
      IF v_unit <> v_part.base_unit AND NOT (v_part.purchase_unit IS NOT NULL AND v_unit = v_part.purchase_unit AND v_part.purchase_to_base_rate > 0) THEN
        PERFORM public.ga_po_raise(422, 'INVALID_UNIT', '第 ' || v_no || ' 項的單位只能是料件的基本單位「' || v_part.base_unit || '」' || COALESCE('或採購單位「' || v_part.purchase_unit || '」', ''));
      END IF;
    ELSE
      IF v_unit IS NULL THEN v_unit := '個'; END IF;
      IF length(v_unit) > 20 THEN PERFORM public.ga_po_raise(400, 'UNIT_TOO_LONG', '第 ' || v_no || ' 項單位不可超過 20 字'); END IF;
    END IF;
    -- 數量與單價
    v_txt := ga_normalize_optional_text(v_item->>'quantity');
    IF v_txt IS NULL OR v_txt !~ c_num THEN PERFORM public.ga_po_raise(400, 'INVALID_QUANTITY', '第 ' || v_no || ' 項數量必須大於 0，最多 4 位小數'); END IF;
    v_qty := v_txt::numeric;
    IF v_qty <= 0 OR v_qty > 999999999 THEN PERFORM public.ga_po_raise(400, 'INVALID_QUANTITY', '第 ' || v_no || ' 項數量必須大於 0，最多 4 位小數'); END IF;
    v_txt := ga_normalize_optional_text(COALESCE(v_item->>'unit_price', '0'));
    IF v_txt !~ c_num THEN PERFORM public.ga_po_raise(400, 'INVALID_PRICE', '第 ' || v_no || ' 項單價必須是 0 以上的數字，最多 4 位小數'); END IF;
    v_price := v_txt::numeric;
    IF v_price > 99999999 THEN PERFORM public.ga_po_raise(400, 'INVALID_PRICE', '第 ' || v_no || ' 項單價過大'); END IF;
    v_base := v_qty;
    IF v_pid IS NOT NULL AND v_unit <> v_part.base_unit THEN v_base := round(v_qty * v_part.purchase_to_base_rate, 4); END IF;
    -- 處理方式
    v_mode := COALESCE(ga_normalize_optional_text(v_item->>'fulfil_mode'), CASE WHEN v_pid IS NOT NULL THEN 'STOCK' ELSE 'NO_STOCK' END);
    IF v_mode NOT IN ('STOCK', 'DIRECT_ASSET', 'NO_STOCK') THEN PERFORM public.ga_po_raise(400, 'INVALID_FULFIL_MODE', '第 ' || v_no || ' 項的處理方式錯誤'); END IF;
    IF v_mode = 'STOCK' AND v_pid IS NULL THEN PERFORM public.ga_po_raise(422, 'STOCK_NEEDS_PART', '第 ' || v_no || ' 項要入總部庫存，必須選擇料件（自由品名請選「只登錄到貨」）'); END IF;
    IF v_mode = 'DIRECT_ASSET' THEN
      v_txt := ga_normalize_optional_text(v_item->>'target_store_id');
      IF v_txt IS NULL OR v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'TARGET_STORE_REQUIRED', '第 ' || v_no || ' 項要直接建立設備，請選擇送往的門市'); END IF;
      v_sid := v_txt::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_sid AND is_active) THEN PERFORM public.ga_po_raise(422, 'TARGET_STORE_INVALID', '第 ' || v_no || ' 項送往的門市不存在或已停用'); END IF;
      IF v_base <> trunc(v_base) THEN PERFORM public.ga_po_raise(422, 'ASSET_QUANTITY_INTEGER', '第 ' || v_no || ' 項要直接建立設備，數量（換算基本單位後）必須是整數'); END IF;
      v_txt := ga_normalize_optional_text(v_item->>'equipment_template_id');
      IF v_txt IS NOT NULL THEN
        IF v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'ITEM_INVALID', '第 ' || v_no || ' 項的設備型號格式錯誤'); END IF;
        v_tid := v_txt::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.ga_equipment_templates WHERE id = v_tid AND deleted_at IS NULL AND is_active) THEN
          PERFORM public.ga_po_raise(422, 'TEMPLATE_INVALID', '第 ' || v_no || ' 項的設備型號不存在或已停用');
        END IF;
      END IF;
    END IF;
    -- 需求單連結
    v_txt := ga_normalize_optional_text(v_item->>'request_id');
    IF v_txt IS NOT NULL THEN
      IF v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'ITEM_INVALID', '第 ' || v_no || ' 項的需求單格式錯誤'); END IF;
      v_rid := v_txt::uuid;
      SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_rid AND deleted_at IS NULL;
      IF NOT FOUND THEN PERFORM public.ga_po_raise(404, 'REQUEST_NOT_FOUND', '第 ' || v_no || ' 項連到的需求單不存在或已被刪除'); END IF;
      IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN PERFORM public.ga_po_raise(409, 'REQUEST_CLOSED', '第 ' || v_no || ' 項連到的需求單（' || v_req.request_no || '）已結案、駁回或取消，不能再開採購單'); END IF;
      IF v_req.request_type = 'REPAIR' THEN PERFORM public.ga_po_raise(422, 'REPAIR_NOT_PURCHASE', '第 ' || v_no || ' 項連到的需求單（' || v_req.request_no || '）是維修單，不能走採購'); END IF;
      IF v_req.part_id IS NOT NULL AND v_pid IS NOT NULL AND v_req.part_id <> v_pid THEN
        PERFORM public.ga_po_raise(422, 'REQUEST_PART_MISMATCH', '第 ' || v_no || ' 項的料件和需求單（' || v_req.request_no || '）指定的料件不同');
      END IF;
      IF NOT (v_rid = ANY (v_rids)) THEN v_rids := array_append(v_rids, v_rid); END IF;
    END IF;
    v_over := ga_normalize_optional_text(v_item->>'over_request_reason');
    IF v_over IS NOT NULL AND length(v_over) > 200 THEN PERFORM public.ga_po_raise(400, 'REASON_TOO_LONG', '第 ' || v_no || ' 項超量原因不可超過 200 字'); END IF;
    v_note := ga_normalize_optional_text(v_item->>'notes');
    IF v_note IS NOT NULL AND length(v_note) > 500 THEN PERFORM public.ga_po_raise(400, 'NOTES_TOO_LONG', '第 ' || v_no || ' 項備註不可超過 500 字'); END IF;
    INSERT INTO public.ga_purchase_order_items (po_id, line_no, part_id, item_name, spec, unit, quantity, quantity_base, unit_price, line_amount, request_id,
                                                fulfil_mode, target_store_id, equipment_template_id, over_request_reason, notes)
    VALUES (p_po_id, v_no, v_pid, v_name, v_spec, v_unit, v_qty, v_base, v_price, round(v_qty * v_price), v_rid,
            v_mode, v_sid, v_tid, v_over, v_note);
  END LOOP;
  -- 需求量加總（依需求單排序取鎖，避免死結）
  FOR v_r IN SELECT x FROM unnest(v_rids) x ORDER BY x LOOP
    PERFORM public.ga_po_check_request_limit(p_po_id, v_r);
  END LOOP;
END;
$$;

-- 重算金額：草稿用目前設定的稅率；未稅小計 = 各品項金額（各自四捨五入到整數元）加總，稅額與含稅總額四捨五入到整數元。
-- 數值沒有變動就不更新（避免白白換掉 updated_at 版本）。
CREATE OR REPLACE FUNCTION public.ga_po_refresh_totals(p_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_po public.ga_purchase_orders%ROWTYPE;
  v_rate numeric;
  v_sub numeric;
  v_tax numeric;
  v_req boolean;
BEGIN
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_rate := CASE WHEN v_po.status = 'DRAFT' THEN public.ga_wf_num('po_tax_rate', 0.05) ELSE v_po.tax_rate END;
  SELECT COALESCE(sum(line_amount), 0) INTO v_sub FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
  v_tax := round(v_sub * v_rate);
  v_req := CASE WHEN v_po.status = 'DRAFT' THEN (public.ga_wf_num('po_approval_enabled', 1) >= 1 AND v_sub + v_tax > public.ga_wf_num('po_approval_threshold', 5000)) ELSE v_po.approval_required END;
  IF v_po.tax_rate IS DISTINCT FROM v_rate OR v_po.subtotal IS DISTINCT FROM v_sub OR v_po.tax_amount IS DISTINCT FROM v_tax
     OR v_po.total_amount IS DISTINCT FROM v_sub + v_tax OR v_po.approval_required IS DISTINCT FROM v_req THEN
    UPDATE public.ga_purchase_orders SET tax_rate = v_rate, subtotal = v_sub, tax_amount = v_tax, total_amount = v_sub + v_tax, approval_required = v_req WHERE id = p_po_id;
  END IF;
END;
$$;

-- 預設總部倉：啟用、未刪除、中央倉庫類型且標記為預設的位置（剛好一個才採用）。
CREATE OR REPLACE FUNCTION public.ga_po_default_location()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END FROM public.ga_inventory_locations
      WHERE is_default AND is_active AND deleted_at IS NULL AND location_type = 'CENTRAL_WAREHOUSE'; $$;

-- 驗證供應商：必須是已建好、狀態 active 的 ga_vendors（D8；該表沒有 deleted_at，停用以 status 判斷）。
CREATE OR REPLACE FUNCTION public.ga_po_check_vendor(p_vendor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ga_vendors WHERE id = p_vendor_id;
  IF NOT FOUND THEN PERFORM public.ga_po_raise(422, 'VENDOR_NOT_FOUND', '找不到這個供應商，採購單只能選已建好的供應商（請到廠商管理新增）'); END IF;
  IF v_status <> 'active' THEN PERFORM public.ga_po_raise(422, 'VENDOR_INACTIVE', '這個供應商目前不是「合作中」狀態，不能開採購單'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_po_check_location(p_location_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_loc public.ga_inventory_locations%ROWTYPE;
BEGIN
  SELECT * INTO v_loc FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NULL;
  IF NOT FOUND THEN PERFORM public.ga_po_raise(404, 'LOCATION_NOT_FOUND', '找不到收貨位置（可能已被刪除）'); END IF;
  IF NOT v_loc.is_active THEN PERFORM public.ga_po_raise(409, 'LOCATION_INACTIVE', '收貨位置「' || v_loc.name || '」已停用'); END IF;
END;
$$;

-- 送核准、下訂前的完整性檢查。
CREATE OR REPLACE FUNCTION public.ga_po_check_ready(p_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_po public.ga_purchase_orders%ROWTYPE;
  v_it record;
  v_r uuid;
  v_req public.ga_service_requests%ROWTYPE;
  v_tpl uuid;
BEGIN
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id;
  IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_order_items WHERE po_id = p_po_id) THEN PERFORM public.ga_po_raise(400, 'ITEMS_REQUIRED', '請至少加入一個品項'); END IF;
  IF v_po.vendor_id IS NULL THEN PERFORM public.ga_po_raise(422, 'VENDOR_REQUIRED', '請先選擇供應商'); END IF;
  PERFORM public.ga_po_check_vendor(v_po.vendor_id);
  FOR v_it IN SELECT i.*, p.is_active AS part_active, p.deleted_at AS part_deleted, to_jsonb(p) ->> 'equipment_template_id' AS part_template
                FROM public.ga_purchase_order_items i LEFT JOIN public.ga_parts p ON p.id = i.part_id WHERE i.po_id = p_po_id ORDER BY i.line_no LOOP
    IF v_it.unit_price <= 0 THEN PERFORM public.ga_po_raise(422, 'PRICE_REQUIRED', '第 ' || v_it.line_no || ' 項還沒有填單價（單價要大於 0）'); END IF;
    IF v_it.part_id IS NOT NULL AND (v_it.part_deleted IS NOT NULL OR NOT v_it.part_active) THEN
      PERFORM public.ga_po_raise(409, 'PART_INACTIVE', '第 ' || v_it.line_no || ' 項的料件已停用或刪除，請修改品項');
    END IF;
    IF v_it.fulfil_mode = 'STOCK' AND v_po.receiving_location_id IS NULL THEN
      PERFORM public.ga_po_raise(422, 'RECEIVING_LOCATION_REQUIRED', '有品項要入總部庫存，請先選擇收貨位置');
    END IF;
    IF v_it.fulfil_mode = 'DIRECT_ASSET' THEN
      IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_it.target_store_id AND is_active) THEN
        PERFORM public.ga_po_raise(422, 'TARGET_STORE_INVALID', '第 ' || v_it.line_no || ' 項送往的門市已停用');
      END IF;
      v_tpl := COALESCE(v_it.equipment_template_id, NULLIF(v_it.part_template, '')::uuid);
      IF v_tpl IS NULL THEN PERFORM public.ga_po_raise(422, 'TEMPLATE_REQUIRED', '第 ' || v_it.line_no || ' 項要直接建立設備，請選擇設備型號（這個料件沒有設定對應型號）'); END IF;
      IF NOT EXISTS (SELECT 1 FROM public.ga_equipment_templates WHERE id = v_tpl AND deleted_at IS NULL AND is_active) THEN
        PERFORM public.ga_po_raise(422, 'TEMPLATE_INVALID', '第 ' || v_it.line_no || ' 項的設備型號已停用或刪除，請重新選擇');
      END IF;
    END IF;
  END LOOP;
  IF v_po.receiving_location_id IS NOT NULL THEN PERFORM public.ga_po_check_location(v_po.receiving_location_id); END IF;
  FOR v_r IN SELECT DISTINCT request_id FROM public.ga_purchase_order_items WHERE po_id = p_po_id AND request_id IS NOT NULL ORDER BY 1 LOOP
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_r;
    IF NOT FOUND OR v_req.deleted_at IS NOT NULL OR v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN
      PERFORM public.ga_po_raise(409, 'REQUEST_CLOSED', '連到的需求單' || COALESCE('（' || v_req.request_no || '）', '') || '已結案、駁回、取消或刪除，請修改品項');
    END IF;
    PERFORM public.ga_po_check_request_limit(p_po_id, v_r);
  END LOOP;
END;
$$;

-- 表頭驗證與寫入（建立與草稿修改共用）：只處理 p_header 內出現的鍵。
CREATE OR REPLACE FUNCTION public.ga_po_header_apply(p_po_id uuid, p_header jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_txt text;
  v_date date;
BEGIN
  IF p_header ? 'vendor_id' THEN
    v_txt := ga_normalize_optional_text(p_header->>'vendor_id');
    IF v_txt IS NULL THEN
      UPDATE public.ga_purchase_orders SET vendor_id = NULL WHERE id = p_po_id AND vendor_id IS NOT NULL;
    ELSE
      IF v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'INVALID_VENDOR', '供應商格式錯誤'); END IF;
      PERFORM public.ga_po_check_vendor(v_txt::uuid);
      UPDATE public.ga_purchase_orders SET vendor_id = v_txt::uuid WHERE id = p_po_id AND vendor_id IS DISTINCT FROM v_txt::uuid;
    END IF;
  END IF;
  IF p_header ? 'receiving_location_id' THEN
    v_txt := ga_normalize_optional_text(p_header->>'receiving_location_id');
    IF v_txt IS NULL THEN
      UPDATE public.ga_purchase_orders SET receiving_location_id = NULL WHERE id = p_po_id AND receiving_location_id IS NOT NULL;
    ELSE
      IF v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'INVALID_LOCATION', '收貨位置格式錯誤'); END IF;
      PERFORM public.ga_po_check_location(v_txt::uuid);
      UPDATE public.ga_purchase_orders SET receiving_location_id = v_txt::uuid WHERE id = p_po_id AND receiving_location_id IS DISTINCT FROM v_txt::uuid;
    END IF;
  END IF;
  IF p_header ? 'expected_delivery_date' THEN
    v_txt := ga_normalize_optional_text(p_header->>'expected_delivery_date');
    IF v_txt IS NOT NULL AND v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN PERFORM public.ga_po_raise(400, 'INVALID_DATE', '預計到貨日格式錯誤（YYYY-MM-DD）'); END IF;
    BEGIN
      v_date := v_txt::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      PERFORM public.ga_po_raise(400, 'INVALID_DATE', '預計到貨日不是有效的日期');
    END;
    UPDATE public.ga_purchase_orders SET expected_delivery_date = v_date WHERE id = p_po_id AND expected_delivery_date IS DISTINCT FROM v_date;
  END IF;
  IF p_header ? 'notes' THEN
    v_txt := ga_normalize_optional_text(p_header->>'notes');
    IF v_txt IS NOT NULL AND length(v_txt) > 1000 THEN PERFORM public.ga_po_raise(400, 'NOTES_TOO_LONG', '備註不可超過 1000 字'); END IF;
    UPDATE public.ga_purchase_orders SET notes = v_txt WHERE id = p_po_id AND notes IS DISTINCT FROM v_txt;
  END IF;
  IF p_header ? 'source_request_id' THEN
    v_txt := ga_normalize_optional_text(p_header->>'source_request_id');
    IF v_txt IS NOT NULL THEN
      IF v_txt !~* c_uuid OR NOT EXISTS (SELECT 1 FROM public.ga_service_requests WHERE id = v_txt::uuid AND deleted_at IS NULL) THEN
        PERFORM public.ga_po_raise(404, 'REQUEST_NOT_FOUND', '找不到來源需求單');
      END IF;
    END IF;
    UPDATE public.ga_purchase_orders SET source_request_id = v_txt::uuid WHERE id = p_po_id AND source_request_id IS DISTINCT FROM v_txt::uuid;
  END IF;
  IF p_header ? 'purchase_review_id' THEN
    v_txt := ga_normalize_optional_text(p_header->>'purchase_review_id');
    IF v_txt IS NOT NULL THEN
      IF v_txt !~* c_uuid OR NOT EXISTS (SELECT 1 FROM public.ga_purchase_reviews WHERE id = v_txt::uuid AND deleted_at IS NULL) THEN
        PERFORM public.ga_po_raise(404, 'REVIEW_NOT_FOUND', '找不到採購評估');
      END IF;
    END IF;
    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;
END;
$$;

-- 完整資料（含品項與事件時間軸）；供應商統編與付款條件依廠商權限遮蔽，登入者以 auth.uid() 判斷。
CREATE OR REPLACE FUNCTION public.ga_po_data(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_billing boolean := public.ga_po_can_vendor(v_uid);
  v_po public.ga_purchase_orders%ROWTYPE;
  v_obj jsonb;
  v_vend public.ga_vendors%ROWTYPE;
  v_items jsonb;
  v_events jsonb;
BEGIN
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_obj := to_jsonb(v_po) - 'create_key' - 'create_hash' - 'vendor_tax_id_snapshot' - 'vendor_payment_terms_snapshot';
  IF v_po.vendor_id IS NOT NULL THEN SELECT * INTO v_vend FROM public.ga_vendors WHERE id = v_po.vendor_id; END IF;
  v_obj := v_obj || jsonb_build_object(
    'status_label', public.ga_po_status_label(v_po.status),
    'vendor_name', COALESCE(v_po.vendor_name_snapshot, v_vend.name),
    'vendor_current_name', v_vend.name,
    'vendor_current_status', v_vend.status,
    'vendor_billing_visible', v_billing,
    -- 已下訂用下訂當時的快照，草稿階段顯示廠商目前資料；兩者都只給有廠商檢視或管理權限者。
    'vendor_tax_id', CASE WHEN v_billing THEN CASE WHEN v_po.ordered_at IS NOT NULL THEN v_po.vendor_tax_id_snapshot ELSE v_vend.tax_id END END,
    'vendor_payment_terms', CASE WHEN v_billing THEN CASE WHEN v_po.ordered_at IS NOT NULL THEN v_po.vendor_payment_terms_snapshot ELSE v_vend.payment_terms END END,
    'source_request_no', (SELECT request_no FROM public.ga_service_requests WHERE id = v_po.source_request_id),
    'receiving_location_name', (SELECT name FROM public.ga_inventory_locations WHERE id = v_po.receiving_location_id),
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_po.created_by),
    'submitted_by_name', (SELECT full_name FROM public.profiles WHERE id = v_po.submitted_by),
    'approved_by_name', (SELECT full_name FROM public.profiles WHERE id = v_po.approved_by),
    'ordered_by_name', (SELECT full_name FROM public.profiles WHERE id = v_po.ordered_by));
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', i.id, 'line_no', i.line_no, 'part_id', i.part_id, 'part_name', p.name, 'item_name', i.item_name, 'spec', i.spec, 'unit', i.unit,
      'quantity', i.quantity, 'quantity_base', i.quantity_base, 'base_unit', p.base_unit, 'unit_price', i.unit_price, 'line_amount', i.line_amount,
      'request_id', i.request_id, 'request_no', r.request_no, 'fulfil_mode', i.fulfil_mode, 'target_store_id', i.target_store_id, 'target_store_name', s.store_name,
      'equipment_template_id', i.equipment_template_id, 'over_request_reason', i.over_request_reason,
      'received_qty', i.received_qty, 'dispatched_qty', i.dispatched_qty, 'notes', i.notes) ORDER BY i.line_no), '[]'::jsonb)
    INTO v_items
    FROM public.ga_purchase_order_items i
    LEFT JOIN public.ga_parts p ON p.id = i.part_id
    LEFT JOIN public.ga_service_requests r ON r.id = i.request_id
    LEFT JOIN public.stores s ON s.id = i.target_store_id
   WHERE i.po_id = p_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'event_type', e.event_type, 'from_status', e.from_status, 'to_status', e.to_status, 'actor_id', e.actor_id,
      'actor_name', (SELECT full_name FROM public.profiles WHERE id = e.actor_id), 'note', e.note, 'payload', e.payload, 'created_at', e.created_at) ORDER BY e.created_at, e.id), '[]'::jsonb)
    INTO v_events FROM public.ga_purchase_order_events e WHERE e.po_id = p_id;
  RETURN v_obj || jsonb_build_object('items', v_items, 'events', v_events);
END;
$$;

-- ---------------------------------------------------------------- 6. 建單（內部共用）
CREATE OR REPLACE FUNCTION public.ga_po_insert(p_uid uuid, p_header jsonb, p_items jsonb, p_event text, p_create_key text, p_create_hash text, p_event_payload jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.ga_purchase_orders (po_no, status, tax_rate, created_by, updated_by, create_key, create_hash, receiving_location_id)
  VALUES (public.ga_next_po_no(), 'DRAFT', public.ga_wf_num('po_tax_rate', 0.05), p_uid, p_uid, p_create_key, p_create_hash,
          CASE WHEN p_header ? 'receiving_location_id' THEN NULL ELSE public.ga_po_default_location() END)
  RETURNING id INTO v_id;
  PERFORM public.ga_po_header_apply(v_id, p_header);
  PERFORM public.ga_po_items_apply(v_id, p_items);
  PERFORM public.ga_po_refresh_totals(v_id);
  PERFORM public.ga_po_event(v_id, p_event, NULL, 'DRAFT', p_uid, NULL, p_event_payload);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_po_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_events_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_err(integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_raise(integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_catch(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_fmt(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_like_escape(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_wf_num(text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_today() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_can_view(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_can_vendor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_perm_error(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_status_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_event(uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_next_po_no() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_request_requested_base(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_request_committed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_check_request_limit(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_items_apply(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_refresh_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_default_location() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_check_vendor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_check_location(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_check_ready(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_header_apply(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_insert(uuid, jsonb, jsonb, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 7. 對外函式：建單、修改、由評估產生
CREATE OR REPLACE FUNCTION public.ga_ws_po_create(p_header jsonb, p_items jsonb, p_create_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_key text := ga_normalize_optional_text(p_create_key);
  v_hash text;
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
  v_exist public.ga_purchase_orders%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_po_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF v_key IS NULL OR length(v_key) > 60 THEN RETURN public.ga_po_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF jsonb_typeof(v_header) <> 'object' THEN RETURN public.ga_po_err(400, 'HEADER_INVALID', '採購單內容格式錯誤'); END IF;
  v_hash := md5(v_header::text || '|' || COALESCE(p_items, 'null'::jsonb)::text);
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_po_create:' || v_uid::text || ':' || v_key, 0));
    SELECT * INTO v_exist FROM public.ga_purchase_orders WHERE created_by = v_uid AND create_key = v_key;
    IF FOUND THEN
      IF v_exist.create_hash IS DISTINCT FROM v_hash THEN
        RETURN public.ga_po_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一張不同內容的採購單使用，請重新整理畫面後再送出');
      END IF;
      RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_po_data(v_exist.id));
    END IF;
    v_id := public.ga_po_insert(v_uid, v_header, p_items, 'create', v_key, v_hash);
    RETURN jsonb_build_object('ok', true, 'status', 201, 'replay', false, 'data', public.ga_po_data(v_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_po_update(p_id uuid, p_header jsonb, p_items jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
  v_po public.ga_purchase_orders%ROWTYPE;
  v_key text;
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_po_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_po_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF jsonb_typeof(v_header) <> 'object' THEN RETURN public.ga_po_err(400, 'HEADER_INVALID', '採購單內容格式錯誤'); END IF;
  BEGIN
    SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
    IF v_po.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN public.ga_po_err(409, 'STALE', '這張採購單已被其他人修改過，請重新載入後再處理', jsonb_build_object('current_status', v_po.status));
    END IF;
    IF v_po.status IN ('PENDING_APPROVAL', 'APPROVED') THEN
      RETURN public.ga_po_err(409, 'PO_LOCKED', CASE WHEN v_po.status = 'PENDING_APPROVAL' THEN '待核准的採購單不能修改，請先撤回再修改' ELSE '已核准的採購單不能修改，要改品項或金額請先撤回核准' END, jsonb_build_object('current_status', v_po.status));
    END IF;
    IF v_po.status IN ('CLOSED', 'CANCELED') THEN
      RETURN public.ga_po_err(409, 'PO_LOCKED', '已結案或已取消的採購單不能修改', jsonb_build_object('current_status', v_po.status));
    END IF;
    IF v_po.status <> 'DRAFT' THEN
      -- D10：下訂後品項、數量、單價、供應商鎖定，只能改備註與預計到貨日。
      IF p_items IS NOT NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_header) k WHERE k NOT IN ('notes', 'expected_delivery_date')) THEN
        RETURN public.ga_po_err(409, 'PO_LOCKED', '已下訂的採購單，品項、數量、單價與供應商已鎖定，只能修改備註與預計到貨日', jsonb_build_object('current_status', v_po.status));
      END IF;
    END IF;
    PERFORM public.ga_po_header_apply(p_id, v_header);
    FOR v_key IN SELECT jsonb_object_keys(v_header) LOOP v_changed := array_append(v_changed, v_key); END LOOP;
    IF p_items IS NOT NULL THEN
      PERFORM public.ga_po_items_apply(p_id, p_items);
      v_changed := array_append(v_changed, 'items');
    END IF;
    IF v_po.status = 'DRAFT' THEN PERFORM public.ga_po_refresh_totals(p_id); END IF;
    UPDATE public.ga_purchase_orders SET updated_by = v_uid WHERE id = p_id;
    PERFORM public.ga_po_event(p_id, 'update', v_po.status, v_po.status, v_uid, NULL, jsonb_build_object('fields', to_jsonb(v_changed)));
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_po_data(p_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_po_request_remaining(p_request_id uuid, p_exclude_po_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_requested numeric;
  v_committed numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_request_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN public.ga_po_err(404, 'REQUEST_NOT_FOUND', '找不到需求單'); END IF;
  v_requested := public.ga_po_request_requested_base(p_request_id);
  v_committed := public.ga_po_request_committed(p_request_id, p_exclude_po_id);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'request_id', p_request_id, 'request_no', v_req.request_no, 'has_limit', v_requested IS NOT NULL,
    'requested_base', v_requested, 'committed_base', v_committed,
    'remaining_base', CASE WHEN v_requested IS NULL THEN NULL ELSE GREATEST(0, v_requested - v_committed) END,
    'base_unit', (SELECT base_unit FROM public.ga_parts WHERE id = v_req.part_id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_po_from_review(p_review_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_review public.ga_purchase_reviews%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_exist uuid;
  v_requested numeric;
  v_committed numeric;
  v_remaining numeric;
  v_qty numeric;
  v_orig_qty numeric;
  v_unit text;
  v_conv numeric := 1;
  v_amount numeric;
  v_price numeric;
  v_vendor uuid;
  v_loc uuid;
  v_id uuid;
  v_header jsonb;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_po_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_po_review:' || COALESCE(p_review_id::text, ''), 0));
    SELECT * INTO v_review FROM public.ga_purchase_reviews WHERE id = p_review_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'REVIEW_NOT_FOUND', '找不到採購評估'); END IF;
    IF v_review.decision <> 'PURCHASE' THEN RETURN public.ga_po_err(409, 'REVIEW_NOT_PURCHASE', '只有評估結果為「進入採購」才能產生採購單'); END IF;
    SELECT id INTO v_exist FROM public.ga_purchase_orders WHERE purchase_review_id = p_review_id AND status <> 'CANCELED' ORDER BY created_at LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_po_data(v_exist)); END IF;
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_review.request_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'REQUEST_NOT_FOUND', '找不到評估對應的需求單'); END IF;
    IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN RETURN public.ga_po_err(409, 'REQUEST_CLOSED', '這張需求單已結案、駁回或取消'); END IF;
    IF v_req.request_type = 'REPAIR' THEN RETURN public.ga_po_err(422, 'REPAIR_NOT_PURCHASE', '維修單不能走採購'); END IF;
    IF v_req.part_id IS NOT NULL THEN
      SELECT * INTO v_part FROM public.ga_parts WHERE id = v_req.part_id AND deleted_at IS NULL AND is_active;
    END IF;
    v_orig_qty := COALESCE(v_review.approved_quantity, v_req.desired_quantity, 1);
    v_qty := v_orig_qty;
    v_unit := COALESCE(v_review.approved_unit, v_req.desired_unit);
    IF v_part.id IS NOT NULL THEN
      IF v_unit IS NULL OR (v_unit <> v_part.base_unit AND NOT (v_part.purchase_unit IS NOT NULL AND v_unit = v_part.purchase_unit AND v_part.purchase_to_base_rate > 0)) THEN
        v_unit := v_part.base_unit;
      END IF;
      IF v_unit <> v_part.base_unit THEN v_conv := v_part.purchase_to_base_rate; END IF;
    ELSE
      v_unit := COALESCE(v_unit, '個');
    END IF;
    -- 不超過需求單剩餘需求量（D2）：評估核准量大於剩餘量時，草稿只帶剩餘量。
    v_requested := public.ga_po_request_requested_base(v_req.id);
    IF v_requested IS NOT NULL THEN
      v_committed := public.ga_po_request_committed(v_req.id, NULL);
      v_remaining := v_requested - v_committed;
      IF v_remaining <= 0.00005 THEN RETURN public.ga_po_err(409, 'NO_REMAINING', '這張需求單的需求量已經全部開立採購單，沒有剩餘量可再產生'); END IF;
      IF v_qty * v_conv > v_remaining + 0.00005 THEN v_qty := round(floor(v_remaining / v_conv * 10000) / 10000, 4); END IF;
      IF v_qty <= 0 THEN RETURN public.ga_po_err(409, 'NO_REMAINING', '這張需求單的剩餘需求量不足一個單位'); END IF;
    END IF;
    v_amount := COALESCE(NULLIF(v_review.final_amount, 0), NULLIF(v_review.negotiated_amount, 0), NULLIF(v_review.quoted_amount, 0), NULLIF(v_review.estimated_amount, 0));
    v_price := CASE WHEN v_amount IS NOT NULL AND v_orig_qty > 0 THEN round(v_amount / v_orig_qty, 4) ELSE 0 END;
    IF v_review.vendor_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ga_vendors WHERE id = v_review.vendor_id AND status = 'active') THEN v_vendor := v_review.vendor_id; END IF;
    IF v_review.receiving_location_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = v_review.receiving_location_id AND deleted_at IS NULL AND is_active) THEN
      v_loc := v_review.receiving_location_id;
    ELSE
      v_loc := public.ga_po_default_location();
    END IF;
    v_header := jsonb_build_object('vendor_id', v_vendor, 'receiving_location_id', v_loc, 'expected_delivery_date', v_review.expected_delivery_date,
                                   'notes', '由採購評估自動產生；單價依評估金額推算，請確認供應商與單價後再下訂',
                                   'source_request_id', v_req.id, 'purchase_review_id', v_review.id);
    v_item := jsonb_build_object('part_id', v_part.id, 'item_name', COALESCE(v_part.name, v_req.title), 'spec', v_req.desired_spec, 'unit', v_unit, 'quantity', v_qty,
                                 'unit_price', v_price, 'request_id', v_req.id, 'fulfil_mode', CASE WHEN v_part.id IS NOT NULL THEN 'STOCK' ELSE 'NO_STOCK' END);
    v_id := public.ga_po_insert(v_uid, v_header, jsonb_build_array(v_item), 'create_from_review', NULL, NULL,
                                jsonb_build_object('review_id', v_review.id, 'request_id', v_req.id, 'request_no', v_req.request_no));
    RETURN jsonb_build_object('ok', true, 'status', 201, 'replay', false, 'data', public.ga_po_data(v_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 8. 動作
CREATE OR REPLACE FUNCTION public.ga_ws_po_action(p_id uuid, p_action text, p_expected_updated_at timestamptz, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_note text := ga_normalize_optional_text(p_note);
  v_po public.ga_purchase_orders%ROWTYPE;
  v_vendor public.ga_vendors%ROWTYPE;
  v_thr numeric;
  v_enabled boolean;
  v_received numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF p_action IS NULL OR p_action NOT IN ('submit', 'withdraw', 'approve', 'reject', 'revoke_approval', 'place_order', 'cancel', 'short_close', 'close') THEN
    RETURN public.ga_po_err(400, 'INVALID_ACTION', '不支援的動作');
  END IF;
  IF p_action IN ('approve', 'reject') THEN
    IF NOT has_permission(v_uid, 'general_affairs.purchase_order.approve') THEN
      RETURN public.ga_po_err(403, 'APPROVE_PERMISSION_REQUIRED', '您沒有「採購核准」權限，不能核准或駁回採購單');
    END IF;
  ELSE
    v_perm := public.ga_po_perm_error(v_uid);
    IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_po_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RETURN public.ga_po_err(400, 'NOTE_TOO_LONG', '備註或原因不可超過 500 字'); END IF;
  BEGIN
    SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
    IF v_po.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN public.ga_po_err(409, 'STALE', '這張採購單已被其他人處理過，請重新載入後再操作', jsonb_build_object('current_status', v_po.status));
    END IF;
    v_thr := public.ga_wf_num('po_approval_threshold', 5000);
    v_enabled := public.ga_wf_num('po_approval_enabled', 1) >= 1;

    IF p_action = 'submit' THEN
      IF v_po.status <> 'DRAFT' THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，只有草稿可以送核准', jsonb_build_object('current_status', v_po.status)); END IF;
      PERFORM public.ga_po_refresh_totals(p_id);
      PERFORM public.ga_po_check_ready(p_id);
      SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_id;
      IF NOT (v_enabled AND v_po.total_amount > v_thr) THEN
        PERFORM public.ga_po_raise(409, 'NO_APPROVAL_NEEDED', '含稅總額 ' || public.ga_po_fmt(v_po.total_amount) || ' 元沒有超過核准門檻 ' || public.ga_po_fmt(v_thr) || ' 元，免核准，可以直接下訂');
      END IF;
      UPDATE public.ga_purchase_orders SET status = 'PENDING_APPROVAL', approval_required = true, approval_threshold_snapshot = v_thr,
             submitted_by = v_uid, submitted_at = now(), approved_by = NULL, approved_at = NULL, approval_note = NULL, updated_by = v_uid WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'submit', 'DRAFT', 'PENDING_APPROVAL', v_uid, v_note, jsonb_build_object('total_amount', v_po.total_amount, 'threshold', v_thr));
    ELSIF p_action = 'withdraw' THEN
      IF v_po.status <> 'PENDING_APPROVAL' THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，只有待核准的採購單可以撤回', jsonb_build_object('current_status', v_po.status)); END IF;
      UPDATE public.ga_purchase_orders SET status = 'DRAFT', updated_by = v_uid WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'withdraw', 'PENDING_APPROVAL', 'DRAFT', v_uid, v_note);
    ELSIF p_action IN ('approve', 'reject') THEN
      IF v_po.status <> 'PENDING_APPROVAL' THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，只有待核准的採購單可以' || CASE WHEN p_action = 'approve' THEN '核准' ELSE '駁回' END, jsonb_build_object('current_status', v_po.status)); END IF;
      -- D6／D11：核准人不可是開單人，也不可是最後一次送核准的人；管理員不繞過。
      IF v_po.created_by = v_uid THEN RETURN public.ga_po_err(403, 'SELF_APPROVAL', '您是這張採購單的開單人，不能自己核准或駁回，請由其他持有「採購核准」權限的人處理'); END IF;
      IF v_po.submitted_by = v_uid THEN RETURN public.ga_po_err(403, 'SELF_APPROVAL', '您是這張採購單最後一次送核准的人，不能自己核准或駁回，請由其他持有「採購核准」權限的人處理'); END IF;
      IF p_action = 'reject' THEN
        IF v_note IS NULL THEN RETURN public.ga_po_err(400, 'REASON_REQUIRED', '駁回必須填寫原因'); END IF;
        UPDATE public.ga_purchase_orders SET status = 'DRAFT', last_reject_by = v_uid, last_reject_at = now(), last_reject_reason = v_note,
               approved_by = NULL, approved_at = NULL, approval_note = NULL, updated_by = v_uid WHERE id = p_id;
        PERFORM public.ga_po_event(p_id, 'reject', 'PENDING_APPROVAL', 'DRAFT', v_uid, v_note);
      ELSE
        UPDATE public.ga_purchase_orders SET status = 'APPROVED', approved_by = v_uid, approved_at = now(), approval_note = v_note, updated_by = v_uid WHERE id = p_id;
        PERFORM public.ga_po_event(p_id, 'approve', 'PENDING_APPROVAL', 'APPROVED', v_uid, v_note, jsonb_build_object('total_amount', v_po.total_amount, 'threshold', v_po.approval_threshold_snapshot));
      END IF;
    ELSIF p_action = 'revoke_approval' THEN
      IF v_po.status <> 'APPROVED' THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，只有已核准待下訂的採購單可以撤回核准', jsonb_build_object('current_status', v_po.status)); END IF;
      IF v_note IS NULL THEN RETURN public.ga_po_err(400, 'REASON_REQUIRED', '撤回核准必須填寫原因'); END IF;
      UPDATE public.ga_purchase_orders SET status = 'DRAFT', approved_by = NULL, approved_at = NULL, approval_note = NULL, updated_by = v_uid WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'revoke_approval', 'APPROVED', 'DRAFT', v_uid, v_note);
    ELSIF p_action = 'place_order' THEN
      IF v_po.status NOT IN ('DRAFT', 'APPROVED') THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，不能下訂', jsonb_build_object('current_status', v_po.status)); END IF;
      IF v_po.status = 'DRAFT' THEN PERFORM public.ga_po_refresh_totals(p_id); END IF;
      PERFORM public.ga_po_check_ready(p_id);
      SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_id;
      IF v_po.status = 'DRAFT' AND v_enabled AND v_po.total_amount > v_thr THEN
        PERFORM public.ga_po_raise(409, 'APPROVAL_REQUIRED', '含稅總額 ' || public.ga_po_fmt(v_po.total_amount) || ' 元超過核准門檻 ' || public.ga_po_fmt(v_thr) || ' 元，必須先送核准並核准後才能下訂');
      END IF;
      SELECT * INTO v_vendor FROM public.ga_vendors WHERE id = v_po.vendor_id;
      UPDATE public.ga_purchase_orders SET status = 'ORDERED', ordered_by = v_uid, ordered_at = now(), updated_by = v_uid,
             vendor_name_snapshot = v_vendor.name, vendor_tax_id_snapshot = v_vendor.tax_id, vendor_payment_terms_snapshot = v_vendor.payment_terms WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'place_order', v_po.status, 'ORDERED', v_uid, v_note, jsonb_build_object('vendor_id', v_po.vendor_id, 'vendor_name', v_vendor.name, 'total_amount', v_po.total_amount));
    ELSIF p_action = 'cancel' THEN
      IF v_po.status IN ('CLOSED', 'CANCELED') THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，不能取消', jsonb_build_object('current_status', v_po.status)); END IF;
      SELECT COALESCE(sum(received_qty), 0) INTO v_received FROM public.ga_purchase_order_items WHERE po_id = p_id;
      IF v_po.status IN ('PARTIALLY_RECEIVED', 'RECEIVED') OR v_received > 0 THEN
        RETURN public.ga_po_err(409, 'HAS_RECEIPTS', '這張採購單已有到貨紀錄，不能取消；少收的部分請用「短收結案」，全部到齊請用「結案」', jsonb_build_object('current_status', v_po.status));
      END IF;
      IF v_po.status = 'ORDERED' AND v_note IS NULL THEN RETURN public.ga_po_err(400, 'REASON_REQUIRED', '已下訂的採購單取消必須填寫原因'); END IF;
      UPDATE public.ga_purchase_orders SET status = 'CANCELED', canceled_by = v_uid, canceled_at = now(), cancel_reason = v_note, updated_by = v_uid WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'cancel', v_po.status, 'CANCELED', v_uid, v_note);
    ELSIF p_action = 'short_close' THEN
      IF v_po.status <> 'PARTIALLY_RECEIVED' THEN
        RETURN public.ga_po_err(409, 'INVALID_STATE', CASE WHEN v_po.status = 'ORDERED' THEN '這張採購單還沒有任何到貨，不能短收結案，請改用取消'
                                                         WHEN v_po.status = 'RECEIVED' THEN '這張採購單已經全部到貨，請按「結案」'
                                                         ELSE '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，不能短收結案' END, jsonb_build_object('current_status', v_po.status));
      END IF;
      IF v_note IS NULL THEN RETURN public.ga_po_err(400, 'REASON_REQUIRED', '短收結案必須填寫原因'); END IF;
      UPDATE public.ga_purchase_orders SET status = 'CLOSED', closed_by = v_uid, closed_at = now(), short_close_reason = v_note, updated_by = v_uid WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'short_close', 'PARTIALLY_RECEIVED', 'CLOSED', v_uid, v_note);
    ELSE
      IF v_po.status <> 'RECEIVED' THEN
        RETURN public.ga_po_err(409, 'INVALID_STATE', CASE WHEN v_po.status = 'PARTIALLY_RECEIVED' THEN '還有品項沒有到齊，請等到貨完成，或用「短收結案」（須填原因）'
                                                         ELSE '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，不能結案' END, jsonb_build_object('current_status', v_po.status));
      END IF;
      UPDATE public.ga_purchase_orders SET status = 'CLOSED', closed_by = v_uid, closed_at = now(), updated_by = v_uid WHERE id = p_id;
      PERFORM public.ga_po_event(p_id, 'close', 'RECEIVED', 'CLOSED', v_uid, v_note);
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_po_data(p_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 9. 查詢
CREATE OR REPLACE FUNCTION public.ga_ws_po_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_data jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  v_data := public.ga_po_data(p_id);
  IF v_data IS NULL THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_data);
END;
$$;

-- 清單：篩選 { statuses:[...], q, vendor_id, mine, overdue, approvals, request_id }；每頁最多 100；回傳精確總數與統計卡（統計不受篩選影響）。
CREATE OR REPLACE FUNCTION public.ga_ws_po_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_statuses text[];
  v_q text;
  v_pat text;
  v_vendor uuid;
  v_request uuid;
  v_mine boolean;
  v_overdue boolean;
  v_approvals boolean;
  v_today date := public.ga_po_today();
  v_total integer;
  v_rows jsonb;
  v_stats jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  IF jsonb_typeof(v_f) <> 'object' THEN RETURN public.ga_po_err(400, 'FILTER_INVALID', '篩選條件格式錯誤'); END IF;
  v_mine := COALESCE(v_f->>'mine', 'false') IN ('true', 't', '1');
  v_overdue := COALESCE(v_f->>'overdue', 'false') IN ('true', 't', '1');
  v_approvals := COALESCE(v_f->>'approvals', 'false') IN ('true', 't', '1');
  v_q := ga_normalize_optional_text(v_f->>'q');
  IF v_approvals AND NOT has_permission(v_uid, 'general_affairs.purchase_order.approve') THEN
    RETURN public.ga_po_err(403, 'APPROVE_PERMISSION_REQUIRED', '待簽核清單只有持「採購核准」權限的人可以看');
  END IF;
  IF v_f ? 'statuses' AND jsonb_typeof(v_f->'statuses') = 'array' THEN
    SELECT array_agg(x) INTO v_statuses FROM jsonb_array_elements_text(v_f->'statuses') x;
    IF EXISTS (SELECT 1 FROM unnest(v_statuses) s WHERE s NOT IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELED')) THEN
      RETURN public.ga_po_err(400, 'FILTER_INVALID', '狀態篩選錯誤');
    END IF;
  END IF;
  IF ga_normalize_optional_text(v_f->>'vendor_id') IS NOT NULL THEN
    IF (v_f->>'vendor_id') !~* c_uuid THEN RETURN public.ga_po_err(400, 'FILTER_INVALID', '供應商篩選錯誤'); END IF;
    v_vendor := (v_f->>'vendor_id')::uuid;
  END IF;
  IF ga_normalize_optional_text(v_f->>'request_id') IS NOT NULL THEN
    IF (v_f->>'request_id') !~* c_uuid THEN RETURN public.ga_po_err(400, 'FILTER_INVALID', '需求單篩選錯誤'); END IF;
    v_request := (v_f->>'request_id')::uuid;
  END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;

  WITH base AS (
    SELECT o.*, v.name AS vendor_current_name
      FROM public.ga_purchase_orders o LEFT JOIN public.ga_vendors v ON v.id = o.vendor_id
     WHERE (v_statuses IS NULL OR o.status = ANY (v_statuses))
       AND (NOT v_approvals OR o.status = 'PENDING_APPROVAL')
       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)
       AND (NOT v_mine OR o.created_by = v_uid)
       AND (NOT v_overdue OR (o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today))
       AND (v_request IS NULL OR o.source_request_id = v_request OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.request_id = v_request))
       AND (v_pat IS NULL OR o.po_no ILIKE v_pat ESCAPE '\' OR COALESCE(o.vendor_name_snapshot, v.name, '') ILIKE v_pat ESCAPE '\'
            OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.item_name ILIKE v_pat ESCAPE '\'))
  )
  SELECT (SELECT count(*) FROM base)::integer,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', b.id, 'po_no', b.po_no, 'status', b.status, 'status_label', public.ga_po_status_label(b.status),
             'vendor_id', b.vendor_id, 'vendor_name', COALESCE(b.vendor_name_snapshot, b.vendor_current_name),
             'source_request_id', b.source_request_id, 'expected_delivery_date', b.expected_delivery_date,
             'subtotal', b.subtotal, 'tax_amount', b.tax_amount, 'total_amount', b.total_amount, 'approval_required', b.approval_required,
             'item_count', (SELECT count(*) FROM public.ga_purchase_order_items i WHERE i.po_id = b.id),
             'first_item_name', (SELECT i.item_name FROM public.ga_purchase_order_items i WHERE i.po_id = b.id ORDER BY i.line_no LIMIT 1),
             'ordered_qty_base', (SELECT COALESCE(sum(i.quantity_base), 0) FROM public.ga_purchase_order_items i WHERE i.po_id = b.id),
             'received_qty', (SELECT COALESCE(sum(i.received_qty), 0) FROM public.ga_purchase_order_items i WHERE i.po_id = b.id),
             'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),
             'created_by', b.created_by, 'created_by_name', (SELECT full_name FROM public.profiles WHERE id = b.created_by),
             'created_at', b.created_at, 'updated_at', b.updated_at, 'ordered_at', b.ordered_at) ORDER BY b.created_at DESC, b.id)
           FROM (SELECT * FROM base ORDER BY created_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size) b), '[]'::jsonb)
    INTO v_total, v_rows;

  SELECT jsonb_build_object(
      'total', count(*),
      'DRAFT', count(*) FILTER (WHERE status = 'DRAFT'), 'PENDING_APPROVAL', count(*) FILTER (WHERE status = 'PENDING_APPROVAL'),
      'APPROVED', count(*) FILTER (WHERE status = 'APPROVED'), 'ORDERED', count(*) FILTER (WHERE status = 'ORDERED'),
      'PARTIALLY_RECEIVED', count(*) FILTER (WHERE status = 'PARTIALLY_RECEIVED'), 'RECEIVED', count(*) FILTER (WHERE status = 'RECEIVED'),
      'CLOSED', count(*) FILTER (WHERE status = 'CLOSED'), 'CANCELED', count(*) FILTER (WHERE status = 'CANCELED'),
      'overdue', count(*) FILTER (WHERE status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND expected_delivery_date IS NOT NULL AND expected_delivery_date < v_today),
      'mine', count(*) FILTER (WHERE created_by = v_uid))
    INTO v_stats FROM public.ga_purchase_orders;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'stats', v_stats,
                            'vendor_billing_visible', public.ga_po_can_vendor(v_uid));
END;
$$;

-- 歷史價（D9）：同料件最近 N 筆「已下訂以上」採購（ORDERED、PARTIALLY_RECEIVED、RECEIVED、CLOSED）。草稿、待核准、已核准未下訂、已取消不算。
CREATE OR REPLACE FUNCTION public.ga_ws_po_price_history(p_part_id uuid, p_limit integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  IF p_part_id IS NULL THEN RETURN public.ga_po_err(400, 'PART_REQUIRED', '請指定料件'); END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, public.ga_wf_num('po_price_history_limit', 5)::integer), 1), 20);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'po_id', t.po_id, 'po_no', t.po_no, 'ordered_date', t.ordered_date, 'vendor_name', t.vendor_name, 'unit_price', t.unit_price,
      'quantity', t.quantity, 'unit', t.unit, 'status', t.status) ORDER BY t.ordered_at DESC, t.po_no DESC), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT o.id AS po_id, o.po_no, o.ordered_at, (o.ordered_at AT TIME ZONE 'Asia/Taipei')::date AS ordered_date, o.vendor_name_snapshot AS vendor_name,
                 i.unit_price, i.quantity, i.unit, o.status
            FROM public.ga_purchase_order_items i JOIN public.ga_purchase_orders o ON o.id = i.po_id
           WHERE i.part_id = p_part_id AND o.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o.ordered_at IS NOT NULL
           ORDER BY o.ordered_at DESC, o.po_no DESC, i.line_no LIMIT v_limit) t;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_rows, 'limit', v_limit);
END;
$$;

-- 供應商選項：只回狀態為 active 的 ga_vendors；統編與付款條件只給有廠商檢視或管理權限者。
CREATE OR REPLACE FUNCTION public.ga_ws_po_vendor_options(p_q text DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q text := ga_normalize_optional_text(p_q);
  v_pat text;
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_billing boolean;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  v_billing := public.ga_po_can_vendor(v_uid);
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  SELECT count(*)::integer INTO v_total FROM public.ga_vendors v WHERE v.status = 'active' AND (v_pat IS NULL OR v.name ILIKE v_pat ESCAPE '\' OR COALESCE(v.alias, '') ILIKE v_pat ESCAPE '\');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'alias', x.alias, 'vendor_type', x.vendor_type,
           'tax_id', CASE WHEN v_billing THEN x.tax_id END, 'payment_terms', CASE WHEN v_billing THEN x.payment_terms END) ORDER BY x.name, x.id), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT * FROM public.ga_vendors v WHERE v.status = 'active' AND (v_pat IS NULL OR v.name ILIKE v_pat ESCAPE '\' OR COALESCE(v.alias, '') ILIKE v_pat ESCAPE '\')
           ORDER BY v.name, v.id LIMIT v_size OFFSET (v_page - 1) * v_size) x;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'billing_visible', v_billing);
END;
$$;

-- ---------------------------------------------------------------- 10. 設定（核准門檻、稅率、歷史價筆數）
CREATE OR REPLACE FUNCTION public.ga_ws_po_settings_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ver timestamptz;
  v_hist jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  SELECT max(updated_at) INTO v_ver FROM public.ga_workflow_settings WHERE key LIKE 'po\_%';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('setting_key', e.setting_key, 'old_value', e.old_value_num, 'new_value', e.new_value_num, 'actor_id', e.actor_id,
           'actor_name', (SELECT full_name FROM public.profiles WHERE id = e.actor_id), 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_hist FROM (SELECT * FROM public.ga_workflow_setting_events WHERE setting_key LIKE 'po\_%' ORDER BY created_at DESC LIMIT 20) e;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'approval_enabled', public.ga_wf_num('po_approval_enabled', 1) >= 1,
    'approval_threshold', public.ga_wf_num('po_approval_threshold', 5000),
    'tax_rate', public.ga_wf_num('po_tax_rate', 0.05),
    'price_history_limit', public.ga_wf_num('po_price_history_limit', 5)::integer,
    'request_overdue_confirm_days', public.ga_wf_num('request_overdue_confirm_days', 7)::integer,
    'updated_at', v_ver, 'can_edit', has_permission(v_uid, 'general_affairs.purchase_order.approve'), 'history', v_hist));
END;
$$;

-- 調整設定：限持採購核准權限者；每個有變動的鍵都寫一筆紀錄（誰、舊值、新值）。只影響之後送出的單（送核准時才快照門檻）。
CREATE OR REPLACE FUNCTION public.ga_ws_po_settings_set(p_values jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_vals jsonb := COALESCE(p_values, '{}'::jsonb);
  v_ver timestamptz;
  v_key text;
  v_dbkey text;
  v_raw text;
  v_new numeric;
  v_old numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.purchase_order.approve') THEN
    RETURN public.ga_po_err(403, 'APPROVE_PERMISSION_REQUIRED', '只有持「採購核准」權限的人可以調整核准門檻與稅率');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_po_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF jsonb_typeof(v_vals) <> 'object' THEN RETURN public.ga_po_err(400, 'SETTINGS_INVALID', '設定格式錯誤'); END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_vals) LOOP
    IF v_key NOT IN ('approval_enabled', 'approval_threshold', 'tax_rate', 'price_history_limit') THEN
      RETURN public.ga_po_err(400, 'SETTINGS_INVALID', '不支援的設定：' || v_key);
    END IF;
  END LOOP;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_po_settings', 0));
    SELECT max(updated_at) INTO v_ver FROM public.ga_workflow_settings WHERE key LIKE 'po\_%';
    IF v_ver IS DISTINCT FROM p_expected_updated_at THEN
      RETURN public.ga_po_err(409, 'STALE', '設定已被其他人修改過，請重新載入後再調整');
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_vals) ORDER BY 1 LOOP
      v_dbkey := 'po_' || v_key;
      v_raw := lower(btrim(COALESCE(v_vals->>v_key, '')));
      IF v_key = 'approval_enabled' THEN
        v_new := CASE WHEN v_raw IN ('true', '1') THEN 1 WHEN v_raw IN ('false', '0') THEN 0 ELSE NULL END;
        IF v_new IS NULL THEN PERFORM public.ga_po_raise(400, 'SETTINGS_INVALID', '「啟用核准」必須是是或否'); END IF;
      ELSIF v_raw !~ '^[0-9]+(\.[0-9]{1,4})?$' THEN
        PERFORM public.ga_po_raise(400, 'SETTINGS_INVALID', '設定值必須是數字');
      ELSE
        v_new := v_raw::numeric;
        IF v_key = 'approval_threshold' AND v_new > 99999999 THEN PERFORM public.ga_po_raise(400, 'SETTINGS_INVALID', '核准門檻不可超過 99,999,999 元'); END IF;
        IF v_key = 'tax_rate' AND v_new > 0.3 THEN PERFORM public.ga_po_raise(400, 'SETTINGS_INVALID', '稅率必須在 0 到 0.3 之間（例如 0.05 代表 5%）'); END IF;
        IF v_key = 'price_history_limit' AND (v_new < 1 OR v_new > 20 OR v_new <> trunc(v_new)) THEN PERFORM public.ga_po_raise(400, 'SETTINGS_INVALID', '歷史價筆數必須是 1 到 20 的整數'); END IF;
      END IF;
      v_old := public.ga_wf_num(v_dbkey, NULL);
      IF v_old IS DISTINCT FROM v_new THEN
        INSERT INTO public.ga_workflow_settings (key, value_num, updated_by, updated_at) VALUES (v_dbkey, v_new, v_uid, clock_timestamp())
        ON CONFLICT (key) DO UPDATE SET value_num = EXCLUDED.value_num, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
        INSERT INTO public.ga_workflow_setting_events (setting_key, old_value_num, new_value_num, actor_id) VALUES (v_dbkey, v_old, v_new, v_uid);
      END IF;
    END LOOP;
    RETURN public.ga_ws_po_settings_get();
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 11. 舊版「採購到貨入庫」的並存保護
-- 舊版需求單頁的「收貨」按鈕以參考單據 GA_PURCHASE_REVIEW 直接過帳。評估一旦有（未取消的）採購單，改走採購單到貨驗入，避免雙記庫存。
CREATE OR REPLACE FUNCTION public.ga_inventory_tx_block_legacy_po_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.reference_type = 'GA_PURCHASE_REVIEW' AND NEW.reference_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE purchase_review_id = NEW.reference_id AND status <> 'CANCELED') THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_EXISTS: 這張需求單的採購評估已經有採購單，請到採購單用「登錄到貨」入庫，不能再用舊版收貨' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_inventory_tx_block_legacy_po_receipt() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ga_inventory_transactions_block_legacy_po_receipt ON public.ga_inventory_transactions;
CREATE TRIGGER trg_ga_inventory_transactions_block_legacy_po_receipt BEFORE INSERT ON public.ga_inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ga_inventory_tx_block_legacy_po_receipt();

-- ---------------------------------------------------------------- 12. 開放給登入者呼叫（函式內各自驗權限與身分）
REVOKE ALL ON FUNCTION public.ga_ws_po_create(jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_update(uuid, jsonb, jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_from_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_action(uuid, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_get(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_list(jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_price_history(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_vendor_options(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_settings_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_settings_set(jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_request_remaining(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_create(jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_update(uuid, jsonb, jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_from_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_action(uuid, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_list(jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_price_history(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_vendor_options(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_settings_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_settings_set(jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_request_remaining(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname LIKE 'ga_ws_po_%' ORDER BY 1;
-- 核對：應列出 11 個函式（create、update、from_review、action、get、list、price_history、vendor_options、settings_get、settings_set、request_remaining）
SELECT code, action, is_active FROM public.permissions WHERE code = 'general_affairs.purchase_order.approve';
-- 核對：應有 1 列（尚未指派給任何角色，要到角色權限頁勾選）
