-- 28-b3-inventory-post.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261111110000_m7m8_b3_inventory_post.sql 相同。
-- G12 庫存餘額、流水、過帳、持有狀態（2026-11-11 第 3 批問卷 C4、C5、C6、C7、Q14）。
-- 性質：會寫入，但只新增 4 個函式，不改任何資料表、資料、觸發器，也不改過帳核心 ga_post_inventory_transaction 與持有狀態函式 ga_set_inventory_holding_allocation（舊版畫面完全不受影響）。
-- 新增：ga_inv_map_error（核心錯誤換白話）、ga_ws_inv_post（過帳包裝：兩個權限缺哪個講清楚、固定識別必填、發生時間不可填未來、最後異動時間不倒退、核心錯誤整筆回復）、
--       ga_ws_inv_set_holding（持有狀態調整：版本檢查 STALE、原因寫入既有事件表 notes）、ga_ws_inv_balance_page（餘額清單：分頁、低庫存紅黃標、精確統計；每一列沿用 ga_inventory_balance_is_visible 可見性規則）。
-- 先決條件：持有狀態兩張表（ga_inventory_holding_allocations、ga_inventory_holding_events）與 ga_set_inventory_holding_allocation 必須已存在——它們在 supabase/migrations/20260925093000，正式區可能漏套；
--           先跑 26-b3-preview-before-apply.sql 第 3 區確認。缺的話本檔開頭會中止，請先補套那支 migration（經使用者核可）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。沒有資料要備份（只新增函式）。撤回：28-b3-inventory-post-rollback.sql。
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.ga_inventory_balances') IS NULL OR to_regclass('public.ga_inventory_transactions') IS NULL
     OR to_regclass('public.ga_inventory_locations') IS NULL OR to_regclass('public.ga_inventory_location_parts') IS NULL
     OR to_regclass('public.ga_inventory_holding_allocations') IS NULL OR to_regclass('public.ga_inventory_holding_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 總務庫存餘額／流水／持有狀態資料表（ga_inventory_*，持有狀態兩張表在 20260925093000 這支）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_post_inventory_transaction')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_set_inventory_holding_allocation')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'has_permission')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_normalize_optional_text') THEN
    RAISE EXCEPTION 'Missing prerequisite function (ga_post_inventory_transaction / ga_set_inventory_holding_allocation / has_permission / ga_normalize_optional_text)';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 錯誤對照
CREATE OR REPLACE FUNCTION public.ga_inv_map_error(p_message text, p_sqlstate text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_code text := substring(COALESCE(p_message, '') FROM '^([A-Z][A-Z0-9_]+):');
  v_detail text := btrim(regexp_replace(COALESCE(p_message, ''), '^[A-Z][A-Z0-9_]+:\s*', ''));
BEGIN
  IF v_code IS NULL AND p_sqlstate = '23505' THEN v_code := 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN CASE v_code
    WHEN 'AUTH_REQUIRED' THEN jsonb_build_object('ok', false, 'status', 401, 'code', v_code, 'error', '請先登入')
    WHEN 'PERMISSION_DENIED' THEN jsonb_build_object('ok', false, 'status', 403, 'code', v_code, 'error', '沒有庫存交易管理權限')
    WHEN 'PART_VIEW_REQUIRED' THEN jsonb_build_object('ok', false, 'status', 403, 'code', v_code, 'error', '缺少「料件查看」權限，因此無法過帳')
    WHEN 'LOCATION_NOT_FOUND' THEN jsonb_build_object('ok', false, 'status', 404, 'code', v_code, 'error', '找不到這個庫存位置（可能已被刪除）')
    WHEN 'LOCATION_INACTIVE' THEN jsonb_build_object('ok', false, 'status', 409, 'code', v_code, 'error', '這個庫存位置已停用，不能過帳')
    WHEN 'PART_NOT_FOUND' THEN jsonb_build_object('ok', false, 'status', 404, 'code', v_code, 'error', '找不到這個料件（可能已被刪除）')
    WHEN 'PART_INACTIVE' THEN jsonb_build_object('ok', false, 'status', 409, 'code', v_code, 'error', '這個料件已停用，不能過帳')
    WHEN 'LOCATION_PART_NOT_CONFIGURED' THEN jsonb_build_object('ok', false, 'status', 422, 'code', v_code, 'error', '這個位置還沒有設定（或已停用）這個料件，請先到「庫存位置」加入料件設定')
    WHEN 'INVALID_PURCHASE_UNIT' THEN jsonb_build_object('ok', false, 'status', 422, 'code', v_code, 'error', '這個料件沒有設定有效的採購單位換算率，請改用基本單位')
    WHEN 'INVALID_UNIT_TYPE' THEN jsonb_build_object('ok', false, 'status', 400, 'code', v_code, 'error', '單位類型錯誤')
    WHEN 'INVALID_TRANSACTION_TYPE' THEN jsonb_build_object('ok', false, 'status', 400, 'code', v_code, 'error', '交易類型錯誤')
    WHEN 'INVALID_QUANTITY' THEN jsonb_build_object('ok', false, 'status', 400, 'code', v_code, 'error', CASE WHEN v_detail ~ '[㐀-鿿]' THEN v_detail ELSE '數量或內容錯誤' END)
    WHEN 'FRACTIONAL_NOT_ALLOWED' THEN jsonb_build_object('ok', false, 'status', 422, 'code', v_code, 'error', '這個料件不允許小數數量，請輸入整數')
    WHEN 'MINIMUM_ISSUE_NOT_MET' THEN jsonb_build_object('ok', false, 'status', 422, 'code', v_code, 'error', '低於這個料件的最小領用量')
    WHEN 'UNPACKING_NOT_ALLOWED' THEN jsonb_build_object('ok', false, 'status', 422, 'code', v_code, 'error', '這個料件不允許拆包領用，出庫數量必須是採購單位的整數倍')
    WHEN 'INSUFFICIENT_STOCK' THEN jsonb_build_object('ok', false, 'status', 409, 'code', v_code, 'error', '庫存不足，而且這個位置不允許負庫存')
    WHEN 'IDEMPOTENCY_CONFLICT' THEN jsonb_build_object('ok', false, 'status', 409, 'code', v_code, 'error', '這個送出識別碼已被另一筆不同內容的交易使用，請重新整理畫面後再送出')
    WHEN 'BALANCE_NOT_FOUND' THEN jsonb_build_object('ok', false, 'status', 404, 'code', v_code, 'error', '找不到這筆庫存餘額')
    WHEN 'INVALID_HOLDING_QUANTITY' THEN jsonb_build_object('ok', false, 'status', 400, 'code', v_code, 'error', '使用中與閒置數量必須是 0 以上的數字')
    WHEN 'HOLDING_EXCEEDS_BALANCE' THEN jsonb_build_object('ok', false, 'status', 409, 'code', v_code, 'error', '使用中與閒置的合計不可超過目前的實際持有量')
    ELSE jsonb_build_object('ok', false, 'status', 500, 'code', 'UNKNOWN_ERROR', 'error', '操作失敗，請稍後重試')
  END;
END;
$$;

-- ---------------------------------------------------------------- 2. 過帳包裝
CREATE OR REPLACE FUNCTION public.ga_ws_inv_post(
  p_transaction_type text,
  p_location_id uuid,
  p_part_id uuid,
  p_quantity numeric,
  p_input_unit_type text,
  p_reason text,
  p_notes text,
  p_idempotency_key text,
  p_occurred_at timestamptz DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := ga_normalize_optional_text(p_idempotency_key);
  v_can_post boolean;
  v_can_part boolean;
  v_prev_at timestamptz;
  v_r record;
  v_last timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'AUTH_REQUIRED', 'error', '請先登入'); END IF;
  v_can_post := has_permission(v_uid, 'general_affairs.inventory_transaction.manage');
  v_can_part := has_permission(v_uid, 'general_affairs.part.view') OR has_permission(v_uid, 'general_affairs.part.manage');
  IF NOT v_can_post OR NOT v_can_part THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', CASE WHEN NOT v_can_post THEN 'PERMISSION_DENIED' ELSE 'PART_VIEW_REQUIRED' END,
      'missing', to_jsonb(array_remove(ARRAY[CASE WHEN NOT v_can_post THEN 'transaction.manage' END, CASE WHEN NOT v_can_part THEN 'part.view' END], NULL)),
      'error', '過帳需要「庫存交易管理」與「料件查看」兩個權限，您缺少：' || concat_ws('、', CASE WHEN NOT v_can_post THEN '庫存交易管理' END, CASE WHEN NOT v_can_part THEN '料件查看' END));
  END IF;
  IF v_key IS NULL OR length(v_key) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'error', '缺少防重複識別碼，請重新整理畫面後再送出');
  END IF;
  IF p_occurred_at IS NOT NULL AND p_occurred_at > now() + interval '1 minute' THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'code', 'FUTURE_OCCURRED_AT', 'error', '發生時間不可晚於現在');
  END IF;

  -- 與核心相同的鎖（交易內可重入）：先鎖住這個位置與料件，才讀得到穩定的「上次異動時間」。
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_inventory_location_part:' || p_location_id::text || ':' || p_part_id::text, 0));
  SELECT last_transaction_at INTO v_prev_at FROM public.ga_inventory_balances WHERE location_id = p_location_id AND part_id = p_part_id;

  BEGIN
    SELECT * INTO v_r FROM public.ga_post_inventory_transaction(
      p_transaction_type, p_location_id, p_part_id, p_quantity, p_input_unit_type, p_reason, p_notes,
      p_reference_type, p_reference_id, v_key, p_occurred_at, COALESCE(p_metadata, '{}'::jsonb));
  EXCEPTION WHEN OTHERS THEN
    -- 子交易已回復核心的任何寫入；只回白話說明。
    RETURN public.ga_inv_map_error(SQLERRM, SQLSTATE);
  END;

  v_last := v_r.occurred_at;
  -- 補登舊日期的交易不可讓「最後異動時間」倒退（核心會把它設成該筆的發生時間）。
  IF NOT v_r.idempotent_replay AND v_prev_at IS NOT NULL AND v_prev_at > v_r.occurred_at THEN
    UPDATE public.ga_inventory_balances SET last_transaction_at = v_prev_at WHERE id = v_r.balance_id;
    v_last := v_prev_at;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_r.idempotent_replay THEN 200 ELSE 201 END, 'data', jsonb_build_object(
    'transaction_id', v_r.transaction_id, 'transaction_no', v_r.transaction_no, 'transaction_type', v_r.transaction_type,
    'location_id', v_r.location_id, 'part_id', v_r.part_id, 'quantity_input', v_r.quantity_input, 'input_unit_type', v_r.input_unit_type,
    'unit_conversion_rate', v_r.unit_conversion_rate, 'quantity_base', v_r.quantity_base,
    'balance_before', v_r.balance_before, 'balance_after', v_r.balance_after, 'occurred_at', v_r.occurred_at, 'created_at', v_r.created_at,
    'balance_id', v_r.balance_id, 'balance_quantity_base', v_r.balance_quantity_base, 'balance_version', v_r.balance_version,
    'last_transaction_at', v_last, 'idempotent_replay', v_r.idempotent_replay));
END;
$$;

-- ---------------------------------------------------------------- 3. 持有狀態調整（C4）
-- p_expected_updated_at：目前畫面上看到的調整時間（還沒有調整過為 NULL）；與資料庫不同 = 已被別人改過（STALE）。
CREATE OR REPLACE FUNCTION public.ga_ws_inv_set_holding(p_balance_id uuid, p_in_use numeric, p_idle numeric, p_reason text, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := ga_normalize_optional_text(p_reason);
  v_bal public.ga_inventory_balances%ROWTYPE;
  v_cur_at timestamptz;
  v_row public.ga_inventory_holding_allocations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'AUTH_REQUIRED', 'error', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_transaction.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'PERMISSION_DENIED', 'error', '沒有庫存交易管理權限，不能調整持有狀態');
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '調整原因不可超過 500 字'); END IF;
  IF p_in_use IS NULL OR p_idle IS NULL OR p_in_use < 0 OR p_idle < 0 OR p_in_use > 999999999 OR p_idle > 999999999
     OR round(p_in_use, 4) <> p_in_use OR round(p_idle, 4) <> p_idle THEN
    RETURN public.ga_inv_map_error('INVALID_HOLDING_QUANTITY: x', '');
  END IF;
  SELECT * INTO v_bal FROM public.ga_inventory_balances WHERE id = p_balance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_inv_map_error('BALANCE_NOT_FOUND: x', ''); END IF;
  SELECT updated_at INTO v_cur_at FROM public.ga_inventory_holding_allocations WHERE balance_id = p_balance_id;
  IF v_cur_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆持有狀態已被其他人調整過，請重新載入後再處理');
  END IF;
  BEGIN
    SELECT * INTO v_row FROM public.ga_set_inventory_holding_allocation(p_balance_id, p_in_use, p_idle, v_reason);
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_inv_map_error(SQLERRM, SQLSTATE);
  END;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'balance_id', v_row.balance_id, 'in_use_quantity', v_row.in_use_quantity, 'idle_quantity', v_row.idle_quantity,
    'unclassified_quantity', GREATEST(0, v_bal.quantity_base - v_row.in_use_quantity - v_row.idle_quantity),
    'notes', v_row.notes, 'updated_at', v_row.updated_at));
END;
$$;

-- ---------------------------------------------------------------- 4. 餘額與持有狀態清單（C5 分頁、C7 低庫存、精確統計）
-- SECURITY DEFINER 且每一列用 ga_inventory_balance_is_visible（與餘額表 RLS 完全相同的規則）過濾；位置、料件名稱用資料庫身分讀（只有只看餘額、沒有位置或料件權限的人也要看得到是哪個位置與料件，只取公開欄位）。
-- 統計（stats）針對「位置／料件／搜尋」條件下的全部列（不受是否含 0、低庫存、持有狀態篩選影響），是資料庫端精確數字。
CREATE OR REPLACE FUNCTION public.ga_ws_inv_balance_page(
  p_location_id uuid DEFAULT NULL,
  p_part_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_include_zero boolean DEFAULT false,
  p_low_only boolean DEFAULT false,
  p_holding text DEFAULT NULL,
  p_sort text DEFAULT 'last_transaction_at',
  p_ascending boolean DEFAULT false,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_term text := left(btrim(COALESCE(p_search, '')), 100);
  v_pat text;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort text := CASE WHEN p_sort IN ('quantity_base', 'last_transaction_at', 'updated_at', 'idle_quantity', 'part_name', 'location_name') THEN p_sort ELSE 'last_transaction_at' END;
  v_holding text := upper(COALESCE(p_holding, ''));
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: 請先登入'; END IF;
  v_pat := CASE WHEN v_term = '' THEN NULL ELSE '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  WITH base AS (
    SELECT b.id, b.location_id, b.part_id, b.quantity_base, b.last_transaction_at, b.version, b.updated_at,
           l.id AS l_id, l.code AS l_code, l.name AS l_name, l.location_type, l.store_id, l.allow_negative_stock,
           p.id AS p_id, p.name AS p_name, p.part_code, p.brand, p.model, p.specification, p.base_unit, p.purchase_unit, p.purchase_to_base_rate,
           lp.safety_stock_qty, lp.reorder_point_qty, lp.maximum_stock_qty,
           COALESCE(h.in_use_quantity, 0) AS in_use, COALESCE(h.idle_quantity, 0) AS idle, h.notes AS h_notes, h.updated_at AS h_updated_at,
           CASE WHEN lp.safety_stock_qty IS NOT NULL AND b.quantity_base < lp.safety_stock_qty THEN 'red'
                WHEN lp.reorder_point_qty IS NOT NULL AND b.quantity_base < lp.reorder_point_qty THEN 'yellow' END AS level
      FROM public.ga_inventory_balances b
      JOIN public.ga_inventory_locations l ON l.id = b.location_id AND l.deleted_at IS NULL
      LEFT JOIN public.ga_parts p ON p.id = b.part_id
      LEFT JOIN LATERAL (SELECT x.safety_stock_qty, x.reorder_point_qty, x.maximum_stock_qty FROM public.ga_inventory_location_parts x
                          WHERE x.location_id = b.location_id AND x.part_id = b.part_id AND x.deleted_at IS NULL AND x.is_active
                          ORDER BY x.updated_at DESC LIMIT 1) lp ON true
      LEFT JOIN public.ga_inventory_holding_allocations h ON h.balance_id = b.id
     WHERE public.ga_inventory_balance_is_visible(b.location_id)
       AND (p_location_id IS NULL OR b.location_id = p_location_id)
       AND (p_part_id IS NULL OR b.part_id = p_part_id)
       AND (v_pat IS NULL OR l.name ILIKE v_pat OR l.code ILIKE v_pat OR p.name ILIKE v_pat OR p.part_code ILIKE v_pat OR p.barcode ILIKE v_pat
            OR p.brand ILIKE v_pat OR p.model ILIKE v_pat OR p.specification ILIKE v_pat)
  ), stats AS (
    SELECT jsonb_build_object(
      'rows', count(*), 'nonzero', count(*) FILTER (WHERE quantity_base <> 0), 'zero', count(*) FILTER (WHERE quantity_base = 0),
      'negative', count(*) FILTER (WHERE quantity_base < 0),
      'red', count(*) FILTER (WHERE level = 'red'), 'yellow', count(*) FILTER (WHERE level = 'yellow'),
      'total_qty', COALESCE(sum(quantity_base) FILTER (WHERE quantity_base > 0), 0),
      'in_use', COALESCE(sum(LEAST(in_use, quantity_base)) FILTER (WHERE quantity_base > 0), 0),
      'idle', COALESCE(sum(LEAST(idle, GREATEST(quantity_base - LEAST(in_use, quantity_base), 0))) FILTER (WHERE quantity_base > 0), 0),
      'unclassified', COALESCE(sum(GREATEST(0, quantity_base - in_use - idle)) FILTER (WHERE quantity_base > 0), 0)
    ) AS s FROM base
  ), filtered AS (
    SELECT * FROM base
     WHERE (p_include_zero OR quantity_base <> 0)
       AND (NOT COALESCE(p_low_only, false) OR level IS NOT NULL)
       AND (v_holding = '' OR (quantity_base > 0 AND (
             (v_holding = 'ALL') OR (v_holding = 'IN_USE' AND in_use > 0) OR (v_holding = 'IDLE' AND idle > 0) OR (v_holding = 'UNCLASSIFIED' AND quantity_base - in_use - idle > 0))))
  ), paged AS (
    SELECT f.*, row_number() OVER (ORDER BY
        (CASE v_sort WHEN 'quantity_base' THEN f.quantity_base WHEN 'idle_quantity' THEN f.idle
                     WHEN 'last_transaction_at' THEN extract(epoch FROM f.last_transaction_at)::numeric WHEN 'updated_at' THEN extract(epoch FROM f.updated_at)::numeric END)
          * (CASE WHEN p_ascending THEN 1 ELSE -1 END) NULLS LAST,
        (CASE WHEN p_ascending THEN CASE v_sort WHEN 'part_name' THEN f.p_name WHEN 'location_name' THEN f.l_name END END) ASC,
        (CASE WHEN NOT p_ascending THEN CASE v_sort WHEN 'part_name' THEN f.p_name WHEN 'location_name' THEN f.l_name END END) DESC,
        f.id) AS rn
      FROM filtered f
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'stats', (SELECT s FROM stats),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', x.id, 'location_id', x.location_id, 'part_id', x.part_id, 'quantity_base', x.quantity_base, 'last_transaction_at', x.last_transaction_at,
      'version', x.version, 'updated_at', x.updated_at, 'level', x.level,
      'safety_stock_qty', x.safety_stock_qty, 'reorder_point_qty', x.reorder_point_qty, 'maximum_stock_qty', x.maximum_stock_qty,
      'holding', jsonb_build_object('in_use_quantity', LEAST(x.in_use, GREATEST(x.quantity_base, 0)),
                                    'idle_quantity', LEAST(x.idle, GREATEST(GREATEST(x.quantity_base, 0) - LEAST(x.in_use, GREATEST(x.quantity_base, 0)), 0)),
                                    'unclassified_quantity', GREATEST(0, x.quantity_base - x.in_use - x.idle), 'notes', x.h_notes, 'updated_at', x.h_updated_at),
      'location', jsonb_build_object('id', x.l_id, 'code', x.l_code, 'name', x.l_name, 'location_type', x.location_type, 'store_id', x.store_id, 'allow_negative_stock', x.allow_negative_stock),
      'part', CASE WHEN x.p_id IS NULL THEN NULL ELSE jsonb_build_object('id', x.p_id, 'name', x.p_name, 'part_code', x.part_code, 'brand', x.brand, 'model', x.model,
                    'specification', x.specification, 'base_unit', x.base_unit, 'purchase_unit', x.purchase_unit, 'purchase_to_base_rate', x.purchase_to_base_rate) END
    ) ORDER BY x.rn) FROM paged x WHERE x.rn > v_offset AND x.rn <= v_offset + v_limit), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------- 授權
REVOKE ALL ON FUNCTION public.ga_inv_map_error(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_inv_post(text, uuid, uuid, numeric, text, text, text, text, timestamptz, text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_set_holding(uuid, numeric, numeric, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_balance_page(uuid, uuid, text, boolean, boolean, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_post(text, uuid, uuid, numeric, text, text, text, text, timestamptz, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_set_holding(uuid, numeric, numeric, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_balance_page(uuid, uuid, text, boolean, boolean, text, text, boolean, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對：應列出 4 個函式
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname IN ('ga_inv_map_error', 'ga_ws_inv_post', 'ga_ws_inv_set_holding', 'ga_ws_inv_balance_page') ORDER BY 1;
