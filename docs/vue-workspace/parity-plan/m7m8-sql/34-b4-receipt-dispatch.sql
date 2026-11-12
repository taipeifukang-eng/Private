-- 34-b4-receipt-dispatch.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261112120000_m7m8_b4_receipt_dispatch.sql 相同。
-- 第 4 批 C（到貨驗入、配發轉設備、型號對應料件、序號補填；D3、D12 至 D16）（2026-11-12 第 4 批問卷 D1 至 D21）。
-- 性質：會寫入，新增 4 張表（進貨紀錄、進貨明細、配發單、設備序號補填紀錄）、ga_parts 1 個欄位（equipment_template_id，料件對應設備型號）與 1 個觸發器、ga_equipment 8 個可為空的欄位（來源採購單／品項／進貨明細／配發單／需求單、供應商與名稱快照、保固起算日）、
--   ga_ws_po_receive／ga_ws_po_dispatch／ga_ws_po_receipts_get／ga_ws_onboarding_set_serial 四個對外函式與內部輔助函式；並以 CREATE OR REPLACE 覆蓋 ga_ws_update_part_guarded（只在「允許修改的欄位」清單多一個 equipment_template_id，其餘與 10-g01 逐字相同；撤回時還原成 10-g01 的版本）。
-- 不改任何既有資料；舊版畫面與舊版 API 完全不受影響（舊版建立設備、料件頁都不帶新欄位）。四張新表登入者不能直接讀寫，一律走函式。
-- 重點規則：登錄到貨即驗入（同一交易以 ga_ws_inv_post 入總部倉庫存）；到貨量不得超過剩餘可收量（訂購量減已驗入量，破損拒收不算已驗入）；驗入量不得大於到貨量；
--   驗入量小於到貨量（破損、拒收）或到貨量小於剩餘量（短收）須原因；改收貨位置或改收替代料須變更原因；同識別重送回原結果、併發不超收；STOCK 品項入庫存、DIRECT_ASSET 品項直接建設備送門市（整數量、不入庫）、NO_STOCK 只登錄。
--   配發＝同一交易內出庫 N、建 N 筆設備（資產編號沿用舊版規則，需分類有第二層分類代碼）、依進貨明細先進先出（每台帶自己那批的到貨日當保固起算日與購置日期）、可分次、序號可空；任一步失敗整筆回復；不另要求設備管理權限（D11）。
--   序號補填限該門市店長與設備管理權限者，已有值要改須原因並留紀錄，同型號序號不可重複。設備購價（既有 purchase_amount 欄位）填未稅單價並在備註註明（含稅與否待確認）。
-- 先決條件：先套 32、33；設備與設備型號、庫存位置、廠商、需求單事件等既有資料表存在；ga_ws_inv_post（第 3 批）與 ga_ws_update_part_guarded（10-g01）已套用。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：34-b4-receipt-dispatch-rollback.sql。套用前先跑 31-b4-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_purchase_orders') IS NULL OR to_regclass('public.ga_purchase_order_items') IS NULL OR to_regclass('public.ga_purchase_order_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_purchase_orders（請先套 20261112110000_m7m8_b4_purchase_orders）';
  END IF;
  IF to_regclass('public.ga_equipment') IS NULL OR to_regclass('public.ga_equipment_templates') IS NULL OR to_regclass('public.ga_equipment_categories') IS NULL
     OR to_regclass('public.ga_parts') IS NULL OR to_regclass('public.ga_inventory_transactions') IS NULL OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.store_managers') IS NULL OR to_regclass('public.ga_service_request_events') IS NULL OR to_regclass('public.ga_vendors') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 到貨驗入與配發需要的既有資料表';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_ws_inv_post')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_equipment_level2_category_code')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_ws_update_part_guarded') THEN
    RAISE EXCEPTION 'Missing prerequisite function (ga_ws_inv_post / ga_equipment_level2_category_code / ga_ws_update_part_guarded)';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 料件對應設備型號（D14）
ALTER TABLE public.ga_parts ADD COLUMN IF NOT EXISTS equipment_template_id uuid REFERENCES public.ga_equipment_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ga_parts_equipment_template ON public.ga_parts (equipment_template_id) WHERE equipment_template_id IS NOT NULL;
COMMENT ON COLUMN public.ga_parts.equipment_template_id IS '採購入庫後可轉成的設備型號（D14）：一個料件只對應一個型號，同型號可被多個料件指向；配發為設備時帶入。';

CREATE OR REPLACE FUNCTION public.ga_parts_check_equipment_template() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.equipment_template_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.equipment_template_id IS DISTINCT FROM OLD.equipment_template_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_equipment_templates WHERE id = NEW.equipment_template_id AND deleted_at IS NULL AND is_active) THEN
      RAISE EXCEPTION '對應的設備型號不存在、已停用或已刪除，請重新選擇' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_parts_check_equipment_template ON public.ga_parts;
CREATE TRIGGER trg_ga_parts_check_equipment_template BEFORE INSERT OR UPDATE OF equipment_template_id ON public.ga_parts
  FOR EACH ROW EXECUTE FUNCTION public.ga_parts_check_equipment_template();

-- 料件修改函式：只把 equipment_template_id 加進允許修改的欄位（其餘與 20261109130000 逐字相同）。
CREATE OR REPLACE FUNCTION public.ga_ws_update_part_guarded(p_part_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur ga_parts%ROWTYPE;
  v_usage jsonb;
  v_allowed text[] := ARRAY['category_id','name','part_code','barcode','brand','model','specification','description','notes','base_unit',
    'purchase_unit','purchase_to_base_rate','minimum_issue_qty','allow_fractional_issue','allow_unpacking','is_active','specs','tags','image_path','equipment_template_id'];
  v_unit text[] := ARRAY['base_unit','purchase_unit','purchase_to_base_rate'];
  v_key text;
  v_sets text := '';
  v_changed boolean := false;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '修改內容格式錯誤'); END IF;
  SELECT * INTO v_cur FROM ga_parts WHERE id = p_part_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到料件'); END IF;
  IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這個料件已被其他人修改，請重新載入後再儲存');
  END IF;
  FOR v_key IN SELECT k FROM jsonb_object_keys(p_patch) AS k LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', format('不可修改的欄位：%s', v_key)); END IF;
    v_sets := v_sets || CASE WHEN v_sets = '' THEN '' ELSE ', ' END || format('%I = r.%I', v_key, v_key);
    IF v_key = ANY(v_unit) AND (to_jsonb(v_cur) -> v_key) IS DISTINCT FROM (p_patch -> v_key)
       AND NOT (v_key = 'purchase_to_base_rate' AND (to_jsonb(v_cur) ->> v_key) IS NOT NULL AND (p_patch ->> v_key) IS NOT NULL
                AND (to_jsonb(v_cur) ->> v_key)::numeric = (p_patch ->> v_key)::numeric) THEN
      v_changed := true;
    END IF;
  END LOOP;
  IF v_sets = '' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '沒有要修改的欄位'); END IF;
  IF v_changed THEN
    v_usage := (ga_ws_part_usage(p_part_id))->'data';
    IF (v_usage->>'unit_locked')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'UNIT_LOCKED', 'usage', v_usage,
        'error', '這個料件已有庫存或庫存交易紀錄，基本單位、採購單位與換算率不能再修改；若單位真的要改，請新增另一個料件。');
    END IF;
  END IF;
  BEGIN
    EXECUTE format('UPDATE ga_parts p SET %s, updated_by = $2 FROM jsonb_populate_record(NULL::ga_parts, $1) r WHERE p.id = $3', v_sets)
      USING p_patch, v_uid, p_part_id;
  EXCEPTION WHEN SQLSTATE '23514' THEN
    RETURN jsonb_build_object('ok', false, 'status', 422, 'code', 'TEMPLATE_INVALID', 'error', SQLERRM);
  END;
  SELECT to_jsonb(p) INTO v_row FROM ga_parts p WHERE p.id = p_part_id;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_row);
END;
$$;

-- ---------------------------------------------------------------- 2. 進貨、配發、序號紀錄資料表
CREATE TABLE IF NOT EXISTS public.ga_purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text NOT NULL,
  po_id uuid NOT NULL REFERENCES public.ga_purchase_orders(id) ON DELETE CASCADE,
  received_date date NOT NULL,
  delivery_note_no text,
  notes text,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_purchase_receipts_no_key UNIQUE (receipt_no),
  CONSTRAINT ga_purchase_receipts_idem_key UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_receipts_po ON public.ga_purchase_receipts (po_id, received_date, created_at);

CREATE TABLE IF NOT EXISTS public.ga_purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.ga_purchase_receipts(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES public.ga_purchase_order_items(id) ON DELETE CASCADE,
  delivered_qty numeric(14,4) NOT NULL,
  accepted_qty numeric(14,4) NOT NULL,
  rejected_qty numeric(14,4) NOT NULL,
  accepted_base numeric(14,4) NOT NULL,
  reason text,
  received_part_id uuid REFERENCES public.ga_parts(id),
  location_id uuid REFERENCES public.ga_inventory_locations(id),
  change_reason text,
  inventory_transaction_id uuid REFERENCES public.ga_inventory_transactions(id) ON DELETE SET NULL,
  dispatched_qty numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_purchase_receipt_items_qty_check CHECK (delivered_qty > 0 AND accepted_qty >= 0 AND accepted_qty <= delivered_qty AND rejected_qty = delivered_qty - accepted_qty AND accepted_base >= 0),
  CONSTRAINT ga_purchase_receipt_items_dispatched_check CHECK (dispatched_qty >= 0 AND dispatched_qty <= accepted_base)
);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_receipt_items_receipt ON public.ga_purchase_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_receipt_items_po_item ON public.ga_purchase_receipt_items (po_item_id);

CREATE TABLE IF NOT EXISTS public.ga_stock_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_no text NOT NULL,
  po_item_id uuid NOT NULL REFERENCES public.ga_purchase_order_items(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.ga_parts(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  quantity integer NOT NULL,
  equipment_template_id uuid NOT NULL REFERENCES public.ga_equipment_templates(id),
  template_change_reason text,
  source_location_id uuid NOT NULL REFERENCES public.ga_inventory_locations(id),
  issue_transaction_id uuid REFERENCES public.ga_inventory_transactions(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.ga_service_requests(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_stock_dispatches_no_key UNIQUE (dispatch_no),
  CONSTRAINT ga_stock_dispatches_idem_key UNIQUE (idempotency_key),
  CONSTRAINT ga_stock_dispatches_qty_check CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_ga_stock_dispatches_item ON public.ga_stock_dispatches (po_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ga_stock_dispatches_store ON public.ga_stock_dispatches (store_id);

CREATE TABLE IF NOT EXISTS public.ga_equipment_serial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.ga_equipment(id) ON DELETE CASCADE,
  old_serial text,
  new_serial text NOT NULL,
  reason text,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ga_equipment_serial_events_equipment ON public.ga_equipment_serial_events (equipment_id, created_at);

-- 四張表不開放登入者直接讀寫：RLS 開啟且沒有任何政策，只有 service_role 與 SECURITY DEFINER 函式能存取。
ALTER TABLE public.ga_purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_stock_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_equipment_serial_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_purchase_receipts, public.ga_purchase_receipt_items, public.ga_stock_dispatches, public.ga_equipment_serial_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_purchase_receipts, public.ga_purchase_receipt_items, public.ga_stock_dispatches, public.ga_equipment_serial_events TO service_role;

-- ---------------------------------------------------------------- 3. 設備來源連結與採購資訊（皆可為空，舊畫面不受影響）
ALTER TABLE public.ga_equipment
  ADD COLUMN IF NOT EXISTS source_purchase_order_id uuid REFERENCES public.ga_purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_po_item_id uuid REFERENCES public.ga_purchase_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_receipt_item_id uuid REFERENCES public.ga_purchase_receipt_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_dispatch_id uuid REFERENCES public.ga_stock_dispatches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_request_id uuid REFERENCES public.ga_service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.ga_vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_name_snapshot text,
  ADD COLUMN IF NOT EXISTS warranty_start_date date;
CREATE INDEX IF NOT EXISTS idx_ga_equipment_source_po ON public.ga_equipment (source_purchase_order_id) WHERE source_purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga_equipment_source_dispatch ON public.ga_equipment (source_dispatch_id) WHERE source_dispatch_id IS NOT NULL;
COMMENT ON COLUMN public.ga_equipment.warranty_start_date IS '保固起算日（採購到貨日，台北）；到期日仍看 warranty_end_date。';

-- ---------------------------------------------------------------- 4. 內部輔助（不開放給前端直接呼叫）
-- 單號：RC-YYYYMMDD-NNN／DSP-YYYYMMDD-NNN（台北日期、每日流水歸零、滿 999 擴為四位）。
CREATE OR REPLACE FUNCTION public.ga_next_receipt_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_day text := to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD');
  v_prefix text := 'RC-' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD') || '-';
  v_seq integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_next_receipt_no:' || v_day, 0));
  SELECT COALESCE(max(substring(receipt_no FROM '^RC-[0-9]{8}-([0-9]+)$')::integer), 0) + 1 INTO v_seq FROM public.ga_purchase_receipts WHERE receipt_no LIKE v_prefix || '%';
  RETURN v_prefix || CASE WHEN v_seq < 1000 THEN lpad(v_seq::text, 3, '0') ELSE v_seq::text END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_next_dispatch_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_day text := to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD');
  v_prefix text := 'DSP-' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD') || '-';
  v_seq integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_next_dispatch_no:' || v_day, 0));
  SELECT COALESCE(max(substring(dispatch_no FROM '^DSP-[0-9]{8}-([0-9]+)$')::integer), 0) + 1 INTO v_seq FROM public.ga_stock_dispatches WHERE dispatch_no LIKE v_prefix || '%';
  RETURN v_prefix || CASE WHEN v_seq < 1000 THEN lpad(v_seq::text, 3, '0') ELSE v_seq::text END;
END;
$$;

-- 品項單位對應過帳的輸入單位：等於基本單位 = BASE、等於採購單位（且換算率有效）= PURCHASE，其他 NULL。
CREATE OR REPLACE FUNCTION public.ga_po_unit_type(p_part_id uuid, p_unit text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE WHEN p.base_unit = p_unit THEN 'BASE' WHEN p.purchase_unit IS NOT NULL AND p.purchase_unit = p_unit AND p.purchase_to_base_rate > 0 THEN 'PURCHASE' END
        FROM public.ga_parts p WHERE p.id = p_part_id; $$;

-- 序號是否已被其他未刪除設備使用：同型號（template_id 相同），或同品牌＋同型號字樣。比對不分大小寫。
CREATE OR REPLACE FUNCTION public.ga_po_serial_conflict(p_template_id uuid, p_serial text, p_exclude_equipment_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ga_equipment e, public.ga_equipment_templates t
     WHERE t.id = p_template_id AND e.deleted_at IS NULL AND upper(btrim(e.serial_number)) = upper(btrim(p_serial))
       AND (p_exclude_equipment_id IS NULL OR e.id <> p_exclude_equipment_id)
       AND (e.template_id = t.id OR (t.brand IS NOT NULL AND t.model IS NOT NULL AND upper(e.brand) = upper(t.brand) AND upper(e.model) = upper(t.model))));
$$;

-- 建立一台設備（沿用舊版建立設備規則：資產編號由 ga_next_equipment_asset_code 依第二層分類代碼＋購置日期取號，資料庫有唯一索引防重複；QR 在第一次列印時才發放，與舊版相同）。
-- 型號帶入分類、名稱、品牌、型號、規格；購置日期 = 到貨日；購價 = 未稅單價；保固起算日 = 到貨日，型號有預設保固月數才推算到期日。
CREATE OR REPLACE FUNCTION public.ga_po_make_equipment(
  p_template_id uuid, p_store_id uuid, p_serial text, p_receipt_date date, p_unit_price numeric,
  p_po_id uuid, p_po_item_id uuid, p_receipt_item_id uuid, p_dispatch_id uuid, p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_t public.ga_equipment_templates%ROWTYPE;
  v_c public.ga_equipment_categories%ROWTYPE;
  v_po public.ga_purchase_orders%ROWTYPE;
  v_vname text;
  v_months integer;
  v_id uuid;
  v_serial text := ga_normalize_optional_text(p_serial);
BEGIN
  SELECT * INTO v_t FROM public.ga_equipment_templates WHERE id = p_template_id AND deleted_at IS NULL AND is_active;
  IF NOT FOUND THEN PERFORM public.ga_po_raise(422, 'TEMPLATE_INVALID', '設備型號不存在或已停用，請改選其他型號'); END IF;
  SELECT * INTO v_c FROM public.ga_equipment_categories WHERE id = v_t.category_id;
  IF v_c.requires_brand AND ga_normalize_optional_text(v_t.brand) IS NULL THEN PERFORM public.ga_po_raise(422, 'TEMPLATE_INCOMPLETE', '設備型號「' || v_t.name || '」沒有品牌，但這個分類要求品牌，請先到設備型號補齊'); END IF;
  IF v_c.requires_model AND ga_normalize_optional_text(v_t.model) IS NULL THEN PERFORM public.ga_po_raise(422, 'TEMPLATE_INCOMPLETE', '設備型號「' || v_t.name || '」沒有型號，但這個分類要求型號，請先到設備型號補齊'); END IF;
  IF v_c.requires_serial_number AND v_serial IS NULL THEN PERFORM public.ga_po_raise(422, 'SERIAL_REQUIRED', '設備型號「' || v_t.name || '」的分類要求填寫序號，配發時請填序號'); END IF;
  -- 資產編號：舊版規則要求分類有「第二層分類代碼」。無法取號就明講，不要讓整批以資料庫原文失敗。
  BEGIN
    PERFORM public.ga_equipment_level2_category_code(v_t.category_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.ga_po_raise(422, 'ASSET_CODE_UNAVAILABLE', '設備型號「' || v_t.name || '」的分類無法產生資產編號（' || SQLERRM || '），請先到設備分類補齊第二層分類代碼');
  END;
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id;
  SELECT COALESCE(v_po.vendor_name_snapshot, (SELECT name FROM public.ga_vendors WHERE id = v_po.vendor_id)) INTO v_vname;
  v_months := CASE WHEN COALESCE(v_t.default_warranty_months, 0) > 0 THEN v_t.default_warranty_months END;
  INSERT INTO public.ga_equipment (store_id, category_id, template_id, name, brand, model, serial_number, status, purpose, specs, purchased_at, purchase_amount,
                                   has_warranty, warranty_start_date, warranty_end_date, notes, vendor_id, vendor_name_snapshot,
                                   source_purchase_order_id, source_po_item_id, source_receipt_item_id, source_dispatch_id, source_request_id)
  VALUES (p_store_id, v_t.category_id, v_t.id, v_t.name, v_t.brand, v_t.model, v_serial, 'ACTIVE', v_t.description, COALESCE(v_t.specs, '{}'::jsonb), p_receipt_date, p_unit_price,
          v_months IS NOT NULL, p_receipt_date, CASE WHEN v_months IS NOT NULL THEN (p_receipt_date + make_interval(months => v_months))::date END,
          '採購單 ' || v_po.po_no || ' 驗入建立；購價為未稅單價', v_po.vendor_id, v_vname,
          p_po_id, p_po_item_id, p_receipt_item_id, p_dispatch_id, p_request_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 進貨紀錄（含明細與直接建立的設備）。
CREATE OR REPLACE FUNCTION public.ga_po_receipt_data(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r public.ga_purchase_receipts%ROWTYPE;
  v_items jsonb;
BEGIN
  SELECT * INTO v_r FROM public.ga_purchase_receipts WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', ri.id, 'po_item_id', ri.po_item_id, 'line_no', i.line_no, 'item_name', i.item_name, 'unit', i.unit, 'fulfil_mode', i.fulfil_mode,
      'delivered_qty', ri.delivered_qty, 'accepted_qty', ri.accepted_qty, 'rejected_qty', ri.rejected_qty, 'accepted_base', ri.accepted_base,
      'reason', ri.reason, 'received_part_id', ri.received_part_id, 'received_part_name', rp.name, 'location_id', ri.location_id, 'location_name', l.name,
      'change_reason', ri.change_reason, 'inventory_transaction_id', ri.inventory_transaction_id, 'dispatched_qty', ri.dispatched_qty,
      'equipment', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'asset_code', e.asset_code, 'name', e.name, 'store_id', e.store_id, 'serial_number', e.serial_number,
                                    'onboarding_status', e.onboarding_status, 'warranty_start_date', e.warranty_start_date) ORDER BY e.asset_code NULLS LAST, e.created_at, e.id), '[]'::jsonb)
                      FROM public.ga_equipment e WHERE e.source_receipt_item_id = ri.id AND e.source_dispatch_id IS NULL AND e.deleted_at IS NULL)
    ) ORDER BY i.line_no), '[]'::jsonb)
    INTO v_items
    FROM public.ga_purchase_receipt_items ri
    JOIN public.ga_purchase_order_items i ON i.id = ri.po_item_id
    LEFT JOIN public.ga_parts rp ON rp.id = ri.received_part_id
    LEFT JOIN public.ga_inventory_locations l ON l.id = ri.location_id
   WHERE ri.receipt_id = p_id;
  RETURN (to_jsonb(v_r) - 'idempotency_key' - 'payload_hash') || jsonb_build_object(
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items);
END;
$$;

-- 配發單（含建立的設備）。設備依資產編號排序（同一交易內建立時 created_at 相同，資產編號才反映建立順序，也就是序號清單的對應順序）。
CREATE OR REPLACE FUNCTION public.ga_po_dispatch_data(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_d public.ga_stock_dispatches%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.ga_stock_dispatches WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN (to_jsonb(v_d) - 'idempotency_key' - 'payload_hash') || jsonb_build_object(
    'store_name', (SELECT COALESCE(short_name, store_name) FROM public.stores WHERE id = v_d.store_id),
    'part_name', (SELECT name FROM public.ga_parts WHERE id = v_d.part_id),
    'template_name', (SELECT name FROM public.ga_equipment_templates WHERE id = v_d.equipment_template_id),
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_d.created_by),
    'equipment', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'asset_code', e.asset_code, 'name', e.name, 'serial_number', e.serial_number,
                           'onboarding_status', e.onboarding_status, 'warranty_start_date', e.warranty_start_date, 'warranty_end_date', e.warranty_end_date,
                           'source_receipt_item_id', e.source_receipt_item_id, 'purchase_amount', e.purchase_amount) ORDER BY e.asset_code NULLS LAST, e.created_at, e.id), '[]'::jsonb)
                    FROM public.ga_equipment e WHERE e.source_dispatch_id = v_d.id));
END;
$$;

-- 驗入／配發寫入同步到需求單時間軸（內部可見，不推播）。
CREATE OR REPLACE FUNCTION public.ga_po_request_timeline(p_request_id uuid, p_type text, p_title text, p_desc text, p_meta jsonb, p_uid uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ INSERT INTO public.ga_service_request_events (request_id, event_type, visibility, title, description, metadata, created_by, created_by_name)
      VALUES (p_request_id, p_type, 'INTERNAL', p_title, p_desc, COALESCE(p_meta, '{}'::jsonb), p_uid, (SELECT full_name FROM public.profiles WHERE id = p_uid)); $$;

-- ---------------------------------------------------------------- 5. 登錄到貨並驗入（D12、D13、D3、D16）
-- p_header：{ received_date?, delivery_note_no?, notes? }；p_lines：[{ po_item_id, delivered_qty, accepted_qty?, reason?, location_id?, received_part_id?, change_reason? }]
CREATE OR REPLACE FUNCTION public.ga_ws_po_receive(p_po_id uuid, p_header jsonb, p_lines jsonb, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_num constant text := '^[0-9]+(\.[0-9]{1,4})?$';
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_key text := ga_normalize_optional_text(p_key);
  v_hash text;
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
  v_prev public.ga_purchase_receipts%ROWTYPE;
  v_po public.ga_purchase_orders%ROWTYPE;
  v_today date := public.ga_po_today();
  v_date date;
  v_txt text;
  v_dn text;
  v_note text;
  v_rid uuid;
  v_rno text;
  v_line jsonb;
  v_no integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_item public.ga_purchase_order_items%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_rpart public.ga_parts%ROWTYPE;
  v_iid uuid;
  v_deliv numeric;
  v_acc numeric;
  v_remain numeric;
  v_ratio numeric;
  v_acc_base numeric;
  v_reason text;
  v_chg text;
  v_loc uuid;
  v_utype text;
  v_tpl uuid;
  v_res jsonb;
  v_riid uuid;
  v_txid uuid;
  v_occ timestamptz;
  v_k integer;
  v_price numeric;
  v_new_status text;
  v_summary jsonb := '[]'::jsonb;
  v_reqs uuid[] := ARRAY[]::uuid[];
  v_r uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_po_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF v_key IS NULL OR length(v_key) > 64 THEN RETURN public.ga_po_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼（最長 64 字），請重新整理畫面後再送出'); END IF;
  IF jsonb_typeof(v_header) <> 'object' THEN RETURN public.ga_po_err(400, 'HEADER_INVALID', '到貨資料格式錯誤'); END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RETURN public.ga_po_err(400, 'LINES_REQUIRED', '請至少登錄一個品項的到貨'); END IF;
  IF jsonb_array_length(p_lines) > 50 THEN RETURN public.ga_po_err(400, 'TOO_MANY_ITEMS', '一次最多登錄 50 個品項'); END IF;
  v_hash := md5(jsonb_build_object('po', p_po_id, 'h', v_header, 'l', p_lines)::text);
  BEGIN
    SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
    -- 重送（同識別）：鎖住採購單後再查，併發的同識別請求會依序拿到同一份結果。
    SELECT * INTO v_prev FROM public.ga_purchase_receipts WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF v_prev.payload_hash = v_hash AND v_prev.po_id = p_po_id THEN
        RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', true, 'data', public.ga_po_receipt_data(v_prev.id), 'po', public.ga_po_data(p_po_id));
      END IF;
      RETURN public.ga_po_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一筆不同內容的到貨使用，請重新整理畫面後再送出');
    END IF;
    IF v_po.status NOT IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN
      RETURN public.ga_po_err(409, 'INVALID_STATE', CASE v_po.status WHEN 'RECEIVED' THEN '這張採購單已經全部到貨，不能再登錄到貨' WHEN 'CLOSED' THEN '這張採購單已結案，不能再登錄到貨'
        WHEN 'CANCELED' THEN '這張採購單已取消，不能登錄到貨' ELSE '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，還沒有下訂，不能登錄到貨' END, jsonb_build_object('current_status', v_po.status));
    END IF;
    -- 到貨日（台北，不可未來，不可早於下訂日）
    v_txt := ga_normalize_optional_text(v_header->>'received_date');
    IF v_txt IS NULL THEN v_date := v_today;
    ELSE
      IF v_txt !~ '^\d{4}-\d{2}-\d{2}$' THEN PERFORM public.ga_po_raise(400, 'DATE_INVALID', '到貨日期格式錯誤（YYYY-MM-DD）'); END IF;
      BEGIN v_date := v_txt::date; EXCEPTION WHEN OTHERS THEN PERFORM public.ga_po_raise(400, 'DATE_INVALID', '到貨日期不存在'); END;
      IF v_date > v_today THEN PERFORM public.ga_po_raise(400, 'FUTURE_DATE', '到貨日期不可晚於今天'); END IF;
      IF v_po.ordered_at IS NOT NULL AND v_date < (v_po.ordered_at AT TIME ZONE 'Asia/Taipei')::date THEN
        PERFORM public.ga_po_raise(422, 'DATE_BEFORE_ORDER', '到貨日期不可早於下訂日（' || to_char(v_po.ordered_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') || '）');
      END IF;
    END IF;
    v_dn := ga_normalize_optional_text(v_header->>'delivery_note_no');
    IF v_dn IS NOT NULL AND length(v_dn) > 60 THEN PERFORM public.ga_po_raise(400, 'DELIVERY_NOTE_TOO_LONG', '送貨單號不可超過 60 字'); END IF;
    v_note := ga_normalize_optional_text(v_header->>'notes');
    IF v_note IS NOT NULL AND length(v_note) > 500 THEN PERFORM public.ga_po_raise(400, 'NOTES_TOO_LONG', '備註不可超過 500 字'); END IF;
    v_rno := public.ga_next_receipt_no();
    INSERT INTO public.ga_purchase_receipts (receipt_no, po_id, received_date, delivery_note_no, notes, idempotency_key, payload_hash, created_by)
    VALUES (v_rno, p_po_id, v_date, v_dn, v_note, v_key, v_hash, v_uid) RETURNING id INTO v_rid;
    v_occ := CASE WHEN v_date = v_today THEN NULL ELSE ((v_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Taipei') END;
    -- 內部流程旗標：ga_ws_inv_post 只在這個旗標存在時才接受參考單據（交易內有效）。
    PERFORM set_config('app.ga_inv_internal_post', 'true', true);

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      v_no := v_no + 1;
      IF jsonb_typeof(v_line) <> 'object' THEN PERFORM public.ga_po_raise(400, 'LINE_INVALID', '第 ' || v_no || ' 列格式錯誤'); END IF;
      v_txt := ga_normalize_optional_text(v_line->>'po_item_id');
      IF v_txt IS NULL OR v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'LINE_INVALID', '第 ' || v_no || ' 列缺少品項'); END IF;
      v_iid := v_txt::uuid;
      IF v_iid = ANY (v_seen) THEN PERFORM public.ga_po_raise(400, 'DUPLICATE_ITEM', '同一個品項在這次到貨中重複出現，請合併成一列'); END IF;
      v_seen := array_append(v_seen, v_iid);
      SELECT * INTO v_item FROM public.ga_purchase_order_items WHERE id = v_iid AND po_id = p_po_id FOR UPDATE;
      IF NOT FOUND THEN PERFORM public.ga_po_raise(404, 'ITEM_NOT_FOUND', '第 ' || v_no || ' 列的品項不屬於這張採購單'); END IF;
      -- 數量
      v_txt := ga_normalize_optional_text(v_line->>'delivered_qty');
      IF v_txt IS NULL OR v_txt !~ c_num THEN PERFORM public.ga_po_raise(400, 'INVALID_QUANTITY', '「' || v_item.item_name || '」的到貨量必須大於 0，最多 4 位小數'); END IF;
      v_deliv := v_txt::numeric;
      IF v_deliv <= 0 THEN PERFORM public.ga_po_raise(400, 'INVALID_QUANTITY', '「' || v_item.item_name || '」的到貨量必須大於 0，最多 4 位小數'); END IF;
      v_txt := ga_normalize_optional_text(v_line->>'accepted_qty');
      IF v_txt IS NULL THEN v_acc := v_deliv;
      ELSE
        IF v_txt !~ c_num THEN PERFORM public.ga_po_raise(400, 'INVALID_QUANTITY', '「' || v_item.item_name || '」的驗入量必須是 0 以上的數字，最多 4 位小數'); END IF;
        v_acc := v_txt::numeric;
      END IF;
      IF v_acc > v_deliv THEN PERFORM public.ga_po_raise(400, 'ACCEPTED_EXCEEDS_DELIVERED', '「' || v_item.item_name || '」的驗入量（' || public.ga_po_fmt(v_acc) || '）不可大於到貨量（' || public.ga_po_fmt(v_deliv) || '）'); END IF;
      v_remain := v_item.quantity - v_item.received_qty;
      IF v_deliv > v_remain THEN
        PERFORM public.ga_po_raise(409, 'OVER_RECEIVE', '「' || v_item.item_name || '」的到貨量 ' || public.ga_po_fmt(v_deliv) || ' 超過剩餘可收量 ' || public.ga_po_fmt(v_remain) || '（訂購 ' || public.ga_po_fmt(v_item.quantity) || '、已驗入 ' || public.ga_po_fmt(v_item.received_qty) || '）',
          jsonb_build_object('po_item_id', v_iid, 'remaining', v_remain));
      END IF;
      -- 原因：破損或拒收（驗入量小於到貨量）或短收（到貨量小於剩餘可收量）都要填
      v_reason := ga_normalize_optional_text(v_line->>'reason');
      IF v_reason IS NOT NULL AND length(v_reason) > 200 THEN PERFORM public.ga_po_raise(400, 'REASON_TOO_LONG', '原因不可超過 200 字'); END IF;
      IF (v_acc < v_deliv OR v_deliv < v_remain) AND v_reason IS NULL THEN
        PERFORM public.ga_po_raise(400, 'REASON_REQUIRED', '「' || v_item.item_name || '」' || CASE WHEN v_acc < v_deliv THEN '有破損或拒收（驗入量小於到貨量）' ELSE '到貨量小於剩餘可收量（短收）' END || '，必須填寫原因');
      END IF;
      v_chg := ga_normalize_optional_text(v_line->>'change_reason');
      IF v_chg IS NOT NULL AND length(v_chg) > 200 THEN PERFORM public.ga_po_raise(400, 'REASON_TOO_LONG', '變更原因不可超過 200 字'); END IF;
      v_ratio := v_item.quantity_base / v_item.quantity;
      v_acc_base := round(v_acc * v_ratio, 4);
      v_loc := NULL; v_rpart := NULL; v_utype := NULL; v_txid := NULL;

      IF v_item.fulfil_mode = 'STOCK' THEN
        -- 收貨位置：預設採購單收貨位置，要改須填變更原因
        v_txt := ga_normalize_optional_text(v_line->>'location_id');
        IF v_txt IS NOT NULL AND v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'LINE_INVALID', '第 ' || v_no || ' 列的收貨位置格式錯誤'); END IF;
        v_loc := COALESCE(v_txt::uuid, v_po.receiving_location_id);
        IF v_loc IS NULL THEN PERFORM public.ga_po_raise(422, 'RECEIVING_LOCATION_REQUIRED', '「' || v_item.item_name || '」要入庫存，請選擇收貨位置'); END IF;
        PERFORM public.ga_po_check_location(v_loc);
        IF v_loc IS DISTINCT FROM v_po.receiving_location_id AND v_chg IS NULL THEN
          PERFORM public.ga_po_raise(400, 'CHANGE_REASON_REQUIRED', '「' || v_item.item_name || '」改了收貨位置（與採購單不同），必須填寫變更原因');
        END IF;
        -- 收到的料件：預設採購單的料件，改收替代料須填變更原因
        v_txt := ga_normalize_optional_text(v_line->>'received_part_id');
        IF v_txt IS NOT NULL AND v_txt !~* c_uuid THEN PERFORM public.ga_po_raise(400, 'LINE_INVALID', '第 ' || v_no || ' 列的收到料件格式錯誤'); END IF;
        SELECT * INTO v_rpart FROM public.ga_parts WHERE id = COALESCE(v_txt::uuid, v_item.part_id) AND deleted_at IS NULL;
        IF NOT FOUND THEN PERFORM public.ga_po_raise(404, 'PART_NOT_FOUND', '「' || v_item.item_name || '」收到的料件不存在或已被刪除'); END IF;
        IF NOT v_rpart.is_active THEN PERFORM public.ga_po_raise(409, 'PART_INACTIVE', '料件「' || v_rpart.name || '」已停用，不能驗入'); END IF;
        IF v_rpart.id IS DISTINCT FROM v_item.part_id AND v_chg IS NULL THEN
          PERFORM public.ga_po_raise(400, 'CHANGE_REASON_REQUIRED', '「' || v_item.item_name || '」改收了替代料件（與採購單不同），必須填寫變更原因');
        END IF;
        v_utype := public.ga_po_unit_type(v_rpart.id, v_item.unit);
        IF v_utype IS NULL THEN
          PERFORM public.ga_po_raise(422, 'SUBSTITUTE_UNIT_MISMATCH', '料件「' || v_rpart.name || '」沒有「' || v_item.unit || '」這個單位（基本單位 ' || v_rpart.base_unit || COALESCE('、採購單位 ' || v_rpart.purchase_unit, '') || '），不能用來驗入這個品項');
        END IF;
      ELSE
        IF ga_normalize_optional_text(v_line->>'location_id') IS NOT NULL OR ga_normalize_optional_text(v_line->>'received_part_id') IS NOT NULL THEN
          PERFORM public.ga_po_raise(400, 'LINE_INVALID', '「' || v_item.item_name || '」不入庫存，不能指定收貨位置或收到的料件');
        END IF;
        IF v_item.fulfil_mode = 'DIRECT_ASSET' AND v_acc_base <> trunc(v_acc_base) THEN
          PERFORM public.ga_po_raise(422, 'ASSET_QUANTITY_INTEGER', '「' || v_item.item_name || '」要直接建立設備，驗入量換算成基本單位後必須是整數');
        END IF;
      END IF;

      INSERT INTO public.ga_purchase_receipt_items (receipt_id, po_item_id, delivered_qty, accepted_qty, rejected_qty, accepted_base, reason, received_part_id, location_id, change_reason)
      VALUES (v_rid, v_iid, v_deliv, v_acc, v_deliv - v_acc, v_acc_base, v_reason, v_rpart.id, v_loc, v_chg) RETURNING id INTO v_riid;

      IF v_item.fulfil_mode = 'STOCK' AND v_acc > 0 THEN
        v_res := public.ga_ws_inv_post('RECEIPT', v_loc, v_rpart.id, v_acc, v_utype, '採購到貨驗入：' || v_rno, v_note,
          v_key || ':RC:' || v_iid::text, v_occ, 'GA_PURCHASE_ORDER', p_po_id,
          jsonb_build_object('po_no', v_po.po_no, 'receipt_no', v_rno, 'po_item_id', v_iid, 'receipt_item_id', v_riid));
        IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%', v_res::text USING ERRCODE = 'GA001'; END IF;
        v_txid := (v_res->'data'->>'transaction_id')::uuid;
        UPDATE public.ga_purchase_receipt_items SET inventory_transaction_id = v_txid WHERE id = v_riid;
      ELSIF v_item.fulfil_mode = 'DIRECT_ASSET' AND v_acc_base > 0 THEN
        SELECT COALESCE(v_item.equipment_template_id, p.equipment_template_id) INTO v_tpl FROM (SELECT 1) x LEFT JOIN public.ga_parts p ON p.id = v_item.part_id;
        IF v_tpl IS NULL THEN PERFORM public.ga_po_raise(422, 'TEMPLATE_REQUIRED', '「' || v_item.item_name || '」要直接建立設備，請先在採購單品項選設備型號（料件沒有對應型號）'); END IF;
        v_price := round(v_item.unit_price / v_ratio, 2);
        FOR v_k IN 1..v_acc_base::integer LOOP
          PERFORM public.ga_po_make_equipment(v_tpl, v_item.target_store_id, NULL, v_date, v_price, p_po_id, v_iid, v_riid, NULL, v_item.request_id);
        END LOOP;
      END IF;

      UPDATE public.ga_purchase_order_items SET received_qty = received_qty + v_acc WHERE id = v_iid;
      IF v_acc > 0 AND v_item.request_id IS NOT NULL AND NOT (v_item.request_id = ANY (v_reqs)) THEN v_reqs := array_append(v_reqs, v_item.request_id); END IF;
      v_summary := v_summary || jsonb_build_array(jsonb_build_object('po_item_id', v_iid, 'item_name', v_item.item_name, 'delivered_qty', v_deliv, 'accepted_qty', v_acc,
        'fulfil_mode', v_item.fulfil_mode, 'reason', v_reason, 'change_reason', v_chg));
    END LOOP;
    PERFORM set_config('app.ga_inv_internal_post', 'false', true);

    IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_order_items WHERE po_id = p_po_id AND received_qty < quantity) THEN v_new_status := 'RECEIVED';
    ELSIF EXISTS (SELECT 1 FROM public.ga_purchase_order_items WHERE po_id = p_po_id AND received_qty > 0) THEN v_new_status := 'PARTIALLY_RECEIVED';
    ELSE v_new_status := v_po.status; END IF;
    UPDATE public.ga_purchase_orders SET status = v_new_status, updated_by = v_uid WHERE id = p_po_id;
    PERFORM public.ga_po_event(p_po_id, 'receive', v_po.status, v_new_status, v_uid, v_note,
      jsonb_build_object('receipt_id', v_rid, 'receipt_no', v_rno, 'received_date', v_date, 'delivery_note_no', v_dn, 'lines', v_summary));
    FOR v_r IN SELECT x FROM unnest(v_reqs) x ORDER BY x LOOP
      PERFORM public.ga_po_request_timeline(v_r, 'PURCHASE_ORDER_RECEIVED', '採購單 ' || v_po.po_no || ' 到貨驗入（' || v_rno || '）', NULL,
        jsonb_build_object('po_id', p_po_id, 'po_no', v_po.po_no, 'receipt_no', v_rno), v_uid);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 6. 配發轉設備（D15、D14）
-- 配發：同一交易內 ISSUE 出庫 N、建 N 筆設備、依進貨明細先進先出分配、寫配發單與事件。
-- p_serials：序號清單（最多 N 個，依順序給第 1、2…台；空字串或 null = 先不填，之後由店長貼標時補）。
CREATE OR REPLACE FUNCTION public.ga_ws_po_dispatch(
  p_po_item_id uuid, p_store_id uuid, p_quantity numeric, p_template_id uuid, p_template_reason text,
  p_source_location_id uuid, p_serials jsonb, p_notes text, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_key text := ga_normalize_optional_text(p_key);
  v_hash text;
  v_note text := ga_normalize_optional_text(p_notes);
  v_reason text := ga_normalize_optional_text(p_template_reason);
  v_prev public.ga_stock_dispatches%ROWTYPE;
  v_item public.ga_purchase_order_items%ROWTYPE;
  v_po public.ga_purchase_orders%ROWTYPE;
  v_poid uuid;
  v_store public.stores%ROWTYPE;
  v_n integer;
  v_src uuid;
  v_gpart uuid;
  v_map uuid;
  v_tpl uuid;
  v_tpl_row public.ga_equipment_templates%ROWTYPE;
  v_avail numeric;
  v_left integer;
  v_take integer;
  v_ri record;
  v_did uuid;
  v_dno text;
  v_res jsonb;
  v_idx integer := 0;
  v_serial text;
  v_serials text[] := ARRAY[]::text[];
  v_el jsonb;
  v_ratio numeric;
  v_price numeric;
  v_req uuid;
  v_k integer;
  v_eids uuid[] := ARRAY[]::uuid[];
  v_dist jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_po_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF v_key IS NULL OR length(v_key) > 64 THEN RETURN public.ga_po_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼（最長 64 字），請重新整理畫面後再送出'); END IF;
  IF p_po_item_id IS NULL OR p_store_id IS NULL THEN RETURN public.ga_po_err(400, 'ARGS_REQUIRED', '請指定採購品項與配發的門市'); END IF;
  IF p_quantity IS NULL OR p_quantity <> trunc(p_quantity) OR p_quantity < 1 OR p_quantity > 200 THEN RETURN public.ga_po_err(400, 'INVALID_QUANTITY', '配發數量必須是 1 至 200 的整數（每台設備一筆）'); END IF;
  v_n := p_quantity::integer;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RETURN public.ga_po_err(400, 'NOTES_TOO_LONG', '備註不可超過 500 字'); END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 200 THEN RETURN public.ga_po_err(400, 'REASON_TOO_LONG', '原因不可超過 200 字'); END IF;
  IF p_serials IS NOT NULL AND jsonb_typeof(p_serials) <> 'array' THEN RETURN public.ga_po_err(400, 'SERIALS_INVALID', '序號清單格式錯誤'); END IF;
  IF p_serials IS NOT NULL AND jsonb_array_length(p_serials) > v_n THEN RETURN public.ga_po_err(400, 'TOO_MANY_SERIALS', '序號數量（' || jsonb_array_length(p_serials) || '）不可超過配發數量（' || v_n || '）'); END IF;
  v_hash := md5(jsonb_build_object('i', p_po_item_id, 's', p_store_id, 'q', v_n, 't', p_template_id, 'r', v_reason, 'l', p_source_location_id, 'sr', COALESCE(p_serials, '[]'::jsonb), 'n', v_note)::text);
  BEGIN
    SELECT po_id INTO v_poid FROM public.ga_purchase_order_items WHERE id = p_po_item_id;
    IF v_poid IS NULL THEN RETURN public.ga_po_err(404, 'ITEM_NOT_FOUND', '找不到這個採購品項'); END IF;
    SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = v_poid FOR UPDATE;
    SELECT * INTO v_item FROM public.ga_purchase_order_items WHERE id = p_po_item_id FOR UPDATE;
    SELECT * INTO v_prev FROM public.ga_stock_dispatches WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF v_prev.payload_hash = v_hash THEN
        RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', true, 'data', public.ga_po_dispatch_data(v_prev.id), 'po', public.ga_po_data(v_po.id));
      END IF;
      RETURN public.ga_po_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一筆不同內容的配發使用，請重新整理畫面後再送出');
    END IF;
    IF v_item.fulfil_mode <> 'STOCK' OR v_item.part_id IS NULL THEN
      RETURN public.ga_po_err(409, 'NOT_DISPATCHABLE', '「' || v_item.item_name || '」不是入總部庫存的品項，不能配發為設備' || CASE WHEN v_item.fulfil_mode = 'DIRECT_ASSET' THEN '（它在到貨驗入時已直接建立設備）' ELSE '' END);
    END IF;
    IF v_po.status NOT IN ('PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') THEN
      RETURN public.ga_po_err(409, 'INVALID_STATE', '這張採購單目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，還沒有驗入的庫存可以配發', jsonb_build_object('current_status', v_po.status));
    END IF;
    SELECT * INTO v_store FROM public.stores WHERE id = p_store_id;
    IF NOT FOUND THEN PERFORM public.ga_po_raise(404, 'STORE_NOT_FOUND', '找不到這間門市'); END IF;
    IF NOT v_store.is_active THEN PERFORM public.ga_po_raise(422, 'STORE_INACTIVE', '門市「' || COALESCE(v_store.short_name, v_store.store_name) || '」已停用，不能配發'); END IF;
    v_src := COALESCE(p_source_location_id, v_po.receiving_location_id);
    IF v_src IS NULL THEN PERFORM public.ga_po_raise(422, 'SOURCE_LOCATION_REQUIRED', '請選擇出庫的來源位置'); END IF;
    PERFORM public.ga_po_check_location(v_src);

    -- 先進先出：以最早的可配發進貨明細決定料件（同一次配發只動同一種料件），可配發量 = 同位置同料件各進貨明細「驗入量 − 已配發量」的加總。
    SELECT ri.received_part_id INTO v_gpart
      FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_receipts r ON r.id = ri.receipt_id
     WHERE ri.po_item_id = p_po_item_id AND ri.inventory_transaction_id IS NOT NULL AND ri.location_id = v_src AND ri.accepted_base - ri.dispatched_qty > 0
     ORDER BY r.received_date, r.created_at, ri.id LIMIT 1;
    IF v_gpart IS NULL THEN
      PERFORM public.ga_po_raise(409, 'NOTHING_TO_DISPATCH', '「' || v_item.item_name || '」在這個位置沒有可配發的已驗入庫存（可能已全部配發，或庫存收在別的位置）');
    END IF;
    SELECT COALESCE(sum(ri.accepted_base - ri.dispatched_qty), 0) INTO v_avail
      FROM public.ga_purchase_receipt_items ri
     WHERE ri.po_item_id = p_po_item_id AND ri.inventory_transaction_id IS NOT NULL AND ri.location_id = v_src AND ri.received_part_id = v_gpart AND ri.accepted_base - ri.dispatched_qty > 0;
    IF v_n > v_avail THEN
      PERFORM public.ga_po_raise(409, 'OVER_DISPATCH', '配發數量 ' || v_n || ' 超過可配發量 ' || public.ga_po_fmt(v_avail) || '（已驗入的庫存扣掉已配發的）', jsonb_build_object('available', v_avail));
    END IF;

    -- 型號：取料件對應；沒有對應就必須手動選；要改（與對應不同）須填原因。
    SELECT equipment_template_id INTO v_map FROM public.ga_parts WHERE id = v_gpart;
    IF p_template_id IS NOT NULL THEN
      v_tpl := p_template_id;
      IF v_map IS DISTINCT FROM v_tpl AND v_map IS NOT NULL AND v_reason IS NULL THEN
        PERFORM public.ga_po_raise(400, 'TEMPLATE_REASON_REQUIRED', '這個料件對應的設備型號與您選的不同，改型號必須填寫原因');
      END IF;
    ELSE
      IF v_map IS NULL THEN PERFORM public.ga_po_raise(422, 'TEMPLATE_REQUIRED', '這個料件還沒有對應的設備型號，請選擇要建立的設備型號（也可先到料件頁設定對應）'); END IF;
      v_tpl := v_map;
    END IF;
    SELECT * INTO v_tpl_row FROM public.ga_equipment_templates WHERE id = v_tpl AND deleted_at IS NULL AND is_active;
    IF NOT FOUND THEN
      PERFORM public.ga_po_raise(422, 'TEMPLATE_INVALID', CASE WHEN p_template_id IS NULL THEN '這個料件對應的設備型號已停用或刪除，請改選其他型號（並填原因）' ELSE '您選的設備型號不存在或已停用' END);
    END IF;

    -- 序號：正規化、清單內不重複、與既有設備不重複
    FOR v_k IN 1..v_n LOOP
      v_el := CASE WHEN p_serials IS NULL THEN NULL ELSE p_serials -> (v_k - 1) END;
      v_serial := CASE WHEN v_el IS NULL OR jsonb_typeof(v_el) = 'null' THEN NULL ELSE ga_normalize_optional_text(v_el #>> '{}') END;
      IF v_serial IS NOT NULL AND length(v_serial) > 100 THEN PERFORM public.ga_po_raise(400, 'SERIAL_TOO_LONG', '序號不可超過 100 字'); END IF;
      IF v_serial IS NOT NULL THEN
        IF upper(v_serial) = ANY (SELECT upper(x) FROM unnest(v_serials) x WHERE x IS NOT NULL) THEN
          PERFORM public.ga_po_raise(409, 'SERIAL_DUPLICATE', '序號「' || v_serial || '」在這次配發中重複');
        END IF;
        IF public.ga_po_serial_conflict(v_tpl, v_serial) THEN
          PERFORM public.ga_po_raise(409, 'SERIAL_DUPLICATE', '序號「' || v_serial || '」已被同型號的其他設備使用');
        END IF;
      END IF;
      v_serials := array_append(v_serials, v_serial);
    END LOOP;

    v_ratio := v_item.quantity_base / v_item.quantity;
    v_price := round(v_item.unit_price / v_ratio, 2);
    v_req := CASE WHEN v_item.request_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ga_service_requests WHERE id = v_item.request_id AND store_id = p_store_id) THEN v_item.request_id END;
    v_dno := public.ga_next_dispatch_no();
    INSERT INTO public.ga_stock_dispatches (dispatch_no, po_item_id, part_id, store_id, quantity, equipment_template_id, template_change_reason, source_location_id,
                                            request_id, idempotency_key, payload_hash, notes, created_by)
    VALUES (v_dno, p_po_item_id, v_gpart, p_store_id, v_n, v_tpl, v_reason, v_src, v_req, v_key, v_hash, v_note, v_uid) RETURNING id INTO v_did;

    PERFORM set_config('app.ga_inv_internal_post', 'true', true);
    v_res := public.ga_ws_inv_post('ISSUE', v_src, v_gpart, v_n, 'BASE', '配發為設備：' || v_dno, v_note, v_key || ':ISSUE', NULL, 'GA_PURCHASE_ORDER', v_po.id,
      jsonb_build_object('po_no', v_po.po_no, 'dispatch_no', v_dno, 'po_item_id', p_po_item_id, 'store_id', p_store_id));
    PERFORM set_config('app.ga_inv_internal_post', 'false', true);
    IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%', v_res::text USING ERRCODE = 'GA001'; END IF;
    UPDATE public.ga_stock_dispatches SET issue_transaction_id = (v_res->'data'->>'transaction_id')::uuid WHERE id = v_did;

    v_left := v_n;
    FOR v_ri IN SELECT ri.id, ri.accepted_base - ri.dispatched_qty AS avail, r.received_date
                  FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_receipts r ON r.id = ri.receipt_id
                 WHERE ri.po_item_id = p_po_item_id AND ri.inventory_transaction_id IS NOT NULL AND ri.location_id = v_src AND ri.received_part_id = v_gpart AND ri.accepted_base - ri.dispatched_qty > 0
                 ORDER BY r.received_date, r.created_at, ri.id FOR UPDATE OF ri LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_left, trunc(v_ri.avail)::integer);
      CONTINUE WHEN v_take <= 0;
      FOR v_k IN 1..v_take LOOP
        v_idx := v_idx + 1;
        v_eids := array_append(v_eids, public.ga_po_make_equipment(v_tpl, p_store_id, v_serials[v_idx], v_ri.received_date, v_price, v_po.id, p_po_item_id, v_ri.id, v_did, v_req));
      END LOOP;
      UPDATE public.ga_purchase_receipt_items SET dispatched_qty = dispatched_qty + v_take WHERE id = v_ri.id;
      v_dist := v_dist || jsonb_build_array(jsonb_build_object('receipt_item_id', v_ri.id, 'received_date', v_ri.received_date, 'quantity', v_take));
      v_left := v_left - v_take;
    END LOOP;
    IF v_left > 0 THEN PERFORM public.ga_po_raise(409, 'OVER_DISPATCH', '可配發量不足（可能剛被其他人配發），請重新整理後再試'); END IF;
    UPDATE public.ga_purchase_order_items SET dispatched_qty = dispatched_qty + v_n WHERE id = p_po_item_id;
    UPDATE public.ga_purchase_orders SET updated_by = v_uid WHERE id = v_po.id;
    PERFORM public.ga_po_event(v_po.id, 'dispatch', v_po.status, v_po.status, v_uid, v_note,
      jsonb_build_object('dispatch_id', v_did, 'dispatch_no', v_dno, 'po_item_id', p_po_item_id, 'store_id', p_store_id, 'store_name', COALESCE(v_store.short_name, v_store.store_name),
                         'quantity', v_n, 'template_id', v_tpl, 'template_change_reason', v_reason, 'distribution', v_dist));
    IF v_req IS NOT NULL THEN
      PERFORM public.ga_po_request_timeline(v_req, 'PURCHASE_ORDER_DISPATCHED', '採購單 ' || v_po.po_no || ' 已配發 ' || v_n || ' 台設備到門市（' || v_dno || '）', NULL,
        jsonb_build_object('po_id', v_po.id, 'dispatch_no', v_dno, 'quantity', v_n), v_uid);
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_dispatch_data(v_did), 'po', public.ga_po_data(v_po.id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 7. 查詢：進貨與配發明細、各品項可配發量
CREATE OR REPLACE FUNCTION public.ga_ws_po_receipts_get(p_po_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '沒有查看採購單的權限'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE id = p_po_id) THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'receipts', (SELECT COALESCE(jsonb_agg(public.ga_po_receipt_data(r.id) ORDER BY r.received_date, r.created_at, r.id), '[]'::jsonb) FROM public.ga_purchase_receipts r WHERE r.po_id = p_po_id),
    'dispatches', (SELECT COALESCE(jsonb_agg(public.ga_po_dispatch_data(d.id) ORDER BY d.created_at, d.id), '[]'::jsonb)
                     FROM public.ga_stock_dispatches d JOIN public.ga_purchase_order_items i ON i.id = d.po_item_id WHERE i.po_id = p_po_id),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'po_item_id', i.id, 'line_no', i.line_no, 'item_name', i.item_name, 'unit', i.unit, 'fulfil_mode', i.fulfil_mode, 'quantity', i.quantity,
                'received_qty', i.received_qty, 'remaining_qty', i.quantity - i.received_qty,
                'received_base', COALESCE((SELECT sum(ri.accepted_base) FROM public.ga_purchase_receipt_items ri WHERE ri.po_item_id = i.id AND ri.inventory_transaction_id IS NOT NULL), 0),
                'dispatched_base', i.dispatched_qty,
                'dispatchable_base', COALESCE((SELECT sum(ri.accepted_base - ri.dispatched_qty) FROM public.ga_purchase_receipt_items ri WHERE ri.po_item_id = i.id AND ri.inventory_transaction_id IS NOT NULL), 0),
                'part_equipment_template_id', (SELECT equipment_template_id FROM public.ga_parts WHERE id = i.part_id)) ORDER BY i.line_no), '[]'::jsonb)
                FROM public.ga_purchase_order_items i WHERE i.po_id = p_po_id)));
END;
$$;

-- ---------------------------------------------------------------- 8. 序號補填（店長貼標時補）
CREATE OR REPLACE FUNCTION public.ga_ws_onboarding_set_serial(p_equipment_id uuid, p_serial text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_serial text := ga_normalize_optional_text(p_serial);
  v_reason text := ga_normalize_optional_text(p_reason);
  v_e public.ga_equipment%ROWTYPE;
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_serial IS NULL THEN RETURN public.ga_po_err(400, 'SERIAL_REQUIRED', '請輸入序號'); END IF;
  IF length(v_serial) > 100 THEN RETURN public.ga_po_err(400, 'SERIAL_TOO_LONG', '序號不可超過 100 字'); END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 200 THEN RETURN public.ga_po_err(400, 'REASON_TOO_LONG', '原因不可超過 200 字'); END IF;
  BEGIN
    SELECT * INTO v_e FROM public.ga_equipment WHERE id = p_equipment_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這台設備'); END IF;
    v_ok := has_permission(v_uid, 'general_affairs.equipment.manage')
            OR EXISTS (SELECT 1 FROM public.store_managers WHERE user_id = v_uid AND store_id = v_e.store_id);
    IF NOT v_ok THEN RETURN public.ga_po_err(403, 'PERMISSION_DENIED', '只有這間門市的店長或擁有設備管理權限的人可以補填序號'); END IF;
    IF v_e.status IN ('SCRAPPED', 'RETIRED') THEN RETURN public.ga_po_err(409, 'INVALID_STATE', '這台設備已報廢或退役，不能補填序號'); END IF;
    IF v_e.serial_number IS NOT NULL AND upper(btrim(v_e.serial_number)) = upper(v_serial) THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_e.id, 'serial_number', v_e.serial_number, 'changed', false));
    END IF;
    IF v_e.serial_number IS NOT NULL AND v_reason IS NULL THEN
      RETURN public.ga_po_err(400, 'REASON_REQUIRED', '這台設備已有序號（' || v_e.serial_number || '），要修改必須填寫原因');
    END IF;
    IF public.ga_po_serial_conflict(v_e.template_id, v_serial, v_e.id)
       OR EXISTS (SELECT 1 FROM public.ga_equipment x WHERE x.deleted_at IS NULL AND x.id <> v_e.id AND upper(btrim(x.serial_number)) = upper(v_serial)
                    AND v_e.brand IS NOT NULL AND v_e.model IS NOT NULL AND upper(x.brand) = upper(v_e.brand) AND upper(x.model) = upper(v_e.model)) THEN
      RETURN public.ga_po_err(409, 'SERIAL_DUPLICATE', '序號「' || v_serial || '」已被同型號的其他設備使用');
    END IF;
    UPDATE public.ga_equipment SET serial_number = v_serial WHERE id = v_e.id;
    INSERT INTO public.ga_equipment_serial_events (equipment_id, old_serial, new_serial, reason, actor_id) VALUES (v_e.id, v_e.serial_number, v_serial, v_reason, v_uid);
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_e.id, 'serial_number', v_serial, 'changed', true));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 9. 開放給登入者呼叫（函式內各自驗權限與身分）；內部輔助不開放
REVOKE ALL ON FUNCTION public.ga_parts_check_equipment_template() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_next_receipt_no() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_next_dispatch_no() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_unit_type(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_serial_conflict(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_make_equipment(uuid, uuid, text, date, numeric, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_receipt_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_dispatch_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_po_request_timeline(uuid, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_po_receive(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_dispatch(uuid, uuid, numeric, uuid, text, uuid, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_po_receipts_get(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_onboarding_set_serial(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_receive(uuid, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_dispatch(uuid, uuid, numeric, uuid, text, uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_receipts_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_onboarding_set_serial(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname IN ('ga_ws_po_receive', 'ga_ws_po_dispatch', 'ga_ws_po_receipts_get', 'ga_ws_onboarding_set_serial') ORDER BY 1;
-- 核對：應列出 4 個函式
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'ga_parts' AND column_name = 'equipment_template_id') OR (table_name = 'ga_equipment' AND column_name IN ('source_purchase_order_id', 'source_po_item_id', 'source_receipt_item_id', 'source_dispatch_id', 'source_request_id', 'vendor_id', 'vendor_name_snapshot', 'warranty_start_date'))) ORDER BY 1, 2;
-- 核對：應列出 9 個欄位
SELECT to_regclass('public.ga_purchase_receipts') AS receipts, to_regclass('public.ga_purchase_receipt_items') AS receipt_items, to_regclass('public.ga_stock_dispatches') AS dispatches, to_regclass('public.ga_equipment_serial_events') AS serial_events;
-- 核對：四個都不是空的
